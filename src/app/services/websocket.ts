import { Injectable, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Subject } from 'rxjs';
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
  numCartaRemitente?: number;
  numCartaDestinatario?: number;
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

// ── Eventos respuesta a poderes ──────────────────────────────────────────────

export interface EvCartaRevelada {
  gameId: string;
  carta: { carta: number; palo: string; puntos: number; protegida: boolean };
  cartaJugadorContrario?: { carta: number; palo: string; puntos: number; protegida: boolean };
}

export interface EvCartaProtegida {
  gameId: string;
  jugadorId: string;
  cartaIndex: number;
}

export interface EvHacerRobarCarta {
  partidaId: string;
  remitente: string;
  destinatario: string;
}

export interface EvTurnoJugadorSaltado {
  gameId: string;
  remitenteId: string;
  destinatarioId: string;
}

export interface EvHabilidadDenegada {
  gameId: string;
  jugadorId: string;
  habilidad: string;
}

export interface EvPuntosCalculados {
  gameId: string;
  puntos: number;
}

export interface EvJugadorMenosPuntuacion {
  gameId: string;
  jugadorId: string;
}

export interface EvPonerCartaSobreOtra {
  aceptada: boolean;
}

export interface EvIntercambioRival {
  gameId: string;
  usuarioIniciador: string;
}

// ── Tipo respuesta rooms:list-public ─────────────────────────────────────────

export interface PublicRoomSummaryBackend {
  name: string;
  code: string;
  playersCount: number;
  rules: {
    maxPlayers: number;
    isPrivate: boolean;
    fillWithBots: boolean;
    deckCount: number;
    turnTimeSeconds: number;
    enabledPowers: string[];
  };
  createdAt: number;
}

// ── Tipos poderes frontend → backend ─────────────────────────────────────────

export type PoderCarta =
  | 'ver-carta'
  | 'intercambiar-carta'
  | 'intercambiar-todas-cartas'
  | 'hacer-robar-carta'
  | 'proteger-carta'
  | 'calcular-puntos'
  | 'jugador-menos-puntuacion'
  | 'desactivar-proxima-habilidad'
  | 'solicitar-carta-sobre-otra'
  | 'poner-carta-sobre-otra'
  | 'preparar-intercambio-carta';

export interface PoderOpts {
  numCarta?: number;          // índice carta propia
  rivalId?: string;           // objetivo rival
  numCartaRival?: number;     // índice carta rival
  numCartaRemitente?: number; // intercambiar-carta
  numCartaDestinatario?: number;
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

  // Streams poderes
  cartaRevelada$       = new Subject<EvCartaRevelada>();
  cartaProtegida$      = new Subject<EvCartaProtegida>();
  hacerRobarCarta$     = new Subject<EvHacerRobarCarta>();
  turnoJugadorSaltado$ = new Subject<EvTurnoJugadorSaltado>();
  habilidadDenegada$   = new Subject<EvHabilidadDenegada>();
  puntosCalculados$    = new Subject<EvPuntosCalculados>();
  jugadorMenosPuntuacion$ = new Subject<EvJugadorMenosPuntuacion>();
  ponerCartaSobreOtra$ = new Subject<EvPonerCartaSobreOtra>();
  intercambioRival$    = new Subject<EvIntercambioRival>();

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

    // Listeners poderes
    this.socket.on('game:carta-revelada',           (d: EvCartaRevelada)        => this.cartaRevelada$.next(d));
    this.socket.on('game:carta-protegida',          (d: EvCartaProtegida)       => this.cartaProtegida$.next(d));
    this.socket.on('game:se-ha-hecho-robar-carta',  (d: EvHacerRobarCarta)      => this.hacerRobarCarta$.next(d));
    this.socket.on('game:turno-jugador-saltado',    (d: EvTurnoJugadorSaltado)  => this.turnoJugadorSaltado$.next(d));
    this.socket.on('game:habilidad-denegada',       (d: EvHabilidadDenegada)    => this.habilidadDenegada$.next(d));
    this.socket.on('game:puntos-calculados',        (d: EvPuntosCalculados)     => this.puntosCalculados$.next(d));
    this.socket.on('game:jugador-menos-puntuacion-calculado', (d: EvJugadorMenosPuntuacion) => this.jugadorMenosPuntuacion$.next(d));
    this.socket.on('game:poner-carta-sobre-otra',   (d: EvPonerCartaSobreOtra)  => this.ponerCartaSobreOtra$.next(d));
    this.socket.on('game:intercambio-rival',        (d: EvIntercambioRival)     => this.intercambioRival$.next(d));
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

