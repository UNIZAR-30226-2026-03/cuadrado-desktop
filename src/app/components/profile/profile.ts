import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DecimalPipe } from '@angular/common';
import {
  ReactiveFormsModule, FormsModule, FormBuilder, FormGroup,
  Validators, AbstractControl, ValidationErrors,
} from '@angular/forms';
import { AuthService } from '../../services/auth';
import { TopBar } from '../shared/top-bar/top-bar';
import { environment } from '../../environment';

interface MyRankingPosition {
  position: number;
  username: string;
  eloRating: number;
}

interface Skin {
  id: string;
  name: string;
  type: string;
  price: number;
  url: string;
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, TopBar, DecimalPipe],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile implements OnInit {
  showChangePasswordPopup = false;
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

  myPosition = signal<MyRankingPosition | null>(null);
  rankingLoading = signal(false);

  changePasswordForm: FormGroup;
  changingPassword = false;
  changePasswordMessage = '';
  changePasswordError = '';

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
    this.auth.refreshProfile().subscribe();
    this.loadProfileAvatars();
    this.cargarMiPosicion();
  }

  get usuario() { return this.auth.usuario(); }

  get profileName(): string {
    return this.profileDisplayName || this.usuario?.nombre || 'Jugador';
  }

  get currentAvatarSkin(): Skin | null {
    const equippedAvatarId = this.usuario?.avatar;
    if (!equippedAvatarId) return null;
    return this.avatarSkins().find(s => s.id === equippedAvatarId) || null;
  }

  volver(): void { this.router.navigate(['/lobby']); }

  openSettingsFromTopBar(): void { this.router.navigate(['/lobby']); }

  onLogout(): void { this.auth.logout(); }

  irRanking(): void { this.router.navigate(['/ranking']); }

  private cargarMiPosicion(): void {
    const token = this.auth.getToken();
    if (!token) return;

    this.rankingLoading.set(true);
    const headers = { Authorization: `Bearer ${token}` };
    this.http.get<MyRankingPosition>(
      `${environment.apiUrl}/users/me/position`, { headers }
    ).subscribe({
      next: (data) => {
        this.myPosition.set(data);
        this.rankingLoading.set(false);
      },
      error: () => this.rankingLoading.set(false),
    });
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
    if (!this.isAvatarOwned(skin) || this.savingProfileAvatar) return;

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
        this.avatarSkins.set(skins.filter(s => s.type === 'Avatar'));
        this.loadingProfileAvatars = false;
      },
      error: () => {
        this.avatarSkins.set([]);
        this.loadingProfileAvatars = false;
      },
    });

    this.http.get<Skin[]>(`${environment.apiUrl}/skins/inventory`, { headers }).subscribe({
      next: (ownedSkins) => {
        const ids = ownedSkins.filter(s => s.type === 'Avatar').map(s => s.id);
        this.ownedAvatarIds.set(new Set(ids));
      },
      error: () => this.ownedAvatarIds.set(new Set()),
    });
  }

  openChangePasswordPopup(): void {
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

    this.auth.cambiarPassword(passwordActual, passwordNueva).subscribe({
      next: () => {
        this.changingPassword = false;
        this.changePasswordMessage = 'Contraseña cambiada correctamente.';
        setTimeout(() => this.closeChangePasswordPopup(), 1200);
      },
      error: () => {
        this.changingPassword = false;
        this.changePasswordError = 'No se pudo cambiar la contraseña.';
      },
    });
  }

  private passwordsMatch(group: AbstractControl): ValidationErrors | null {
    const p = group.get('passwordNueva')?.value;
    const c = group.get('confirmarPassword')?.value;
    return p && c && p !== c ? { passwordsMismatch: true } : null;
  }
}
