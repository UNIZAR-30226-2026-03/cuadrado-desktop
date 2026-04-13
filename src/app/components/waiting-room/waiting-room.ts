import { Component, OnInit, signal, computed, effect } from '@angular/core';
import { Router } from '@angular/router';
import {
  trigger, transition, style, animate, query, stagger
} from '@angular/animations';
import { AuthService } from '../../services/auth';
import { RoomService, SalaData, JugadorSala, MAX_JUGADORES } from '../../services/room';

interface PowerCard {
  card: string;
  description: string;
}

const POWER_DESCRIPTIONS: Record<string, string> = {
  'A':  'Intercambia todas tus cartas por todas las cartas de otro jugador.',
  '2':  'Elige a un jugador para que robe una carta extra y la añada a sus cartas.',
  '3':  'Protege una de tus cartas: no puede ser intercambiada por otro jugador.',
  '4':  'Salta el siguiente turno de un jugador a tu elección.',
  '5':  'Mira una carta de cada jugador.',
  '6':  'Roba otra carta del mazo.',
  '7':  'Revela qué jugador tiene menos puntos en ese momento. (Poder almacenable)',
  '8':  'La siguiente habilidad que se active no tendrá efecto. (Poder almacenable)',
  '9':  'Ofrece un intercambio a otro jugador: ambos elegís una carta a ciegas.',
  '10': 'Ve una de tus propias cartas.',
  'J':  'Ve una de tus cartas y una de otro jugador; decide si las intercambias (con ese mismo jugador).',
  'Q':  'Sin poder especial. (12 puntos)',
  'K':  'K roja = 0 puntos · K negra = 20 puntos.',
};

@Component({
  selector: 'app-waiting-room',
  standalone: true,
  imports: [],
  templateUrl: './waiting-room.html',
  styleUrl: './waiting-room.scss',
  animations: [
    trigger('slotStagger', [
      transition(':enter', [
        query('.player-slot', [
          style({ opacity: 0, transform: 'scale(0.9)' }),
          stagger(70, [
            animate('400ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              style({ opacity: 1, transform: 'none' })),
          ]),
        ], { optional: true }),
      ]),
    ]),
    trigger('fadeIn', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(12px)' }),
        animate('350ms ease-out', style({ opacity: 1, transform: 'none' })),
      ]),
    ]),
  ],
})
export class WaitingRoom implements OnInit {
  sala = signal<SalaData | null>(null);
  soyAnfitrion = signal(false);
  miNombre = signal('');
  iniciandoPartida = signal(false);
  codigoCopiado = signal(false);
  botsAAgregar = signal(1);

  // Popups
  showStartPopup = signal(false);
  showPowersPopup = signal(false);
  selectedPowerCard = signal<PowerCard | null>(null);

  slotsVacios = computed(() => {
    const s = this.sala();
    if (!s) return [];
    const vacios = MAX_JUGADORES - s.jugadores.length;
    return Array.from({ length: vacios }, (_, i) => i);
  });

  maxBotsAgregables = computed(() => {
    const s = this.sala();
    if (!s) return 0;
    return Math.max(0, MAX_JUGADORES - s.jugadores.length);
  });

  puedeIniciar = computed(() => {
    const s = this.sala();
    if (!s || s.jugadores.length < 1) return false;
    // El host debe estar listo para poder iniciar
    const host = s.jugadores.find(j => j.esAnfitrion);
    return host?.listo || false;
  });

  puedeJugarConPresentes = computed(() => {
    const s = this.sala();
    return s ? s.jugadores.length >= 2 : false;
  });

  todosListos = computed(() => {
    const s = this.sala();
    if (!s || s.jugadores.length < 1) return false;
    return s.jugadores.filter(j => !j.esBot).every(j => j.listo);
  });

  estoyListo = computed(() => {
    const s = this.sala();
    if (!s) return false;
    const yo = s.jugadores.find(j => j.nombre === this.miNombre() && !j.esBot);
    return yo?.listo || false;
  });

  activePowers = computed((): PowerCard[] => {
    const s = this.sala();
    if (!s || !s.reglasActivas) return [];
    return s.reglasActivas.map(card => ({
      card,
      description: POWER_DESCRIPTIONS[card] || 'Poder por definir.',
    }));
  });

  constructor(
    private router: Router,
    private auth: AuthService,
    private roomService: RoomService
  ) {
    // Auto-abrir popup de inicio cuando todos los humanos esten listos
    effect(() => {
      if (this.todosListos() && this.soyAnfitrion() && !this.iniciandoPartida()) {
        this.showStartPopup.set(true);
      }
    });

    // Mantener el contador de bots dentro del rango disponible.
    effect(() => {
      const max = this.maxBotsAgregables();
      const actual = this.botsAAgregar();
      const normalizado = this.normalizarCantidadBots(actual, max);
      if (actual !== normalizado) {
        this.botsAAgregar.set(normalizado);
      }
    });
  }