  // ── Poderes de cartas ──────────────────────────────────────────────────────

  verCarta(gameId: string, indexCarta: number, playerId?: string, indexCartaPlayer?: number): void {
    this.emit('game:ver-carta', { gameId, indexCarta, playerId, indexCartaPlayer });
  }

  intercambiarCartaPoder(
    gameId: string,
    numCartaRemitente: number,
    destinatarioId: string,
    numCartaDestinatario: number,
  ): void {
    this.emit('game:intercambiar-carta', {
      gameId, numCartaRemitente, destinatarioId, numCartaDestinatario,
    });
  }

  intercambiarTodasCartas(gameId: string, destinatarioId: string): void {
    this.emit('game:intercambiar-todas-cartas', { gameId, destinatarioId });
  }

  hacerRobarCarta(gameId: string, adversarioId: string): void {
    this.emit('game:hacer-robar-carta', { gameId, adversarioId });
  }

  protegerCarta(gameId: string, numCarta: number): void {
    this.emit('game:proteger-carta', { gameId, numCarta });
  }

  calcularPuntos(gameId: string): void {
    this.emit('game:calcular-puntos', { gameId });
  }

  jugadorMenosPuntuacion(gameId: string): void {
    this.emit('game:jugador-menos-puntuacion', { gameId });
  }

  desactivarProximaHabilidad(gameId: string): void {
    this.emit('game:desactivar-proxima-habilidad', { gameId });
  }

  solicitarCartaSobreOtra(gameId: string): void {
    this.emit('game:solicitar-carta-sobre-otra', { gameId });
  }

  ponerCartaSobreOtra(gameId: string, numCarta: number): void {
    this.emit('game:poner-carta-sobre-otra', { gameId, numCarta });
  }

  prepararIntercambioCarta(gameId: string, numCartaJugador: number, rivalId: string): void {
    this.emit('game:preparar-intercambio-carta', { gameId, numCartaJugador, rivalId });
  }

  /** Dispatcher genérico: elige evento según poder. */
  emitirPoder(gameId: string, poder: PoderCarta, opts: PoderOpts = {}): void {
    switch (poder) {
      case 'ver-carta':
        this.verCarta(gameId, opts.numCarta ?? 0, opts.rivalId, opts.numCartaRival);
        return;
      case 'intercambiar-carta':
        this.intercambiarCartaPoder(
          gameId,
          opts.numCartaRemitente ?? opts.numCarta ?? 0,
          opts.rivalId!,
          opts.numCartaDestinatario ?? opts.numCartaRival ?? 0,
        );
        return;
      case 'intercambiar-todas-cartas':
        this.intercambiarTodasCartas(gameId, opts.rivalId!);
        return;
      case 'hacer-robar-carta':
        this.hacerRobarCarta(gameId, opts.rivalId!);
        return;
      case 'proteger-carta':
        this.protegerCarta(gameId, opts.numCarta ?? 0);
        return;
      case 'calcular-puntos':
        this.calcularPuntos(gameId);
        return;
      case 'jugador-menos-puntuacion':
        this.jugadorMenosPuntuacion(gameId);
        return;
      case 'desactivar-proxima-habilidad':
        this.desactivarProximaHabilidad(gameId);
        return;
      case 'solicitar-carta-sobre-otra':
        this.solicitarCartaSobreOtra(gameId);
        return;
      case 'poner-carta-sobre-otra':
        this.ponerCartaSobreOtra(gameId, opts.numCarta ?? 0);
        return;
      case 'preparar-intercambio-carta':
        this.prepararIntercambioCarta(gameId, opts.numCarta ?? 0, opts.rivalId!);
        return;
    }
  }

  listarSalasPublicas(token: string): Promise<PublicRoomSummaryBackend[]> {
    const emitir = async (): Promise<PublicRoomSummaryBackend[]> => {
      const resp = await this.socket!.emitWithAck('rooms:list-public');
      return (resp as { rooms?: PublicRoomSummaryBackend[] })?.rooms ?? [];
    };

    if (this.socket?.connected) return emitir();

    return new Promise((resolve, reject) => {
      this.conectar(token);
      const sock = this.socket!;
      const onConnect = () => {
        sock.off('connect_error', onError);
        emitir().then(resolve).catch(reject);
      };
      const onError = (err: Error) => {
        sock.off('connect', onConnect);
        reject(err);
      };
      sock.once('connect', onConnect);
      sock.once('connect_error', onError);
    });
  }

  desconectar(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.estaConectado.set(false);
    }
  }
}
