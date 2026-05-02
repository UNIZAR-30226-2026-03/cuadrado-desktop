import { Component, OnInit, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
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
  imports: [TopBar, SettingsPopupComponent],
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
  numBarajas = signal<1 | 2>(1);
  maxJugadores = signal(4);
  turnTime = signal(30);

  readonly turnTimeOptions = [15, 20, 30, 45, 60, 90] as const;

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
    const usuario = this.auth.usuario();
    const token = this.auth.getToken();
    const nombreSala = `Sala de ${usuario?.nombre || 'Jugador'}`;

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

    // Si hay token, crear la sala también en el backend para sync multijugador
    if (token) {
      try {
        await this.ws.conectarYEsperar(token);
        await this.ws.leaveRoomAck();
        const resp = await this.ws.createRoom(nombreSala, {
          maxPlayers: this.maxJugadores(),
          turnTimeSeconds: this.turnTime(),
          isPrivate: !this.esPublica(),
          fillWithBots: false,
          enabledPowers: reglasActivas,
          deckCount: this.numBarajas(),
        });
        if (resp.success && resp.roomCode) {
          codigo = resp.roomCode;
        }
      } catch {
        // Si el backend no está disponible, continuar con código local
      }
    }

    const sala: SalaData = {
      id: codigo,
      nombre: nombreSala,
      anfitrion: anfitrion.nombre,
      publica: this.esPublica(),
      estado: 'esperando',
      jugadores: [anfitrion],
      dificultadBots: 'Normal',
      creadaEn: Date.now(),
      numBarajas: this.numBarajas(),
      maxJugadores: this.maxJugadores(),
      reglasActivas,
    };

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