  ngOnInit(): void {
    const sala = this.roomService.obtenerSala();
    if (!sala) {
      this.router.navigate(['/lobby']);
      return;
    }
    this.sala.set(sala);
    this.soyAnfitrion.set(this.roomService.esAnfitrion());
    this.miNombre.set(this.auth.usuario()?.nombre || 'Jugador');
  }

  // Copiar codigo
  copiarCodigo(): void {
    const codigo = this.sala()?.id;
    if (!codigo) return;
    navigator.clipboard.writeText(codigo).then(() => {
      this.codigoCopiado.set(true);
      setTimeout(() => this.codigoCopiado.set(false), 2000);
    });
  }

  // Controles del anfitrion
  expulsarJugador(jugador: JugadorSala): void {
    const sala = this.sala();
    if (!sala || !this.soyAnfitrion()) return;
    if (jugador.esAnfitrion) return;

    sala.jugadores = sala.jugadores.filter(j => j.id !== jugador.id);
    if (sala.estado === 'llena') {
      sala.estado = 'esperando';
    }
    this.actualizarSala(sala);
  }

  // Popup de inicio
  abrirPopupInicio(): void {
    if (!this.puedeIniciar() || this.iniciandoPartida()) return;
    this.showStartPopup.set(true);
  }

  cerrarPopupInicio(): void {
    this.showStartPopup.set(false);
  }

  iniciarConPresentes(): void {
    if (!this.puedeJugarConPresentes()) return;
    this.showStartPopup.set(false);
    this.lanzarPartida();
  }

  agregarBots(): void {
    const sala = this.sala();
    if (!sala) return;

    const maxDisponibles = Math.max(0, MAX_JUGADORES - sala.jugadores.length);
    const cantidad = this.normalizarCantidadBots(this.botsAAgregar(), maxDisponibles);
    if (cantidad <= 0) return;

    const nombresUsados = sala.jugadores.map(j => j.nombre);
    for (let i = 0; i < cantidad && sala.jugadores.length < MAX_JUGADORES; i++) {
      const bot = this.roomService.generarBot(nombresUsados, sala.dificultadBots);
      sala.jugadores.push(bot);
      nombresUsados.push(bot.nombre);
    }

    this.actualizarSala(sala);
  }

  onBotsAAgregarInput(event: Event): void {
    const valor = Number((event.target as HTMLInputElement).value);
    this.botsAAgregar.set(this.normalizarCantidadBots(valor, this.maxBotsAgregables()));
  }

  private lanzarPartida(): void {
    this.iniciandoPartida.set(true);
    setTimeout(() => {
      const sala = this.sala();
      if (sala) {
        sala.estado = 'en_partida';
        this.actualizarSala(sala);
      }
      this.router.navigate(['/tablero']);
    }, 2500);
  }

  cancelarSala(): void {
    this.roomService.eliminarSala();
    this.router.navigate(['/lobby']);
  }

  // Controles del jugador
  toggleListo(): void {
    const sala = this.sala();
    if (!sala) return;
    const yo = sala.jugadores.find(j => j.nombre === this.miNombre() && !j.esBot);
    if (!yo) return;
    yo.listo = !yo.listo;
    this.actualizarSala(sala);
  }

  abandonarSala(): void {
    const sala = this.sala();
    if (sala) {
      sala.jugadores = sala.jugadores.filter(j => j.nombre !== this.miNombre() || j.esBot);
      if (sala.estado === 'llena') {
        sala.estado = 'esperando';
      }
      if (sala.publica) {
        this.roomService.guardarSala(sala);
      }
    }
    localStorage.removeItem('cubo_sala_actual');
    localStorage.removeItem('cubo_es_anfitrion');
    this.router.navigate(['/lobby']);
  }

  // Popup de poderes
  abrirPopupPoderes(): void {
    this.selectedPowerCard.set(null);
    this.showPowersPopup.set(true);
  }

  cerrarPopupPoderes(): void {
    this.showPowersPopup.set(false);
    this.selectedPowerCard.set(null);
  }

  selectPowerCard(power: PowerCard): void {
    this.selectedPowerCard.set(power);
  }

  // Helpers
  private actualizarSala(sala: SalaData): void {
    this.roomService.guardarSala(sala);
    this.sala.set({ ...sala });
  }

  private normalizarCantidadBots(valor: number, max: number): number {
    if (max <= 0) return 0;
    const entero = Number.isFinite(valor) ? Math.trunc(valor) : 1;
    return Math.min(Math.max(entero, 1), max);
  }
}
