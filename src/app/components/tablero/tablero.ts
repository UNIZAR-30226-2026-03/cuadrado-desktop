import { Component, OnInit, OnDestroy, signal, computed, effect, Injector } from '@angular/core';
import { NgStyle } from '@angular/common';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth';
import { RoomService, JugadorSala } from '../../services/room';
import { GameService, NotificacionJuego } from '../../services/game';
import { VoiceChatService } from '../../services/voice-chat';
import {
  WebsocketService,
  EvTurnoIniciado,
  EvDescartarPendiente,
  EvDecisionRequerida,
  EvCartaRobada,
  PoderCarta,
  EvIntercambioCartas,
  EvHacerRobarCarta,
  EvAccionProtegidaCancelada,
  EvPlayerControllerChanged,
  EvInicioPartida,
} from '../../services/websocket';
import { environment } from '../../environment';

// Mapeo valor carta → poder backend (definido en game.manager.ts del backend)
const PODER_POR_VALOR: Record<number, PoderCarta | null> = {
  1: 'intercambiar-todas-cartas',
  2: 'hacer-robar-carta',
  3: 'proteger-carta',
  4: 'saltar-turno-jugador',
  5: 'ver-carta-rival',
  6: null,   // roba-y-sigue: backend automático al descartar
  7: null,   // habilidad almacenable (se activa manualmente desde mochila)
  8: null,   // habilidad almacenable (se activa manualmente desde mochila)
  9: 'intercambiar-carta',
  10: 'ver-carta',
  11: 'ver-carta',
  12: null,
  13: null,
};

function poderDeValor(valor: number): PoderCarta | null {
  return PODER_POR_VALOR[valor] ?? null;
}

// Tipos internos del tablero

type Palo = 'corazones' | 'picas' | 'rombos' | 'treboles' | 'joker';
type Posicion = 'south' | 'north' | 'east' | 'west' | 'ne' | 'nw' | 'se' | 'sw';
type FaseTurno = 'banner' | 'robando' | 'decidiendo' | 'idle' | 'shuffle' | 'fin';

interface CartaMesa {
  valor: number;  // 1-13
  palo: Palo;
  visible: boolean;
  seleccionada: boolean;
  protegida?: boolean;   // poder 3: escudo permanente hasta descartar/intercambiar
}

interface JugadorMesa {
  id: string;
  nombre: string;
  avatar: string;
  esYo: boolean;
  esBot: boolean;
  posicion: Posicion;
  mano: CartaMesa[];
  cartaPendiente: CartaMesa | null;
  reverso?: string;  // nombre de la skin de dorso de carta equipada
  tapete?: string;   // nombre de la skin de tapete equipada
}

interface CartaReveladaModal {
  propia: CartaMesa;
  rival?: CartaMesa;
  // True cuando el evento corresponde a la J: el jugador debe decidir
  // intercambiar antes de que el servidor avance el turno (game:resolver-j).
  requiereDecisionJ?: boolean;
}

interface PendingSkill {
  poder: PoderCarta;
  valorCarta: number;
  fase: 'propia' | 'rival' | 'cartaRival';
  numCartaPropia: number | null;
}

// Posiciones según número de jugadores: índice 0 = yo (sur)
const POSICIONES: Record<number, Posicion[]> = {
  2: ['south', 'north'],
  3: ['south', 'east', 'west'],
  4: ['south', 'east', 'north', 'west'],
  5: ['south', 'east', 'ne', 'nw', 'west'],
  6: ['south', 'east', 'ne', 'north', 'nw', 'west'],
  7: ['south', 'se', 'east', 'ne', 'north', 'nw', 'west'],
  8: ['south', 'se', 'east', 'ne', 'north', 'nw', 'west', 'sw'],
};

const TURNO_SEGUNDOS = 20;
const CARTAS_POR_JUGADOR = 4;

@Component({
  selector: 'app-tablero',
  standalone: true,
  imports: [NgStyle],
  templateUrl: './tablero.html',
  styleUrl: './tablero.scss',
})
export class Tablero implements OnInit, OnDestroy {

  // Estado reactivo
  jugadores        = signal<JugadorMesa[]>([]);
  turnoIdx         = signal(0);
  fase             = signal<FaseTurno>('idle');
  timerSegundos    = signal(TURNO_SEGUNDOS);
  timerDuracion    = signal(TURNO_SEGUNDOS);
  modoIntercambio  = signal(false);
  // Carta elegida por el jugador local en el poder 9, guardada antes de
  // que se limpie pendingSkill / intercambioCiegoRequerido.
  poderNueveCartaLocal = signal<number | null>(null);
  // Banner del turno: visible durante todo el turno; arranca centrado y a
  // 1s se desplaza al lateral para no bloquear el centro de la mesa.
  mostrarBannerTurno = signal(false);
  bannerLateral      = signal(false);
  discardTop       = signal<CartaMesa | null>(null);
  deckCount        = signal(0);
  mensajeFin       = signal<string | null>(null);
  rankingFinal     = signal<Array<{userId: string; puntaje: number; posicion?: number}> | null>(null);
  ganadorIdFinal   = signal<string | null>(null);
  cuboActivado      = signal(false);
  cuboInfo          = signal<{ solicitanteId: string; turnosRestantes: number } | null>(null);
  cuboBannerVisible = signal(false);
  robarDisponible   = signal(false);

  // Poderes: estado de selección de objetivo
  esperandoObjetivo    = signal(false);
  poderPendiente       = signal<PoderCarta | null>(null);
  numCartaPendiente    = signal<number | null>(null);
  // Poder 5 (ver-carta-rival): rival elegido en el primer paso, esperando
  // a que el jugador elija una carta concreta del rival.
  rivalSeleccionado    = signal<string | null>(null);

  // Feedback inbound (eventos servidor -> UI)
  cartaReveladaModal = signal<CartaReveladaModal | null>(null);
  notificacionToast  = signal<NotificacionJuego | null>(null);
  pendingSkill       = signal<PendingSkill | null>(null);

  // Poderes almacenables (7 y 8). El backend no emite un evento por jugador
  // con su almacén; lo inferimos desde los descartes locales del jugador.
  // Cada vez que el jugador local descarta un 7 u 8 se acumula aquí; al
  // activarlos se decrementa.
  poderesAlmacenados = signal<number[]>([]);
  // Bloqueos diferidos del poder 8 que afectan a la próxima habilidad ejecutada.
  poder8BloqueosPendientes = computed(() => this.gameService.poder8Estado()?.pendientesDiferidos ?? 0);
  contadorPoder7 = computed(() => this.poderesAlmacenados().filter(p => p === 7).length);
  contadorPoder8 = computed(() => this.poderesAlmacenados().filter(p => p === 8).length);
  // Modo selección activo del poder 7: el jugador debe elegir una carta
  // propia que coincida en valor con la última descartada. Se activa al
  // recibir `game:poner-carta-sobre-otra { aceptada: true }` y se mantiene
  // mientras el backend siga emitiendo `game:poner-otra-carta-sobre-otra`.
  seleccionPoder7Activa = signal(false);
  // Descarte Rápido: true desde que el jugador pulsa el botón hasta que el
  // backend responde con `aceptada`. Si aceptada→true pasa a seleccionPoder7Activa.
  modoDescarteRapidoActivo = signal(false);
  // true mientras esperamos la respuesta de broadcast tras enviar poner-carta-sobre-otra.
  private _descarteRapidoEnProceso = false;

  // Flash de animación: set de keys "jugadorId:cartaIdx" o "jugadorId:pendiente"
  // que determina qué cartas deben mostrar el borde iluminado en ese instante.
  flashKeys = signal<ReadonlySet<string>>(new Set<string>());

  // Flash de aterrizaje: señal que activa la animación de entrada en la pila de descartes.
  discardArrivalFlash = signal(false);

  // Anuncio temporal de acción ("¡X descarta!" / "¡X intercambia!").
  // El campo seq garantiza nuevo valor de señal aunque nombre/accion sean iguales,
  // forzando la recreación del DOM y el reinicio de la animación CSS.
  discardAnuncio = signal<{ nombre: string; accion: 'descarta' | 'intercambia'; seq: number } | null>(null);
  private discardAnuncioSeq = 0;

  // Modal de salida del host (Paso 1: Opciones de Salida)
  modalSalidaVisible = signal(false);

  // Banner de sustitución por bot (jugador no-host abandona)
  bannerSustitucion = signal<string | null>(null);
  private bannerSustitucionTimer: ReturnType<typeof setTimeout> | null = null;

  // Revancha (estadio 9). El estado real lo trae `gameService.revancha()`,
  // pero llevamos un flag local para deshabilitar el botón tras emitir
  // `game:volver-a-jugar` y mostrar feedback inmediato.
  revanchaSolicitada = signal(false);
  revanchaEstado = computed(() => this.gameService.revancha()?.estado ?? null);
  // Flag interno para indicarle a ngOnDestroy que la transición a la sala
  // de espera es por revancha: NO debe desconectar el websocket ni cerrar el
  // audio (la nueva sala los reusa). Sin esto, el waiting-room llega a una
  // sala desconectada y nunca recibe room:update del backend.
  private revanchaEnCurso = false;

  // Poder 4: bloqueo UI cuando me han saltado el turno. Se activa al recibir
  // `game:turno-jugador-saltado` con destinatario=yo y se desactiva tras 2s.
  saltoTurnoBloqueo = signal<{ remitenteNombre: string } | null>(null);
  private saltoTurnoTimeout: ReturnType<typeof setTimeout> | null = null;

  // Poder 5: modal con cartas reveladas a todos.
  cartasReveladasTodosModal = signal<Array<{ jugadorId: string; valor: number; palo: Palo }> | null>(null);
  private cartasTodosTimeout: ReturnType<typeof setTimeout> | null = null;

  // Poder 9 (intercambio ciego) lado rival: el iniciador ya envió su carta.
  // Ahora el rival debe elegir, a ciegas, una carta de su mano para entregar.
  intercambioCiegoRequerido = signal<{ usuarioIniciador: string } | null>(null);

