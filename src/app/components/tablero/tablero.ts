import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth';
import { RoomService, JugadorSala } from '../../services/room';

// ── Tipos internos del tablero ────────────────────────────────────────────────

type Palo = 'corazones' | 'picas' | 'rombos' | 'treboles';
type Posicion = 'south' | 'north' | 'east' | 'west' | 'ne' | 'nw' | 'se' | 'sw';
type FaseTurno = 'banner' | 'robando' | 'decidiendo' | 'idle' | 'fin';

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
  imports: [],
  templateUrl: './tablero.html',
  styleUrl: './tablero.scss',
})
export class Tablero implements OnInit, OnDestroy {

  // ── Estado reactivo ─────────────────────────────────────────────────────────
  jugadores        = signal<JugadorMesa[]>([]);
  turnoIdx         = signal(0);
  fase             = signal<FaseTurno>('idle');
  timerSegundos    = signal(TURNO_SEGUNDOS);
  modoIntercambio  = signal(false);
  discardTop       = signal<CartaMesa | null>(null);
  deckCount        = signal(0);
  mensajeFin       = signal<string | null>(null);

  // ── Computados ──────────────────────────────────────────────────────────────
  jugadorActual   = computed(() => this.jugadores()[this.turnoIdx()] ?? null);
  esMiTurno       = computed(() => !!this.jugadorActual()?.esYo);
  timerPorcentaje = computed(() => (this.timerSegundos() / TURNO_SEGUNDOS) * 100);
  timerUrgente    = computed(() => this.timerSegundos() <= 5 && this.esMiTurno() && this.fase() === 'decidiendo');

  // ── Internos ────────────────────────────────────────────────────────────────
  private deck: CartaMesa[] = [];
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private phaseTimeout:  ReturnType<typeof setTimeout>  | null = null;

  constructor(
    private router:      Router,
    private auth:        AuthService,
    private roomService: RoomService,
  ) {}

  ngOnInit(): void {
    const sala = this.roomService.obtenerSala();
    if (!sala || sala.jugadores.length < 2) {
      this.router.navigate(['/lobby']);
      return;
    }
    this.inicializarJuego(sala.jugadores);
  }

