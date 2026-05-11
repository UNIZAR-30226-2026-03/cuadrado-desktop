import { Injectable, signal, computed } from '@angular/core';
import {
  WebsocketService,
  PoderCarta,
  PoderOpts,
  EvCartaRevelada,
  EvCartasReveladasTodos,
  EvCartaProtegida,
  EvIntercambioCartas,
  EvHacerRobarCarta,
  EvHabilidadDenegada,
  EvTurnoJugadorSaltado,
  EvJugadorMenosPuntuacion,
  EvPoder8Estado,
  EvRevanchaEstado,
  EvInicioPartida,
  EvTurnoIniciado,
} from './websocket';

// Clasificación según si el poder necesita objetivo rival
export const PODERES_CON_OBJETIVO: ReadonlySet<PoderCarta> = new Set([
  'intercambiar-carta',
  'intercambiar-todas-cartas',
  'hacer-robar-carta',
  'preparar-intercambio-carta',
  'saltar-turno-jugador',
]);

// 'ver-carta' es mixto: directo si es carta propia, con objetivo si es carta rival.
export function poderRequiereObjetivo(poder: PoderCarta): boolean {
  return PODERES_CON_OBJETIVO.has(poder);
}

export interface NotificacionJuego {
  id: number;
  tipo: 'success' | 'error';
  mensaje: string;
}

@Injectable({
  providedIn: 'root'
})
export class GameService {
  private _gameId = signal<string | null>(null);
  private _turnoJugadores = signal<string[]>([]);
  private _cartaRevelada = signal<EvCartaRevelada | null>(null);
  private _cartasReveladasTodos = signal<EvCartasReveladasTodos | null>(null);
  private _ultimoIntercambioCartas = signal<EvIntercambioCartas | null>(null);
  private _ultimoRoboForzado = signal<EvHacerRobarCarta | null>(null);
  private _notificacion = signal<NotificacionJuego | null>(null);
  private _poder8Estado = signal<EvPoder8Estado | null>(null);
  private _revancha = signal<EvRevanchaEstado | null>(null);
  private _ultimoInicioPartida = signal<EvInicioPartida | null>(null);
  private _ultimoTurnoIniciado = signal<EvTurnoIniciado | null>(null);
  // Protecciones activas: clave `${jugadorId}:${cartaIndex}` → true mientras la carta siga en mano
  private _cartasProtegidas = signal<ReadonlySet<string>>(new Set());
  // Último salto de turno recibido (poder 4): el tablero lo consume para
  // bloquear UI 2s cuando el destinatario soy yo.
  private _ultimoSaltoTurno = signal<EvTurnoJugadorSaltado | null>(null);
  private secuenciaNotificacion = 0;

  gameId = this._gameId.asReadonly();
  turnoJugadores = this._turnoJugadores.asReadonly();
  cartaRevelada = this._cartaRevelada.asReadonly();
  cartasReveladasTodos = this._cartasReveladasTodos.asReadonly();
  ultimoIntercambioCartas = this._ultimoIntercambioCartas.asReadonly();
  ultimoRoboForzado = this._ultimoRoboForzado.asReadonly();
  notificacion = this._notificacion.asReadonly();
  poder8Estado = this._poder8Estado.asReadonly();
  revancha = this._revancha.asReadonly();
  ultimoInicioPartida  = this._ultimoInicioPartida.asReadonly();
  ultimoTurnoIniciado  = this._ultimoTurnoIniciado.asReadonly();
  cartasProtegidas = this._cartasProtegidas.asReadonly();
  ultimoSaltoTurno = this._ultimoSaltoTurno.asReadonly();
  estaConectado = computed(() => this.ws.estaConectado());

  /** Devuelve true si la carta `cartaIndex` del jugador `jugadorId` está protegida. */
  estaProtegida(jugadorId: string, cartaIndex: number): boolean {
    return this._cartasProtegidas().has(`${jugadorId}:${cartaIndex}`);
  }