  // Computados
  jugadorActual = computed(() => {
    const order = this.turnoOrder;
    if (order.length > 0) {
      const userId = order[this.turnoIdx() % order.length];
      return this.jugadores().find(j => j.nombre === userId) ?? null;
    }
    return this.jugadores()[this.turnoIdx()] ?? null;
  });
  esMiTurno           = computed(() => !!this.jugadorActual()?.esYo);
  estaEnPartidaOnline = computed(() => !!this.gameService.gameId());
  timerPorcentaje = computed(() => (this.timerSegundos() / this.timerDuracion()) * 100);
  rankingConNombres = computed(() => {
    const ranking = this.rankingFinal();
    if (!ranking) return null;
    const jugadores = this.jugadores();
    return ranking.map((entry, i) => ({
      posicion: i + 1,
      nombre: jugadores.find(j => j.id === entry.userId)?.nombre ?? entry.userId,
      puntaje: entry.puntaje,
      esYo: jugadores.find(j => j.id === entry.userId)?.esYo ?? false,
    }));
  });
  timerUrgente    = computed(() => this.timerSegundos() <= 5 && this.esMiTurno() && this.fase() === 'decidiendo');
  soyAnfitrion    = computed(() => this.roomService.esAnfitrion());

  // Orden de turno sincronizado con el backend (userIds); vacío en modo local
  private turnoOrder: string[] = [];

  // Internos
  // TODO(backend): deck → GameManager.robarCarta() vía evento game:carta-robada
  private deck: CartaMesa[] = [];
  // TODO(backend): discardPile → GameManager (cartasDescartadas) vía evento game:mazo-rebarajado
  private discardPile: CartaMesa[] = [];
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private robarInterval: ReturnType<typeof setInterval> | null = null;
  private phaseTimeout:  ReturnType<typeof setTimeout>  | null = null;
  private cuboBannerTimer: ReturnType<typeof setTimeout> | null = null;
  private bannerLateralTimer: ReturnType<typeof setTimeout> | null = null;
  private discardArrivalTimer: ReturnType<typeof setTimeout> | null = null;
  private discardAnuncioTimer: ReturnType<typeof setTimeout> | null = null;
  private cuboTurnosLocal = 0; // contador de turnos restantes en modo local
  private revealTimeout: ReturnType<typeof setTimeout> | null = null;
  private toastTimeout:  ReturnType<typeof setTimeout> | null = null;

  // URLs reales de las skins equipadas (obtenidas del backend)
  private localReversoUrl = signal<string | null>(null);
  private localTapeteUrl  = signal<string | null>(null);
  private reglasActivas: string[] = [];
  private subs: Subscription[] = [];

  constructor(
    private router:      Router,
    private auth:        AuthService,
    private roomService: RoomService,
    private http:        HttpClient,
    private gameService: GameService,
    private ws:          WebsocketService,
    private injector:    Injector,
    public  voiceChat:   VoiceChatService,
  ) {}

  ngOnInit(): void {
    const sala = this.roomService.obtenerSala();
    if (!sala || sala.jugadores.length < 2) {
      this.router.navigate(['/lobby']);
      return;
    }
    this.reglasActivas = sala.reglasActivas;
    this.conectarEstadosInbound();
    this.inicializarJuego(sala.jugadores);
    const inicioEv = this.gameService.ultimoInicioPartida();
    if (inicioEv?.estado) {
      this.restaurarEstadoGuardado(inicioEv.estado);
    }
    this.gameService.limpiarUltimoInicioPartida();

    // Si game:turno-iniciado llegó antes de que el tablero terminara de montarse
    // (ocurre siempre al reanudar: el backend lo emite justo después de inicio-partida),
    // arrancamos el turno desde el caché en lugar de esperar un evento que ya pasó.
    const turnoEv = this.gameService.ultimoTurnoIniciado();
    if (turnoEv && this.gameService.gameId()) {
      this.arrancarTurnoDesdeCache(turnoEv);
      this.gameService.limpiarUltimoTurnoIniciado();
    }

    this.cargarSkinsEquipadas();

    this.subs.push(
      this.ws.turnoIniciado$.subscribe((ev: EvTurnoIniciado) => {
        // Limpiar cartaPendiente de todos al transicionar de turno
        const sinPendientes = this.jugadores().map(j =>
          j.cartaPendiente ? { ...j, cartaPendiente: null } : j
        );
        this.jugadores.set(sinPendientes);
        // Decrementar contador de cubo si está activo
        if (this.cuboActivado()) {
          this.cuboInfo.update(info =>
            info ? { ...info, turnosRestantes: Math.max(0, info.turnosRestantes - 1) } : info
          );
        }
        const idx = this.turnoOrder.indexOf(ev.userId);
        this.turnoIdx.set(idx >= 0 ? idx : 0);
        this.limpiarEstadoPoder();
        this.limpiarTimers();
        this.iniciarTurno(ev.turnDeadlineAt);
      }),
      this.ws.cuboActivado$.subscribe(ev => {
        this.cuboActivado.set(true);
        this.cuboInfo.set({
          solicitanteId: ev.solicitanteId,
          turnosRestantes: ev.turnosRestantes,
        });
        this.showCuboBanner();
      }),
      this.ws.partidaFinalizada$.subscribe(ev => {
        const motivos: Record<string, string> = {
          cubo: '¡Cubo! La partida ha terminado.',
          sinCartasMazo: 'El mazo se ha agotado.',
          unJugadorSinCartas: 'Un jugador se ha quedado sin cartas.',
        };
        if (ev.ranking?.length) {
          this.rankingFinal.set(ev.ranking);
        }
        if (ev.ganadorId) {
          this.ganadorIdFinal.set(ev.ganadorId);
        }
        this.finalizarPartida(motivos[ev.motivo] ?? 'La partida ha terminado.');
      }),
      this.ws.roomClosed$.subscribe((ev) => {
        const msg = ev.savedRoomName
          ? `La partida ha sido guardada. Puedes reanudarla desde el lobby.`
          : 'La partida ha terminado porque el líder abandonó.';
        this.finalizarPartida(msg);
      }),
      this.ws.playerControllerChanged$.subscribe((ev: EvPlayerControllerChanged) => {
        if (ev.controlador === 'bot') {
          const nombre = ev.nombreEnPartida ?? ev.userId;
          this.mostrarBannerSustitucion(`${nombre} ha abandonado. Un bot tomará su lugar.`);
        }
      }),
      this.ws.descartePendiente$.subscribe((ev: EvDescartarPendiente) => {
        const palo = this.normalizarPalo(ev.carta.palo);
        if (palo) {
          this.discardTop.set({ valor: ev.carta.carta, palo, visible: true, seleccionada: false });
        }
        // Animación de aterrizaje en la pila para todos los clientes.
        this.triggerDiscardArrival();
        const actual = this.jugadorActual();
        if (actual && !actual.esYo) {
          // Solo para observadores: el jugador local ya muestra el banner correcto
          // desde accionDescartar() o seleccionarCartaMano(), y el eco del WS
          // no debe sobrescribirlo.
          // esIntercambio es true cuando el backend incluya tipo/numCarta en el broadcast.
          const esIntercambio = ev.tipo === 'intercambiar' || ev.numCarta !== undefined;
          const targets = [`${actual.id}:pendiente`];
          if (esIntercambio && ev.numCarta !== undefined) targets.push(`${actual.id}:${ev.numCarta}`);
          this.triggerFlash(targets, esIntercambio ? 1000 : 500);
          this.mostrarAnuncioAccion(actual.nombre, esIntercambio ? 'intercambia' : 'descarta');
        }
      }),
      // Sincronizar la carta robada real del backend con cartaPendiente del jugador local.
      // Backend dev envía `carta`; versiones previas usaban `game`. Aceptamos ambos.
      this.ws.decisionRequerida$.subscribe((ev: EvDecisionRequerida) => {
        const cartaInfo = ev.carta ?? ev.game;
        if (!cartaInfo) return;
        const palo = this.normalizarPalo(cartaInfo.palo);
        if (!palo) return;
        const all = [...this.jugadores()];
        const idx = this.idxActualEnArray();
        if (all[idx]?.esYo) {
          all[idx] = { ...all[idx], cartaPendiente: { valor: cartaInfo.carta, palo, visible: true, seleccionada: false } };
          this.jugadores.set(all);
        }
      }),
      // Backend emite esto cuando el jugador descarta un 6 (roba-y-decide).
      // La nueva carta queda como pendiente igual que en una decisión normal.
      this.ws.cartaRobadaPorDescartar6$.subscribe((ev) => {
        const palo = this.normalizarPalo(ev.cartaRobada.palo);
        if (!palo) return;
        if (ev.reshuffle?.cantidadCartasMazo != null) {
          this.deckCount.set(ev.reshuffle.cantidadCartasMazo);
        }
        const all = [...this.jugadores()];
        const idx = this.idxActualEnArray();
        if (all[idx]?.esYo) {
          all[idx] = { ...all[idx], cartaPendiente: { valor: ev.cartaRobada.carta, palo, visible: true, seleccionada: false } };
          this.jugadores.set(all);
          this.modoIntercambio.set(false);
          this.fase.set('decidiendo');
          this.pararTimer();
          this.iniciarTimer();
        }
      }),
      // Backend emite esto cuando falla el descarte rapido.
      // La carta pasa directamente a la mano del jugador local.
      this.ws.cartaRobadaPorDescarteRapido$.subscribe((ev) => {
        const palo = this.normalizarPalo(ev.cartaRobada.palo);
        if (!palo) return;
        if (ev.reshuffle?.cantidadCartasMazo != null) {
          this.deckCount.set(ev.reshuffle.cantidadCartasMazo);
        }
        const all = [...this.jugadores()];
        // Este evento sólo llega al cliente propio (to(client.id)), nunca al jugador del turno.
        // Usar findIndex(esYo) en lugar de idxActualEnArray() para no depender de quién tiene el turno.
        const idx = all.findIndex(j => j.esYo);
        if (idx < 0) return;
        const mano = [...all[idx].mano];
        const cartaNueva: CartaMesa = { valor: ev.cartaRobada.carta, palo, visible: false, seleccionada: false };
        const placeholderIdx = mano.findIndex(c => c.valor === 0 && c.palo === 'joker');
        if (placeholderIdx >= 0) {
          mano[placeholderIdx] = cartaNueva;
        } else if (mano.length < ev.numCartasMano) {
          mano.push(cartaNueva);
        }
        all[idx] = { ...all[idx], mano };
        this.jugadores.set(all);
      }),
      // Una carta protegida bloqueó una habilidad: NO bloquear el turno,
      // solo notificar al usuario. El backend ya reanuda el flujo.
      this.ws.accionProtegidaCancelada$.subscribe((ev: EvAccionProtegidaCancelada) => {
        // Quitar la marca de escudo del jugador cuya protección fue consumida.
        const all = [...this.jugadores()];
        const idx = all.findIndex(j => j.id === ev.propietarioId || j.nombre === ev.propietarioId);
        if (idx >= 0) {
          const mano = all[idx].mano.map(c => c.protegida ? { ...c, protegida: false } : c);
          all[idx] = { ...all[idx], mano };
          this.jugadores.set(all);
        }
      }),
      // Descarte Rápido paso 1: server confirma si acepta la solicitud.
      this.ws.ponerCartaSobreOtra$.subscribe((ev) => {
        this.modoDescarteRapidoActivo.set(false);
        if (!ev.aceptada) {
          this.seleccionPoder7Activa.set(false);
          this.publicarToast('No es posible el descarte rápido en este momento.', 'error');
          return;
        }
        this.poderesAlmacenados.update(prev => {
          const idx = prev.indexOf(7);
          if (idx === -1) return prev;
          const next = [...prev];
          next.splice(idx, 1);
          return next;
        });
        this.seleccionPoder7Activa.set(true);
      }),
      // Descarte Rápido paso 3 (éxito/chain): servidor confirma acierto.
      this.ws.ponerOtraCartaSobreOtra$.subscribe(() => {
        if (this._descarteRapidoEnProceso) {
          this._descarteRapidoEnProceso = false;
          this.publicarToast('¡Descarte interceptado con éxito!');
        }
        this.seleccionPoder7Activa.set(true);
      }),
      // Descarte Rápido — sincronizar tamaño de mano; detectar fallo si no llegó éxito antes.
      this.ws.accionCartaSobreOtra$.subscribe((ev) => {
        if (this._descarteRapidoEnProceso) {
          const yo = this.jugadores().find(j => j.esYo);
          if (yo && (ev.usuarioImplicado === yo.nombre || ev.usuarioImplicado === yo.id)) {
            this._descarteRapidoEnProceso = false;
            this.publicarToast('¡Fallo en el descarte! Robas una carta de penalización.', 'error');
          }
        }
        const all = [...this.jugadores()];
        const idx = all.findIndex(j => j.nombre === ev.usuarioImplicado);
        if (idx < 0) return;
        const jug = all[idx];
        if (jug.mano.length === ev.numCartasMano) return;
        if (jug.mano.length > ev.numCartasMano) {
          all[idx] = { ...jug, mano: jug.mano.slice(0, ev.numCartasMano) };
        } else if (!jug.esYo) {
          // Para jugadores remotos: placeholder opaco hasta que llegue la carta real.
          // Para "yo" en descarte rápido fallido: cartaRobadaPorDescarteRapido$ añade la carta real, no añadimos jokers aquí.
          const placeholder: CartaMesa = { valor: 0, palo: 'joker', visible: false, seleccionada: false };
          const extra = ev.numCartasMano - jug.mano.length;
          all[idx] = { ...jug, mano: [...jug.mano, ...Array.from({ length: extra }, () => ({ ...placeholder }))] };
        }
        this.jugadores.set(all);
      }),
      // Mostrar reverso de carta cuando un jugador remoto roba
      this.ws.cartaRobada$.subscribe((ev: EvCartaRobada) => {
        this.deckCount.set(ev.cartasRestantes);
        const userId = this.turnoOrder[ev.jugadorRobado];
        if (!userId) return;
        const all = [...this.jugadores()];
        const robadorIdx = all.findIndex(j => j.nombre === userId);
        if (robadorIdx >= 0 && !all[robadorIdx].esYo && !all[robadorIdx].esBot) {
          all[robadorIdx] = { ...all[robadorIdx], cartaPendiente: { valor: 1, palo: 'corazones', visible: false, seleccionada: false } };
          this.jugadores.set(all);
        }
      }),
      // Poder 3: marcar carta protegida con escudo permanente.
      this.ws.cartaProtegida$.subscribe((ev) => {
        const all = [...this.jugadores()];
        const idx = all.findIndex(j => j.nombre === ev.jugadorId || j.id === ev.jugadorId);
        if (idx < 0) return;
        const mano = all[idx].mano.map((c, i) =>
          i === ev.cartaIndex ? { ...c, protegida: true } : c
        );
        all[idx] = { ...all[idx], mano };
        this.jugadores.set(all);
      }),
      // Poder 4: cuando me saltan el turno, bloquear UI 2s y mostrar mensaje.
      this.ws.turnoJugadorSaltado$.subscribe((ev) => {
        const yo = this.jugadores().find(j => j.esYo);
        if (!yo) return;
        const soyDestinatario = ev.destinatarioId === yo.nombre || ev.destinatarioId === yo.id;
        if (!soyDestinatario) return;
        const remitente = this.jugadores().find(
          j => j.nombre === ev.remitenteId || j.id === ev.remitenteId,
        );
        const nombre = remitente?.nombre ?? ev.remitenteId;
        this.activarBloqueoSaltoTurno(nombre);
      }),
      // Poder 9 paso 2: el iniciador ya emitió su selección a ciegas; el
      // backend nos avisa al rival para que elija su carta. Mostramos overlay
      // con la mano oculta (boca abajo) — el rival elige sin ver su carta.
      this.ws.intercambioRival$.subscribe((ev) => {
        const yo = this.jugadores().find(j => j.esYo);
        if (!yo) return;
        this.intercambioCiegoRequerido.set({ usuarioIniciador: ev.usuarioIniciador });
      }),
      // Poder 5: modal con cartas reveladas a todos.
      this.ws.cartasReveladasTodos$.subscribe((ev) => {
        const cartas = ev.cartas
          .map(c => ({
            jugadorId: c.jugadorId,
            valor: c.carta.carta,
            palo: this.normalizarPalo(c.carta.palo) ?? ('picas' as Palo),
          }));
        this.cartasReveladasTodosModal.set(cartas);
        if (this.cartasTodosTimeout) clearTimeout(this.cartasTodosTimeout);
        this.cartasTodosTimeout = setTimeout(() => {
          this.cartasReveladasTodosModal.set(null);
          this.gameService.limpiarCartasReveladasTodos();
        }, 5000);
      }),
    );
  }

