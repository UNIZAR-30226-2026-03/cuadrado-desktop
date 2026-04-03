import { Component, OnInit, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import {
  trigger, transition, style, animate
} from '@angular/animations';
import { AuthService } from '../../services/auth';
import { RoomService, SalaData } from '../../services/room';

interface CardPower {
  card: string;
  image: string;
  description: string;
  enabled: boolean;
}

@Component({
  selector: 'app-create-room',
  standalone: true,
  imports: [],
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

  cardPowers: CardPower[] = [
    { card: 'A',  image: '🂡', description: 'Permite espiar una de tus propias cartas.', enabled: false },
    { card: '2',  image: '🂢', description: 'Permite espiar una carta de otro jugador.', enabled: false },
    { card: '3',  image: '🂣', description: 'Permite intercambiar una carta tuya con la de otro jugador sin verlas.', enabled: false },
    { card: '4',  image: '🂤', description: 'Sin poder especial.', enabled: false },
    { card: '5',  image: '🂥', description: 'Sin poder especial.', enabled: false },
    { card: '6',  image: '🂦', description: 'Sin poder especial.', enabled: false },
    { card: '7',  image: '🂧', description: 'Permite ver una carta de otro jugador y decidir si intercambiarla con una tuya.', enabled: false },
    { card: '8',  image: '🂨', description: 'Sin poder especial.', enabled: false },
    { card: '9',  image: '🂩', description: 'Sin poder especial.', enabled: false },
    { card: '10', image: '🂪', description: 'Permite ver una carta de otro jugador y decidir si intercambiarla con una tuya.', enabled: false },
    { card: 'J',  image: '🂫', description: 'Sin poder especial.', enabled: false },
    { card: 'Q',  image: '🂭', description: 'Sin poder especial.', enabled: false },
    { card: 'K',  image: '🂮', description: 'Vale 0 puntos al final de la partida.', enabled: false },
  ];

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private auth: AuthService,
    private roomService: RoomService
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
    this.cardPowers[index].enabled = !this.cardPowers[index].enabled;
  }

  crearSala(): void {
    const usuario = this.auth.usuario();
    const codigo = this.roomService.generarCodigo();
    const nombre = `Sala de ${usuario?.nombre || 'Jugador'}`;

    const anfitrion = {
      id: `user_${usuario?.nombre || 'anon'}`,
      nombre: usuario?.nombre || 'Anfitrión',
      esBot: false,
      esAnfitrion: true,
      listo: false,
      avatar: '👑'
    };

    const reglasActivas = this.cardPowers
      .filter(p => p.enabled)
      .map(p => p.card);

    const sala: SalaData = {
      id: codigo,
      nombre,
      anfitrion: anfitrion.nombre,
      publica: this.esPublica(),
      estado: 'esperando',
      jugadores: [anfitrion],
      dificultadBots: 'Normal',
      creadaEn: Date.now(),
      numBarajas: this.numBarajas(),
      reglasActivas,
    };

    this.roomService.guardarSala(sala);
    this.roomService.setEsAnfitrion(true);
    this.router.navigate(['/waiting-room']);
  }

  volver(): void {
    this.router.navigate(['/lobby']);
  }

  irATutorial(): void {
    this.router.navigate(['/tutorial']);
  }
}
