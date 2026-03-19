import { Component } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router,RouterLink } from '@angular/router';
import { trigger, transition, style, animate } from '@angular/animations';
import { AuthService } from '../../../services/auth';
import { finalize, timeout } from 'rxjs';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register.html',
  styleUrl: './register.scss',
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
    trigger('logoReveal', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.7)', filter: 'blur(8px)' }),
        animate('500ms 250ms cubic-bezier(0.16, 1, 0.3, 1)', style({ opacity: 1, transform: 'scale(1)', filter: 'blur(0)' })),
      ]),
    ]),
  ],
})
export class RegisterComponent {
  form: FormGroup;
  loading = false;
  errorMsg = '';

  constructor(private fb: FormBuilder, private auth: AuthService, private router: Router) {
    this.form = this.fb.group({
      usuario:              ['', [Validators.required, Validators.minLength(3)]],
      email:                ['', [Validators.required, Validators.email]],
      contrasena:           ['', [Validators.required, Validators.minLength(8)]],
      confirmarContrasena:  ['', [Validators.required]],
    }, { validators: this.passwordsMatch });
  }

  private passwordsMatch(group: AbstractControl): ValidationErrors | null {
    const p = group.get('contrasena')?.value;
    const c = group.get('confirmarContrasena')?.value;
    return p && c && p !== c ? { passwordsMismatch: true } : null;
  }

  onSubmit(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    
    const { usuario, email, contrasena } = this.form.value;
    this.errorMsg = '';
    this.loading = true;

    // Usamos .subscribe() para "echar la carta al buzón" y esperar la respuesta
    this.auth.registrar(usuario, email, contrasena)
      .pipe(
        // Evita dejar la UI bloqueada si el backend no responde
        timeout(10000),
        finalize(() => {
          this.loading = false;
        })
      )
      .subscribe({
      next: (respuesta) => {
        console.log('¡Registro exitoso!', respuesta);
        // Redirigimos al usuario a la pantalla de login para que entre
        this.router.navigate(['/login']);
      },
      error: (err: any) => {
        if (err?.name === 'TimeoutError' || err?.status === 0) {
          this.errorMsg = 'No hay conexión con el servidor. Inténtalo de nuevo en unos segundos.';
        } else {
          // Si el backend se queja (ej. usuario duplicado), mostramos el error
          this.errorMsg = err?.error?.message ?? 'No se pudo registrar el usuario';
        }
        console.error('Error al registrar:', err);
      }
    });
  }
}
