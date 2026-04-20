import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import {
  trigger, transition, style, animate, query, stagger
} from '@angular/animations';
import { AuthService } from '../../services/auth';
import { GameTable } from '../game-table/game-table';
import { TopBar } from '../shared/top-bar/top-bar';
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
  imports: [FormsModule, GameTable, TopBar],
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
  showHamburgerMenu = false;
  showDeckPopup = false;
  showConfigPopup = false;

  // Configuración
  configMusic = 80;
  configSfx = 80;
  configVoice = 80;
  configInputDevice = '';
  audioInputDevices: MediaDeviceInfo[] = [];

  // Cubos 3D efímeros
  cubes = signal<SpawnedCube[]>([]);
  private cubeIdCounter = 0;
  private cubeTimers: ReturnType<typeof setTimeout>[] = [];
  private spawnTimer: ReturnType<typeof setTimeout> | null = null;

  // URL de la skin de reverso equipada
  reversoUrl = signal<string | null>(null);

  constructor(
    protected auth: AuthService,
    private router: Router,
    private http: HttpClient,
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
    this.showHamburgerMenu = false;
    this.router.navigate(['/profile']);
  }
  onLogout(): void {
    this.showHamburgerMenu = false;
    this.auth.logout();
  }

  openDeckPopup(): void { this.showDeckPopup = true; }
  closeDeckPopup(): void { this.showDeckPopup = false; }

  selectDecks(num: 1 | 2): void {
    this.showDeckPopup = false;
    this.router.navigate(['/create-room'], { queryParams: { barajas: num } });
  }

  toggleHamburgerMenu(): void {
    this.showHamburgerMenu = !this.showHamburgerMenu;
  }

  openConfigPopup(): void {
    this.showHamburgerMenu = false;
    this.showConfigPopup = true;
    if (!this.configInputDevice) {
      this.configInputDevice = 'default';
    }
    // Solicitar permiso de micrófono primero para obtener etiquetas de dispositivos
    navigator.mediaDevices?.getUserMedia({ audio: true })
      .then(stream => {
        stream.getTracks().forEach(t => t.stop());
        return navigator.mediaDevices.enumerateDevices();
      })
      .then(devices => {
        this.audioInputDevices = devices
          .filter(d => d.kind === 'audioinput' && d.deviceId !== 'default');
      })
      .catch(() => {
        // Si se deniegan los permisos, enumerar sin etiquetas
        navigator.mediaDevices?.enumerateDevices().then(devices => {
          this.audioInputDevices = devices
            .filter(d => d.kind === 'audioinput' && d.deviceId !== 'default');
        }).catch(() => {});
      });
  }

  closeConfigPopup(): void {
    this.showConfigPopup = false;
  }
}
