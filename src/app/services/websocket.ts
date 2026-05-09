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
  // Presente solo cuando se reanuda una partida guardada
  estado?: {
    turnoActualUserId: string;
    cartasRestantes: number;
    ultimaCartaDescartada: { carta: number; palo: string; puntos: number; protegida: boolean } | null;
    cuboActivado: boolean;
    cuboSolicitanteId: string | null;
    cuboTurnosRestantes?: number;
    jugadores: Array<{
      userId: string;
      cartasMano?: number;
      cartasEnMano?: Array<{ carta: number; palo: string; puntos: number; protegida: boolean }>;
      habilidadesActivadas?: number[];
      cartasProtegidas?: number[];
    }>;
  };
}

export interface EvCartaRobada {
  partidaId: string;
  jugadorRobado: number; // índice en turnoJugadores[]
  cartasRestantes: number; // cantidad de cartas restantes en el mazo
}

export interface EvDecisionRequerida {
  gameId: string;
  // Backend `dev` envía `carta`. Versiones previas enviaban `game`.
  // Aceptamos ambos por compatibilidad: usar `ev.carta ?? ev.game`.
  carta?: { carta: number; palo: string; puntos: number; protegida: boolean };
  game?: { carta: number; palo: string; puntos: number; protegida: boolean };
}

export interface EvDescartarPendiente {
  partidaId: string;
  carta: { carta: number; palo: string; puntos: number; protegida: boolean };
  // Campos opcionales que el backend debe añadir al broadcast de carta-por-pendiente
  // para que los observadores distingan descarte de intercambio:
  //   tipo:     'descartar' | 'intercambiar'
  //   numCarta: posición de la carta de mano intercambiada (0-3)
  tipo?: 'descartar' | 'intercambiar';
  numCarta?: number;
}

export interface EvIntercambioCartas {
  partidaId: string;
  remitente: string;
  destinatario: string;
  numCartaRemitente?: number;
  numCartaDestinatario?: number;
  cardCountRemitente?: number;
  cardCountDestinatario?: number;
}

// Emitido cuando el jugador descarta un 6: backend devuelve la carta
// robada que queda pendiente (WAIT_DECISION) hasta nueva acción del jugador.
export interface EvCartaRobadaPorDescartar6 {
  gameId: string;
  cartaRobada: { carta: number; palo: string; puntos: number; protegida: boolean };
  reshuffle?: { huboRebarajado: boolean; cantidadCartasMazo?: number; cantidadCartasDescartadas?: number };
}

// Emitido cuando falla el descarte rapido: backend devuelve la carta robada
// que pasa directamente a la mano del jugador.
export interface EvCartaRobadaPorDescarteRapido {
  gameId: string;
  cartaRobada: { carta: number; palo: string; puntos: number; protegida: boolean };
  numCartasMano: number;
  reshuffle?: { huboRebarajado: boolean; cantidadCartasMazo?: number; cantidadCartasDescartadas?: number };
}

// Una habilidad fue cancelada porque la carta objetivo estaba protegida.
// No debe bloquear el flujo: solo informar y continuar.
export interface EvAccionProtegidaCancelada {
  gameId: string;
  accion: string;
  actorId: string;
  propietarioId: string;
  proteccionesConsumidas?: number;
  message?: string;
}

// Estado del poder 8 diferido: bloqueo de la próxima habilidad.
export interface EvPoder8Estado {
  gameId: string;
  pendientes: number;
  pendientesDiferidos: number;
  activadorId: string | null;
}

// Estado de revancha (game:revancha-estado).
export interface EvRevanchaEstado {
  gameId: string;
  estado: 'waiting-host' | 'room-ready' | string;
  hostId: string;
  jugadoresListos: string[];
  roomCode?: string;
  roomName?: string;
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
  dificultadBots?: 'facil' | 'media' | 'dificil';
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
  savedRoomName?: string;
}

