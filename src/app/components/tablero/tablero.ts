import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { NgStyle } from '@angular/common';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth';
import { RoomService, JugadorSala } from '../../services/room';
import { GameService } from '../../services/game';
import { WebsocketService, EvTurnoIniciado, EvDescartarPendiente, EvDecisionRequerida, EvCartaRobada } from '../../services/websocket';
import { environment } from '../../environment';

// Tipos internos del tablero

type Palo = 'corazones' | 'picas' | 'rombos' | 'treboles';
type Posicion = 'south' | 'north' | 'east' | 'west' | 'ne' | 'nw' | 'se' | 'sw';
type FaseTurno = 'banner' | 'robando' | 'decidiendo' | 'idle' | 'shuffle' | 'fin';

interface CartaMesa {
  valor: number;  // 1-13
  palo: Palo;
  visible: boolean;
  seleccionada: boolean;
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
  modoIntercambio  = signal(false);
  discardTop       = signal<CartaMesa | null>(null);
  deckCount        = signal(0);
  mensajeFin       = signal<string | null>(null);
  cuboActivado      = signal(false);
  cuboInfo          = signal<{ solicitanteId: string; turnosRestantes: number } | null>(null);
  cuboBannerVisible = signal(false);
  robarDisponible   = signal(false);
  robarSegundos    = signal(3);

  // Computados
  jugadorActual = computed(() => {
    const order = this.turnoOrder;
    if (order.length > 0) {
      const userId = order[this.turnoIdx() % order.length];
      return this.jugadores().find(j => j.nombre === userId) ?? null;
    }
    return this.jugadores()[this.turnoIdx()] ?? null;
  });
  esMiTurno       = computed(() => !!this.jugadorActual()?.esYo);
  timerPorcentaje = computed(() => (this.timerSegundos() / TURNO_SEGUNDOS) * 100);
  timerUrgente    = computed(() => this.timerSegundos() <= 5 && this.esMiTurno() && this.fase() === 'decidiendo');

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
  private cuboTurnosLocal = 0; // contador de turnos restantes en modo local

  // URLs reales de las skins equipadas (obtenidas del backend)
  private localReversoUrl = signal<string | null>(null);
  private localTapeteUrl  = signal<string | null>(null);
  private subs: Subscription[] = [];

  constructor(
    private router:      Router,
    private auth:        AuthService,
    private roomService: RoomService,
    private http:        HttpClient,
    private gameService: GameService,
    private ws:          WebsocketService,
  ) {}

  ngOnInit(): void {
    const sala = this.roomService.obtenerSala();
    if (!sala || sala.jugadores.length < 2) {
      this.router.navigate(['/lobby']);
      return;
    }
    this.inicializarJuego(sala.jugadores);
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
        this.limpiarTimers();
        this.iniciarTurno();
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
        this.finalizarPartida(motivos[ev.motivo] ?? 'La partida ha terminado.');
      }),
      this.ws.roomClosed$.subscribe(() => {
        this.finalizarPartida('La partida ha terminado porque un jugador abandonó.');
      }),
      this.ws.descartePendiente$.subscribe((ev: EvDescartarPendiente) => {
        const palo = this.normalizarPalo(ev.carta.palo);
        if (palo) {
          this.discardTop.set({ valor: ev.carta.carta, palo, visible: true, seleccionada: false });
        }
      }),
      // Sincronizar la carta robada real del backend con cartaPendiente del jugador local
      this.ws.decisionRequerida$.subscribe((ev: EvDecisionRequerida) => {
        if (!ev.game) return;
        const palo = this.normalizarPalo(ev.game.palo);
        if (!palo) return;
        const all = [...this.jugadores()];
        const idx = this.idxActualEnArray();
        if (all[idx]?.esYo) {
          all[idx] = { ...all[idx], cartaPendiente: { valor: ev.game.carta, palo, visible: true, seleccionada: false } };
          this.jugadores.set(all);
        }
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
    );
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
    this.limpiarTimers();
    this.subs.forEach(s => s.unsubscribe());
    this.gameService.salirDePartida();
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


  private iniciarTurno(): void {
    this.fase.set('banner');
    this.modoIntercambio.set(false);

    if (this.esMiTurno()) {
      // Jugador local: mostrar botón Robar durante 3 segundos
      this.robarDisponible.set(true);
      this.robarSegundos.set(3);
      this.iniciarTimerRobo();
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

    // Breve pausa de animación antes de pasar a fase de decisión
    this.phaseTimeout = setTimeout(() => {
      this.fase.set('decidiendo');
      if (jugador.esBot) {
        this.botDecide();
      } else if (jugador.esYo) {
        this.iniciarTimer();
      }
    }, 800);
  }

  // Timer del jugador humano

  private iniciarTimer(): void {
    this.timerSegundos.set(TURNO_SEGUNDOS);
    this.timerInterval = setInterval(() => {
      const t = this.timerSegundos() - 1;
      this.timerSegundos.set(t);
      if (t <= 0) {
        this.pararTimer();
        this.accionDescartar(); // timeout → descarte automático
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

  private iniciarTimerRobo(): void {
    this.robarInterval = setInterval(() => {
      const t = this.robarSegundos() - 1;
      this.robarSegundos.set(t);
      if (t <= 0) {
        this.pararTimerRobo();
        this.robarDisponible.set(false);
        this.ejecutarRobo();
      }
    }, 1000);
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

    // Mostrar carta descartada inmediatamente (en online es la carta real via decisionRequerida$)
    const cartaDescartada = { ...carta, visible: true };
    this.discardTop.set(cartaDescartada);

    const gameId = this.gameService.gameId();
    if (!gameId) {
      this.discardPile.push(cartaDescartada);
    }

    all[idx] = { ...jugador, cartaPendiente: null };
    this.jugadores.set(all);

    if (gameId) this.ws.descartarPendiente(gameId);

    this.programarSiguienteTurno();
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
    this.fase.set('fin');
    this.mensajeFin.set(mensaje);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Helpers para el template
  // ══════════════════════════════════════════════════════════════════════════════

  getValorCarta(valor: number): string {
    return ['A','2','3','4','5','6','7','8','9','10','J','Q','K'][valor - 1] ?? '?';
  }

  getPaloSimbolo(palo: Palo): string {
    const map: Record<Palo, string> = {
      corazones: '♥', picas: '♠', rombos: '♦', treboles: '♣',
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

  salirPartida(): void {
    this.limpiarTimers();
    this.gameService.salirDePartida();
    this.router.navigate(['/lobby']);
  }

  private normalizarPalo(palo: string): Palo | null {
    const map: Record<string, Palo> = {
      corazones: 'corazones', hearts: 'corazones',
      picas: 'picas', spades: 'picas',
      rombos: 'rombos', diamonds: 'rombos',
      treboles: 'treboles', clubs: 'treboles',
    };
    return map[palo?.toLowerCase()] ?? null;
  }

  private idxActualEnArray(): number {
    const actual = this.jugadorActual();
    if (!actual) return 0;
    const idx = this.jugadores().findIndex(j => j.nombre === actual.nombre);
    return idx >= 0 ? idx : 0;
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
  }
}
