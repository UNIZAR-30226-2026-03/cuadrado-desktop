import { Injectable, signal } from '@angular/core';

export interface MusicTrack {
  file: string;
  name: string;
}

const MUSIC_DIR       = 'music/';
const MANIFEST_PATH   = 'music/manifest.json';
const STORAGE_VOLUME  = 'bgm:volume';
const STORAGE_TRACK   = 'bgm:track';
const DEFAULT_VOLUME  = 50;

@Injectable({ providedIn: 'root' })
export class BackgroundMusicService {
  readonly tracks       = signal<MusicTrack[]>([]);
  readonly currentTrack = signal<MusicTrack | null>(null);
  readonly volume       = signal<number>(loadVolume());

  // Pipeline 100% Web Audio:
  //   AudioBufferSourceNode → GainNode → AudioContext.destination
  // No usamos HTMLAudioElement ni MediaStream, así que el path de salida
  // queda totalmente desacoplado del que utiliza WebRTC para la voz.
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private pendingStart = false;
  private gestureBound = false;
  private initStarted = false;

  async init(): Promise<void> {
    if (this.initStarted) return;
    this.initStarted = true;

    try {
      // latencyHint:'playback' indica a Chromium que es reproducción de alta
      // calidad — no comunicaciones — y le permite usar buffers grandes y la
      // categoría de audio multimedia del SO.
      this.audioCtx = new AudioContext({ latencyHint: 'playback' });
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = this.volume() / 100;
      this.gainNode.connect(this.audioCtx.destination);
      console.log('[bgm] AudioContext listo, sampleRate=', this.audioCtx.sampleRate);
    } catch (err) {
      console.error('[bgm] AudioContext no se pudo crear:', err);
      return;
    }

    const manifestUrl = absoluteUrl(MANIFEST_PATH);
    try {
      const res = await fetch(manifestUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest = await res.json() as { tracks: MusicTrack[] };
      const tracks = Array.isArray(manifest.tracks) ? manifest.tracks : [];
      this.tracks.set(tracks);
      console.log(`[bgm] manifest OK, ${tracks.length} canciones`);
      if (tracks.length === 0) return;
      const saved = localStorage.getItem(STORAGE_TRACK);
      const initial = tracks.find(t => t.file === saved) ?? tracks[0];
      await this.selectTrack(initial.file);
    } catch (err) {
      console.warn('[bgm] No se pudo cargar el manifest:', err);
    }
  }

  async selectTrack(file: string): Promise<void> {
    const track = this.tracks().find(t => t.file === file);
    if (!track || !this.audioCtx || !this.gainNode) return;
    this.currentTrack.set(track);
    localStorage.setItem(STORAGE_TRACK, track.file);

    const buffer = await this.loadBuffer(track.file);
    if (!buffer) return;
    this.startSource(buffer);
  }

  setVolume(volume: number): void {
    const v = clamp(volume);
    this.volume.set(v);
    localStorage.setItem(STORAGE_VOLUME, String(v));
    if (this.gainNode && this.audioCtx) {
      // setTargetAtTime evita clicks por cambio brusco; constante de tiempo
      // muy pequeña para que el cambio sea perceptualmente inmediato.
      this.gainNode.gain.setTargetAtTime(v / 100, this.audioCtx.currentTime, 0.01);
    }
  }

  private async loadBuffer(file: string): Promise<AudioBuffer | null> {
    if (!this.audioCtx) return null;
    const cached = this.buffers.get(file);
    if (cached) return cached;

    const url = absoluteUrl(`${MUSIC_DIR}${encodeURIComponent(file)}`);
    console.log('[bgm] descargando', url);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuf = await res.arrayBuffer();
      const decoded = await this.audioCtx.decodeAudioData(arrayBuf);
      this.buffers.set(file, decoded);
      console.log(`[bgm] decodificada "${file}" — ${decoded.duration.toFixed(1)}s, ${decoded.numberOfChannels} canales`);
      return decoded;
    } catch (err) {
      console.warn('[bgm] no se pudo cargar/decodificar', file, err);
      return null;
    }
  }

  private startSource(buffer: AudioBuffer): void {
    if (!this.audioCtx || !this.gainNode) return;

    // Detenemos la fuente previa (cada AudioBufferSourceNode solo se puede
    // arrancar una vez, así que creamos uno nuevo en cada cambio de pista).
    if (this.sourceNode) {
      try { this.sourceNode.stop(); } catch { /* ya parada */ }
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    const src = this.audioCtx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.gainNode);
    this.sourceNode = src;

    this.tryStart();
  }

  private tryStart(): void {
    if (!this.audioCtx || !this.sourceNode) return;
    if (this.audioCtx.state === 'suspended') {
      // Política de autoplay: el contexto arranca suspended hasta el primer
      // gesto del usuario. Lo intentamos y, si falla, reintentamos al primer
      // click/tecla.
      this.audioCtx.resume()
        .then(() => this.startNow())
        .catch(err => {
          console.warn('[bgm] resume() rechazado, esperando gesto:', err);
          this.pendingStart = true;
          this.bindGestureRetry();
        });
    } else {
      this.startNow();
    }
  }

  private startNow(): void {
    if (!this.sourceNode) return;
    try {
      this.sourceNode.start();
      this.pendingStart = false;
      console.log('[bgm] reproducción iniciada');
    } catch (err) {
      // start() lanza si ya se llamó antes — significa que ya está sonando.
      console.warn('[bgm] start() ignorado:', err);
    }
  }

  private bindGestureRetry(): void {
    if (this.gestureBound) return;
    this.gestureBound = true;
    const retry = async () => {
      if (!this.pendingStart || !this.audioCtx) { cleanup(); return; }
      try {
        await this.audioCtx.resume();
        this.startNow();
        cleanup();
      } catch (err) {
        console.warn('[bgm] resume() sigue rechazado:', err);
      }
    };
    const cleanup = () => {
      document.removeEventListener('pointerdown', retry, true);
      document.removeEventListener('keydown', retry, true);
      document.removeEventListener('click', retry, true);
      document.removeEventListener('touchend', retry, true);
      this.gestureBound = false;
    };
    document.addEventListener('pointerdown', retry, true);
    document.addEventListener('keydown', retry, true);
    document.addEventListener('click', retry, true);
    document.addEventListener('touchend', retry, true);
  }
}

function absoluteUrl(path: string): string {
  return new URL(path, document.baseURI).toString();
}

function loadVolume(): number {
  const raw = localStorage.getItem(STORAGE_VOLUME);
  const n = raw == null ? DEFAULT_VOLUME : Number(raw);
  return Number.isFinite(n) ? clamp(n) : DEFAULT_VOLUME;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}
