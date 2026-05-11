import { Injectable, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { WebsocketService } from './websocket';
import { environment } from '../environment';

export type MicPermission = 'unknown' | 'granted' | 'denied';

function buildIceServers(): RTCIceServer[] {
  // STUN públicos de fallback (descubrimiento de IP pública).
  const stunFallback: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  const custom = environment.iceServers ?? [];
  if (custom.length === 0) {
    console.warn(
      '[voice] No hay TURN configurado en environment.iceServers — los peers detrás ' +
      'de NAT estricto (Eduroam, 4G, oficinas) no podrán oírse. ' +
      'Registra una cuenta gratis en https://dashboard.metered.ca/signup y pega su ' +
      'snippet de iceServers en environment.ts.'
    );
  }
  return [...stunFallback, ...custom];
}

const ICE_SERVERS: RTCIceServer[] = buildIceServers();

const SPEAKING_THRESHOLD = 15; // amplitud media (0-255) para considerar que alguien habla

@Injectable({ providedIn: 'root' })
export class VoiceChatService {
  // ── Señales de configuración ───────────────────────────────────────────────
  readonly micPermission     = signal<MicPermission>('unknown');
  readonly audioInputDevices = signal<MediaDeviceInfo[]>([]);
  readonly localStream       = signal<MediaStream | null>(null);
  readonly selectedDeviceId  = signal<string>('default');
  readonly outputVolume      = signal<number>(80);
  readonly musicVolume       = signal<number>(80);
  readonly sfxVolume         = signal<number>(80);
  readonly micMuted          = signal(false);

  // ── Señales de actividad de voz ────────────────────────────────────────────
  readonly localSpeaking  = signal(false);
  readonly speakingPeers  = signal<ReadonlySet<string>>(new Set());
  readonly connectedPeers = signal<string[]>([]);
  // Peers que yo he silenciado localmente (solo me afecta a mi)
  readonly mutedPeers     = signal<ReadonlySet<string>>(new Set());
  // Peers que se han silenciado a sí mismos (notificado via backend)
  readonly selfMutedPeers = signal<ReadonlySet<string>>(new Set());

  // ── Internos ───────────────────────────────────────────────────────────────
  private peers            = new Map<string, RTCPeerConnection>();
  private remoteAudio      = new Map<string, HTMLAudioElement>();
  private signalSubs: Subscription[] = [];
  // ICE candidates que llegan antes de que setRemoteDescription complete
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();

  private audioCtx: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private remoteAnalysers = new Map<string, AnalyserNode>();
  private detectionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private ws: WebsocketService) {}

  // ── Permisos y dispositivos ────────────────────────────────────────────────

  async requestPermissionAndLoadDevices(): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.micPermission.set('denied');
      return false;
    }
    // Si ya tenemos permiso solo refrescamos la lista
    if (this.micPermission() === 'granted') {
      await this.refreshDeviceList();
      return true;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      this.micPermission.set('granted');
      await this.refreshDeviceList();
      return true;
    } catch {
      this.micPermission.set('denied');
      await this.refreshDeviceList();
      return false;
    }
  }

  async refreshDeviceList(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    this.audioInputDevices.set(
      all.filter(d => d.kind === 'audioinput' && d.deviceId !== 'default'),
    );
  }

  // ── Volúmenes de configuración ─────────────────────────────────────────────

  setOutputVolume(volume: number): void {
    this.outputVolume.set(clamp(volume));
    const vol = this.outputVolume() / 100;
    this.remoteAudio.forEach(el => (el.volume = vol));
  }

  setMusicVolume(volume: number): void { this.musicVolume.set(clamp(volume)); }
  setSfxVolume(volume: number): void   { this.sfxVolume.set(clamp(volume)); }

  // ── Stream local (micrófono) ───────────────────────────────────────────────

  async startLocalStream(deviceId: string = 'default'): Promise<MediaStream | null> {
    this.stopLocalStream();
    const constraints: MediaStreamConstraints = {
      audio: deviceId === 'default' ? true : { deviceId: { exact: deviceId } },
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const tracks = stream.getAudioTracks();
      console.log(`[voice] startLocalStream OK — audio tracks=${tracks.length}, label="${tracks[0]?.label}"`);
      this.localStream.set(stream);
      this.selectedDeviceId.set(deviceId);
      // Sincronizar el estado real de las pistas con el flag micMuted: si el usuario
      // entra con el servicio ya en "muteado", las nuevas pistas vienen enabled=true
      // por defecto y la UI mostraría silenciado mientras el audio sí se transmite.
      tracks.forEach(t => (t.enabled = !this.micMuted()));
      this.setupLocalAnalyser(stream);
      this.ensureDetectionRunning();
      // Si ya hay peers conectados (caso reentry/revancha), inyectar la nueva pista
      // en todos los senders para que la transmisión continúe sin renegociar.
      this.peers.forEach(pc => this.replaceTrackInPeer(pc));
      return stream;
    } catch (err) {
      console.error('[voice] startLocalStream FAILED:', err);
      return null;
    }
  }

  stopLocalStream(): void {
    this.localStream()?.getTracks().forEach(t => t.stop());
    this.localStream.set(null);
    this.localAnalyser = null;
    this.localSpeaking.set(false);
    this.maybeStopDetection();
  }

  async selectDevice(deviceId: string): Promise<void> {
    this.selectedDeviceId.set(deviceId);
    if (this.localStream()) {
      await this.startLocalStream(deviceId);
      this.peers.forEach(pc => this.replaceTrackInPeer(pc));
      if (this.micMuted()) {
        this.localStream()?.getAudioTracks().forEach(t => (t.enabled = false));
      }
    }
  }

  toggleMute(): void {
    const stream = this.localStream();
    if (!stream) return;
    const muted = !this.micMuted();
    stream.getAudioTracks().forEach(t => (t.enabled = !muted));
    this.micMuted.set(muted);
    this.ws.sendVoiceMute(muted);
  }

  toggleMutePeer(peerId: string): void {
    const current = new Set(this.mutedPeers());
    if (current.has(peerId)) {
      current.delete(peerId);
    } else {
      current.add(peerId);
    }
    this.mutedPeers.set(current);
    const el = this.remoteAudio.get(peerId);
    if (el) el.muted = current.has(peerId);
  }

  // ── Sala de voz (señalización WebRTC) ─────────────────────────────────────

  joinVoiceRoom(roomId: string): void {
    console.log(`[voice] joinVoiceRoom(${roomId}) — localStream tracks=${this.localStream()?.getAudioTracks().length ?? 0}`);
    this.teardownSignaling();
    this.selfMutedPeers.set(new Set());
    this.mutedPeers.set(new Set());
    this.signalSubs = [
      this.ws.voicePeers$.subscribe(peers    => this.onPeers(peers)),
      this.ws.voicePeerJoined$.subscribe(e   => this.onPeerJoined(e.peerId)),
      this.ws.voicePeerLeft$.subscribe(e     => this.onPeerLeft(e.peerId)),
      this.ws.voiceOffer$.subscribe(e        => this.onOffer(e.from, e.offer)),
      this.ws.voiceAnswer$.subscribe(e       => this.onAnswer(e.from, e.answer)),
      this.ws.voiceIceCandidate$.subscribe(e => this.onIceCandidate(e.from, e.candidate)),
      this.ws.voiceMuteChanged$.subscribe(e  => this.onMuteChanged(e.peerId, e.muted)),
    ];
    this.ws.joinVoiceRoom(roomId);
  }

  leaveVoiceRoom(): void {
    console.log('[voice] leaveVoiceRoom');
    this.ws.leaveVoiceRoom();
    this.closeAllPeers();
    this.teardownSignaling();
  }

  // ── Callbacks de señalización ──────────────────────────────────────────────

  private async onPeers(peerIds: string[]): Promise<void> {
    console.log(`[voice] voice:peers -> [${peerIds.map(p => p.slice(0, 6)).join(', ')}]`);
    for (const peerId of peerIds) {
      try {
        const pc = this.createPeer(peerId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log(`[voice] offer-> ${peerId.slice(0, 6)}`);
        this.ws.sendVoiceOffer(peerId, offer);
      } catch (err) {
        console.error(`[voice] onPeers error con ${peerId.slice(0, 6)}:`, err);
      }
    }
  }

  private onPeerJoined(peerId: string): void {
    console.log(`[voice] peer-joined: ${peerId.slice(0, 6)} (esperamos su oferta)`);
  }

  private async onOffer(from: string, offer: RTCSessionDescriptionInit): Promise<void> {
    console.log(`[voice] offer<- ${from.slice(0, 6)}`);
    try {
      const pc = this.createPeer(from);
      await pc.setRemoteDescription(offer);
      await this.drainPendingCandidates(from, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log(`[voice] answer-> ${from.slice(0, 6)}`);
      this.ws.sendVoiceAnswer(from, answer);
    } catch (err) {
      console.error(`[voice] onOffer error con ${from.slice(0, 6)}:`, err);
    }
  }

  private async onAnswer(from: string, answer: RTCSessionDescriptionInit): Promise<void> {
    console.log(`[voice] answer<- ${from.slice(0, 6)}`);
    const pc = this.peers.get(from);
    if (!pc) {
      console.warn(`[voice] answer recibido para peer desconocido ${from.slice(0, 6)}`);
      return;
    }
    try {
      await pc.setRemoteDescription(answer);
      await this.drainPendingCandidates(from, pc);
    } catch (err) {
      console.error(`[voice] onAnswer error con ${from.slice(0, 6)}:`, err);
    }
  }

  private async onIceCandidate(from: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peers.get(from);
    if (!pc) return;
    if (!pc.remoteDescription) {
      // remoteDescription aún no está listo: encolar para aplicar después
      const queue = this.pendingCandidates.get(from) ?? [];
      queue.push(candidate);
      this.pendingCandidates.set(from, queue);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn(`[voice] addIceCandidate falló para ${from.slice(0, 6)}:`, err);
    }
  }

  private onPeerLeft(peerId: string): void { this.closePeer(peerId); }

  private onMuteChanged(peerId: string, muted: boolean): void {
    this.selfMutedPeers.update(s => {
      const n = new Set(s);
      if (muted) n.add(peerId); else n.delete(peerId);
      return n;
    });
  }

  // ── Gestión de peers ───────────────────────────────────────────────────────

  private createPeer(peerId: string): RTCPeerConnection {
    const tag = peerId.slice(0, 6);
    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 4,
      bundlePolicy: 'max-bundle',
    });

    // Garantizar siempre una sección m=audio sendrecv en la SDP. Si no hay
    // localStream todavía, igualmente añadimos un transceiver para que la
    // negociación tenga la dirección correcta y luego attacharemos la track
    // cuando esté disponible.
    const stream = this.localStream();
    const localTrack = stream?.getAudioTracks()[0] ?? null;
    if (stream && localTrack) {
      pc.addTrack(localTrack, stream);
    } else {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      console.warn(`[voice] createPeer(${tag}) sin localStream — se añadió transceiver vacío`);
    }

    pc.ontrack = event => {
      const remote = event.streams[0];
      console.log(`[voice] ontrack <- ${tag}, tracks=${remote?.getTracks().length}, kind=${event.track.kind}`);
      this.attachRemoteAudio(peerId, remote);
    };

    pc.onicecandidate = event => {
      if (event.candidate) {
        const c = event.candidate;
        console.log(`[voice] ice-out -> ${tag} type=${c.type} proto=${c.protocol} addr=${c.address ?? c.candidate.slice(0, 40)}`);
        this.ws.sendIceCandidate(peerId, c.toJSON());
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[voice] peer ${tag} iceConnectionState=${pc.iceConnectionState}`);
    };

    pc.onicegatheringstatechange = () => {
      console.log(`[voice] peer ${tag} iceGatheringState=${pc.iceGatheringState}`);
    };

    pc.onsignalingstatechange = () => {
      console.log(`[voice] peer ${tag} signalingState=${pc.signalingState}`);
    };

    pc.onconnectionstatechange = () => {
      console.log(`[voice] peer ${tag} connectionState=${pc.connectionState}`);
      // 'disconnected' es transitorio (puede recuperarse); sólo cerramos en 'failed'.
      if (pc.connectionState === 'failed') {
        console.warn(`[voice] peer ${tag} FAILED — cerrando`);
        this.closePeer(peerId);
      }
    };

    this.peers.set(peerId, pc);
    this.connectedPeers.update(list => [...list, peerId]);
    return pc;
  }

  private attachRemoteAudio(peerId: string, stream: MediaStream): void {
    const tag = peerId.slice(0, 6);
    let el = this.remoteAudio.get(peerId);
    if (!el) {
      el = new Audio();
      el.autoplay = true;
      // Bug histórico de Chromium: un MediaStreamAudioSourceNode solo entrega
      // datos si existe un HTMLMediaElement adjunto al DOM reproduciendo ese
      // mismo stream. Además, en la build empaquetada de Electron los <audio>
      // desligados del DOM no llegan a sonar. Por eso lo añadimos oculto.
      el.setAttribute('playsinline', 'true');
      el.style.display = 'none';
      document.body.appendChild(el);
      this.remoteAudio.set(peerId, el);
    }
    el.srcObject = stream;
    el.volume = this.outputVolume() / 100;
    el.muted = this.mutedPeers().has(peerId);
    // Forzamos play(): aunque autoplay esté permitido por el switch de Electron,
    // si la política de autoplay rechaza el primer intento, capturamos el error
    // sin romper el resto del flujo.
    el.play()
      .then(() => console.log(`[voice] audio remoto reproduciendo (${tag})`))
      .catch(err => console.warn(`[voice] play() rechazado para ${tag}:`, err?.name ?? err));
    this.setupRemoteAnalyser(peerId, stream);
    this.ensureDetectionRunning();
  }

  private closePeer(peerId: string): void {
    this.peers.get(peerId)?.close();
    this.peers.delete(peerId);
    this.pendingCandidates.delete(peerId);
    const el = this.remoteAudio.get(peerId);
    if (el) {
      el.srcObject = null;
      el.remove();
      this.remoteAudio.delete(peerId);
    }
    this.remoteAnalysers.delete(peerId);
    this.speakingPeers.update(s => { const n = new Set(s); n.delete(peerId); return n; });
    this.selfMutedPeers.update(s => { const n = new Set(s); n.delete(peerId); return n; });
    this.mutedPeers.update(s => { const n = new Set(s); n.delete(peerId); return n; });
    this.connectedPeers.update(list => list.filter(id => id !== peerId));
    this.maybeStopDetection();
  }

  private closeAllPeers(): void {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
  }

  private replaceTrackInPeer(pc: RTCPeerConnection): void {
    const track = this.localStream()?.getAudioTracks()[0];
    if (!track) return;
    // Buscar el sender de audio. Si ya tenía track, lo encontramos por kind del track.
    // Si fue creado con addTransceiver vacío, buscamos vía transceivers para no perder
    // la entrega cuando se inicia el stream tras la negociación.
    const sender = pc.getSenders().find(s => s.track?.kind === 'audio')
      ?? pc.getTransceivers().find(t => t.receiver.track?.kind === 'audio' || (t.sender.track === null))?.sender;
    sender?.replaceTrack(track).catch(err => console.warn('[voice] replaceTrack falló:', err));
  }

  private async drainPendingCandidates(peerId: string, pc: RTCPeerConnection): Promise<void> {
    const queued = this.pendingCandidates.get(peerId) ?? [];
    this.pendingCandidates.delete(peerId);
    for (const c of queued) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* ignorar */ }
    }
  }

  private teardownSignaling(): void {
    this.signalSubs.forEach(s => s.unsubscribe());
    this.signalSubs = [];
  }

  // ── Detección de actividad de voz ─────────────────────────────────────────

  private getOrCreateAudioCtx(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new AudioContext();
    }
    return this.audioCtx;
  }

  private setupLocalAnalyser(stream: MediaStream): void {
    try {
      const ctx = this.getOrCreateAudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      this.localAnalyser = analyser;
    } catch { /* AudioContext bloqueado — se intentará en la próxima acción del usuario */ }
  }

  private setupRemoteAnalyser(peerId: string, stream: MediaStream): void {
    try {
      const ctx = this.getOrCreateAudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      this.remoteAnalysers.set(peerId, analyser);
    } catch { /* ignorar */ }
  }

  private ensureDetectionRunning(): void {
    if (this.detectionTimer !== null) return;
    this.detectionTimer = setInterval(() => this.detectSpeaking(), 100);
  }

  private maybeStopDetection(): void {
    if (this.localAnalyser || this.remoteAnalysers.size > 0) return;
    if (this.detectionTimer !== null) {
      clearInterval(this.detectionTimer);
      this.detectionTimer = null;
    }
  }

  private detectSpeaking(): void {
    const buf = new Uint8Array(128);

    // Local
    if (this.localAnalyser) {
      this.localAnalyser.getByteFrequencyData(buf);
      const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
      this.localSpeaking.set(avg > SPEAKING_THRESHOLD);
    }

    // Remote peers
    const speaking = new Set<string>();
    this.remoteAnalysers.forEach((analyser, peerId) => {
      analyser.getByteFrequencyData(buf);
      const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
      if (avg > SPEAKING_THRESHOLD) speaking.add(peerId);
    });
    this.speakingPeers.set(speaking);
  }
}

function clamp(v: number): number { return Math.max(0, Math.min(100, v)); }
