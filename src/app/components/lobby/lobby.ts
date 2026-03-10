import { Component } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import {
  trigger, transition, style, animate, query, stagger
} from '@angular/animations';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-lobby',
  standalone: true,
  imports: [DecimalPipe, ReactiveFormsModule],
  templateUrl: './lobby.html',
  styleUrl: './lobby.scss',
  host: { '[@pageFade]': '' },
  animations: [
    trigger('pageFade', [
      transition(':enter', [style({ opacity: 0 }), animate('400ms ease-out', style({ opacity: 1 }))]),
      transition(':leave', [animate('250ms ease-in', style({ opacity: 0 }))]),
    ]),
    trigger('navStagger', [
      transition(':enter', [
        query('.nav-card', [
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
export class Lobby {
  showProfileMenu = false;
  showChangePasswordPopup = false;
  changePasswordForm: FormGroup;
  changingPassword = false;
  changePasswordMessage = '';
  changePasswordError = '';

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

  get usuario() { return this.auth.usuario(); }

  navegar(ruta: string): void { this.router.navigate([ruta]); }
  onLogout(): void { this.auth.logout(); }

  toggleProfileMenu(): void {
    this.showProfileMenu = !this.showProfileMenu;
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