  /** Activa bloqueo UI tras evento `game:turno-jugador-saltado` con destinatario=yo.
   *  Pasa 2 segundos exactos antes de desbloquear. El backend ya avanza el turno
   *  internamente; aquí solo bloqueamos input local mientras dure la animación. */
  private activarBloqueoSaltoTurno(remitenteNombre: string): void {
    if (this.saltoTurnoTimeout) clearTimeout(this.saltoTurnoTimeout);
    this.saltoTurnoBloqueo.set({ remitenteNombre });
    this.saltoTurnoTimeout = setTimeout(() => {
      this.saltoTurnoBloqueo.set(null);
      this.gameService.limpiarUltimoSaltoTurno();
    }, 2000);
  }

  cerrarModalCartasTodos(): void {
    this.cartasReveladasTodosModal.set(null);
    this.gameService.limpiarCartasReveladasTodos();
    if (this.cartasTodosTimeout) {
      clearTimeout(this.cartasTodosTimeout);
      this.cartasTodosTimeout = null;
    }
  }

  private cargarSkinsEquipadas(): void {
    const headers = { Authorization: `Bearer ${this.auth.getToken()}` };
    this.http.get<{ carta: string | null; tapete: string | null }>(
      `${environment.apiUrl}/skins/equipped`, { headers }
    ).subscribe({
      next: (data) => {
        this.localReversoUrl.set(data.carta ?? environment.defaultReversoUrl);
        if (data.tapete) this.localTapeteUrl.set(data.tapete);
      },
    });
  }

  ngOnDestroy(): void {
    if (this.discardAnuncioTimer) {
      clearTimeout(this.discardAnuncioTimer);
      this.discardAnuncioTimer = null;
    }
    this.limpiarTimers();
    this.limpiarFeedbackVisual();
    this.subs.forEach(s => s.unsubscribe());
    if (this.revanchaEnCurso) {
      // Revancha: limpiar el estado de partida pero mantener viva la conexión
      // websocket y el stream de audio para que el waiting-room los reutilice.
      this.gameService.limpiarParaRevancha();
      return;
    }
    this.gameService.salirDePartida();
    this.voiceChat.leaveVoiceRoom();
    this.voiceChat.stopLocalStream();
  }

