import { Component } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { trigger, transition, style, animate } from '@angular/animations';
import { AuthService } from '../../../services/auth';
import { SettingsFabComponent } from '../../shared/settings-fab/settings-fab';

@Component({
  selector: 'app-change-password',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, SettingsFabComponent],
  templateUrl: './change-password.html',
  styleUrl: './change-password.scss',
  animations: [
    trigger('cardSpring', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(50px) scale(0.92)' }),
        animate('600ms 100ms cubic-bezier(0.34, 1.56, 0.64, 1)', style({ opacity: 1, transform: 'none' })),
      ]),
    ]),
  ],
})
export class ChangePasswordComponent {
  form: FormGroup;
  cambiado = false;
  cargando = false;
  error = '';

  constructor(private fb: FormBuilder, private auth: AuthService) {
    this.form = this.fb.group({
      passwordActual:   ['', [Validators.required]],
      passwordNueva:    ['', [Validators.required, Validators.minLength(8)]],
      confirmarPassword: ['', [Validators.required]],
    }, { validators: this.passwordsMatch });
  }

  private passwordsMatch(group: AbstractControl): ValidationErrors | null {
    const p = group.get('passwordNueva')?.value;
    const c = group.get('confirmarPassword')?.value;
    return p && c && p !== c ? { passwordsMismatch: true } : null;
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.cargando = true;
    this.error = '';
    const { passwordActual, passwordNueva } = this.form.value;
    const ok = await this.auth.cambiarPassword(passwordActual, passwordNueva);
    this.cargando = false;
    ok ? this.cambiado = true : this.error = 'No se pudo cambiar la contraseña.';
  }
}
