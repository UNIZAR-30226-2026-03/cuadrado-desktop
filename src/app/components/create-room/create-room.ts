import { Component, OnInit, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  trigger, transition, style, animate
} from '@angular/animations';
import { AuthService } from '../../services/auth';
import { RoomService, SalaData } from '../../services/room';
import { WebsocketService } from '../../services/websocket';
import { TopBar } from '../shared/top-bar/top-bar';
import { SettingsPopupComponent } from '../shared/settings-popup/settings-popup';

interface CardPower {
  card: string;
  image: string;
  description: string;
  enabled: boolean;
}

const PODERES_VALIDOS = new Set(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J']);

@Component({
  selector: 'app-create-room',
  standalone: true,
  imports: [FormsModule, TopBar, SettingsPopupComponent],
  templateUrl: './create-room.html',
  styleUrl: './create-room.scss',
  animations: [
    trigger('panelEnter', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(30px) scale(0.96)' }),
        animate('500ms 100ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          style({ opacity: 1, transform: 'none' })),
      ]),
    ]),
  ],
})
export class CreateRoom implements OnInit {
  esPublica = signal(true);
  fillWithBots = signal(false);
  dificultadBots = signal<'facil' | 'media' | 'dificil'>('media');
  numBarajas = signal<1 | 2>(1);
  maxJugadores = signal(4);
  turnTime = signal(30);
  nombreSala = signal('');
  creando = signal(false);

  // Warning modal: sala ya creada en backend, pendiente de confirmar
  warningVisible = signal(false);
  warningMessage = signal<string | null>(null);
  private pendingRoomCode: string | null = null;
  private pendingSalaData: SalaData | null = null;

  readonly turnTimeOptions = [15, 20, 30, 45, 60, 90] as const;

  readonly dificultadOptions: { value: 'facil' | 'media' | 'dificil'; label: string }[] = [
    { value: 'facil',   label: 'Fácil' },
    { value: 'media',   label: 'Normal' },
    { value: 'dificil', label: 'Difícil' },
  ];

  cardPowers: CardPower[] = [
    { card: 'A',  image: '🂡', description: 'Intercambia todas tus cartas por todas las cartas de otro jugador.', enabled: false },
    { card: '2',  image: '🂢', description: 'Elige a un jugador para que robe una carta extra y la añada a sus cartas.', enabled: false },
    { card: '3',  image: '🂣', description: 'Protege una de tus cartas: no puede ser intercambiada por otro jugador.', enabled: false },
    { card: '4',  image: '🂤', description: 'Salta el siguiente turno de un jugador a tu elección.', enabled: false },
    { card: '5',  image: '🂥', description: 'Mira una carta de cada jugador.', enabled: false },
    { card: '6',  image: '🂦', description: 'Roba otra carta del mazo.', enabled: false },
    { card: '7',  image: '🂧', description: 'Revela qué jugador tiene menos puntos en ese momento. (Poder almacenable)', enabled: false },
    { card: '8',  image: '🂨', description: 'La siguiente habilidad que se active no tendrá efecto. (Poder almacenable)', enabled: false },
    { card: '9',  image: '🂩', description: 'Ofrece un intercambio a otro jugador: ambos elegís una carta a ciegas.', enabled: false },
    { card: '10', image: '🂪', description: 'Ve una de tus propias cartas.', enabled: true },
    { card: 'J',  image: '🂫', description: 'Ve una de tus cartas y una de otro jugador; decide si las intercambias (con ese mismo jugador).', enabled: true },
  ];

