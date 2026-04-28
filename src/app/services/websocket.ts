import { Injectable, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Subject, ReplaySubject } from 'rxjs';
import { environment } from '../environment';

// ── Tipos de eventos servidor → cliente ─────────────────────────────────────

export interface EvInicioPartida {
  partidaId: string;
  jugadores: string[];  // userIds en orden de turno
  jugadoresDetalle: Array<{
    userId: string;
    controlador: 'humano' | 'bot';
    dificultadBot?: 'facil' | 'media' | 'dificil';
    nombreEnPartida?: string;
  }>;
  // ❌ NO incluye: cartas en mano, turno inicial, fase, turnDeadlineAt, deckCount
}

export interface EvCartaRobada {
  partidaId: string;
  jugadorRobado: number; // índice en turnoJugadores[]
  cartasRestantes: number; // cantidad de cartas restantes en el mazo
}

export interface EvDecisionRequerida {
  gameId: string;
  // La carta robada solo se envía al jugador que robó.
  // NOTA: en el backend la propiedad se llama "game", no "carta".
  game?: { carta: number; palo: string; puntos: number; protegida: boolean };
}

export interface EvDescartarPendiente {
  partidaId: string;
  carta: { carta: number; palo: string; puntos: number; protegida: boolean };
}

export interface EvIntercambioCartas {
  partidaId: string;
  remitente: string;
  destinatario: string;
}

export interface EvTurnoExpirado {
  gameId: string;
  turn: number;
  phase: string;
  turnDeadlineAt: number;
}

export interface EvPartidaFinalizada {
  gameId: string;
  motivo: 'sinCartasMazo' | 'unJugadorSinCartas' | 'cubo';
  ranking: Array<{ userId: string; puntaje: number }>;
  ganadorId: string;
  cartasJugadores: Array<{ jugadorId: string; valoresCartas: number[] }>;
  recompensas: unknown;
}

export interface EvTurnoIniciado {
  gameId: string;
  turn: number;
  userId: string;
  phase: string;
  turnDeadlineAt: number;
}

export interface EvCuboActivado {
  gameId: string;
  solicitanteId: string;
  turnosRestantes: number;
}

export interface EvMazoRebarajado {
  gameId: string;
  cantidadCartasMazo: number;
  cantidadCartasDescartadas: number;
}

// ── Tipos de sala ─────────────────────────────────────────────────────────────

export interface RoomRules {
  maxPlayers: number;
  turnTimeSeconds: number;
  isPrivate: boolean;
  fillWithBots: boolean;
  enabledPowers?: string[];
  deckCount?: number;
}

export interface RoomStatePlayer {
  userId: string;
  controlador: 'bot' | 'humano';
  dificultadBot?: string;
  nombreEnPartida?: string;
  socketId: string;
  isHost: boolean;
  joinedAt: Date;
  connected: boolean;
  ready: boolean;
}

export interface EvRoomUpdate {
  name: string;
  code: string;
  hostId: string;
  players: RoomStatePlayer[];
  rules: RoomRules;
  started: boolean;
  createdAt: Date;
}

export interface EvRoomClosed {
  reason: string;
  roomCode: string;
}

export interface PublicRoomSummary {
  name: string;
  code: string;
  playersCount: number;
  rules: {
    maxPlayers: number;
    turnTimeSeconds: number;
    isPrivate: boolean;
    fillWithBots: boolean;
    dificultadBots?: string;
    deckCount?: number;
    enabledPowers?: string[];
  };
  createdAt: string | Date;
}

