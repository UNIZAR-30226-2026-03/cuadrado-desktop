import { Injectable, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { WebsocketService } from './websocket';

export type MicPermission = 'unknown' | 'granted' | 'denied';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

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

  // ── Internos ───────────────────────────────────────────────────────────────
  private peers       = new Map<string, RTCPeerConnection>();
  private remoteAudio = new Map<string, HTMLAudioElement>();
  private signalSubs: Subscription[] = [];

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
      this.localStream.set(stream);
      this.selectedDeviceId.set(deviceId);
      this.setupLocalAnalyser(stream);
      this.ensureDetectionRunning();
      return stream;
    } catch {
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
  }

  // ── Sala de voz (señalización WebRTC) ─────────────────────────────────────

  joinVoiceRoom(roomId: string): void {
    this.teardownSignaling();
    this.signalSubs = [
      this.ws.voicePeers$.subscribe(peers    => this.onPeers(peers)),
      this.ws.voicePeerJoined$.subscribe(e   => this.onPeerJoined(e.peerId)),
      this.ws.voicePeerLeft$.subscribe(e     => this.onPeerLeft(e.peerId)),
      this.ws.voiceOffer$.subscribe(e        => this.onOffer(e.from, e.offer)),
      this.ws.voiceAnswer$.subscribe(e       => this.onAnswer(e.from, e.answer)),
      this.ws.voiceIceCandidate$.subscribe(e => this.onIceCandidate(e.from, e.candidate)),
    ];
    this.ws.joinVoiceRoom(roomId);
  }

  leaveVoiceRoom(): void {
    this.ws.leaveVoiceRoom();
    this.closeAllPeers();
    this.teardownSignaling();
  }

  // ── Callbacks de señalización ──────────────────────────────────────────────

  private async onPeers(peerIds: string[]): Promise<void> {
    for (const peerId of peerIds) {
      const pc = this.createPeer(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.ws.sendVoiceOffer(peerId, offer);
    }
  }

  private onPeerJoined(_peerId: string): void { /* El nuevo peer nos enviará una oferta */ }

  private async onOffer(from: string, offer: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.createPeer(from);
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.ws.sendVoiceAnswer(from, answer);
  }

  private async onAnswer(from: string, answer: RTCSessionDescriptionInit): Promise<void> {
    await this.peers.get(from)?.setRemoteDescription(answer);
  }

  private async onIceCandidate(from: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peers.get(from);
    if (!pc) return;
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* ignorar */ }
  }

  private onPeerLeft(peerId: string): void { this.closePeer(peerId); }

  // ── Gestión de peers ───────────────────────────────────────────────────────

  private createPeer(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    const stream = this.localStream();
    if (stream) stream.getTracks().forEach(t => pc.addTrack(t, stream));

    pc.ontrack = event => this.attachRemoteAudio(peerId, event.streams[0]);

    pc.onicecandidate = event => {
      if (event.candidate) this.ws.sendIceCandidate(peerId, event.candidate.toJSON());
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.closePeer(peerId);
      }
    };

    this.peers.set(peerId, pc);
    this.connectedPeers.update(list => [...list, peerId]);
    return pc;
  }

  private attachRemoteAudio(peerId: string, stream: MediaStream): void {
    let el = this.remoteAudio.get(peerId);
    if (!el) {
      el = new Audio();
      el.autoplay = true;
      this.remoteAudio.set(peerId, el);
    }
    el.srcObject = stream;
    el.volume = this.outputVolume() / 100;
    this.setupRemoteAnalyser(peerId, stream);
    this.ensureDetectionRunning();
  }

  private closePeer(peerId: string): void {
    this.peers.get(peerId)?.close();
    this.peers.delete(peerId);
    const el = this.remoteAudio.get(peerId);
    if (el) { el.srcObject = null; this.remoteAudio.delete(peerId); }
    this.remoteAnalysers.delete(peerId);
    this.speakingPeers.update(s => { const n = new Set(s); n.delete(peerId); return n; });
    this.connectedPeers.update(list => list.filter(id => id !== peerId));
    this.maybeStopDetection();
  }

  private closeAllPeers(): void {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
  }

  private replaceTrackInPeer(pc: RTCPeerConnection): void {
    const track = this.localStream()?.getAudioTracks()[0];
    if (!track) return;
    pc.getSenders().find(s => s.track?.kind === 'audio')?.replaceTrack(track);
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
