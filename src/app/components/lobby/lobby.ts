import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { ReactiveFormsModule, FormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import {
  trigger, transition, style, animate, query, stagger
} from '@angular/animations';
import { AuthService } from '../../services/auth';
import { GameTable } from '../game-table/game-table';

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
  imports: [DecimalPipe, ReactiveFormsModule, FormsModule, GameTable],
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
  showProfileMenu = false;
  showChangePasswordPopup = false;
  showDeckPopup = false;
  showConfigPopup = false;

  // Configuración
  configMusic = 80;
  configSfx = 80;
  configVoice = 80;
  configInputDevice = '';
  audioInputDevices: MediaDeviceInfo[] = [];
  changePasswordForm: FormGroup;
  changingPassword = false;
  changePasswordMessage = '';
  changePasswordError = '';

  // Cubos 3D efímeros
  cubes = signal<SpawnedCube[]>([]);
  private cubeIdCounter = 0;
  private cubeTimers: ReturnType<typeof setTimeout>[] = [];
  private spawnTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    protected auth: AuthService,
    private router: Router,
    private fb: FormBuilder
  ) {
    this.changePasswordForm = this.fb.group({
      passwordActual: ['', [Validators.required]],
      passwordNueva: ['', [Validators.required, Validators.minLength(8)]],
      confirmarPassword: ['', [Validators.required]],
    }, { validators: this.passwordsMatch });
  }

  ngOnInit(): void {
    // Lote inicial escalonado
    for (let i = 0; i < 8; i++) {
      const t = setTimeout(() => this.spawnCube(), i * 500);
      this.cubeTimers.push(t);
    }
    // Spawneo continuo
    this.scheduleNextCube();
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
  onLogout(): void { this.auth.logout(); }

  openDeckPopup(): void { this.showDeckPopup = true; }
  closeDeckPopup(): void { this.showDeckPopup = false; }

  selectDecks(num: 1 | 2): void {
    this.showDeckPopup = false;
    this.router.navigate(['/create-room'], { queryParams: { barajas: num } });
  }

  toggleProfileMenu(): void {
    this.showProfileMenu = !this.showProfileMenu;
  }

  openConfigPopup(): void {
    this.showConfigPopup = true;
    navigator.mediaDevices?.enumerateDevices().then(devices => {
      this.audioInputDevices = devices.filter(d => d.kind === 'audioinput');
      if (this.audioInputDevices.length && !this.configInputDevice) {
        this.configInputDevice = this.audioInputDevices[0].deviceId;
      }
    }).catch(() => {});
  }

  closeConfigPopup(): void {
    this.showConfigPopup = false;
  }

  openChangePasswordPopup(): void {
    this.showProfileMenu = false;
    this.showChangePasswordPopup = true;
    this.changePasswordForm.reset();
    this.changePasswordMessage = '';
    this.changePasswordError = '';
  }

  closeChangePasswordPopup(): void {
    this.showChangePasswordPopup = false;
    this.changePasswordForm.reset();
  }

  submitChangePassword(): void {
    if (this.changePasswordForm.invalid) {
      this.changePasswordForm.markAllAsTouched();
      return;
    }
    this.changingPassword = true;
    this.changePasswordMessage = '';
    this.changePasswordError = '';

    const { passwordActual, passwordNueva } = this.changePasswordForm.value;
    
    // Llamamos al servicio real, sin el "Mock"
    this.auth.cambiarPassword(passwordActual, passwordNueva).subscribe({
      next: () => {
        this.changingPassword = false;
        this.changePasswordMessage = 'Contraseña cambiada correctamente.';
        setTimeout(() => this.closeChangePasswordPopup(), 1200);
      },
      error: (err) => {
        this.changingPassword = false;
        this.changePasswordError = 'No se pudo cambiar la contraseña.';
        console.error('Error del backend:', err);
      }
    });
  }

  private passwordsMatch(group: AbstractControl): ValidationErrors | null {
    const p = group.get('passwordNueva')?.value;
    const c = group.get('confirmarPassword')?.value;
    return p && c && p !== c ? { passwordsMismatch: true } : null;
  }
}