  constructor(private ws: WebsocketService) {
    this.ws.inicioPartida$.subscribe((ev) => {
      this._gameId.set(ev.partidaId);
      this._ultimoInicioPartida.set(ev);
    });

    this.ws.turnoIniciado$.subscribe((ev) => {
      this._ultimoTurnoIniciado.set(ev);
      // Mantener gameId sincronizado con cada turno (misma estrategia que el web React).
      // Cubre el caso en que _gameId quedó desincronizado (reconexión, timing, etc.)
      if (ev.gameId) {
        this._gameId.set(ev.gameId);
      }
    });

    this.ws.cartaRevelada$.subscribe((ev) => {
      this._cartaRevelada.set(ev);
      this.publicarNotificacion('success', 'Carta revelada.');
    });

    this.ws.intercambioCartas$.subscribe((ev) => {
      this._ultimoIntercambioCartas.set(ev);
      this.publicarNotificacion('success', 'Intercambio de cartas aplicado.');
    });

    this.ws.hacerRobarCarta$.subscribe((ev) => {
      this._ultimoRoboForzado.set(ev);
      this.publicarNotificacion('success', 'Se ha aplicado un robo de carta.');
    });

    this.ws.habilidadDenegada$.subscribe((ev) => {
      this.publicarNotificacion('error', this.formatearHabilidadDenegada(ev));
    });

    // Carta protegida bloqueó la acción: avisar pero NO bloquear el flujo.
    this.ws.accionProtegidaCancelada$.subscribe((ev) => {
      const accion = (ev.accion ?? 'accion').split('-').join(' ');
      this.publicarNotificacion(
        'error',
        `Acción "${accion}" cancelada: la carta del rival está protegida.`,
      );
    });

    this.ws.poder8Estado$.subscribe((ev) => {
      this._poder8Estado.set(ev);
    });

    this.ws.revanchaEstado$.subscribe((ev) => {
      this._revancha.set(ev);
    });

    // Poder 3: registrar carta protegida.
    this.ws.cartaProtegida$.subscribe((ev: EvCartaProtegida) => {
      this._cartasProtegidas.update(prev => {
        const next = new Set(prev);
        next.add(`${ev.jugadorId}:${ev.cartaIndex}`);
        return next;
      });
      this.publicarNotificacion('success', 'Tu carta ha sido protegida.');
    });

    // Poder 4: registrar último salto. El tablero consume y aplica espera 2s.
    this.ws.turnoJugadorSaltado$.subscribe((ev: EvTurnoJugadorSaltado) => {
      this._ultimoSaltoTurno.set(ev);
    });

    // Poder 5: revelar carta(s) de cualquier jugador.
    this.ws.cartasReveladasTodos$.subscribe((ev) => {
      this._cartasReveladasTodos.set(ev);
    });

    // Poder 7: radar — toast con el jugador con menos puntos.
    this.ws.jugadorMenosPuntuacion$.subscribe((ev: EvJugadorMenosPuntuacion) => {
      this.publicarNotificacion('success', `Radar: ${ev.jugadorId} tiene menos puntos.`);
    });

    this.ws.error$.subscribe((mensaje) => {
      this.publicarNotificacion('error', mensaje);
    });
  }