  get todosSeleccionados(): boolean {
    return this.cardPowers.length > 0 && this.cardPowers.every(p => p.enabled);
  }

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private auth: AuthService,
    private roomService: RoomService,
    private ws: WebsocketService
  ) {}

  ngOnInit() {
    const barajasParam = this.route.snapshot.queryParamMap.get('barajas');
    if (barajasParam === '2') {
      this.numBarajas.set(2);
    } else {
      this.numBarajas.set(1);
    }
    const usuario = this.auth.usuario();
    this.nombreSala.set(`Sala de ${usuario?.nombre || 'Jugador'}`);
  }

  togglePower(index: number): void {
    const power = this.cardPowers[index];
    if (!PODERES_VALIDOS.has(power.card)) return;
    power.enabled = !power.enabled;
  }

  toggleSeleccionarTodos(): void {
    const activar = !this.todosSeleccionados;
    this.cardPowers.forEach(p => {
      if (PODERES_VALIDOS.has(p.card)) p.enabled = activar;
    });
  }

  async crearSala(): Promise<void> {
    if (this.creando()) return;
    const usuario = this.auth.usuario();
    const token = this.auth.getToken();
    const nombreSala = this.nombreSala().trim() || `Sala de ${usuario?.nombre || 'Jugador'}`;

    const anfitrion = {
      id: `user_${usuario?.nombre || 'anon'}`,
      nombre: usuario?.nombre || 'Anfitrión',
      esBot: false,
      esAnfitrion: true,
      avatar: '👑'
    };

    const reglasActivas = this.cardPowers
      .filter(p => p.enabled && PODERES_VALIDOS.has(p.card))
      .map(p => p.card);

    let codigo = this.roomService.generarCodigo();
    let warning: string | undefined;

    this.creando.set(true);
    if (token) {
      try {
        await this.ws.conectarYEsperar(token);
        await this.ws.leaveRoomAck();
        const resp = await this.ws.createRoom(nombreSala, {
          maxPlayers: this.maxJugadores(),
          turnTimeSeconds: this.turnTime(),
          isPrivate: !this.esPublica(),
          fillWithBots: this.fillWithBots(),
          dificultadBots: this.fillWithBots() ? this.dificultadBots() : undefined,
          enabledPowers: reglasActivas,
          deckCount: this.numBarajas(),
        });
        if (resp.success && resp.roomCode) {
          codigo = resp.roomCode;
          warning = resp.warning;
        }
      } catch {
        // Backend no disponible: continuar con código local
      }
    }
    this.creando.set(false);

    const mapaDisplay: Record<'facil' | 'media' | 'dificil', 'Fácil' | 'Normal' | 'Difícil'> = {
      facil: 'Fácil',
      media: 'Normal',
      dificil: 'Difícil',
    };

    const sala: SalaData = {
      id: codigo,
      nombre: nombreSala,
      anfitrion: anfitrion.nombre,
      publica: this.esPublica(),
      estado: 'esperando',
      jugadores: [anfitrion],
      dificultadBots: mapaDisplay[this.dificultadBots()],
      creadaEn: Date.now(),
      numBarajas: this.numBarajas(),
      maxJugadores: this.maxJugadores(),
      reglasActivas,
      fillWithBots: this.fillWithBots(),
    };

    if (warning) {
      // Sala ya creada en backend — guardar pendientes y pedir confirmación
      this.pendingRoomCode = codigo;
      this.pendingSalaData = sala;
      this.warningMessage.set(warning);
      this.warningVisible.set(true);
    } else {
      this.confirmarCreacion(sala);
    }
  }

  cancelarWarning(): void {
    this.warningVisible.set(false);
    this.warningMessage.set(null);
    // La sala ya fue creada en el backend: salir de ella para limpiar
    if (this.ws.estaConectado()) {
      this.ws.leaveRoom();
    }
    this.pendingRoomCode = null;
    this.pendingSalaData = null;
  }

  continuarConWarning(): void {
    this.warningVisible.set(false);
    this.warningMessage.set(null);
    if (this.pendingSalaData) {
      this.confirmarCreacion(this.pendingSalaData);
    }
    this.pendingRoomCode = null;
    this.pendingSalaData = null;
  }

  private confirmarCreacion(sala: SalaData): void {
    this.roomService.guardarSala(sala);
    this.roomService.setEsAnfitrion(true);
    this.router.navigate(['/waiting-room']);
  }

  // Placeholder: el popup de ajustes se implementa en un paso posterior.
  showSettingsPopup = false;
  openSettingsFromTopBar(): void { this.showSettingsPopup = true; }

  volver(): void {
    this.router.navigate(['/lobby']);
  }

  irATutorial(): void {
    this.router.navigate(['/tutorial'], { queryParams: { from: 'create-room', barajas: this.numBarajas() } });
  }
}