// ── Servicio ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class WebsocketService {
  private socket: Socket | null = null;

  estaConectado = signal(false);

  // Streams para eventos de juego
  inicioPartida$     = new Subject<EvInicioPartida>();
  turnoIniciado$     = new Subject<EvTurnoIniciado>();
  cartaRobada$       = new Subject<EvCartaRobada>();
  decisionRequerida$ = new Subject<EvDecisionRequerida>();
  descartePendiente$ = new Subject<EvDescartarPendiente>();
  intercambioCartas$ = new Subject<EvIntercambioCartas>();
  turnoExpirado$     = new Subject<EvTurnoExpirado>();
  partidaFinalizada$ = new Subject<EvPartidaFinalizada>();
  cuboActivado$      = new Subject<EvCuboActivado>();
  mazoRebarajado$    = new Subject<EvMazoRebarajado>();
  roomUpdate$        = new ReplaySubject<EvRoomUpdate>(1);
  roomClosed$        = new Subject<EvRoomClosed>();
  error$             = new Subject<string>();

  conectar(token: string, roomCode?: string): void {
    if (this.socket?.connected) return;

    this.socket = io(environment.wsUrl, {
      auth: { token },
      ...(roomCode ? { query: { salaId: roomCode } } : {}),
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    this.socket.on('connect',    () => this.estaConectado.set(true));
    this.socket.on('disconnect', () => this.estaConectado.set(false));
    this.socket.on('exception',  (err: { error?: { message?: string } }) =>
      this.error$.next(err?.error?.message ?? 'Error WebSocket'));

    // Eventos de sala
    this.socket.on('room:update', (data: EvRoomUpdate) => this.roomUpdate$.next(data));
    this.socket.on('room:closed', (data: EvRoomClosed) => this.roomClosed$.next(data));

    // Eventos de partida
    this.socket.on('game:inicio-partida',    (d: EvInicioPartida)     => this.inicioPartida$.next(d));
    this.socket.on('game:turno-iniciado',    (d: EvTurnoIniciado)     => this.turnoIniciado$.next(d));
    this.socket.on('game:carta-robada',      (d: EvCartaRobada)       => this.cartaRobada$.next(d));
    this.socket.on('game:decision-requerida',(d: EvDecisionRequerida) => this.decisionRequerida$.next(d));
    this.socket.on('game:descartar-pendiente',(d: EvDescartarPendiente)=> this.descartePendiente$.next(d));
    this.socket.on('game:intercambio-cartas',(d: EvIntercambioCartas) => this.intercambioCartas$.next(d));
    this.socket.on('game:turno-expirado',    (d: EvTurnoExpirado)     => this.turnoExpirado$.next(d));
    this.socket.on('game:partida-finalizada',(d: EvPartidaFinalizada) => this.partidaFinalizada$.next(d));
    this.socket.on('game:cubo-activado',     (d: EvCuboActivado)      => this.cuboActivado$.next(d));
    this.socket.on('game:mazo-rebarajado',   (d: EvMazoRebarajado)    => this.mazoRebarajado$.next(d));
  }

  /** Conecta y espera hasta que el socket esté listo (máx. 5 s). */
  conectarYEsperar(token: string): Promise<void> {
    if (this.socket?.connected) return Promise.resolve();

    return new Promise((resolve, reject) => {
      this.conectar(token);
      const timeout = setTimeout(() => reject(new Error('WS connection timeout')), 5000);
      this.socket!.once('connect', () => { clearTimeout(timeout); resolve(); });
      this.socket!.once('connect_error', (err) => { clearTimeout(timeout); reject(err); });
    });
  }

  // ── Acciones de sala ───────────────────────────────────────────────────────

  async createRoom(name: string, rules: RoomRules): Promise<{ success: boolean; roomCode?: string; roomName?: string }> {
    if (!this.socket) return { success: false };
    try {
      return await this.socket.timeout(6000).emitWithAck('rooms:create', { name, rules });
    } catch {
      return { success: false };
    }
  }

  async joinRoomWs(roomCode: string): Promise<{ success: boolean; roomCode?: string }> {
    if (!this.socket) return { success: false };
    try {
      return await this.socket.timeout(5000).emitWithAck('rooms:join', { roomCode });
    } catch {
      return { success: false };
    }
  }

  async listPublicRooms(): Promise<PublicRoomSummary[]> {
    if (!this.socket) return [];
    try {
      const resp = await this.socket.timeout(5000).emitWithAck('rooms:list-public', {});
      return resp?.success ? (resp.rooms ?? []) : [];
    } catch {
      return [];
    }
  }

  async leaveRoomAck(): Promise<void> {
    if (!this.socket?.connected) return;
    try {
      await this.socket.timeout(3000).emitWithAck('rooms:leave', {});
    } catch {
      // ignorar — el objetivo es limpiar el estado del backend
    }
  }

  leaveRoom(): void {
    this.emit('rooms:leave', {});
  }

  toggleReady(): void {
    this.emit('rooms:toggle-ready', {});
  }

  // ── Emitir acciones de juego ───────────────────────────────────────────────

  emit<T>(event: string, payload: T): void {
    this.socket?.emit(event, payload);
  }

  startRoom(roomCode: string): void {
    this.emit('rooms:start', { roomCode });
  }

  iniciarPartida(savedGameId?: string): void {
    this.emit('game:iniciar-partida', savedGameId ? { savedGameId } : {});
  }

  unirseASala(roomCode: string): void {
    this.emit('rooms:join', { roomCode });
  }

  robarCarta(gameId: string): void {
    this.emit('game:robar-carta', { gameId });
  }

  descartarPendiente(gameId: string): void {
    this.emit('game:descartar-pendiente', { gameId });
  }

  cartaPorPendiente(gameId: string, numCarta: number): void {
    this.emit('game:carta-por-pendiente', { gameId, numCarta });
  }

  solicitarCubo(gameId: string): void {
    this.emit('game:cubo', { gameId });
  }

  desconectar(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.estaConectado.set(false);
    }
  }
}
