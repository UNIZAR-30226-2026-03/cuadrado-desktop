import { Injectable, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Subject } from 'rxjs';
import { environment } from '../environment';

// ── Tipos de eventos servidor → cliente ─────────────────────────────────────

export interface EvInicioPartida {
  partidaId: string;
}

export interface EvCartaRobada {
  partidaId: string;
  jugadorRobado: number; // índice en turnoJugadores[]
}

export interface EvDecisionRequerida {
  gameId: string;
  carta?: { carta: number; palo: string; puntos: number }; // la carta robada (sólo al que robó)
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

// ── Servicio ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class WebsocketService {
  private socket: Socket | null = null;

  estaConectado = signal(false);

  // Streams para eventos de juego
  inicioPartida$     = new Subject<EvInicioPartida>();
  cartaRobada$       = new Subject<EvCartaRobada>();
  decisionRequerida$ = new Subject<EvDecisionRequerida>();
  descartePendiente$ = new Subject<EvDescartarPendiente>();
  intercambioCartas$ = new Subject<EvIntercambioCartas>();
  turnoExpirado$     = new Subject<EvTurnoExpirado>();
  partidaFinalizada$ = new Subject<EvPartidaFinalizada>();
  cuboActivado$      = new Subject<EvCuboActivado>();
  mazoRebarajado$    = new Subject<EvMazoRebarajado>();
  roomUpdate$        = new Subject<unknown>();
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
    this.socket.on('room:update', (data: unknown) => this.roomUpdate$.next(data));

    // Eventos de partida
    this.socket.on('game:inicio-partida',    (d: EvInicioPartida)     => this.inicioPartida$.next(d));
    this.socket.on('game:carta-robada',      (d: EvCartaRobada)       => this.cartaRobada$.next(d));
    this.socket.on('game:decision-requerida',(d: EvDecisionRequerida) => this.decisionRequerida$.next(d));
    this.socket.on('game:descartar-pendiente',(d: EvDescartarPendiente)=> this.descartePendiente$.next(d));
    this.socket.on('game:intercambio-cartas',(d: EvIntercambioCartas) => this.intercambioCartas$.next(d));
    this.socket.on('game:turno-expirado',    (d: EvTurnoExpirado)     => this.turnoExpirado$.next(d));
    this.socket.on('game:partida-finalizada',(d: EvPartidaFinalizada) => this.partidaFinalizada$.next(d));
    this.socket.on('game:cubo-activado',     (d: EvCuboActivado)      => this.cuboActivado$.next(d));
    this.socket.on('game:mazo-rebarajado',   (d: EvMazoRebarajado)    => this.mazoRebarajado$.next(d));
  }

  // ── Emitir acciones de juego ───────────────────────────────────────────────

  emit<T>(event: string, payload: T): void {
    this.socket?.emit(event, payload);
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