  private conectarEstadosInbound(): void {
    effect(() => {
      const evento = this.gameService.cartaRevelada();
      if (!evento) return;

      // Si llega carta propia + rival → es la J (poder 11): el backend deja
      // el permiso pendiente esperando game:resolver-j. NO autocerrar el modal.
      const esDecisionJ = !!evento.cartaJugadorContrario;

      this.cartaReveladaModal.set({
        propia: this.normalizarCartaEvento(evento.carta),
        rival: evento.cartaJugadorContrario
          ? this.normalizarCartaEvento(evento.cartaJugadorContrario)
          : undefined,
        requiereDecisionJ: esDecisionJ,
      });

      if (!esDecisionJ) {
        this.reprogramarCierreCartaRevelada();
      } else if (this.revealTimeout) {
        clearTimeout(this.revealTimeout);
        this.revealTimeout = null;
      }
    }, { injector: this.injector });

    effect(() => {
      const evento = this.gameService.ultimoIntercambioCartas();
      if (!evento) return;

      this.aplicarIntercambioInbound(evento);
      this.gameService.limpiarUltimoIntercambioCartas();
    }, { injector: this.injector });

    effect(() => {
      const evento = this.gameService.ultimoRoboForzado();
      if (!evento) return;

      this.aplicarRoboForzadoInbound(evento);
      this.gameService.limpiarUltimoRoboForzado();
    }, { injector: this.injector });

    effect(() => {
      const notificacion = this.gameService.notificacion();
      if (!notificacion) return;

      this.notificacionToast.set(notificacion);
      this.reprogramarCierreToast(notificacion.id);
    }, { injector: this.injector });

    // Revancha: cuando el server confirma `room-ready` con `roomCode`, la sala
    // ya existe en backend (server hace leave/join automático). Persistimos
    // un placeholder mínimo en RoomService para que la pantalla de espera
    // arranque, y `room:update` rellenará el resto al llegar.
    effect(() => {
      const ev = this.gameService.revancha();
      if (!ev) return;
      if (ev.estado !== 'room-ready' || !ev.roomCode) return;

      const yo = this.jugadores().find(j => j.esYo)?.nombre ?? '';
      const soyHost = ev.hostId === yo;
      this.persistirSalaRevancha(ev.roomCode, ev.roomName ?? 'Revancha', soyHost);
      // Marcar la transición como revancha ANTES de navegar para que el
      // ngOnDestroy preserve la conexión websocket y el audio de cara a la
      // nueva sala (el backend hace leave/join automático sobre el mismo socket).
      this.revanchaEnCurso = true;
      this.router.navigate(['/waiting-room']);
    }, { injector: this.injector });
  }

  private normalizarCartaEvento(carta: {
    carta: number;
    palo: string;
    puntos: number;
    protegida: boolean;
  }): CartaMesa {
    return {
      valor: carta.carta,
      palo: this.normalizarPalo(carta.palo) ?? 'picas',
      visible: true,
      seleccionada: false,
    };
  }

  private aplicarIntercambioInbound(evento: EvIntercambioCartas): void {
    const jugadores = [...this.jugadores()];
    const idxRemitente = jugadores.findIndex((j) => j.id === evento.remitente);
    const idxDestinatario = jugadores.findIndex((j) => j.id === evento.destinatario);
    if (idxRemitente === -1 || idxDestinatario === -1) return;

    const remitente = jugadores[idxRemitente];
    const destinatario = jugadores[idxDestinatario];

    // Poder 9: swap de una carta concreta.
    // La carta local del jugador se guardó en poderNueveCartaLocal al seleccionarla.
    // El state update sí necesita los índices del backend; la animación no.
    const cartaLocal = this.poderNueveCartaLocal();
    this.poderNueveCartaLocal.set(null);

    const yo = jugadores.find(j => j.esYo);
    const soySujeto = yo?.id === remitente.id || yo?.id === destinatario.id;

    const tieneIndicesBackend =
      typeof evento.numCartaRemitente === 'number' &&
      typeof evento.numCartaDestinatario === 'number' &&
      evento.numCartaRemitente >= 0 &&
      evento.numCartaDestinatario >= 0 &&
      evento.numCartaRemitente < remitente.mano.length &&
      evento.numCartaDestinatario < destinatario.mano.length;

    if (tieneIndicesBackend || (soySujeto && cartaLocal !== null)) {
      // State update: solo si el backend envió los índices correctos
      if (tieneIndicesBackend) {
        const manoR = [...remitente.mano];
        const manoD = [...destinatario.mano];
        const tmp = manoR[evento.numCartaRemitente!];
        manoR[evento.numCartaRemitente!] = manoD[evento.numCartaDestinatario!];
        manoD[evento.numCartaDestinatario!] = tmp;
        jugadores[idxRemitente]   = { ...remitente,   mano: manoR };
        jugadores[idxDestinatario] = { ...destinatario, mano: manoD };
        this.jugadores.set(jugadores);
      }

      // Animación: flash de carta propia (estado local) → secuencia 0→N rival
      const PROPIA_MS  = 400;
      const SEQ_STEP_MS = 220;
      if (yo?.id === remitente.id) {
        if (cartaLocal !== null) this.triggerFlash([`${remitente.id}:${cartaLocal}`], PROPIA_MS);
        setTimeout(() => this.triggerSequentialFlash(destinatario.id, destinatario.mano.length, SEQ_STEP_MS), PROPIA_MS);
      } else if (yo?.id === destinatario.id) {
        if (cartaLocal !== null) this.triggerFlash([`${destinatario.id}:${cartaLocal}`], PROPIA_MS);
        setTimeout(() => this.triggerSequentialFlash(remitente.id, remitente.mano.length, SEQ_STEP_MS), PROPIA_MS);
      } else {
        // Observadores: ambas secuencias en paralelo
        this.triggerSequentialFlash(remitente.id, remitente.mano.length, SEQ_STEP_MS);
        this.triggerSequentialFlash(destinatario.id, destinatario.mano.length, SEQ_STEP_MS);
      }
      return;
    }

    // Poder AS: intercambio total de manos, saltando las posiciones en las
    // que cualquiera de los dos jugadores tenga una carta protegida (poder 3).
    this.triggerFlash([
      ...remitente.mano.map((_, i) => `${remitente.id}:${i}`),
      ...destinatario.mano.map((_, i) => `${destinatario.id}:${i}`),
    ]);

    const manoRemitente = [...remitente.mano];
    const manoDestinatario = [...destinatario.mano];
    const len = Math.min(manoRemitente.length, manoDestinatario.length);
    for (let i = 0; i < len; i++) {
      if (manoRemitente[i].protegida || manoDestinatario[i].protegida) continue;
      const tmp = manoRemitente[i];
      manoRemitente[i] = manoDestinatario[i];
      manoDestinatario[i] = tmp;
    }
    jugadores[idxRemitente] = { ...remitente, mano: manoRemitente };
    jugadores[idxDestinatario] = { ...destinatario, mano: manoDestinatario };
    this.jugadores.set(jugadores);
  }

  private aplicarRoboForzadoInbound(evento: EvHacerRobarCarta): void {
    const jugadores = [...this.jugadores()];
    const idxDestinatario = jugadores.findIndex((j) => j.id === evento.destinatario);
    if (idxDestinatario === -1) return;

    const jugador = jugadores[idxDestinatario];
    const cartaRobada = this.extraerCartaParaRoboForzado();

    jugadores[idxDestinatario] = {
      ...jugador,
      mano: [...jugador.mano, cartaRobada],
    };

    this.jugadores.set(jugadores);
  }

  private extraerCartaParaRoboForzado(): CartaMesa {
    const carta = this.deck.pop();
    if (carta) {
      this.deckCount.set(this.deck.length);
      return { ...carta, visible: false, seleccionada: false };
    }

    // Fallback visual cuando no tenemos carta local disponible.
    return {
      valor: 0,
      palo: 'joker',
      visible: false,
      seleccionada: false,
    };
  }

  cerrarOverlayCartaRevelada(): void {
    this.cartaReveladaModal.set(null);
    this.gameService.limpiarCartaRevelada();
    if (this.revealTimeout) {
      clearTimeout(this.revealTimeout);
      this.revealTimeout = null;
    }
  }

  /** Decisión final del poder J: intercambiar la carta vista.
   *  Solo se ejecuta cuando el jugador pulsa "Intercambiar". */
  decidirIntercambioJ(intercambiar: boolean): void {
    const modal = this.cartaReveladaModal();
    if (!modal?.requiereDecisionJ) return;
    this.gameService.resolverJ(intercambiar);
    this.cerrarOverlayCartaRevelada();
  }

  /** Cancelar la decisión J: cierra el modal manteniendo el permiso pendiente
   *  para que el jugador pueda probar otra combinación carta propia + rival.
   *  Importante: NO emite resolverJ(false) — eso resuelve el permiso y avanza
   *  el turno. La spec pide reintentar, así que vuelve a fase 'propia'. */
  cancelarDecisionJ(): void {
    const modal = this.cartaReveladaModal();
    if (!modal?.requiereDecisionJ) return;
    // El backend dejó el permiso 'decidir-intercambio-j' activo: para reintentar
    // hay que enviar resolverJ(false) y luego re-disparar la J. Como el server
    // mantiene el permiso solo para la última invocación, la forma más segura
    // es: cerrar modal, avisar al server que NO intercambia, y permitir que el
    // jugador vuelva a hacer flujo selección propia → rival si dispone de J.
    this.gameService.resolverJ(false);
    this.cartaReveladaModal.set(null);
    this.gameService.limpiarCartaRevelada();
    if (this.revealTimeout) {
      clearTimeout(this.revealTimeout);
      this.revealTimeout = null;
    }
    // Re-iniciar selección si todavía es mi turno y tengo el poder pendiente.
    // El usuario verá las cartas, podrá descartar otra J o pasar.
    this.publicarToast('Decisión cancelada. Selecciona nueva combinación si dispones del poder.');
  }

  private publicarToast(mensaje: string, tipo: NotificacionJuego['tipo'] = 'success'): void {
    this.notificacionToast.set({ id: Date.now(), tipo, mensaje });
    this.reprogramarCierreToast(Date.now());
  }

  /** Activa un poder 8 almacenado: bloquea la próxima habilidad rival. */
  activarPoder8Almacenado(): void {
    if (this.contadorPoder8() === 0) return;
    if (!this.esMiTurno()) return;
    const gameId = this.gameService.gameId();
    if (!gameId) return;
    this.ws.desactivarProximaHabilidad(gameId);
    this.poderesAlmacenados.update(prev => {
      const idx = prev.indexOf(8);
      if (idx === -1) return prev;
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });
  }

  /** Activa un poder 7 almacenado: radar — revela qué jugador tiene menos puntos.
   *  El backend solo lo permite al inicio del turno (fase WAIT_DRAW).
   */
  activarPoder7Almacenado(): void {
    if (this.contadorPoder7() === 0) return;
    if (!this.esMiTurno()) return;
    const gameId = this.gameService.gameId();
    if (!gameId) return;
    this.ws.jugadorMenosPuntuacion(gameId);
    this.poderesAlmacenados.update(prev => {
      const idx = prev.indexOf(7);
      if (idx === -1) return prev;
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });
  }

