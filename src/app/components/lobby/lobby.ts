import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { ReactiveFormsModule, FormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import {
  trigger, transition, style, animate, query, stagger
} from '@angular/animations';
import { AuthService } from '../../services/auth';
import { GameTable } from '../game-table/game-table';
import { environment } from '../../environment';

interface SpawnedCube {
  id: number;
  size: number;
  x: number;
  y: number;
  duration: number;
  faces: string[];
}

interface Skin {
  id: string;
  name: string;
  type: string;
  price: number;
  url: string;
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
  showHamburgerMenu = false;
  showChangePasswordPopup = false;
  showDeckPopup = false;
  showConfigPopup = false;
  showProfilePopup = false;
  showAvatarSelector = false;

  isEditingProfileName = false;
  profileDisplayName = '';
  profileNameDraft = '';
  profileNameError = '';
  profileStatusMessage = '';
  profileStatusError = '';

  loadingProfileAvatars = false;
  savingProfileAvatar = false;
  avatarSkins = signal<Skin[]>([]);
  ownedAvatarIds = signal<Set<string>>(new Set());
  avatarImageErrors = signal<Set<string>>(new Set());

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

  // URL de la skin de reverso equipada
  reversoUrl = signal<string | null>(null);

  constructor(
    protected auth: AuthService,
    private router: Router,
    private fb: FormBuilder,
    private http: HttpClient,
  ) {
    this.changePasswordForm = this.fb.group({
      passwordActual: ['', [Validators.required]],
      passwordNueva: ['', [Validators.required, Validators.minLength(8)]],
      confirmarPassword: ['', [Validators.required]],
    }, { validators: this.passwordsMatch });
  }

  ngOnInit(): void {
    this.profileDisplayName = this.usuario?.nombre ?? '';

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
        if (data.carta) this.reversoUrl.set(data.carta);
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
  get profileName(): string {
    return this.profileDisplayName || this.usuario?.nombre || 'Jugador';
  }

  get currentAvatarSkin(): Skin | null {
    const equippedAvatarId = this.usuario?.avatar;
    if (!equippedAvatarId) return null;
    return this.avatarSkins().find(skin => skin.id === equippedAvatarId) || null;
  }

  navegar(ruta: string): void { this.router.navigate([ruta]); }
  onLogout(): void {
    this.showHamburgerMenu = false;
    this.showProfilePopup = false;
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

  openProfilePopup(): void {
    this.showHamburgerMenu = false;
    this.showProfilePopup = true;
    this.showAvatarSelector = false;
    this.isEditingProfileName = false;
    this.profileNameError = '';
    this.profileStatusMessage = '';
    this.profileStatusError = '';

    if (!this.profileDisplayName) {
      this.profileDisplayName = this.usuario?.nombre ?? 'Jugador';
    }

    this.auth.refreshProfile().subscribe();
    this.loadProfileAvatars();
  }

  closeProfilePopup(): void {
    this.showProfilePopup = false;
    this.showAvatarSelector = false;
    this.isEditingProfileName = false;
    this.profileNameDraft = '';
    this.profileNameError = '';
    this.profileStatusError = '';
    this.profileStatusMessage = '';
  }

  toggleAvatarSelector(): void {
    this.profileStatusMessage = '';
    this.profileStatusError = '';
    this.showAvatarSelector = !this.showAvatarSelector;

    if (this.showAvatarSelector && this.avatarSkins().length === 0) {
      this.loadProfileAvatars();
    }
  }

  startProfileNameEdit(): void {
    this.profileStatusMessage = '';
    this.profileStatusError = '';
    this.profileNameError = '';
    this.profileNameDraft = this.profileName;
    this.isEditingProfileName = true;
  }

  cancelProfileNameEdit(): void {
    this.isEditingProfileName = false;
    this.profileNameDraft = '';
    this.profileNameError = '';
  }

  saveProfileName(): void {
    const nextName = this.profileNameDraft.trim();

    if (!nextName) {
      this.profileNameError = 'El nombre no puede estar vacío.';
      return;
    }

    if (nextName.length < 3) {
      this.profileNameError = 'El nombre debe tener al menos 3 caracteres.';
      return;
    }

    if (nextName.length > 20) {
      this.profileNameError = 'El nombre no puede superar los 20 caracteres.';
      return;
    }

    this.profileDisplayName = nextName;
    this.isEditingProfileName = false;
    this.profileNameDraft = '';
    this.profileNameError = '';
    this.profileStatusError = '';
    this.profileStatusMessage = 'Nombre actualizado.';
  }

  isAvatarOwned(skin: Skin): boolean {
    return this.ownedAvatarIds().has(skin.id);
  }

  isAvatarSelected(skin: Skin): boolean {
    return this.usuario?.avatar === skin.id;
  }

  selectAvatarSkin(skin: Skin): void {
    if (!this.isAvatarOwned(skin) || this.savingProfileAvatar) {
      return;
    }

    if (this.isAvatarSelected(skin)) {
      this.showAvatarSelector = false;
      return;
    }

    const token = this.auth.getToken();
    if (!token) {
      this.profileStatusError = 'No hay sesión activa para actualizar el avatar.';
      return;
    }

    this.savingProfileAvatar = true;
    this.profileStatusError = '';
    this.profileStatusMessage = '';

    const headers = { Authorization: `Bearer ${token}` };
    this.http.patch(`${environment.apiUrl}/skins/equip/${skin.id}`, {}, { headers }).subscribe({
      next: () => {
        this.savingProfileAvatar = false;
        this.showAvatarSelector = false;
        this.auth.updateUser({ avatar: skin.id });
        this.auth.refreshProfile().subscribe();
        this.profileStatusMessage = 'Avatar actualizado.';
      },
      error: () => {
        this.savingProfileAvatar = false;
        this.profileStatusError = 'No se pudo actualizar el avatar.';
      },
    });
  }

  getAvatarImageUrl(skin: Skin): string {
    return skin.url || `assets/skins/${skin.name}.png`;
  }

  onAvatarImageError(skinId: string): void {
    this.avatarImageErrors.update(prev => new Set(prev).add(skinId));
  }

  hasAvatarImageError(skinId: string): boolean {
    return this.avatarImageErrors().has(skinId);
  }

  private loadProfileAvatars(): void {
    const token = this.auth.getToken();
    if (!token) {
      this.avatarSkins.set([]);
      this.ownedAvatarIds.set(new Set());
      return;
    }

    const headers = { Authorization: `Bearer ${token}` };
    this.loadingProfileAvatars = true;

    this.http.get<Skin[]>(`${environment.apiUrl}/skins/store`).subscribe({
      next: (skins) => {
        this.avatarSkins.set(skins.filter(skin => skin.type === 'Avatar'));
        this.loadingProfileAvatars = false;
      },
      error: () => {
        this.avatarSkins.set([]);
        this.loadingProfileAvatars = false;
      },
    });

    this.http.get<Skin[]>(`${environment.apiUrl}/skins/inventory`, { headers }).subscribe({
      next: (ownedSkins) => {
        const ownedAvatarIds = ownedSkins
          .filter(skin => skin.type === 'Avatar')
          .map(skin => skin.id);

        this.ownedAvatarIds.set(new Set(ownedAvatarIds));
      },
      error: () => {
        this.ownedAvatarIds.set(new Set());
      },
    });
  }

  openChangePasswordPopup(): void {
    this.showHamburgerMenu = false;
    this.showProfilePopup = false;
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