  ngOnDestroy(): void {
    this.limpiarTimers();
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Inicialización
  // ══════════════════════════════════════════════════════════════════════════════

  private inicializarJuego(lista: JugadorSala[]): void {
    const miNombre = this.auth.usuario()?.nombre ?? '';

    // El jugador humano siempre en posición sur (índice 0)
    const yo    = lista.find(j => j.nombre === miNombre && !j.esBot);
    const resto = lista.filter(j => j !== yo);
    const ordenados = yo ? [yo, ...resto] : lista;

    const n = Math.min(ordenados.length, 8);
    const posiciones = POSICIONES[n] ?? POSICIONES[4];

    this.deck = this.crearBarajaMezclada();

    const jugadoresMesa: JugadorMesa[] = ordenados.slice(0, n).map((j, i) => ({
      id:             j.id,
      nombre:         j.nombre,
      avatar:         j.avatar,
      esYo:           j.nombre === miNombre && !j.esBot,
      esBot:          j.esBot,
      posicion:       posiciones[i],
      mano:           Array.from({ length: CARTAS_POR_JUGADOR }, () =>
                        ({ ...this.deck.pop()!, visible: false, seleccionada: false })
                      ),
      cartaPendiente: null,
    }));

    this.deckCount.set(this.deck.length);
    this.jugadores.set(jugadoresMesa);

    // Pequeño retraso para que el DOM se renderice antes del primer turno
    this.phaseTimeout = setTimeout(() => this.iniciarTurno(), 600);
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

  // ══════════════════════════════════════════════════════════════════════════════
  // Ciclo de turno
  // ══════════════════════════════════════════════════════════════════════════════

  private iniciarTurno(): void {
    this.fase.set('banner');
    this.modoIntercambio.set(false);
    // Banner visible 2 segundos → robo automático
    this.phaseTimeout = setTimeout(() => this.ejecutarRobo(), 2000);
  }

  private ejecutarRobo(): void {
    if (this.deck.length === 0) {
      this.finalizarPartida('El mazo se ha agotado');
      return;
    }

    this.fase.set('robando');
    const cartaRobada = this.deck.pop()!;
    this.deckCount.set(this.deck.length);

    const all = [...this.jugadores()];
    const idx = this.turnoIdx();
    const jugador = all[idx];

    // La carta sólo es visible para el jugador que la roba (no para bots visualmente)
    all[idx] = {
      ...jugador,
      cartaPendiente: { ...cartaRobada, visible: jugador.esYo, seleccionada: false },
    };
    this.jugadores.set(all);

    // Breve pausa de animación antes de pasar a fase de decisión
    this.phaseTimeout = setTimeout(() => {
      this.fase.set('decidiendo');
      if (jugador.esBot) {
        this.botDecide();
      } else {
        this.iniciarTimer();
      }
    }, 800);
  }

  // ── Timer del jugador humano ─────────────────────────────────────────────────

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

  // ══════════════════════════════════════════════════════════════════════════════
  // Acciones del jugador humano (llamadas desde el template)
  // ══════════════════════════════════════════════════════════════════════════════

  activarModoIntercambio(): void {
    if (!this.esMiTurno() || this.fase() !== 'decidiendo') return;
    this.modoIntercambio.set(true);
  }

  accionDescartar(): void {
    if (this.fase() !== 'decidiendo') return;
    this.pararTimer();

    const all     = [...this.jugadores()];
    const idx     = this.turnoIdx();
    const jugador = all[idx];
    const carta   = jugador.cartaPendiente;
    if (!carta) return;

    // La carta robada va a la pila de descartes boca arriba (visible para todos)
    this.discardTop.set({ ...carta, visible: true });
    all[idx] = { ...jugador, cartaPendiente: null };
    this.jugadores.set(all);

    this.programarSiguienteTurno();
  }

  /**
   * Se llama al hacer clic en una carta de la mano durante el modo intercambio.
   * jugadorIdx: índice del jugador en el array (siempre el jugador local)
   * cartaIdx:   posición de la carta en su mano (0-3)
   */
  seleccionarCartaMano(jugadorIdx: number, cartaIdx: number): void {
    if (!this.modoIntercambio()) return;

    const all     = this.jugadores();
    const jugador = all[jugadorIdx];
    if (!jugador?.esYo || !jugador.cartaPendiente) return;

    // La carta de la mano va al descarte boca arriba
    const cartaVieja = jugador.mano[cartaIdx];
    this.discardTop.set({ ...cartaVieja, visible: true });

    // La carta pendiente ocupa su lugar en la mano (boca abajo)
    const nuevaMano = [...jugador.mano];
    nuevaMano[cartaIdx] = { ...jugador.cartaPendiente, visible: false, seleccionada: false };

    const updated = [...all];
    updated[jugadorIdx] = { ...jugador, mano: nuevaMano, cartaPendiente: null };
    this.jugadores.set(updated);

    this.modoIntercambio.set(false);
    this.pararTimer();
    this.programarSiguienteTurno();
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Lógica de bots
  // ══════════════════════════════════════════════════════════════════════════════

  private botDecide(): void {
    // El bot "piensa" entre 1 y 2,2 segundos
    const delay = 1000 + Math.random() * 1200;
    this.phaseTimeout = setTimeout(() => {
      if (Math.random() < 0.45) {
        // 45 %: intercambia con una carta aleatoria de su mano
        const cartaIdx = Math.floor(Math.random() * CARTAS_POR_JUGADOR);
        this.botIntercambiar(this.turnoIdx(), cartaIdx);
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
    this.discardTop.set({ ...jugador.mano[cartaIdx], visible: true });

    const nuevaMano = [...jugador.mano];
    nuevaMano[cartaIdx] = { ...jugador.cartaPendiente, visible: false, seleccionada: false };
    all[jugadorIdx] = { ...jugador, mano: nuevaMano, cartaPendiente: null };
    this.jugadores.set(all);

    this.programarSiguienteTurno();
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Avance de turno y fin de partida
  // ══════════════════════════════════════════════════════════════════════════════

  private programarSiguienteTurno(): void {
    this.fase.set('idle');
    this.phaseTimeout = setTimeout(() => {
      const n = this.jugadores().length;
      this.turnoIdx.set((this.turnoIdx() + 1) % n);
      this.iniciarTurno();
    }, 500);
  }

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

  salirPartida(): void {
    this.limpiarTimers();
    this.router.navigate(['/lobby']);
  }

  private limpiarTimers(): void {
    this.pararTimer();
    if (this.phaseTimeout) {
      clearTimeout(this.phaseTimeout);
      this.phaseTimeout = null;
    }
  }
}
