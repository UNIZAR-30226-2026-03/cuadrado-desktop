import { Component } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { trigger, transition, style, animate } from '@angular/animations';
import { AuthService } from '../../../services/auth';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.scss',
  host: { '[@pageFade]': '' },
  animations: [
    trigger('pageFade', [
      transition(':enter', [style({ opacity: 0 }), animate('350ms ease-out', style({ opacity: 1 }))]),
      transition(':leave', [animate('200ms ease-in', style({ opacity: 0 }))]),
    ]),
    trigger('cardSpring', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(50px) scale(0.92)' }),
        animate('600ms 100ms cubic-bezier(0.34, 1.56, 0.64, 1)', style({ opacity: 1, transform: 'none' })),
      ]),
    ]),
  ],
})
export class ForgotPasswordComponent {
  form: FormGroup;
  enviado = false;
  cargando = false;

  constructor(private fb: FormBuilder, private auth: AuthService) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
    });
  }

  onSubmit(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.cargando = true;
    
    this.auth.recuperarPassword(this.form.value.email).subscribe({
      next: () => {
        this.cargando = false;
        this.enviado = true;
      },
      error: (err : any) => {
        this.cargando = false;
        console.error('Error al recuperar contraseña', err);
      }
    });
  }
}
