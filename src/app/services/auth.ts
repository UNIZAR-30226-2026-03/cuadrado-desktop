import { Injectable, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { tap, delay } from 'rxjs/operators';
import { of } from 'rxjs';
import { environment } from '../environment';
import { Usuario } from '../models/game';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private _usuario = signal<Usuario | null>(null);
  private _token = signal<string | null>(null);

  usuario = this._usuario.asReadonly();
  estaAutenticado = computed(() => !!this._token());

  // Añadimos HttpClient aquí
  constructor(private router: Router, private http: HttpClient) {
    const usuarioGuardado = localStorage.getItem('usuario');
    const tokenGuardado = localStorage.getItem('token');
    if (usuarioGuardado && tokenGuardado) {
      this._usuario.set(JSON.parse(usuarioGuardado));
      this._token.set(tokenGuardado);
    }
  }

  // 1. LOGIN
  // NestJS espera { username, password }
  login(username: string, password: string) {
    return this.http.post<any>(`${environment.apiUrl}/auth/login`, { username, password })
      .pipe(
        tap(respuesta => {
          const token = respuesta.accessToken;
          const u = respuesta.user;

          const user: Usuario = {
            id: 0,
            nombre: u.username,
            monedas: u.cubitos,
            exp: u.eloRating,
            partidasJugadas: u.gamesPlayed,
            partidasGanadas: u.gamesWon,
            ranking: u.rankPlacement,
            avatar: '',
            reverso: u.equippedSkinID || '',
            tapete: '',
          };

          this._token.set(token);
          this._usuario.set(user);

          localStorage.setItem('token', token);
          localStorage.setItem('usuario', JSON.stringify(user));
        })
      );
  }

  // 2. REGISTRO
  // NestJS espera { username, email, password }
  registrar(username: string, email: string, password: string) {
    return this.http.post(`${environment.apiUrl}/auth/register`, { username, email, password });
  }

  // 3. CAMBIAR CONTRASEÑA
  // NestJS está protegido por @UseGuards(JwtGuard), así que hay que enviar el Token
  cambiarPassword(passwordActual: string, nuevaPassword: string) {
    const headers = { Authorization: `Bearer ${this.getToken()}` };
    return this.http.post(`${environment.apiUrl}/auth/change-password`, 
      { passwordActual, nuevaPassword }, 
      { headers }
    );
  }

  recuperarPassword(email: string){
    return of(true).pipe(delay(1000));
  }

  // 4. LOGOUT (Avisar al backend)
  logout() {
    const headers = { Authorization: `Bearer ${this.getToken()}` };
    const refreshToken = localStorage.getItem('refreshToken') || ''; // Si usas refresh tokens
    
    this.http.post(`${environment.apiUrl}/auth/logout`, { refreshToken }, { headers })
    
      .subscribe({
        next: () => this.limpiarSesion(),
        error: () => this.limpiarSesion() // Limpiamos el front incluso si el back falla
      });
  }

  private limpiarSesion() {
    this._usuario.set(null);
    this._token.set(null);
    localStorage.removeItem('usuario');
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return this._token();
  }
}