export interface SavedGameSummary {
  gameId: string;
  creatorId: string;
  roomName: string;
  updatedAt: string;
  players: string[];
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

export interface EvPlayerControllerChanged {
  gameId: string;
  userId: string;
  controlador: 'humano' | 'bot';
  dificultadBot?: string;
  nombreEnPartida?: string;
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

// Encadenamiento del poder 7: backend confirma acierto y el jugador puede
// volver a colocar otra carta del mismo valor.
export interface EvPonerOtraCartaSobreOtra {
  gameId: string;
}

// Notificación a todos del cambio de cartas en mano tras carta-sobre-otra.
export interface EvAccionCartaSobreOtra {
  partidaId: string;
  usuarioImplicado: string;
  numCartasMano: number;
}

export interface EvIntercambioRival {
  gameId: string;
  usuarioIniciador: string;
}

// Carta revelada para todos (poder 5: espía rival con carta de cualquiera).
export interface EvCartasReveladasTodos {
  gameId: string;
  cartas: Array<{
    jugadorId: string;
    indexCarta: number;
    carta: { carta: number; palo: string; puntos: number; protegida: boolean };
  }>;
}

// ── Tipos señalización WebRTC (voz) ──────────────────────────────────────────

export interface EvVoicePeerJoined   { peerId: string }
export interface EvVoicePeerLeft     { peerId: string }
export interface EvVoiceOffer        { from: string; offer: RTCSessionDescriptionInit }
export interface EvVoiceAnswer       { from: string; answer: RTCSessionDescriptionInit }
export interface EvVoiceIceCandidate { from: string; candidate: RTCIceCandidateInit }
export interface EvVoiceMuteChanged  { peerId: string; muted: boolean }

// ── Tipos poderes frontend → backend ─────────────────────────────────────────

export type PoderCarta =
  | 'ver-carta'
  | 'ver-carta-rival'
  | 'intercambiar-carta'
  | 'intercambiar-todas-cartas'
  | 'hacer-robar-carta'
  | 'proteger-carta'
  | 'saltar-turno-jugador'
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
  /** socketId → username (userId). Actualizado con cada room:update. */
  socketToUsername = signal<ReadonlyMap<string, string>>(new Map());

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

  // Streams poderes
  cartaRevelada$            = new Subject<EvCartaRevelada>();
  cartasReveladasTodos$     = new Subject<EvCartasReveladasTodos>();
  cartaProtegida$           = new Subject<EvCartaProtegida>();
  hacerRobarCarta$          = new Subject<EvHacerRobarCarta>();
  turnoJugadorSaltado$      = new Subject<EvTurnoJugadorSaltado>();
  habilidadDenegada$        = new Subject<EvHabilidadDenegada>();
  puntosCalculados$         = new Subject<EvPuntosCalculados>();
  jugadorMenosPuntuacion$   = new Subject<EvJugadorMenosPuntuacion>();
  ponerCartaSobreOtra$      = new Subject<EvPonerCartaSobreOtra>();
  ponerOtraCartaSobreOtra$  = new Subject<EvPonerOtraCartaSobreOtra>();
  accionCartaSobreOtra$     = new Subject<EvAccionCartaSobreOtra>();
  intercambioRival$         = new Subject<EvIntercambioRival>();
  cartaRobadaPorDescartar6$ = new Subject<EvCartaRobadaPorDescartar6>();
  cartaRobadaPorDescarteRapido$ = new Subject<EvCartaRobadaPorDescarteRapido>();
  accionProtegidaCancelada$ = new Subject<EvAccionProtegidaCancelada>();
  poder8Estado$             = new Subject<EvPoder8Estado>();
  revanchaEstado$           = new Subject<EvRevanchaEstado>();
  playerControllerChanged$  = new Subject<EvPlayerControllerChanged>();

  // Streams señalización WebRTC
  voicePeers$        = new Subject<string[]>();
  voicePeerJoined$   = new Subject<EvVoicePeerJoined>();
  voicePeerLeft$     = new Subject<EvVoicePeerLeft>();
  voiceOffer$        = new Subject<EvVoiceOffer>();
  voiceAnswer$       = new Subject<EvVoiceAnswer>();
  voiceIceCandidate$ = new Subject<EvVoiceIceCandidate>();
  voiceMuteChanged$  = new Subject<EvVoiceMuteChanged>();

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

