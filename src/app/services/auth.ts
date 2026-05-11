import { Injectable, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { tap, catchError, map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environment';
import { Usuario } from '../models/game';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private _usuario = signal<Usuario | null>(null);
  private _token = signal<string | null>(null);
  private profileSyncTimer: ReturnType<typeof setInterval> | null = null;
  private readonly PROFILE_SYNC_MS = 15000;

  usuario = this._usuario.asReadonly();
  estaAutenticado = computed(() => !!this._token());

  // Añadimos HttpClient aquí
  constructor(private router: Router, private http: HttpClient) {
    const usuarioGuardado = localStorage.getItem('usuario');
    const tokenGuardado = localStorage.getItem('token');
    if (usuarioGuardado && tokenGuardado) {
      this._usuario.set(JSON.parse(usuarioGuardado));
      this._token.set(tokenGuardado);
      this.startProfileSync();
      this.validarYRenovarSesion();
    }
  }

  // Valida el token guardado al arrancar la app. Si el token expiró (401),
  // usa el refreshToken para obtener uno nuevo. Si eso también falla → logout.
  // Errores de red o backend dormido se ignoran (la sesión se mantiene).
  private validarYRenovarSesion(): void {
    const token = this._token();
    const refreshToken = localStorage.getItem('refreshToken');
    if (!token) return;

    const headers = { Authorization: `Bearer ${token}` };
    this.http.get<any>(`${environment.apiUrl}/users/me`, { headers }).pipe(
      tap(profile => {
        const current = this._usuario();
        if (!current) return;
        this.setUser({
          ...current,
          nombre: profile.username ?? current.nombre,
          monedas: profile.cubitos ?? current.monedas,
          exp: profile.eloRating ?? current.exp,
          partidasJugadas: profile.gamesPlayed ?? current.partidasJugadas,
          partidasGanadas: profile.gamesWon ?? current.partidasGanadas,
          avatar: profile.equipado?.avatar ?? current.avatar,
        });
      }),
      catchError(err => {
        if (err.status === 401 && refreshToken) {
          return this.http.post<any>(`${environment.apiUrl}/auth/refresh`, { refreshToken }).pipe(
            tap(resp => {
              this._token.set(resp.accessToken);
              localStorage.setItem('token', resp.accessToken);
              if (resp.refreshToken) localStorage.setItem('refreshToken', resp.refreshToken);
            }),
            switchMap(() => this.refreshProfile()),
            catchError(() => {
              this.limpiarSesion();
              return of(null);
            })
          );
        }
        return of(null);
      })
    ).subscribe();
  }

  // 1. LOGIN
  // NestJS espera { username, password }
  login(username: string, password: string) {
    return this.http.post<any>(`${environment.apiUrl}/auth/login`, { username, password })
      .pipe(
        tap(respuesta => {
          const token = respuesta.accessToken;
          const refreshToken = respuesta.refreshToken;
          const u = respuesta.user;

          const user: Usuario = {
            id: 0,
            nombre: u.username,
            monedas: u.cubitos ?? 0,
            exp: u.eloRating,
            partidasJugadas: u.gamesPlayed ?? 0,
            partidasGanadas: u.gamesWon ?? 0,
            ranking: u.rankPlacement ?? 0,
            avatar: u.equippedAvatarId ?? '',
            reverso: u.equippedSkinID || '',
            tapete: '',
          };

          this._token.set(token);
          localStorage.setItem('token', token);
          if (refreshToken) {
            localStorage.setItem('refreshToken', refreshToken);
          }
          this.setUser(user);
          this.startProfileSync();
          this.refreshProfile().subscribe();
        })
      );
  }

  updateUser(patch: Partial<Usuario>) {
    const current = this._usuario();
    if (!current) return;
    this.setUser({ ...current, ...patch });
  }

  refreshProfile() {
    const token = this._token();
    const current = this._usuario();

    if (!token || !current) {
      return of(null);
    }

    const headers = { Authorization: `Bearer ${token}` };
    return this.http.get<any>(`${environment.apiUrl}/users/me`, { headers }).pipe(
      map(profile => {
        const refreshed: Usuario = {
          ...current,
          nombre: profile.username ?? current.nombre,
          monedas: profile.cubitos ?? current.monedas,
          exp: profile.eloRating ?? current.exp,
          partidasJugadas: profile.gamesPlayed ?? current.partidasJugadas,
          partidasGanadas: profile.gamesWon ?? current.partidasGanadas,
          avatar: profile.equipado?.avatar ?? current.avatar,
        };

        return refreshed;
      }),
      tap(refreshed => this.setUser(refreshed)),
      catchError(() => of(null)),
    );
  }

  // 2. REGISTRO
  // NestJS espera { username, email, password }
  registrar(username: string, email: string, password: string) {
    return this.http.post(`${environment.apiUrl}/auth/register`, { username, email, password });
  }

  // 3. CAMBIAR CONTRASEÑA
  async cambiarPassword(passwordActual: string, nuevaPassword: string): Promise<boolean> {
    const headers = { Authorization: `Bearer ${this.getToken()}` };
    try {
      await firstValueFrom(
        this.http.post(`${environment.apiUrl}/auth/change-password`,
          { currentPassword: passwordActual, newPassword: nuevaPassword },
          { headers }
        )
      );
      return true;
    } catch {
      return false;
    }
  }

  // 4. RECUPERAR CONTRASEÑA — paso 1: enviar código al email
  async recuperarPassword(email: string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.post(`${environment.apiUrl}/forgotten_passwd/notify`, { email })
      );
      return true;
    } catch {
      return false;
    }
  }

  // 4b. RECUPERAR CONTRASEÑA — paso 2: validar código y cambiar contraseña
  async resetearPassword(email: string, authCode: string, newPassword: string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.post(`${environment.apiUrl}/forgotten_passwd/reset-password`,
          { email, authCode, newPassword }
        )
      );
      return true;
    } catch {
      return false;
    }
  }

  // 4. LOGOUT (Avisar al backend)
  logout() {
    const token = this.getToken();
    const refreshToken = localStorage.getItem('refreshToken');

    // Si el front no tiene refresh token, evitamos llamar al backend con valor vacío.
    if (!token || !refreshToken) {
      this.limpiarSesion();
      return;
    }

    const headers = { Authorization: `Bearer ${token}` };

    this.http.post(`${environment.apiUrl}/auth/logout`, { refreshToken }, { headers })
      .subscribe({
        next: () => this.limpiarSesion(),
        error: () => this.limpiarSesion() // Limpiamos el front incluso si el back falla
      });
  }

  private limpiarSesion() {
    this.stopProfileSync();
    this._usuario.set(null);
    this._token.set(null);
    localStorage.removeItem('usuario');
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    this.router.navigate(['/login']);
  }

  private setUser(user: Usuario) {
    this._usuario.set(user);
    localStorage.setItem('usuario', JSON.stringify(user));
  }

  private startProfileSync() {
    if (this.profileSyncTimer) return;

    this.profileSyncTimer = setInterval(() => {
      this.refreshProfile().subscribe();
    }, this.PROFILE_SYNC_MS);
  }

  private stopProfileSync() {
    if (!this.profileSyncTimer) return;
    clearInterval(this.profileSyncTimer);
    this.profileSyncTimer = null;
  }

  getToken(): string | null {
    return this._token();
  }
}