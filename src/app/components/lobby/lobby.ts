import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import {
  trigger, transition, style, animate, query, stagger
} from '@angular/animations';
import { AuthService } from '../../services/auth';
import { RoomService, SalaData } from '../../services/room';
import { WebsocketService, SavedGameSummary } from '../../services/websocket';
import { VoiceChatService } from '../../services/voice-chat';
import { GameTable } from '../game-table/game-table';
import { TopBar } from '../shared/top-bar/top-bar';
import { SettingsPopupComponent } from '../shared/settings-popup/settings-popup';
import { environment } from '../../environment';

interface SpawnedCube {
  id: number;
  size: number;
  x: number;
  y: number;
  duration: number;
  faces: string[];
}

const MAX_CUBES = 16;

@Component({
  selector: 'app-lobby',
  standalone: true,
  imports: [FormsModule, DatePipe, GameTable, TopBar, SettingsPopupComponent],
  templateUrl: './lobby.html',
  styleUrl: './lobby.scss',
  animations: [
    trigger('navStagger', [
      transition(':enter', [
        query('.nav-btn', [
          style({ opacity: 0, transform: 'translateY(32px) scale(0.90)' }),
          stagger(80, [
            animate('500ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              style({ opacity: 1, transform: 'none' })),
          ]),
        ], { optional: true }),
      ]),
    ]),
    trigger('headerSlide', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(-20px)' }),
        animate('400ms 150ms ease-out', style({ opacity: 1, transform: 'none' })),
      ]),
    ]),
  ],
})
export class Lobby implements OnInit, OnDestroy {
  showDeckPopup = false;
  showConfigPopup = false;

  // Vista dentro del popup de creación: selector de barajas o lista de guardadas
  vistaPopup = signal<'deck' | 'saved'>('deck');
  partidasGuardadas = signal<SavedGameSummary[]>([]);
  cargandoPartidas = signal(false);
  errorPartidas = signal<string | null>(null);
  cargandoReanudar = signal<string | null>(null); // gameId de la partida en curso


  // Cubos 3D efímeros
  cubes = signal<SpawnedCube[]>([]);
  private cubeIdCounter = 0;
  private cubeTimers: ReturnType<typeof setTimeout>[] = [];
  private spawnTimer: ReturnType<typeof setTimeout> | null = null;

  // URL de la skin de reverso equipada
  reversoUrl = signal<string | null>(null);

  constructor(
    protected auth: AuthService,
    protected voiceChat: VoiceChatService,
    private router: Router,
    private http: HttpClient,
    private ws: WebsocketService,
    private roomService: RoomService,
  ) {}

  ngOnInit(): void {
    // Lote inicial escalonado
    for (let i = 0; i < 8; i++) {
      const t = setTimeout(() => this.spawnCube(), i * 500);
      this.cubeTimers.push(t);
    }
    // Spawneo continuo
    this.scheduleNextCube();
    // Skin de reverso del usuario
    this.cargarSkinReverso();
  }

  private cargarSkinReverso(): void {
    const headers = { Authorization: `Bearer ${this.auth.getToken()}` };
    this.http.get<{ carta: string | null; tapete: string | null }>(
      `${environment.apiUrl}/skins/equipped`, { headers }
    ).subscribe({
      next: (data) => {
        this.reversoUrl.set(data.carta ?? environment.defaultReversoUrl);
      },
    });
  }

  ngOnDestroy(): void {
    this.cubeTimers.forEach(t => clearTimeout(t));
    if (this.spawnTimer) clearTimeout(this.spawnTimer);
  }

  private spawnCube(): void {
    if (this.cubes().length >= MAX_CUBES) return;
    const size = 16 + Math.random() * 36;
    const half = size / 2;
    const cube: SpawnedCube = {
      id: this.cubeIdCounter++,
      size,
      x: 2 + Math.random() * 94,
      y: 2 + Math.random() * 94,
      duration: 6000 + Math.random() * 8000,
      faces: [
        `rotateY(0deg) translateZ(${half}px)`,
        `rotateY(180deg) translateZ(${half}px)`,
        `rotateY(90deg) translateZ(${half}px)`,
        `rotateY(-90deg) translateZ(${half}px)`,
        `rotateX(90deg) translateZ(${half}px)`,
        `rotateX(-90deg) translateZ(${half}px)`,
      ],
    };
    this.cubes.update(prev => [...prev, cube]);

    const t = setTimeout(() => {
      this.cubes.update(prev => prev.filter(c => c.id !== cube.id));
    }, cube.duration + 100);
    this.cubeTimers.push(t);
  }

