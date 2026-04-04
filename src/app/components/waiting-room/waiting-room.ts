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
  'A':  'Permite espiar una de tus propias cartas.',
  '2':  'Permite espiar una carta de otro jugador.',
  '3':  'Permite intercambiar una carta tuya con la de otro jugador sin verlas.',
  '4':  'Poder por definir.',
  '5':  'Poder por definir.',
  '6':  'Poder por definir.',
  '7':  'Permite ver una carta de otro jugador y decidir si intercambiarla con una tuya.',
  '8':  'Poder por definir.',
  '9':  'Poder por definir.',
  '10': 'Permite ver una carta de otro jugador y decidir si intercambiarla con una tuya.',
  'J':  'Poder por definir.',
  'Q':  'Poder por definir.',
  'K':  'Vale 0 puntos al final de la partida.',
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
    this.showStartPopup.set(false);
    this.lanzarPartida();
  }

  iniciarConBots(): void {
    const sala = this.sala();
    if (!sala) return;

    // Rellenar huecos con bots
    const nombresUsados = sala.jugadores.map(j => j.nombre);
    while (sala.jugadores.length < MAX_JUGADORES) {
      const bot = this.roomService.generarBot(nombresUsados, sala.dificultadBots);
      sala.jugadores.push(bot);
      nombresUsados.push(bot.nombre);
    }
    this.actualizarSala(sala);

    this.showStartPopup.set(false);
    this.lanzarPartida();
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
}