  /** Cancela manualmente el modo selección del poder 7 (sin emitir al server). */
  cancelarSeleccionPoder7(): void {
    this.seleccionPoder7Activa.set(false);
  }

  /** Inicia el flujo de Descarte Rápido: solicita permiso al backend y
   *  activa el modo de espera. El servidor responderá con aceptada true/false. */
  iniciarDescarteRapido(): void {
    const gameId = this.gameService.gameId();
    if (!gameId || this.fase() === 'fin') return;
    if (this.modoDescarteRapidoActivo() || this.seleccionPoder7Activa()) return;
    this.modoDescarteRapidoActivo.set(true);
    this.ws.solicitarCartaSobreOtra(gameId);
  }

  cancelarDescarteRapido(): void {
    this.modoDescarteRapidoActivo.set(false);
  }

  /** Solicita revancha al backend (`game:volver-a-jugar`). */
  solicitarRevancha(): void {
    if (this.revanchaSolicitada()) return;
    this.revanchaSolicitada.set(true);
    this.gameService.volverAJugar();
  }

  private reprogramarCierreCartaRevelada(): void {
    if (this.revealTimeout) {
      clearTimeout(this.revealTimeout);
    }
    this.revealTimeout = setTimeout(() => {
      this.cerrarOverlayCartaRevelada();
    }, 6000);
  }

