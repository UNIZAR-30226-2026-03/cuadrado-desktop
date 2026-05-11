import { Component } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { trigger, transition, style, animate } from '@angular/animations';
import { AuthService } from '../../../services/auth';
import { SettingsFabComponent } from '../../shared/settings-fab/settings-fab';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, SettingsFabComponent],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  animations: [
    trigger('cardSpring', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(50px) scale(0.92)' }),
        animate('600ms 100ms cubic-bezier(0.34, 1.56, 0.64, 1)', style({ opacity: 1, transform: 'none' })),
      ]),
    ]),
    trigger('logoReveal', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.7)', filter: 'blur(8px)' }),
        animate('500ms 250ms cubic-bezier(0.16, 1, 0.3, 1)', style({ opacity: 1, transform: 'scale(1)', filter: 'blur(0)' })),
      ]),
    ]),
  ],
})
export class LoginComponent {
  form: FormGroup;
  loading = false;
  errorMsg = '';

  constructor(private fb: FormBuilder, private auth: AuthService, private router: Router) {
    this.form = this.fb.group({
      usuario:    ['', [Validators.required, Validators.minLength(3)]],
      contrasena: ['', [Validators.required, Validators.minLength(8)]],
    });
  }

  onSubmit(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    
    const { usuario, contrasena } = this.form.value;
    this.errorMsg = '';
    this.loading = true;

    this.auth.login(usuario, contrasena).subscribe({
      next: (respuesta) => {
        this.loading = false;
        console.log('¡Login exitoso!', respuesta);
        
        this.router.navigate(['/lobby']);
      },
      error: (err: any) => {
        this.loading = false;
        this.errorMsg = err?.error?.message ?? 'Usuario o contraseña incorrectos';
        console.error('Error al iniciar sesión:', err);
      }
    });
  }
}