    // Panel debug dev: logueo de todos los eventos entrantes con su payload.
    // Solo se activa fuera de producción. Útil para auditar nuevos eventos
    // del backend (poder8-estado, accion-protegida-cancelada, revancha-estado, ...).
    if (!environment.production) {
      this.socket.onAny((event: string, ...args: unknown[]) => {
        // eslint-disable-next-line no-console
        console.debug('[ws-in]', event, args.length === 1 ? args[0] : args);
      });
    }

    // Eventos de sala
    this.socket.on('room:update', (data: EvRoomUpdate) => {
      this.roomUpdate$.next(data);
      const map = new Map<string, string>();
      data.players.forEach(p => { if (p.socketId && p.userId) map.set(p.socketId, p.userId); });
      this.socketToUsername.set(map);
    });
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

    // Listeners poderes
    this.socket.on('game:carta-revelada',           (d: EvCartaRevelada)        => this.cartaRevelada$.next(d));
    this.socket.on('game:cartas-reveladas-todos',   (d: EvCartasReveladasTodos) => this.cartasReveladasTodos$.next(d));
    this.socket.on('game:carta-protegida',          (d: EvCartaProtegida)       => this.cartaProtegida$.next(d));
    this.socket.on('game:se-ha-hecho-robar-carta',  (d: EvHacerRobarCarta)      => this.hacerRobarCarta$.next(d));
    this.socket.on('game:turno-jugador-saltado',    (d: EvTurnoJugadorSaltado)  => this.turnoJugadorSaltado$.next(d));
    this.socket.on('game:habilidad-denegada',       (d: EvHabilidadDenegada)    => this.habilidadDenegada$.next(d));
    this.socket.on('game:puntos-calculados',        (d: EvPuntosCalculados)     => this.puntosCalculados$.next(d));
    this.socket.on('game:jugador-menos-puntuacion-calculado', (d: EvJugadorMenosPuntuacion) => this.jugadorMenosPuntuacion$.next(d));
    this.socket.on('game:poner-carta-sobre-otra',      (d: EvPonerCartaSobreOtra)      => this.ponerCartaSobreOtra$.next(d));
    this.socket.on('game:poner-otra-carta-sobre-otra', (d: EvPonerOtraCartaSobreOtra)  => this.ponerOtraCartaSobreOtra$.next(d));
    this.socket.on('game:accion-carta-sobre-otra',     (d: EvAccionCartaSobreOtra)     => this.accionCartaSobreOtra$.next(d));
    this.socket.on('game:intercambio-rival',           (d: EvIntercambioRival)         => this.intercambioRival$.next(d));
    this.socket.on('game:carta-robada-por-descartar-6',(d: EvCartaRobadaPorDescartar6) => this.cartaRobadaPorDescartar6$.next(d));
    this.socket.on('game:carta-robada-por-descarte-rapido',(d: EvCartaRobadaPorDescarteRapido) => this.cartaRobadaPorDescarteRapido$.next(d));
    this.socket.on('game:accion-protegida-cancelada',  (d: EvAccionProtegidaCancelada) => this.accionProtegidaCancelada$.next(d));
    this.socket.on('game:poder8-estado',               (d: EvPoder8Estado)             => this.poder8Estado$.next(d));
    this.socket.on('game:revancha-estado',             (d: EvRevanchaEstado)           => this.revanchaEstado$.next(d));
    this.socket.on('game:player-controller-changed',   (d: EvPlayerControllerChanged)  => this.playerControllerChanged$.next(d));