  private reprogramarCierreToast(notificacionId: number): void {
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }
    this.toastTimeout = setTimeout(() => {
      this.notificacionToast.set(null);
      this.gameService.limpiarNotificacion(notificacionId);
    }, 3500);
  }

  private limpiarFeedbackVisual(): void {
    if (this.revealTimeout) {
      clearTimeout(this.revealTimeout);
      this.revealTimeout = null;
    }
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
  }

  // Inicialización

  private inicializarJuego(lista: JugadorSala[]): void {
    const miNombre = this.auth.usuario()?.nombre ?? '';

    // Capturar el orden de turno del backend si está disponible
    this.turnoOrder = [...this.gameService.turnoJugadores()];

    // El jugador humano siempre en posición sur (índice 0)
    const yo    = lista.find(j => j.nombre === miNombre && !j.esBot);
    const resto = lista.filter(j => j !== yo);
    const ordenados = yo ? [yo, ...resto] : lista;

    const n = Math.min(ordenados.length, 8);
    const posiciones = POSICIONES[n] ?? POSICIONES[4];

    // TODO(backend): crearBarajaMezclada → GameManager.rellenarBaraja() + mezclarArray()
    this.deck = this.crearBarajaMezclada();
    this.discardPile = [];

    const usuario = this.auth.usuario();
    const jugadoresMesa: JugadorMesa[] = ordenados.slice(0, n).map((j, i) => {
      const esYo = j.nombre === miNombre && !j.esBot;
      return {
        id:             j.id,
        nombre:         j.nombre,
        avatar:         j.avatar,
        esYo,
        esBot:          j.esBot,
        posicion:       posiciones[i],
        mano:           Array.from({ length: CARTAS_POR_JUGADOR }, () =>
                          ({ ...this.deck.pop()!, visible: false, seleccionada: false })
                        ),
        cartaPendiente: null,
        reverso:        esYo ? (usuario?.reverso || undefined) : undefined,
        tapete:         esYo ? (usuario?.tapete || undefined) : undefined,
      };
    });

    this.deckCount.set(this.deck.length);
    this.jugadores.set(jugadoresMesa);

    // Online: el primer turno lo lanza el backend vía game:turno-iniciado
    // Local: arrancar inmediatamente
    if (!this.gameService.gameId()) {
      this.phaseTimeout = setTimeout(() => this.iniciarTurno(), 600);
    }
  }

  private crearBarajaMezclada(): CartaMesa[] {
    const palos: Palo[] = ['corazones', 'picas', 'rombos', 'treboles'];
    const baraja: CartaMesa[] = [];
    for (const palo of palos) {
      for (let v = 1; v <= 13; v++) {
        baraja.push({ valor: v, palo, visible: false, seleccionada: false });
      }
    }
    // Mezcla Fisher-Yates
    for (let i = baraja.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [baraja[i], baraja[j]] = [baraja[j], baraja[i]];
    }
    return baraja;
  }

  // Ciclo de turno


  private iniciarTurno(turnDeadlineAt?: number): void {
    this.fase.set('banner');
    this.modoIntercambio.set(false);

    // Banner del turno: aparece centrado y, transcurrido 1s, se desplaza
    // al lateral para liberar el centro de la mesa (donde está el mazo).
    this.mostrarBannerTurno.set(true);
    this.bannerLateral.set(false);
    if (this.bannerLateralTimer) clearTimeout(this.bannerLateralTimer);
    this.bannerLateralTimer = setTimeout(() => this.bannerLateral.set(true), 1000);

    // Temporizador visual sincronizado en TODOS los clientes (no sólo en el del
    // jugador en turno): así la barra se decrementa en todas las pantallas.
    // El descarte automático al expirar sólo se ejecuta en el cliente del
    // jugador que tiene el turno (ver iniciarTimer).
    this.iniciarTimer(turnDeadlineAt);

    if (this.esMiTurno()) {
      this.robarDisponible.set(true);
    } else {
      const enLinea = !!this.gameService.gameId();
      if (!enLinea) {
        // Modo local: simular robo del jugador no-local (humano o bot)
        this.phaseTimeout = setTimeout(() => this.ejecutarRobo(), 2000);
      }
      // Modo online: el backend gestiona todos los jugadores no locales (humanos y bots)
    }
  }

  // TODO(backend): ejecutarRobo → WebsocketService.robarCarta(gameId) → GameManager.robarCarta()
  //   ✅ game:carta-robada emite { partidaId, jugadorRobado (índice), cartasRestantes }
  //   ✅ game:decision-requerida emite { gameId, game: cartaRobada } solo al jugador que robó
  //      NOTA: en el backend el campo de la carta se llama "game", no "carta".
  private ejecutarRobo(): void {
    if (this.deck.length === 0) {
      // No debería ocurrir: el shuffle se gestiona en programarSiguienteTurno
      this.finalizarPartida('El mazo se ha agotado sin poder rebarajar');
      return;
    }

    this.fase.set('robando');
    const cartaRobada = this.deck.pop()!;
    this.deckCount.set(this.deck.length);

    const all = [...this.jugadores()];
    const idx = this.idxActualEnArray();
    const jugador = all[idx];

    // La carta sólo es visible para el jugador que la roba (no para bots visualmente)
    all[idx] = {
      ...jugador,
      cartaPendiente: { ...cartaRobada, visible: jugador.esYo, seleccionada: false },
    };
    this.jugadores.set(all);

    // En modo online, notificar al backend del robo para que avance su estado interno
    // y acepte después el descarte/intercambio sin esperar el temporizador del servidor
    const gameId = this.gameService.gameId();
    if (gameId && jugador.esYo) this.ws.robarCarta(gameId);

    // Breve pausa de animación antes de pasar a fase de decisión.
    // El temporizador ya fue iniciado en iniciarTurno() (corre para todos los
    // jugadores), así que aquí sólo cambiamos de fase y delegamos a la lógica
    // de bot si corresponde.
    this.phaseTimeout = setTimeout(() => {
      this.fase.set('decidiendo');
      if (jugador.esBot) {
        this.botDecide();
      }
    }, 800);
  }

  // Timer del jugador humano

  private iniciarTimer(turnDeadlineAt?: number): void {
    this.pararTimer();
    const segundos = turnDeadlineAt
      ? Math.max(1, Math.round((turnDeadlineAt - Date.now()) / 1000))
      : TURNO_SEGUNDOS;
    this.timerDuracion.set(segundos);
    this.timerSegundos.set(segundos);
    this.timerInterval = setInterval(() => {
      const t = this.timerSegundos() - 1;
      this.timerSegundos.set(t);
      if (t <= 0) {
        this.pararTimer();
        // Sólo el cliente del jugador en turno dispara el descarte automático
        // (en el resto, el timer es puramente visual y el backend avanza el turno).
        if (this.esMiTurno() && this.fase() === 'decidiendo') {
          this.accionDescartar();
        }
      }
    }, 1000);
  }

  private pararTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  // Acciones del jugador humano (llamadas desde el template)

  accionRobar(): void {
    if (!this.robarDisponible()) return;
    this.pararTimerRobo();
    this.robarDisponible.set(false);
    this.ejecutarRobo();
  }

  /** Clic en el mazo central. Equivale al antiguo botón "Robar". */
  onClickMazo(): void {
    if (!this.robarDisponible()) return;
    this.accionRobar();
  }

  private pararTimerRobo(): void {
    if (this.robarInterval) {
      clearInterval(this.robarInterval);
      this.robarInterval = null;
    }
  }

  activarModoIntercambio(): void {
    if (!this.esMiTurno() || this.fase() !== 'decidiendo') return;
    this.modoIntercambio.set(true);
  }

  cancelarModoIntercambio(): void {
    this.modoIntercambio.set(false);
  }

  // TODO(backend): accionCubo → WebsocketService.solicitarCubo(gameId) → GameManager.solicitarCubo()
  //   El backend activa N+1 turnos de cuenta atrás; si el solicitante no gana,
  //   recibe penalización del 30% en ELO y cubitos (evento game:cubo-activado).
  accionCubo(): void {
    if (this.cuboActivado()) return; // solo se puede pedir una vez

    const gameId = this.gameService.gameId();
    if (gameId) {
      this.gameService.solicitarCubo();
    } else {
      // Modo local: N+1 turnos restantes (todos juegan uno más incluyendo al solicitante)
      const n = this.jugadores().length;
      this.cuboTurnosLocal = n + 1;
      this.cuboActivado.set(true);
      this.cuboInfo.set({
        solicitanteId: this.jugadorActual()?.nombre ?? '',
        turnosRestantes: n,
      });
      this.showCuboBanner();
    }
  }

  private showCuboBanner(): void {
    if (this.cuboBannerTimer) clearTimeout(this.cuboBannerTimer);
    this.cuboBannerVisible.set(true);
    this.cuboBannerTimer = setTimeout(() => {
      this.cuboBannerVisible.set(false);
      this.cuboBannerTimer = null;
    }, 3200);
  }

  // TODO(backend): accionDescartar → WebsocketService.descartarPendiente(gameId)
  //   → GameManager.descartarCartaPendiente() → evento game:descartar-pendiente (broadcast)
  accionDescartar(): void {
    if (this.fase() !== 'decidiendo') return;
    this.pararTimer();

    const all     = [...this.jugadores()];
    const idx     = this.idxActualEnArray();
    const jugador = all[idx];
    const carta   = jugador.cartaPendiente;
    if (!carta) return;

    // Flash en el slot pendiente antes de enviarlo al descarte
    this.triggerFlash([`${jugador.id}:pendiente`]);

    // Mostrar carta descartada inmediatamente (en online es la carta real via decisionRequerida$)
    const cartaDescartada = { ...carta, visible: true };
    this.discardTop.set(cartaDescartada);
    this.triggerDiscardArrival();

    // Poderes almacenables: si el jugador local descarta un 7 u 8 se almacenan
    // para activación manual posterior (poder 8: desactivar-proxima-habilidad;
    // poder 7: solicitar-carta-sobre-otra → poner-carta-sobre-otra).
    if (jugador.esYo && (carta.valor === 7 || carta.valor === 8) &&
        this.reglasActivas.includes(String(carta.valor))) {
      this.poderesAlmacenados.update(prev => [...prev, carta.valor]);
    }

    const gameId = this.gameService.gameId();
    if (!gameId) {
      this.discardPile.push(cartaDescartada);
    }

    all[idx] = { ...jugador, cartaPendiente: null };
    this.jugadores.set(all);

    if (gameId) this.ws.descartarPendiente(gameId);

    this.mostrarAnuncioAccion(jugador.nombre, 'descarta');

    // Activar poder si la carta descartada lo tiene (retiene el turno hasta que se complete)
    const poder = poderDeValor(carta.valor);
    if (poder && jugador.esYo) {
      this.activarPoderDesdeDescarte(carta.valor, poder);
      return;
    }

    this.programarSiguienteTurno();
  }

  // Activa el SkillPanel con la UI correcta según el poder de la carta descartada
  private activarPoderDesdeDescarte(valorCarta: number, poder: PoderCarta): void {
    this.fase.set('idle');

    if (
      poder === 'intercambiar-todas-cartas' ||
      poder === 'hacer-robar-carta' ||
      poder === 'saltar-turno-jugador' ||
      poder === 'ver-carta-rival'
    ) {
      // Empiezan eligiendo rival. 'ver-carta-rival' además requiere elegir
      // luego una carta concreta del rival.
      this.pendingSkill.set({ poder, valorCarta, fase: 'rival', numCartaPropia: null });
      this.poderPendiente.set(poder);
      this.esperandoObjetivo.set(true);
    } else {
      // proteger-carta, intercambiar-carta, ver-carta: primero selección de carta propia
      this.pendingSkill.set({ poder, valorCarta, fase: 'propia', numCartaPropia: null });
    }
  }

  // Llamado cuando el jugador selecciona una de sus cartas durante el SkillPanel (fase 'propia')
  seleccionarCartaPropiaParaPoder(cartaIdx: number): void {
    const skill = this.pendingSkill();
    if (!skill || skill.fase !== 'propia') return;

    const { poder, valorCarta } = skill;

    if (poder === 'proteger-carta') {
      this.gameService.usarPoderCarta('proteger-carta', { numCarta: cartaIdx });
      this.limpiarEstadoPoder();
      return;
    }

    if (poder === 'ver-carta' && valorCarta === 10) {
      this.gameService.usarPoderCarta('ver-carta', { numCarta: cartaIdx });
      this.limpiarEstadoPoder();
      return;
    }

    if (poder === 'ver-carta') {
      // J (11): carta propia seleccionada → ahora seleccionar carta específica del rival
      this.pendingSkill.update(s => s ? { ...s, fase: 'cartaRival', numCartaPropia: cartaIdx } : null);
      this.numCartaPendiente.set(cartaIdx);
      return;
    }

    if (poder === 'intercambiar-carta') {
      // Intercambio ciego (9): carta propia → ahora seleccionar rival
      this.poderNueveCartaLocal.set(cartaIdx);
      this.pendingSkill.update(s => s ? { ...s, fase: 'rival', numCartaPropia: cartaIdx } : null);
      this.numCartaPendiente.set(cartaIdx);
      this.poderPendiente.set('preparar-intercambio-carta');
      this.esperandoObjetivo.set(true);
    }
  }

  private limpiarEstadoPoder(): void {
    this.esperandoObjetivo.set(false);
    this.poderPendiente.set(null);
    this.numCartaPendiente.set(null);
    this.rivalSeleccionado.set(null);
    this.pendingSkill.set(null);
  }

  seleccionarCartaRivalParaPoder(jugadorIdx: number, cartaIdx: number): void {
    const skill = this.pendingSkill();
    if (!skill || skill.fase !== 'cartaRival') return;
    const rival = this.jugadores()[jugadorIdx];
    if (!rival || rival.esYo) return;

    // Poder 5 (ver-carta-rival): el rival ya fue elegido en el paso anterior,
    // ahora el jugador elige qué carta de su mano revelar.
    if (skill.poder === 'ver-carta-rival') {
      const rivalIdSel = this.rivalSeleccionado();
      if (rivalIdSel && rival.id !== rivalIdSel) return;
      this.gameService.usarPoderCarta('ver-carta-rival', {
        rivalId: rivalIdSel ?? rival.id,
        numCartaRival: cartaIdx,
      });
      this.limpiarEstadoPoder();
      if (!this.gameService.gameId()) this.programarSiguienteTurno();
      return;
    }

    // J (11): el flujo actual envía ver-carta con carta propia + rival, el
    // backend deja permiso 'decidir-intercambio-j' pendiente y emite la
    // revelación de ambas cartas.
    const numCartaPropia = skill.numCartaPropia;
    if (numCartaPropia === null) return;

    this.gameService.usarPoderCarta('ver-carta', {
      rivalId: rival.id,
      numCarta: numCartaPropia,
      numCartaRival: cartaIdx,
    });
    this.limpiarEstadoPoder();
    if (!this.gameService.gameId()) this.programarSiguienteTurno();
  }

  getNombrePoder(valorCarta: number): string {
    const nombres: Record<number, string> = {
      1: 'Intercambio total',  2: 'Forzar robo',
      3: 'Proteger carta',     4: 'Saltar turno',
      5: 'Espía rival',        9: 'Intercambio ciego',
      10: 'Ver carta propia',  11: 'Ver + decidir',
    };
    return nombres[valorCarta] ?? 'Poder activado';
  }

  getDescripcionPoder(valorCarta: number): string {
    const descs: Record<number, string> = {
      1:  'Intercambia todas tus cartas con las de un rival.',
      2:  'Obliga a un rival a robar una carta extra.',
      3:  'Protege una de tus cartas de intercambios rivales.',
      4:  'Salta el próximo turno de un rival.',
      5:  'Elige una carta de un rival y revélala.',
      9:  'Tú y un rival intercambiáis una carta a ciegas.',
      10: 'Mira una de tus propias cartas (5s).',
      11: 'Mira una tuya y una de un rival; decide si las intercambiáis.',
    };
    return descs[valorCarta] ?? '';
  }

  /**
   * Se llama al hacer clic en una carta de la mano durante el modo intercambio.
   * jugadorIdx: índice del jugador en el array (siempre el jugador local)
   * cartaIdx:   posición de la carta en su mano (0-3)
   *
   * TODO(backend): seleccionarCartaMano → WebsocketService.cartaPorPendiente(gameId, numCarta)
   *   → GameManager.descartarCartaPorPendiente() → evento game:descartar-pendiente (broadcast)
   */
  seleccionarCartaMano(jugadorIdx: number, cartaIdx: number): void {
    if (!this.modoIntercambio()) return;

    const all     = this.jugadores();
    const jugador = all[jugadorIdx];
    if (!jugador?.esYo || !jugador.cartaPendiente) return;

    // Flash en ambas cartas durante 1 s: la pendiente y la de la mano intercambiada
    this.triggerFlash([`${jugador.id}:pendiente`, `${jugador.id}:${cartaIdx}`], 1000);

    const gameId = this.gameService.gameId();
    if (!gameId) {
      // Modo local: la carta de la mano va al descarte boca arriba
      const cartaVieja = { ...jugador.mano[cartaIdx], visible: true };
      this.discardTop.set(cartaVieja);
      this.discardPile.push(cartaVieja);
    }
    // Modo online: discardTop lo actualiza descartePendiente$ con la carta real del backend

    // La carta pendiente ocupa su lugar en la mano (boca abajo)
    const nuevaMano = [...jugador.mano];
    nuevaMano[cartaIdx] = { ...jugador.cartaPendiente, visible: false, seleccionada: false };

    const updated = [...all];
    updated[jugadorIdx] = { ...jugador, mano: nuevaMano, cartaPendiente: null };
    this.jugadores.set(updated);

    this.modoIntercambio.set(false);
    this.pararTimer();

    if (gameId) this.ws.cartaPorPendiente(gameId, cartaIdx);

    this.mostrarAnuncioAccion(jugador.nombre, 'intercambia');
    this.programarSiguienteTurno();
  }

  // Lógica de bots
  // TODO(backend): botDecide y botIntercambiar deben eliminarse cuando el frontend se integre
  //   con el backend. ✅ El backend ya tiene sistema completo de bots:
  //   - BotsService con estrategias EasyStrategy / MediumStrategy / HardStrategy
  //   - GameGateway.scheduleBotProcessing() + flushBotActions() ejecutan turnos de bot
  //   - Los bots emiten los mismos eventos que humanos (game:bot-roba-carta, etc.)
  //   Estas funciones locales solo se usan mientras el Tablero no consuma WebSocket.

  private botDecide(): void {
    // El bot "piensa" entre 1 y 2,2 segundos
    const delay = 1000 + Math.random() * 1200;
    this.phaseTimeout = setTimeout(() => {
      if (Math.random() < 0.45) {
        // 45 %: intercambia con una carta aleatoria de su mano
        const cartaIdx = Math.floor(Math.random() * CARTAS_POR_JUGADOR);
        this.botIntercambiar(this.idxActualEnArray(), cartaIdx);
      } else {
        // 55 %: descarta la carta robada
        this.accionDescartar();
      }
    }, delay);
  }

  private botIntercambiar(jugadorIdx: number, cartaIdx: number): void {
    const all     = [...this.jugadores()];
    const jugador = all[jugadorIdx];
    if (!jugador.cartaPendiente) return;

    // La carta de la mano del bot va al descarte (boca arriba, todos la ven)
    const cartaBot = { ...jugador.mano[cartaIdx], visible: true };
    this.discardTop.set(cartaBot);
    this.discardPile.push(cartaBot);

    const nuevaMano = [...jugador.mano];
    nuevaMano[cartaIdx] = { ...jugador.cartaPendiente, visible: false, seleccionada: false };
    all[jugadorIdx] = { ...jugador, mano: nuevaMano, cartaPendiente: null };
    this.jugadores.set(all);

    this.mostrarAnuncioAccion(jugador.nombre, 'intercambia');
    this.programarSiguienteTurno();
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Avance de turno y fin de partida
  // ══════════════════════════════════════════════════════════════════════════════

  // TODO(backend): programarSiguienteTurno debe eliminarse; el backend avanza el turno
  //   automáticamente al procesar acciones. avanzarTurno() en GameManager muta el estado
  //   interno pero ❌ NO emite ningún evento. El frontend deberá inferir el cambio de turno
  //   desde otros eventos (game:descartar-pendiente, game:turno-expirado, etc.).
  private programarSiguienteTurno(): void {
    this.fase.set('idle');

    // Online: el backend avanza el turno y emitirá game:turno-iniciado
    if (this.gameService.gameId()) return;

    // Si el mazo se agotó, intentar rebarajar antes de avanzar
    if (this.deck.length === 0) {
      if (this.discardPile.length > 0) {
        // TODO(backend): ejecutarShuffle → escuchar game:mazo-rebarajado
        //   ✅ El backend emite automáticamente game:mazo-rebarajado tras cada robarCarta()
        //   cuando el mazo se agota (GameManager.intentarRebarajarDescartes()).
        this.ejecutarShuffle();
      } else {
        this.finalizarPartida('El mazo se ha agotado');
      }
      return;
    }

    this.phaseTimeout = setTimeout(() => {
      // Cubo local: descontar turno y finalizar cuando corresponda
      if (this.cuboActivado() && !this.gameService.gameId()) {
        this.cuboTurnosLocal--;
        const restantes = Math.max(0, this.cuboTurnosLocal - 1); // -1 para mostrar "0" en el último turno
        this.cuboInfo.update(info => info ? { ...info, turnosRestantes: restantes } : info);
        if (this.cuboTurnosLocal <= 0) {
          this.finalizarPartida('¡Cubo! La partida ha terminado.');
          return;
        }
      }

      const n = this.jugadores().length;
      this.turnoIdx.set((this.turnoIdx() + 1) % n);
      this.iniciarTurno();
    }, 500);
  }

  /**
   * Mecánica de reposición del mazo (Shuffle):
   * - La carta superior del descarte se mantiene visible
   * - El resto de las descartadas se mezclan y forman el nuevo mazo
   * - Se muestra un banner "¡Shuffle!" durante 2 segundos
   * - Tras el banner continúa el siguiente turno en orden
   *
   * TODO(backend): Este método debe eliminarse y reemplazarse por el handler de
   *   game:mazo-rebarajado ✅ (ya emitido por GameGateway tras intentarRebarajarDescartes).
   *   El payload del backend es: { gameId, cantidadCartasMazo, cantidadCartasDescartadas }.
   */
  private ejecutarShuffle(): void {
    this.fase.set('shuffle');

    // La carta superior del descarte se mantiene; el resto forma el nuevo mazo
    const cartaSuperior = this.discardPile[this.discardPile.length - 1] ?? null;
    const cartasParaMazo = this.discardPile.slice(0, this.discardPile.length - 1);

    // Fisher-Yates: mezclar las cartas del descarte para el nuevo mazo
    for (let i = cartasParaMazo.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cartasParaMazo[i], cartasParaMazo[j]] = [cartasParaMazo[j], cartasParaMazo[i]];
    }

    // Nuevo mazo: todas boca abajo
    this.deck = cartasParaMazo.map(c => ({ ...c, visible: false, seleccionada: false }));
    this.deckCount.set(this.deck.length);

    // El descarte queda solo con la carta superior
    this.discardPile = cartaSuperior ? [cartaSuperior] : [];
    this.discardTop.set(cartaSuperior ?? null);

    // Tras 2 segundos: avanzar al siguiente jugador
    this.phaseTimeout = setTimeout(() => {
      this.fase.set('idle');
      this.phaseTimeout = setTimeout(() => {
        const n = this.jugadores().length;
        this.turnoIdx.set((this.turnoIdx() + 1) % n);
        this.iniciarTurno();
      }, 500);
    }, 2000);
  }

  // TODO(backend): finalizarPartida → handler de game:partida-finalizada
  //   con { motivo, ranking, ganadorId, cartasJugadores, recompensas }
  private finalizarPartida(mensaje: string): void {
    this.limpiarTimers();
    this.mostrarBannerTurno.set(false);
    this.bannerLateral.set(false);
    this.fase.set('fin');
    this.mensajeFin.set(mensaje);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Helpers para el template
  // ══════════════════════════════════════════════════════════════════════════════

  // ── Sistema de flash de animación ──────────────────────────────────────

  /** Muestra el banner "¡X descarta!" o "¡X intercambia!" durante ~1.3 s. */
  private mostrarAnuncioAccion(nombre: string, accion: 'descarta' | 'intercambia'): void {
    if (this.discardAnuncioTimer) clearTimeout(this.discardAnuncioTimer);
    this.discardAnuncio.set({ nombre, accion, seq: ++this.discardAnuncioSeq });
    this.discardAnuncioTimer = setTimeout(() => {
      this.discardAnuncio.set(null);
      this.discardAnuncioTimer = null;
    }, 1300);
  }

  /** Activa la animación de aterrizaje en la pila de descartes durante 700 ms. */
  private triggerDiscardArrival(): void {
    if (this.discardArrivalTimer) clearTimeout(this.discardArrivalTimer);
    this.discardArrivalFlash.set(true);
    this.discardArrivalTimer = setTimeout(() => {
      this.discardArrivalFlash.set(false);
      this.discardArrivalTimer = null;
    }, 700);
  }

  /** Ilumina las cartas indicadas durante `duracion` ms (por defecto 500). */
  private triggerFlash(keys: string[], duracion = 500): void {
    if (keys.length === 0) return;
    this.flashKeys.update(s => {
      const next = new Set(s);
      keys.forEach(k => next.add(k));
      return next;
    });
    setTimeout(() => {
      this.flashKeys.update(s => {
        const next = new Set(s);
        keys.forEach(k => next.delete(k));
        return next;
      });
    }, duracion);
  }

  /** Ilumina las cartas 0…numCards-1 del jugador una a una, con stepMs entre cada paso. */
  private triggerSequentialFlash(jugadorId: string, numCards: number, stepMs = 220): void {
    for (let i = 0; i < numCards; i++) {
      setTimeout(() => this.triggerFlash([`${jugadorId}:${i}`], stepMs), i * stepMs);
    }
  }

  isFlashing(jugadorId: string, cartaIdx: number): boolean {
    return this.flashKeys().has(`${jugadorId}:${cartaIdx}`);
  }

  isFlashingPendiente(jugadorId: string): boolean {
    return this.flashKeys().has(`${jugadorId}:pendiente`);
  }

  getValorCarta(valor: number): string {
    return ['A','2','3','4','5','6','7','8','9','10','J','Q','K'][valor - 1] ?? '?';
  }

  getPaloSimbolo(palo: Palo): string {
    const map: Record<Palo, string> = {
      corazones: '♥', picas: '♠', rombos: '♦', treboles: '♣', joker: '🃏',
    };
    return map[palo];
  }

  esRoja(palo: Palo): boolean {
    return palo === 'corazones' || palo === 'rombos';
  }

  reversoStyle(jugador: JugadorMesa): Record<string, string> {
    if (!jugador.esYo) return {};
    const url = this.localReversoUrl();
    if (!url) return {};
    return {
      'background-image': `url(${url})`,
      'background-size': 'cover',
      'background-position': 'center',
      'background-repeat': 'no-repeat',
    };
  }

  tapeteStyle(jugador: JugadorMesa): Record<string, string> {
    if (!jugador.tapete) return {};
    const url = this.localTapeteUrl();
    if (!url) return {};
    return {
      'background-image': `url(${url})`,
      'background-size': 'cover',
      'background-position': 'center',
      'background-repeat': 'no-repeat',
    };
  }

  isSpeaking(jugador: { nombre: string; esYo: boolean; esBot: boolean }): boolean {
    if (jugador.esBot || !this.voiceChat.localStream()) return false;
    if (jugador.esYo) return this.voiceChat.localSpeaking();
    const map = this.ws.socketToUsername();
    for (const [socketId, username] of map) {
      if (username === jugador.nombre) return this.voiceChat.speakingPeers().has(socketId);
    }
    return false;
  }

  mostrarBannerSustitucion(msg: string): void {
    if (this.bannerSustitucionTimer) clearTimeout(this.bannerSustitucionTimer);
    this.bannerSustitucion.set(msg);
    this.bannerSustitucionTimer = setTimeout(() => {
      this.bannerSustitucion.set(null);
      this.bannerSustitucionTimer = null;
    }, 5000);
  }

  iniciarSalida(): void {
    if (this.soyAnfitrion() && this.fase() !== 'fin') {
      this.modalSalidaVisible.set(true);
    } else {
      const gameId = this.gameService.gameId();
      if (gameId && this.estaEnPartidaOnline() && this.fase() !== 'fin') {
        this.ws.abandonarPartida(gameId);
      }
      this.salirPartida();
    }
  }

  cerrarModalSalida(): void {
    this.modalSalidaVisible.set(false);
  }

  confirmarSalidaSinGuardar(): void {
    this.modalSalidaVisible.set(false);
    this.salirPartida();
  }

  confirmarGuardarYSalir(): void {
    this.modalSalidaVisible.set(false);
    const gameId = this.gameService.gameId();
    if (gameId) {
      this.ws.guardarYCerrarPartida(gameId);
    }
    this.salirPartida();
  }

  salirPartida(): void {
    this.limpiarTimers();
    this.limpiarFeedbackVisual();
    this.gameService.salirDePartida();
    this.voiceChat.leaveVoiceRoom();
    this.voiceChat.stopLocalStream();
    this.router.navigate(['/lobby']);
  }

  /** Persiste un SalaData mínimo para que /waiting-room pueda arrancar; el
   *  contenido real llega vía `room:update` poco después.
   */
  private persistirSalaRevancha(roomCode: string, roomName: string, soyHost: boolean): void {
    const placeholder = {
      id: roomCode,
      nombre: roomName,
      anfitrion: soyHost ? (this.auth.usuario()?.nombre ?? '') : '',
      publica: false,
      estado: 'esperando' as const,
      jugadores: [],
      dificultadBots: 'Normal' as const,
      creadaEn: Date.now(),
      numBarajas: 1 as const,
      maxJugadores: 2,
      reglasActivas: [] as string[],
    };
    this.roomService.guardarSala(placeholder);
    this.roomService.setEsAnfitrion(soyHost);
  }

  private arrancarTurnoDesdeCache(ev: EvTurnoIniciado): void {
    const idx = this.turnoOrder.indexOf(ev.userId);
    this.turnoIdx.set(idx >= 0 ? idx : 0);
    this.limpiarTimers();
    this.iniciarTurno(ev.turnDeadlineAt);
  }

  private restaurarEstadoGuardado(estado: NonNullable<EvInicioPartida['estado']>): void {
    this.deckCount.set(estado.cartasRestantes);

    if (estado.ultimaCartaDescartada) {
      const palo = this.normalizarPalo(estado.ultimaCartaDescartada.palo);
      if (palo) {
        this.discardTop.set({
          valor: estado.ultimaCartaDescartada.carta,
          palo,
          visible: true,
          seleccionada: false,
        });
      }
    }

    const miNombre = this.auth.usuario()?.nombre ?? '';
    const all = [...this.jugadores()];

    estado.jugadores.forEach(jugInfo => {
      const idx = all.findIndex(j => j.nombre === jugInfo.userId || j.id === jugInfo.userId);
      if (idx < 0) return;
      const jug = all[idx];

      if (jug.esYo && jugInfo.cartasEnMano?.length) {
        const mano: CartaMesa[] = jugInfo.cartasEnMano.map(c => ({
          valor: c.carta,
          palo: this.normalizarPalo(c.palo) ?? 'picas' as Palo,
          visible: true,
          seleccionada: false,
          protegida: c.protegida,
        }));
        all[idx] = { ...jug, mano };
      } else if (jugInfo.cartasMano != null) {
        const placeholder: CartaMesa = { valor: 0, palo: 'joker', visible: false, seleccionada: false };
        all[idx] = { ...jug, mano: Array.from({ length: jugInfo.cartasMano }, () => ({ ...placeholder })) };
      }

      if (jugInfo.cartasProtegidas?.length) {
        const mano = [...all[idx].mano];
        jugInfo.cartasProtegidas.forEach(i => {
          if (mano[i]) mano[i] = { ...mano[i], protegida: true };
        });
        all[idx] = { ...all[idx], mano };
      }
    });

    this.jugadores.set(all);

    const yoInfo = estado.jugadores.find(j => j.userId === miNombre);
    if (yoInfo?.habilidadesActivadas?.length) {
      this.poderesAlmacenados.set([...yoInfo.habilidadesActivadas]);
    }

    if (estado.cuboActivado) {
      this.cuboActivado.set(true);
      this.cuboInfo.set({
        solicitanteId: estado.cuboSolicitanteId ?? '',
        turnosRestantes: estado.cuboTurnosRestantes ?? 0,
      });
    }
  }

  private normalizarPalo(palo: string): Palo | null {
    const map: Record<string, Palo> = {
      corazones: 'corazones', hearts: 'corazones',
      picas: 'picas', spades: 'picas',
      rombos: 'rombos', diamonds: 'rombos',
      treboles: 'treboles', clubs: 'treboles',
      joker: 'joker',
    };
    return map[palo?.toLowerCase()] ?? null;
  }

  private idxActualEnArray(): number {
    const actual = this.jugadorActual();
    if (!actual) return 0;
    const idx = this.jugadores().findIndex(j => j.nombre === actual.nombre);
    return idx >= 0 ? idx : 0;
  }

  /**
   * Click en carta de la mano:
   *  - modoIntercambio → intercambia carta pendiente por esta
   *  - pendingSkill fase 'propia' → selecciona carta para el poder activo
   *  - otro caso → sin acción (poderes NUNCA se activan desde click en mano)
   */
  onClickCartaMano(jugadorIdx: number, cartaIdx: number): void {
    // Poder 9 lado rival: si me han ofrecido intercambio ciego, este clic
    // entrega esta carta al iniciador (yo no la vi tampoco).
    const ofrecido = this.intercambioCiegoRequerido();
    if (ofrecido) {
      const jugador = this.jugadores()[jugadorIdx];
      if (!jugador?.esYo) return;
      const gameId = this.gameService.gameId();
      if (!gameId) return;
      this.poderNueveCartaLocal.set(cartaIdx);
      this.ws.intercambioCartaInteractivo(gameId, cartaIdx, ofrecido.usuarioIniciador);
      this.intercambioCiegoRequerido.set(null);
      return;
    }

    // Descarte Rápido: clic en carta propia → poner-carta-sobre-otra.
    if (this.seleccionPoder7Activa()) {
      const jugador = this.jugadores()[jugadorIdx];
      if (!jugador?.esYo) return;
      const gameId = this.gameService.gameId();
      if (!gameId) return;
      this._descarteRapidoEnProceso = true;
      this.ws.ponerCartaSobreOtra(gameId, cartaIdx);
      // El server resolverá: chain (acierto) o penalización (fallo).
      // Desactivamos el modo de inmediato; si llega el chain se reactiva.
      this.seleccionPoder7Activa.set(false);
      return;
    }

    if (this.modoIntercambio()) {
      this.seleccionarCartaMano(jugadorIdx, cartaIdx);
      return;
    }
    const skill = this.pendingSkill();
    if (skill?.fase === 'propia') {
      const jugador = this.jugadores()[jugadorIdx];
      if (jugador?.esYo) this.seleccionarCartaPropiaParaPoder(cartaIdx);
    } else if (skill?.fase === 'cartaRival') {
      const jugador = this.jugadores()[jugadorIdx];
      if (jugador && !jugador.esYo) this.seleccionarCartaRivalParaPoder(jugadorIdx, cartaIdx);
    }
  }

  // ─── Poderes de carta ────────────────────────────────────────────────────

  /**
   * Click en avatar de rival estando en fase 'rival' del SkillPanel.
   */
  seleccionarObjetivoRival(rivalId: string): void {
    if (!this.esperandoObjetivo()) return;

    const poder = this.poderPendiente();
    const numCarta = this.numCartaPendiente();
    if (!poder) { this.cancelarObjetivoPoder(); return; }

    // Poder 5 (ver-carta-rival): tras elegir rival, transición a fase
    // 'cartaRival' para que el jugador elija qué carta del rival revelar.
    if (poder === 'ver-carta-rival') {
      this.pendingSkill.update(s => s ? { ...s, fase: 'cartaRival' } : null);
      this.esperandoObjetivo.set(false);
      this.rivalSeleccionado.set(rivalId);
      return;
    }

    this.gameService.usarPoderCarta(poder, {
      rivalId,
      numCarta: numCarta ?? undefined,
      numCartaRemitente: numCarta ?? undefined,
    });

    this.limpiarEstadoPoder();
    // En online el backend avanza el turno vía turnoIniciado$; en local avanzar manualmente
    if (!this.gameService.gameId()) this.programarSiguienteTurno();
  }

  cancelarObjetivoPoder(): void {
    this.limpiarEstadoPoder();
    if (!this.gameService.gameId()) this.programarSiguienteTurno();
  }

  private limpiarTimers(): void {
    this.pararTimer();
    this.pararTimerRobo();
    this.robarDisponible.set(false);
    if (this.phaseTimeout) {
      clearTimeout(this.phaseTimeout);
      this.phaseTimeout = null;
    }
    if (this.cuboBannerTimer) {
      clearTimeout(this.cuboBannerTimer);
      this.cuboBannerTimer = null;
    }
    if (this.bannerLateralTimer) {
      clearTimeout(this.bannerLateralTimer);
      this.bannerLateralTimer = null;
    }
    if (this.discardArrivalTimer) {
      clearTimeout(this.discardArrivalTimer);
      this.discardArrivalTimer = null;
    }
    if (this.saltoTurnoTimeout) {
      clearTimeout(this.saltoTurnoTimeout);
      this.saltoTurnoTimeout = null;
    }
    if (this.saltoTurnoBloqueo()) {
      this.saltoTurnoBloqueo.set(null);
      this.gameService.limpiarUltimoSaltoTurno();
    }
    if (this.cartasTodosTimeout) {
      clearTimeout(this.cartasTodosTimeout);
      this.cartasTodosTimeout = null;
    }
    if (this.bannerSustitucionTimer) {
      clearTimeout(this.bannerSustitucionTimer);
      this.bannerSustitucionTimer = null;
    }
  }
}