  private scheduleNextCube(): void {
    const delay = 1200 + Math.random() * 2500;
    this.spawnTimer = setTimeout(() => {
      this.spawnCube();
      this.scheduleNextCube();
    }, delay);
  }

  get usuario() { return this.auth.usuario(); }

  navegar(ruta: string): void { this.router.navigate([ruta]); }
  irPerfil(): void {
    this.router.navigate(['/profile']);
  }
  onLogout(): void {
    this.auth.logout();
  }

  openDeckPopup(): void {
    this.vistaPopup.set('deck');
    this.errorPartidas.set(null);
    this.showDeckPopup = true;
  }

  closeDeckPopup(): void {
    this.showDeckPopup = false;
    this.vistaPopup.set('deck');
  }

  selectDecks(num: 1 | 2): void {
    this.showDeckPopup = false;
    this.vistaPopup.set('deck');
    this.router.navigate(['/create-room'], { queryParams: { barajas: num } });
  }

  abrirVistaSaved(): void {
    this.vistaPopup.set('saved');
    this.errorPartidas.set(null);
    this.cargarPartidasGuardadas();
  }

  volverADecks(): void {
    this.vistaPopup.set('deck');
    this.errorPartidas.set(null);
  }

  async cargarPartidasGuardadas(): Promise<void> {
    if (this.cargandoPartidas()) return;
    const token = this.auth.getToken();
    if (!token) return;

    this.cargandoPartidas.set(true);
    this.errorPartidas.set(null);
    try {
      await this.ws.conectarYEsperar(token);
      const partidas = await this.ws.listarPartidasGuardadas();
      this.partidasGuardadas.set(partidas);
    } catch {
      this.errorPartidas.set('No se pudieron cargar las partidas guardadas.');
    } finally {
      this.cargandoPartidas.set(false);
    }
  }

  async reanudarPartida(partida: SavedGameSummary): Promise<void> {
    const token = this.auth.getToken();
    const usuario = this.auth.usuario();
    if (!token || !usuario) return;

    this.cargandoReanudar.set(partida.gameId);
    this.errorPartidas.set(null);
    try {
      await this.ws.conectarYEsperar(token);
      await this.ws.leaveRoomAck();
      // Sin rules → el backend detecta la partida guardada por nombre
      const resp = await this.ws.createRoom(partida.roomName);
      if (!resp.roomCode) {
        const motivo = (resp as { error?: string }).error ?? 'El servidor no devolvió un código de sala';
        throw new Error(motivo);
      }

      this.roomService.guardarResumenPartida(partida);

      const sala: SalaData = {
        id: resp.roomCode,
        nombre: resp.roomName || partida.roomName,
        anfitrion: usuario.nombre,
        publica: false,
        estado: 'esperando',
        jugadores: [{
          id: usuario.nombre,
          nombre: usuario.nombre,
          esBot: false,
          esAnfitrion: true,
          avatar: '👑',
        }],
        dificultadBots: 'Normal',
        creadaEn: Date.now(),
        numBarajas: 1,
        maxJugadores: 8,
        reglasActivas: [],
      };
      this.roomService.guardarSala(sala);
      this.roomService.setEsAnfitrion(true);
      this.closeDeckPopup();
      this.router.navigate(['/waiting-room']);
    } catch (err) {
      this.errorPartidas.set(err instanceof Error ? err.message : 'No se pudo reanudar la partida.');
    } finally {
      this.cargandoReanudar.set(null);
    }
  }

  openConfigPopup(): void {
    this.showConfigPopup = true;
  }

  closeConfigPopup(): void {
    this.showConfigPopup = false;
  }
}