    // Señalización WebRTC
    this.socket.on('voice:peers',         (peers: string[])          => this.voicePeers$.next(peers));
    this.socket.on('voice:peer-joined',   (d: EvVoicePeerJoined)     => this.voicePeerJoined$.next(d));
    this.socket.on('voice:peer-left',     (d: EvVoicePeerLeft)       => this.voicePeerLeft$.next(d));
    this.socket.on('voice:offer',         (d: EvVoiceOffer)          => this.voiceOffer$.next(d));
    this.socket.on('voice:answer',        (d: EvVoiceAnswer)         => this.voiceAnswer$.next(d));
    this.socket.on('voice:ice-candidate', (d: EvVoiceIceCandidate)   => this.voiceIceCandidate$.next(d));
    this.socket.on('voice:mute-changed',  (d: EvVoiceMuteChanged)    => this.voiceMuteChanged$.next(d));
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

  async createRoom(name: string, rules?: RoomRules): Promise<{ success: boolean; roomCode?: string; roomName?: string; warning?: string; loadedFromSave?: boolean }> {
    if (!this.socket) return { success: false };
    try {
      const payload = rules ? { name, rules } : { name };
      return await this.socket.timeout(6000).emitWithAck('rooms:create', payload);
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

  guardarYCerrarPartida(gameId: string): void {
    this.emit('game:guardar-y-cerrar', { gameId });
  }

  abandonarPartida(gameId: string, dificultadBot: 'facil' | 'media' | 'dificil' = 'media'): void {
    this.emit('game:abandonar-partida', { gameId, dificultadBot });
  }

  async listarPartidasGuardadas(): Promise<SavedGameSummary[]> {
    if (!this.socket) return [];
    try {
      const resp = await this.socket.timeout(5000).emitWithAck('game:listar-partidas-guardadas', {});
      return resp?.success ? (resp.partidas ?? []) : [];
    } catch {
      return [];
    }
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

  iniciarPartida(savedRoomName?: string): void {
    this.emit('game:iniciar-partida', savedRoomName ? { savedRoomName } : {});
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

  /** Poder 9 paso 2: el rival responde al intercambio interactivo eligiendo
   *  a ciegas cuál de sus cartas entrega. */
  intercambioCartaInteractivo(gameId: string, numCartaJugador: number, rivalId: string): void {
    this.emit('game:intercambiar-carta-interactivo', { gameId, numCartaJugador, rivalId });
  }

  /** Poder 5: el solicitante elige un rival y una carta concreta a revelar. */
  verCartaRival(gameId: string, rivalId: string, indexCartaRival: number): void {
    this.emit('game:ver-carta-rival', { gameId, rivalId, indexCartaRival });
  }

  /** Poder J: resolver decisión final tras ver carta propia + rival. */
  resolverJ(gameId: string, intercambiar: boolean): void {
    this.emit('game:resolver-j', { gameId, intercambiar });
  }

  /** Poder 4: saltar el siguiente turno del rival indicado. */
  saltarTurnoJugador(gameId: string, adversarioId: string): void {
    this.emit('game:saltar-turno-jugador', { gameId, adversarioId });
  }

  /** Solicitud de revancha al finalizar la partida. */
  volverAJugar(gameId: string): void {
    this.emit('game:volver-a-jugar', { gameId });
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
      case 'saltar-turno-jugador':
        this.saltarTurnoJugador(gameId, opts.rivalId!);
        return;
      case 'ver-carta-rival':
        this.verCartaRival(gameId, opts.rivalId!, opts.numCartaRival ?? 0);
        return;
    }
  }

  desconectar(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.estaConectado.set(false);
    }
  }

  // ── Señalización WebRTC (voz) ──────────────────────────────────────────────

  joinVoiceRoom(roomId: string): void {
    this.socket?.emit('voice:join', roomId);
  }

  leaveVoiceRoom(): void {
    this.socket?.emit('voice:leave');
  }

  sendVoiceOffer(to: string, offer: RTCSessionDescriptionInit): void {
    this.socket?.emit('voice:offer', { to, offer });
  }

  sendVoiceAnswer(to: string, answer: RTCSessionDescriptionInit): void {
    this.socket?.emit('voice:answer', { to, answer });
  }

  sendIceCandidate(to: string, candidate: RTCIceCandidateInit): void {
    this.socket?.emit('voice:ice-candidate', { to, candidate });
  }

  sendVoiceMute(muted: boolean): void {
    this.socket?.emit('voice:mute', { muted });
  }
}
