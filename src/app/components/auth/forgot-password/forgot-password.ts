import { Component } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { trigger, transition, style, animate } from '@angular/animations';
import { AuthService } from '../../../services/auth';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.scss',
  animations: [
    trigger('cardSpring', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(50px) scale(0.92)' }),
        animate('600ms 100ms cubic-bezier(0.34, 1.56, 0.64, 1)', style({ opacity: 1, transform: 'none' })),
      ]),
    ]),
  ],
})
export class ForgotPasswordComponent {
  emailForm: FormGroup;
  resetForm: FormGroup;

  paso: 'email' | 'codigo' | 'exito' = 'email';
  cargando = false;
  error = '';
  private emailEnviado = '';

  constructor(private fb: FormBuilder, private auth: AuthService) {
    this.emailForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
    });
    this.resetForm = this.fb.group({
      codigo:           ['', [Validators.required]],
      passwordNueva:    ['', [Validators.required, Validators.minLength(8)]],
      confirmarPassword: ['', [Validators.required]],
    }, { validators: this.passwordsMatch });
  }

  private passwordsMatch(group: AbstractControl): ValidationErrors | null {
    const p = group.get('passwordNueva')?.value;
    const c = group.get('confirmarPassword')?.value;
    return p && c && p !== c ? { passwordsMismatch: true } : null;
  }

  onSubmitEmail(): void {
    if (this.emailForm.invalid) { this.emailForm.markAllAsTouched(); return; }
    this.cargando = true;
    this.error = '';
    this.emailEnviado = this.emailForm.value.email;

    this.auth.recuperarPassword(this.emailEnviado).subscribe({
      next: () => {
        this.cargando = false;
        this.paso = 'codigo';
      },
      error: () => {
        this.cargando = false;
        this.error = 'No se pudo enviar el correo. Verifica que el email esté registrado.';
      },
    });
  }

  async onSubmitReset(): Promise<void> {
    if (this.resetForm.invalid) { this.resetForm.markAllAsTouched(); return; }
    this.cargando = true;
    this.error = '';
    const { codigo, passwordNueva } = this.resetForm.value;
    const ok = await this.auth.resetearPassword(this.emailEnviado, codigo, passwordNueva);
    this.cargando = false;
    ok ? this.paso = 'exito' : this.error = 'Código incorrecto o expirado. Inténtalo de nuevo.';
  }
}
