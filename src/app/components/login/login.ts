import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  loginForm: FormGroup;
  errorMensaje: string = '';

  constructor(
    private auth: AuthService, 
    private router: Router,
    private fb: FormBuilder
  ) {
    this.loginForm = this.fb.group({
      username: ['', Validators.required],
      password: ['', Validators.required]
    });
  }

  onAcceder(): void {
    // Si el usuario no ha rellenado algo, no hacemos nada
    if (this.loginForm.invalid) return;

    // Extraemos los datos reales que ha escrito el usuario
    const { username, password } = this.loginForm.value;

    // Llamamos al método que creamos antes en el servicio y nos "suscribimos" para esperar la respuesta
    this.auth.login(username, password).subscribe({
      next: () => {
        this.router.navigate(['/lobby']);
      },
      error: (err) => {
        this.errorMensaje = 'Usuario o contraseña incorrectos';
      }
    });
  }
}