  /** Limpia las protecciones de un jugador concreto al descartar/intercambiar
   *  esa carta (las invalida el tablero). */
  liberarProteccion(jugadorId: string, cartaIndex: number): void {
    const key = `${jugadorId}:${cartaIndex}`;
    if (!this._cartasProtegidas().has(key)) return;
    this._cartasProtegidas.update(prev => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  limpiarUltimoSaltoTurno(): void {
    this._ultimoSaltoTurno.set(null);
  }

  limpiarCartasReveladasTodos(): void {
    this._cartasReveladasTodos.set(null);
  }

  resolverJ(intercambiar: boolean): void {
    const id = this._gameId();
    if (id) this.ws.resolverJ(id, intercambiar);
  }

  saltarTurnoJugador(adversarioId: string): void {
    const id = this._gameId();
    if (id) this.ws.saltarTurnoJugador(id, adversarioId);
  }

  volverAJugar(): void {
    const id = this._gameId();
    if (id) this.ws.volverAJugar(id);
  }

  unirseAPartida(token: string, roomCode: string): void {
    this.ws.conectar(token, roomCode);
  }

  iniciarPartida(): void {
    this.ws.iniciarPartida();
  }

  robarCarta(): void {
    const id = this._gameId();
    if (id) this.ws.robarCarta(id);
  }

  descartarPendiente(): void {
    const id = this._gameId();
    if (id) this.ws.descartarPendiente(id);
  }

  intercambiarConPendiente(numCarta: number): void {
    const id = this._gameId();
    if (id) this.ws.cartaPorPendiente(id, numCarta);
  }

  solicitarCubo(): void {
    const id = this._gameId();
    if (id) this.ws.solicitarCubo(id);
  }

  setGameId(gameId: string): void {
    this._gameId.set(gameId);
  }

  setTurnoJugadores(jugadores: string[]): void {
    this._turnoJugadores.set(jugadores);
  }

  limpiarCartaRevelada(): void {
    this._cartaRevelada.set(null);
  }

  limpiarUltimoIntercambioCartas(): void {
    this._ultimoIntercambioCartas.set(null);
  }

  limpiarUltimoRoboForzado(): void {
    this._ultimoRoboForzado.set(null);
  }

  limpiarNotificacion(notificacionId?: number): void {
    if (notificacionId != null) {
      const actual = this._notificacion();
      if (!actual || actual.id !== notificacionId) return;
    }
    this._notificacion.set(null);
  }

  /**
   * Método puente: recibe datos del tablero, valida gameId actual y delega
   * al WebsocketService. Retorna false si no hay partida o falta objetivo.
   */
  usarPoderCarta(poder: PoderCarta, opts: PoderOpts = {}): boolean {
    const id = this._gameId();
    if (!id) return false;

    if (poderRequiereObjetivo(poder) && !opts.rivalId) return false;

    this.ws.emitirPoder(id, poder, opts);
    return true;
  }

  salirDePartida(): void {
    this.ws.desconectar();
    this._gameId.set(null);
    this._turnoJugadores.set([]);
    this._cartaRevelada.set(null);
    this._cartasReveladasTodos.set(null);
    this._ultimoIntercambioCartas.set(null);
    this._ultimoRoboForzado.set(null);
    this._notificacion.set(null);
    this._poder8Estado.set(null);
    this._revancha.set(null);
    this._cartasProtegidas.set(new Set());
    this._ultimoSaltoTurno.set(null);
    this._ultimoInicioPartida.set(null);
    this._ultimoTurnoIniciado.set(null);
  }

  limpiarUltimoInicioPartida(): void {
    this._ultimoInicioPartida.set(null);
  }

  limpiarUltimoTurnoIniciado(): void {
    this._ultimoTurnoIniciado.set(null);
  }

  /**
   * Limpia el estado interno de la partida pero MANTIENE viva la conexión
   * websocket. Se usa al iniciar una revancha: el backend reutiliza el socket
   * para emitir room:update de la nueva sala y, si desconectáramos, esos
   * eventos nunca llegarían y la sala de espera quedaría vacía.
   */
  limpiarParaRevancha(): void {
    this._gameId.set(null);
    this._turnoJugadores.set([]);
    this._cartaRevelada.set(null);
    this._ultimoIntercambioCartas.set(null);
    this._ultimoRoboForzado.set(null);
    this._notificacion.set(null);
    this._poder8Estado.set(null);
    this._revancha.set(null);
  }

  private publicarNotificacion(
    tipo: NotificacionJuego['tipo'],
    mensaje: string,
  ): void {
    this.secuenciaNotificacion += 1;
    this._notificacion.set({
      id: this.secuenciaNotificacion,
      tipo,
      mensaje,
    });
  }

  private formatearHabilidadDenegada(evento: EvHabilidadDenegada): string {
    const habilidad = (evento.habilidad ?? 'desconocida').split('-').join(' ');
    return `Habilidad denegada: ${habilidad}.`;
  }
}
