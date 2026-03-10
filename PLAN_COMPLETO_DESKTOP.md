# PLAN COMPLETO - Cuadrado Desktop (Angular)

**Equipo:** Ruben + Juan
**Estado actual:** Esqueleto basico con 3 componentes vacios y modelos iniciales.
**Objetivo:** App de escritorio completa del juego "Cuadrado" (cartas).

---

## DIAGNOSTICO DEL ESTADO ACTUAL

### Lo que ya existe

```
src/app/
  components/
    login/       -> Boton basico, sin formulario real
    lobby/       -> Placeholder vacio
    tablero/     -> Placeholder vacio
  models/
    game.ts      -> Interfaces: Usuario, Carta, Jugador, Sala, SalaConfig, EstadoPartida, etc.
  services/
    auth.ts      -> Mock minimo (booleano)
    game.ts      -> Generador de cartas aleatorias (simulacion)
    api.services.ts -> ROTO: importa tipos que no existen (GameState, Card)
  app.routes.ts  -> 3 rutas: /login, /lobby, /tablero
  app.config.ts  -> provideRouter + provideHttpClient
```

### Problemas a corregir YA

1. `api.services.ts` importa `{ GameState, Card } from '../models'` -> no existe. Debe ser `{ EstadoPartida, Carta } from '../models/game'`.
2. `game.spec.ts` importa `Game` pero el servicio se llama `GameService`.
3. No hay guards de rutas (cualquiera accede a /lobby sin login).
4. No hay estilos en ninguna pantalla.
5. No hay soporte para WebSocket (necesario para partidas en tiempo real).
6. Faltan +15 pantallas de las requeridas.

---

## PANTALLAS REQUERIDAS (del documento de objetivos)

| # | Pantalla | Componente Angular | Prioridad |
|---|----------|--------------------|-----------|
| 1 | Login | `login/` | CRITICA |
| 2 | Registro | `register/` | CRITICA |
| 3 | Olvidaste contrasena | `forgot-password/` | MEDIA |
| 4 | Pantalla de carga | `loading/` | BAJA |
| 5 | Sin conexion | `no-connection/` | BAJA |
| 6 | Pantalla principal (home) | `home/` | CRITICA |
| 7 | Perfil | `profile/` | ALTA |
| 8 | Personalizar avatar | `customize/` | MEDIA |
| 9 | Inventario | `inventory/` | MEDIA |
| 10 | Reglas / Tutorial | `rules/` | MEDIA |
| 11 | Crear sala | `create-room/` | CRITICA |
| 12 | Lista de salas | `room-list/` | CRITICA |
| 13 | Espera en sala | `waiting-room/` | CRITICA |
| 14 | Tablero de juego | `tablero/` | CRITICA |
| 15 | Pausa | `pause/` | MEDIA |
| 16 | Ajustes | `settings/` | MEDIA |
| 17 | Tienda | `shop/` | ALTA |
| 18 | Fin de partida | `game-over/` | CRITICA |
| 19 | Ranking global | `ranking/` | ALTA |

---

## ARQUITECTURA DE CARPETAS FINAL

```
src/app/
  components/
    auth/
      login/
      register/
      forgot-password/
    main-menu/
      home/
      profile/
      customize/
      inventory/
      settings/
      rules/
      ranking/
    rooms/
      create-room/
      room-list/
      waiting-room/
    game/
      tablero/
      game-over/
      pause/
    shop/
      shop/
    shared/
      loading/
      no-connection/
      header/
      card/              <- componente visual de una carta
      player-slot/       <- componente visual de un jugador en mesa
      chat/              <- chat de partida
  guards/
    auth.guard.ts        <- protege rutas que requieren login
  models/
    user.model.ts
    game.model.ts
    room.model.ts
    shop.model.ts
  services/
    api.service.ts       <- HTTP centralizado
    auth.service.ts      <- login, registro, token
    game.service.ts      <- logica de partida
    room.service.ts      <- crear/listar/unirse a salas
    shop.service.ts      <- tienda y compras
    websocket.service.ts <- conexion en tiempo real
    user.service.ts      <- perfil, inventario, ranking
  interceptors/
    auth.interceptor.ts  <- adjunta token JWT a peticiones
```

---

## DIVISION DEL TRABAJO

### Criterio: dividir por FLUJO, no por archivo suelto

- **RUBEN:** Flujo de JUEGO (tablero, partida, WebSocket, logica de cartas, fin de partida, pausa)
- **JUAN:** Flujo de NAVEGACION (auth, salas, perfil, tienda, ranking, ajustes)

### Mapa de propiedad

| Zona | Dueno | Carpetas |
|------|-------|----------|
| Auth (login, registro, forgot) | Juan | `components/auth/**` |
| Guards e interceptores | Juan | `guards/**`, `interceptors/**` |
| Home / Menu principal | Juan | `components/main-menu/home/` |
| Perfil, customizacion, inventario | Juan | `components/main-menu/profile,customize,inventory/` |
| Ajustes | Juan | `components/main-menu/settings/` |
| Reglas / Tutorial | Juan | `components/main-menu/rules/` |
| Ranking | Juan | `components/main-menu/ranking/` |
| Crear sala, listar salas, espera | Juan | `components/rooms/**` |
| Tienda | Juan | `components/shop/**` |
| Tablero de juego | Ruben | `components/game/tablero/` |
| Fin de partida | Ruben | `components/game/game-over/` |
| Pausa | Ruben | `components/game/pause/` |
| Componentes compartidos (card, player-slot, chat) | Ruben | `components/shared/card,player-slot,chat/` |
| WebSocket service | Ruben | `services/websocket.service.ts` |
| Game service | Ruben | `services/game.service.ts` |
| Auth service | Juan | `services/auth.service.ts` |
| Room service | Juan | `services/room.service.ts` |
| Shop service | Juan | `services/shop.service.ts` |
| User service | Juan | `services/user.service.ts` |
| API service (base) | Juan | `services/api.service.ts` |
| Modelos (compartido) | Coordinar | `models/**` |
| Rutas y app.routes.ts | Coordinar | `app.routes.ts` |
| Estilos globales | Coordinar | `styles.scss` |

**Ficheros compartidos** (`models/**`, `app.routes.ts`, `styles.scss`): antes de tocarlos, AVISAR por chat. PR pequena y rapida.

---

## FASES DE DESARROLLO

---

### FASE 0 - LIMPIEZA Y SETUP (1-2 horas) - JUNTOS

**Objetivo:** Dejar el repo limpio, con estructura correcta y sin errores.

**Rama:** `chore/cleanup-and-setup`
**Quien:** Uno de los dos (el otro revisa PR)

**Tareas exactas:**

1. Corregir `api.services.ts`:
   - Renombrar a `api.service.ts`
   - Cambiar imports rotos:
     ```typescript
     import { EstadoPartida, Carta } from '../models/game';
     ```
   - Actualizar metodos para usar tipos correctos

2. Corregir `game.spec.ts`:
   - Cambiar `import { Game }` por `import { GameService }`
   - Cambiar `TestBed.inject(Game)` por `TestBed.inject(GameService)`

3. Crear estructura de carpetas (vacias con .gitkeep):
   ```
   src/app/guards/
   src/app/interceptors/
   src/app/components/auth/
   src/app/components/main-menu/
   src/app/components/rooms/
   src/app/components/game/
   src/app/components/shared/
   src/app/components/shop/
   ```

4. Mover componentes existentes a nueva estructura:
   - `components/login/` -> `components/auth/login/`
   - `components/lobby/` -> `components/rooms/room-list/` (renombrar)
   - `components/tablero/` -> `components/game/tablero/`

5. Actualizar `app.routes.ts` con las nuevas rutas

6. Instalar dependencias necesarias:
   ```powershell
   npm install socket.io-client
   npm install @angular/forms
   ```
   (Angular Forms ya esta en package.json pero confirmar)

7. Crear `src/app/services/environment.ts` con URL base del backend:
   ```typescript
   export const environment = {
     apiUrl: 'http://localhost:3000/api',
     wsUrl: 'ws://localhost:3000',
     production: false
   };
   ```

8. Configurar estilos globales basicos en `styles.scss`

**Comandos Git:**
```powershell
git switch main
git pull origin main
git switch -c chore/cleanup-and-setup
# ... hacer cambios ...
git add .
git commit -m "chore: reorganizar estructura, corregir imports rotos, preparar carpetas"
git push -u origin chore/cleanup-and-setup
# Abrir PR -> merge -> borrar rama
```

---

### FASE 1 - MODELOS Y SERVICIOS BASE (3-4 horas)

**Objetivo:** Tener todos los tipos TypeScript y servicios mock listos para que las pantallas los consuman.

---

#### JUAN: Modelos + Auth Service + API Service

**Rama:** `feature/auth-service-juan`

**Tarea 1: Separar modelos en ficheros**

Crear `src/app/models/user.model.ts`:
```typescript
export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  monedas: number;
  exp: number;
  nivel: number;
  partidasJugadas: number;
  partidasGanadas: number;
  ranking: number;
  eloRating: number;
  avatar: string;
  reverso: string;
  tapete: string;
}

export interface Inventario {
  avatares: string[];
  reversos: string[];
  tapetes: string[];
}

export interface CredencialesLogin {
  email: string;
  contrasena: string;
}

export interface CredencialesRegistro {
  nombre: string;
  email: string;
  contrasena: string;
}

export interface RespuestaAuth {
  token: string;
  usuario: Usuario;
}
```

Crear `src/app/models/room.model.ts`:
```typescript
export interface SalaConfig {
  nombre: string;
  maxJugadores: number;
  barajas: 1 | 2;
  modoJuego: 'tradicional' | 'extremo';
  reglasEspeciales: boolean[];
  esPrivada: boolean;
  codigo?: string;
}

export interface Sala {
  id: string;
  config: SalaConfig;
  jugadores: JugadorSala[];
  estado: 'waiting' | 'playing' | 'finished';
  creadorId: string;
}

export interface JugadorSala {
  id: string;
  nombre: string;
  avatar: string;
  estaListo: boolean;
}

export interface FiltroSalas {
  modoJuego?: 'tradicional' | 'extremo';
  maxJugadores?: number;
  soloDisponibles?: boolean;
}
```

Crear `src/app/models/shop.model.ts`:
```typescript
export type TipoSkin = 'avatar' | 'reverso' | 'tapete' | 'animacion';

export interface Skin {
  id: string;
  nombre: string;
  tipo: TipoSkin;
  precio: number;
  urlImagen: string;
  esPoseida: boolean;
  estaEquipada: boolean;
}

export interface CompraResultado {
  exito: boolean;
  monedasRestantes: number;
  mensaje: string;
}
```

Mantener `src/app/models/game.model.ts` (renombrar de `game.ts`):
```typescript
// Mantener las interfaces Carta, Jugador, EstadoPartida
// pero actualizar para alinear con backend:

export interface Carta {
  id: string;
  palo: 'hearts' | 'diamonds' | 'clubs' | 'spades' | 'joker';
  valor: string;
  estaVisible: boolean;
  tieneEscudo: boolean;
}

export interface Jugador {
  id: string;
  idUsuario: string;
  nombre: string;
  avatar: string;
  cartas: Carta[];
  puntos: number | null;    // null si no reveladas
  estaSilenciado: boolean;
  estaEnsordecido: boolean;
  estaConectado: boolean;
}

export interface EstadoPartida {
  idSala: string;
  turnoActual: string;
  cartasRestantesMazo: number;
  ultimoDescarte: Carta | null;
  pilaDescarte: Carta[];
  tiempoRestante: number;
  fase: 'waiting' | 'dealing' | 'playing' | 'lastRound' | 'reveal' | 'finished';
  jugadorCuadrado: string | null;
  rondaExtra: boolean;
  jugadores: Jugador[];
  modoJuego: 'tradicional' | 'extremo';
}

export type AccionJuego =
  | { tipo: 'robar_mazo' }
  | { tipo: 'robar_descarte' }
  | { tipo: 'descartar'; cartaId: string }
  | { tipo: 'intercambiar'; cartaPropiaIdx: number }
  | { tipo: 'decir_cuadrado' }
  | { tipo: 'usar_habilidad'; habilidad: string; objetivo?: string; cartaIdx?: number }
  | { tipo: 'lanzar_encima'; cartaPropiaIdx: number };
```

Crear barrel export `src/app/models/index.ts`:
```typescript
export * from './user.model';
export * from './game.model';
export * from './room.model';
export * from './shop.model';
```

**Tarea 2: Auth Service completo**

Crear `src/app/services/auth.service.ts`:
```typescript
import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from './environment';
import { Usuario, CredencialesLogin, CredencialesRegistro, RespuestaAuth } from '../models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private _usuario = signal<Usuario | null>(null);
  private _token = signal<string | null>(null);

  usuario = this._usuario.asReadonly();
  estaAutenticado = computed(() => !!this._token());

  constructor(private http: HttpClient, private router: Router) {
    const tokenGuardado = localStorage.getItem('token');
    const usuarioGuardado = localStorage.getItem('usuario');
    if (tokenGuardado && usuarioGuardado) {
      this._token.set(tokenGuardado);
      this._usuario.set(JSON.parse(usuarioGuardado));
    }
  }

  async login(credenciales: CredencialesLogin): Promise<void> {
    // TODO: Reemplazar mock por llamada real cuando backend este listo
    // this.http.post<RespuestaAuth>(`${environment.apiUrl}/auth/login`, credenciales)
    const mockResponse: RespuestaAuth = {
      token: 'mock-jwt-token-123',
      usuario: {
        id: '1', nombre: 'Ruben', email: credenciales.email,
        monedas: 500, exp: 0, nivel: 1,
        partidasJugadas: 0, partidasGanadas: 0,
        ranking: 0, eloRating: 1000,
        avatar: 'default', reverso: 'default', tapete: 'default'
      }
    };
    this._token.set(mockResponse.token);
    this._usuario.set(mockResponse.usuario);
    localStorage.setItem('token', mockResponse.token);
    localStorage.setItem('usuario', JSON.stringify(mockResponse.usuario));
  }

  async registrar(credenciales: CredencialesRegistro): Promise<void> {
    // TODO: llamada real al backend
    await this.login({ email: credenciales.email, contrasena: credenciales.contrasena });
  }

  logout(): void {
    this._token.set(null);
    this._usuario.set(null);
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return this._token();
  }
}
```

**Tarea 3: Auth Guard**

Crear `src/app/guards/auth.guard.ts`:
```typescript
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.estaAutenticado()) return true;
  router.navigate(['/login']);
  return false;
};
```

**Tarea 4: Auth Interceptor**

Crear `src/app/interceptors/auth.interceptor.ts`:
```typescript
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).getToken();
  if (token) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(req);
};
```

**Comandos Git:**
```powershell
git switch main
git pull origin main
git switch -c feature/auth-service-juan
# ... implementar todo lo anterior ...
git add .
git commit -m "feat(auth): modelos tipados, auth service con mock, guard e interceptor"
git push -u origin feature/auth-service-juan
# Abrir PR -> Ruben revisa -> merge
```

---

#### RUBEN: WebSocket Service + Game Service

**Rama:** `feature/game-services-ruben`

**IMPORTANTE:** Esperar a que la Fase 0 este mergeada. No hace falta esperar a Juan.

**Tarea 1: WebSocket Service**

Crear `src/app/services/websocket.service.ts`:
```typescript
import { Injectable, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { environment } from './environment';
import { EstadoPartida, AccionJuego } from '../models';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private socket: Socket | null = null;

  estaConectado = signal(false);

  // Streams de eventos del servidor
  estadoPartida$ = new Subject<EstadoPartida>();
  mensajeChat$ = new Subject<{ jugadorId: string; texto: string; timestamp: number }>();
  error$ = new Subject<string>();
  jugadorConectado$ = new Subject<string>();
  jugadorDesconectado$ = new Subject<string>();

  conectar(token: string, salaId: string): void {
    if (this.socket?.connected) return;

    this.socket = io(environment.wsUrl, {
      auth: { token },
      query: { salaId },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    this.socket.on('connect', () => this.estaConectado.set(true));
    this.socket.on('disconnect', () => this.estaConectado.set(false));

    this.socket.on('estado_partida', (estado: EstadoPartida) => {
      this.estadoPartida$.next(estado);
    });

    this.socket.on('mensaje_chat', (msg) => this.mensajeChat$.next(msg));
    this.socket.on('jugador_conectado', (id) => this.jugadorConectado$.next(id));
    this.socket.on('jugador_desconectado', (id) => this.jugadorDesconectado$.next(id));
    this.socket.on('error', (err) => this.error$.next(err));
  }

  enviarAccion(accion: AccionJuego): void {
    this.socket?.emit('accion_juego', accion);
  }

  enviarMensaje(texto: string): void {
    this.socket?.emit('mensaje_chat', { texto });
  }

  desconectar(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.estaConectado.set(false);
  }
}
```

**Tarea 2: Game Service completo**

Reescribir `src/app/services/game.service.ts`:
```typescript
import { Injectable, signal, computed } from '@angular/core';
import { WebSocketService } from './websocket.service';
import { AuthService } from './auth.service';
import {
  EstadoPartida, Jugador, Carta, AccionJuego
} from '../models';

@Injectable({ providedIn: 'root' })
export class GameService {
  private _estado = signal<EstadoPartida | null>(null);

  estado = this._estado.asReadonly();
  jugadores = computed(() => this._estado()?.jugadores ?? []);
  fase = computed(() => this._estado()?.fase ?? 'waiting');
  esMiTurno = computed(() => {
    const e = this._estado();
    const u = this.auth.usuario();
    if (!e || !u) return false;
    const yo = e.jugadores.find(j => j.idUsuario === u.id);
    return yo?.id === e.turnoActual;
  });
  miJugador = computed(() => {
    const e = this._estado();
    const u = this.auth.usuario();
    if (!e || !u) return null;
    return e.jugadores.find(j => j.idUsuario === u.id) ?? null;
  });

  constructor(
    private ws: WebSocketService,
    private auth: AuthService
  ) {
    this.ws.estadoPartida$.subscribe(estado => {
      this._estado.set(estado);
    });
  }

  unirseAPartida(salaId: string): void {
    const token = this.auth.getToken();
    if (token) this.ws.conectar(token, salaId);
  }

  ejecutarAccion(accion: AccionJuego): void {
    if (!this.esMiTurno()) return;
    this.ws.enviarAccion(accion);
  }

  robarDelMazo(): void {
    this.ejecutarAccion({ tipo: 'robar_mazo' });
  }

  robarDelDescarte(): void {
    this.ejecutarAccion({ tipo: 'robar_descarte' });
  }

  descartarCarta(cartaId: string): void {
    this.ejecutarAccion({ tipo: 'descartar', cartaId });
  }

  intercambiarCarta(idx: number): void {
    this.ejecutarAccion({ tipo: 'intercambiar', cartaPropiaIdx: idx });
  }

  decirCuadrado(): void {
    this.ejecutarAccion({ tipo: 'decir_cuadrado' });
  }

  usarHabilidad(habilidad: string, objetivo?: string, cartaIdx?: number): void {
    this.ejecutarAccion({ tipo: 'usar_habilidad', habilidad, objetivo, cartaIdx });
  }

  lanzarEncima(cartaIdx: number): void {
    this.ejecutarAccion({ tipo: 'lanzar_encima', cartaPropiaIdx: cartaIdx });
  }

  salirDePartida(): void {
    this.ws.desconectar();
    this._estado.set(null);
  }

  // --- MOCK para desarrollo sin backend ---
  private readonly PALOS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
  private readonly VALORES = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

  cargarPartidaMock(numJugadores: number = 4): void {
    const jugadores: Jugador[] = Array.from({ length: numJugadores }, (_, i) => ({
      id: String(i + 1),
      idUsuario: i === 0 ? (this.auth.usuario()?.id ?? '1') : String(1000 + i),
      nombre: i === 0 ? (this.auth.usuario()?.nombre ?? 'Yo') : `Bot ${i}`,
      avatar: 'default',
      cartas: Array.from({ length: 4 }, () => this.cartaRandom()),
      puntos: null,
      estaSilenciado: false,
      estaEnsordecido: false,
      estaConectado: true,
    }));

    this._estado.set({
      idSala: 'mock-sala-1',
      turnoActual: '1',
      cartasRestantesMazo: 44,
      ultimoDescarte: this.cartaRandom(true),
      pilaDescarte: [],
      tiempoRestante: 30,
      fase: 'playing',
      jugadorCuadrado: null,
      rondaExtra: false,
      jugadores,
      modoJuego: 'tradicional',
    });
  }

  private cartaRandom(visible = false): Carta {
    return {
      id: crypto.randomUUID(),
      palo: this.PALOS[Math.floor(Math.random() * 4)],
      valor: this.VALORES[Math.floor(Math.random() * 13)],
      estaVisible: visible,
      tieneEscudo: false,
    };
  }
}
```

**Comandos Git:**
```powershell
git switch main
git pull origin main
git switch -c feature/game-services-ruben
# ... implementar ...
git add .
git commit -m "feat(game): websocket service y game service con logica de partida"
git push -u origin feature/game-services-ruben
# Abrir PR -> Juan revisa -> merge
```

---

### FASE 2 - PANTALLAS DE AUTH (4-5 horas)

**Objetivo:** Login real con formulario, registro, y navegacion protegida.

---

#### JUAN: Login + Registro + Forgot Password

**Rama:** `feature/auth-screens-juan`

**Ficheros a crear/modificar:**

1. `src/app/components/auth/login/login.ts` - Componente con formulario reactivo
2. `src/app/components/auth/login/login.html` - Template con inputs email/password
3. `src/app/components/auth/login/login.scss` - Estilos
4. `src/app/components/auth/register/register.ts` - Componente registro
5. `src/app/components/auth/register/register.html`
6. `src/app/components/auth/register/register.scss`
7. `src/app/components/auth/forgot-password/forgot-password.ts`
8. `src/app/components/auth/forgot-password/forgot-password.html`
9. `src/app/components/auth/forgot-password/forgot-password.scss`

**Funcionalidad Login:**
- Formulario con email y contrasena (ReactiveFormsModule)
- Validacion: email requerido y formato, contrasena minimo 6 chars
- Boton "Iniciar sesion" -> llama AuthService.login()
- Link "Crear cuenta" -> navega a /register
- Link "Olvidaste contrasena?" -> navega a /forgot-password
- Feedback de error si falla login
- Redirige a /home si ya esta autenticado

**Funcionalidad Registro:**
- Formulario: nombre, email, contrasena, confirmar contrasena
- Validaciones: nombre requerido, email formato, contrasenas coinciden
- Boton "Registrarse" -> llama AuthService.registrar()
- Link "Ya tengo cuenta" -> navega a /login

**Funcionalidad Forgot Password:**
- Input de email
- Boton "Enviar enlace"
- Mensaje de confirmacion
- Link volver a login

**Actualizar `app.routes.ts`:**
```typescript
{ path: 'login', component: Login },
{ path: 'register', component: Register },
{ path: 'forgot-password', component: ForgotPassword },
{ path: 'home', component: Home, canActivate: [authGuard] },
// ... resto de rutas protegidas con authGuard ...
{ path: '', redirectTo: '/login', pathMatch: 'full' },
```

---

#### RUBEN: Componente Card + PlayerSlot (compartidos)

**Rama:** `feature/shared-components-ruben`

**Ficheros a crear:**

1. `src/app/components/shared/card/card.ts`
2. `src/app/components/shared/card/card.html`
3. `src/app/components/shared/card/card.scss`
4. `src/app/components/shared/player-slot/player-slot.ts`
5. `src/app/components/shared/player-slot/player-slot.html`
6. `src/app/components/shared/player-slot/player-slot.scss`

**Componente Card:**
- Input: `carta: Carta`
- Input: `tamano: 'sm' | 'md' | 'lg'`
- Input: `seleccionable: boolean`
- Output: `click` event
- Muestra: palo + valor si visible, reverso si no visible
- Animacion flip al revelar
- Indicador de escudo si `tieneEscudo`

**Componente PlayerSlot:**
- Input: `jugador: Jugador`
- Input: `esTurnoActual: boolean`
- Input: `esMio: boolean`
- Muestra: avatar, nombre, 4 cartas (boca abajo normalmente), indicador turno
- Glow/borde si es su turno
- Opacity reducida si desconectado

---

### FASE 3 - PANTALLA PRINCIPAL Y NAVEGACION (4-5 horas)

**Objetivo:** Menu principal funcional desde el que acceder a todo.

---

#### JUAN: Home + Header + Rutas completas

**Rama:** `feature/home-navigation-juan`

**Home (`components/main-menu/home/`):**
- Titulo "Cuadrado"
- Boton "Jugar" -> navega a /rooms
- Boton "Tienda" -> navega a /shop
- Boton "Perfil" -> navega a /profile
- Boton "Ranking" -> navega a /ranking
- Boton "Reglas" -> navega a /rules
- Boton "Ajustes" -> navega a /settings
- Mostrar monedas y nivel del usuario (desde AuthService.usuario())
- Boton logout en esquina

**Header (`components/shared/header/`):**
- Nombre usuario + avatar
- Monedas
- Boton volver
- Se usa en todas las pantallas excepto login y tablero

**Actualizar `app.routes.ts` completo:**
```typescript
export const routes: Routes = [
  { path: 'login', component: Login },
  { path: 'register', component: Register },
  { path: 'forgot-password', component: ForgotPassword },
  { path: 'home', component: Home, canActivate: [authGuard] },
  { path: 'profile', component: Profile, canActivate: [authGuard] },
  { path: 'customize', component: Customize, canActivate: [authGuard] },
  { path: 'inventory', component: Inventory, canActivate: [authGuard] },
  { path: 'settings', component: Settings, canActivate: [authGuard] },
  { path: 'rules', component: Rules, canActivate: [authGuard] },
  { path: 'ranking', component: Ranking, canActivate: [authGuard] },
  { path: 'rooms', component: RoomList, canActivate: [authGuard] },
  { path: 'rooms/create', component: CreateRoom, canActivate: [authGuard] },
  { path: 'rooms/:id/wait', component: WaitingRoom, canActivate: [authGuard] },
  { path: 'game/:id', component: Tablero, canActivate: [authGuard] },
  { path: 'game/:id/over', component: GameOver, canActivate: [authGuard] },
  { path: 'shop', component: Shop, canActivate: [authGuard] },
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: '**', redirectTo: '/login' }
];
```

---

#### RUBEN: Tablero de juego (estructura visual)

**Rama:** `feature/tablero-layout-ruben`

**Tablero (`components/game/tablero/`):**
- Layout de mesa de juego:
  - Centro: mazo + pila de descarte
  - Alrededor: PlayerSlots distribuidos (2-8 jugadores)
  - Abajo: mis cartas (mas grandes, interactivas)
  - Panel lateral: chat, botones de accion
  - Barra superior: temporizador, fase, boton pausa
- Integracion con GameService:
  - Se subscribe a `gameService.estado`
  - Muestra jugadores con PlayerSlot
  - Muestra cartas propias con Card
  - Botones: robar mazo, robar descarte, decir cuadrado
- Inicialmente usar `gameService.cargarPartidaMock()` para desarrollo visual

**Estructura del template:**
```
+----------------------------------------------+
|  Timer  |  Fase: Jugando  |  [Pausa]         |
+----------------------------------------------+
|              Jugador 3                        |
|         [?][?][?][?]                          |
|                                               |
| Jugador 2      [MAZO][DESCARTE]    Jugador 4  |
| [?][?][?][?]                       [?][?][?][?]|
|                                               |
|              Jugador 1 (YO)                   |
|         [carta1][carta2][carta3][carta4]      |
|                                               |
| [Robar Mazo] [Robar Descarte] [CUADRADO!]    |
+----------------------------------------------+
|  Chat: ...                                    |
+----------------------------------------------+
```

---

### FASE 4 - SISTEMA DE SALAS (5-6 horas)

**Objetivo:** Poder crear, listar, filtrar y unirse a salas.

---

#### JUAN: Room Service + Crear Sala + Listar Salas + Espera

**Rama:** `feature/rooms-juan`

**Room Service (`services/room.service.ts`):**
```typescript
// Metodos:
// crearSala(config: SalaConfig): Observable<Sala>
// listarSalas(filtro?: FiltroSalas): Observable<Sala[]>
// unirseSala(salaId: string, codigo?: string): Observable<Sala>
// salirSala(salaId: string): Observable<void>
// marcarListo(salaId: string): Observable<void>
// iniciarPartida(salaId: string): Observable<void>
```
Implementar con datos mock inicialmente.

**Crear Sala (`components/rooms/create-room/`):**
- Formulario:
  - Nombre de sala (texto)
  - Max jugadores (selector 2-8)
  - Numero de barajas (1 o 2, si >6 jugadores forzar 2)
  - Modo de juego (tradicional/extremo)
  - Reglas especiales (checkboxes por carta)
  - Publica/Privada (toggle)
  - Codigo (si privada, autogenerado)
- Boton "Crear sala" -> roomService.crearSala() -> navegar a waiting room

**Lista de Salas (`components/rooms/room-list/`):**
- Lista de salas disponibles (salas en estado 'waiting')
- Filtros: modo de juego, numero de jugadores
- Cada sala muestra: nombre, jugadores/max, modo, boton "Unirse"
- Campo de codigo para salas privadas
- Boton "Crear sala" -> navega a /rooms/create

**Sala de Espera (`components/rooms/waiting-room/`):**
- Muestra configuracion de la sala
- Lista de jugadores conectados con su estado (listo/no listo)
- Boton "Estoy listo"
- Boton "Iniciar partida" (solo creador, solo si todos listos y min 2)
- Boton "Salir"
- Se actualiza en tiempo real via WebSocket

---

#### RUBEN: Logica de juego en tablero + Chat

**Rama:** `feature/tablero-logic-ruben`

**Completar tablero con logica:**
- Maquina de estados del turno:
  1. Esperar turno
  2. Robar carta (mazo o descarte)
  3. Decidir: descartar o intercambiar
  4. Si carta especial y se descarta: activar habilidad
  5. Fin turno
- Implementar cada habilidad especial como dialogo/popup:
  - 10: Popup "Elige una de tus cartas para ver"
  - J: Popup "Ve tu carta y una del rival, decide si intercambiar"
  - Modo extremo: A, 2, 3, 4, 5, 6, 7, 8, 9 (cada una con su popup)
- Mecanica "lanzar encima": detectar carta descartada, popup rapido "Tienes esta carta? Lanzar!"
- Boton "CUADRADO!" siempre visible, con confirmacion

**Chat (`components/shared/chat/`):**
- Panel lateral/inferior en tablero
- Input de texto + boton enviar
- Lista de mensajes con nombre y hora
- Se conecta a WebSocketService.mensajeChat$

---

### FASE 5 - PERFIL, TIENDA, RANKING (4-5 horas)

---

#### JUAN: Perfil + Tienda + Ranking

**Rama:** `feature/profile-shop-ranking-juan`

**Perfil (`components/main-menu/profile/`):**
- Avatar grande
- Nombre editable
- Estadisticas: partidas jugadas, ganadas, ratio, ELO
- Cubitos (monedas)
- Boton "Personalizar" -> /customize
- Boton "Inventario" -> /inventory

**Personalizar (`components/main-menu/customize/`):**
- Selector de avatar (de los que tiene en inventario)
- Selector de reverso de cartas
- Selector de tapete
- Preview en tiempo real
- Boton guardar

**Inventario (`components/main-menu/inventory/`):**
- Tabs: Avatares, Reversos, Tapetes, Animaciones
- Grid de items con indicador "equipado" / "disponible"
- Click para equipar

**Tienda (`components/shop/shop/`):**
- Tabs por categoria (mismas que inventario)
- Grid de items con precio
- Boton comprar (con confirmacion)
- Mostrar monedas actuales
- Items ya comprados marcados

**Ranking (`components/main-menu/ranking/`):**
- Tabla con: posicion, nombre, ELO, partidas ganadas
- Destacar mi posicion
- Paginacion o scroll infinito

---

#### RUBEN: Game Over + Pausa + Ajustes

**Rama:** `feature/gameover-pause-ruben`

**Game Over (`components/game/game-over/`):**
- Mostrar resultado: ganador, perdedor
- Tabla de puntuacion de cada jugador (cartas reveladas + puntos)
- Animacion victoria/derrota
- Monedas/EXP ganadas
- Botones: "Volver al lobby", "Jugar otra vez"

**Pausa (`components/game/pause/`):**
- Overlay sobre el tablero
- Opciones: "Continuar", "Ajustes", "Abandonar partida"
- Si abandona: confirmacion + penalizacion

**Ajustes (`components/main-menu/settings/`):**
- Volumen musica / efectos (sliders)
- Notificaciones on/off
- Idioma (si aplica)
- Cerrar sesion

---

### FASE 6 - INTEGRACION CON BACKEND REAL (variable, depende del backend)

**Objetivo:** Reemplazar todos los mocks por llamadas reales.

**Prerequisito:** El equipo de backend debe tener endpoints listos.

---

#### Ambos: Reemplazar mocks progresivamente

**Proceso por cada servicio:**

1. Pedir al equipo de backend la especificacion del endpoint (URL, metodo, body, respuesta)
2. Crear rama: `feature/integrate-auth-real-<nombre>`
3. En el servicio, quitar el mock y poner la llamada HTTP real
4. Probar con Postman/Thunder Client que el endpoint responde
5. Probar en la app
6. PR y merge

**Orden de integracion recomendado:**
1. Auth (login, registro) - critico, todo depende de esto
2. Perfil de usuario (GET /users/me)
3. Salas (CRUD de salas)
4. WebSocket (unirse a partida, recibir estado)
5. Tienda (listar skins, comprar)
6. Ranking (GET /ranking)

---

### FASE 7 - PULIDO FINAL (3-4 horas)

---

#### Ambos:

- Pantalla de carga (spinner animado entre navegaciones)
- Pantalla sin conexion (detector de navigator.onLine)
- Reglas / Tutorial (pantalla con las reglas del juego, cartas especiales, etc.)
- Animaciones CSS (flip de cartas, transiciones de pantalla)
- Responsive (aunque es desktop, minimo 1024px)
- Tests unitarios basicos (al menos servicios)
- Limpieza de console.log, TODOs, etc.

---

## RESUMEN DE RAMAS (en orden cronologico)

| Orden | Rama | Quien | Depende de |
|-------|------|-------|------------|
| 1 | `chore/cleanup-and-setup` | Cualquiera | - |
| 2a | `feature/auth-service-juan` | Juan | #1 |
| 2b | `feature/game-services-ruben` | Ruben | #1 |
| 3a | `feature/auth-screens-juan` | Juan | #2a |
| 3b | `feature/shared-components-ruben` | Ruben | #2b |
| 4a | `feature/home-navigation-juan` | Juan | #3a |
| 4b | `feature/tablero-layout-ruben` | Ruben | #3b |
| 5a | `feature/rooms-juan` | Juan | #4a |
| 5b | `feature/tablero-logic-ruben` | Ruben | #4b |
| 6a | `feature/profile-shop-ranking-juan` | Juan | #5a |
| 6b | `feature/gameover-pause-ruben` | Ruben | #5b |
| 7 | `feature/integrate-*` | Ambos | #6a + #6b |
| 8 | `chore/polish-*` | Ambos | #7 |

---

## ESTIMACION DE TIEMPO TOTAL

| Fase | Horas estimadas | Comentario |
|------|-----------------|------------|
| Fase 0 | 1-2h | Setup rapido |
| Fase 1 | 3-4h | Modelos y servicios base |
| Fase 2 | 4-5h | Auth screens + shared components |
| Fase 3 | 4-5h | Home + Tablero visual |
| Fase 4 | 5-6h | Salas + Logica juego |
| Fase 5 | 4-5h | Perfil, tienda, ranking + game over |
| Fase 6 | Variable | Depende del backend |
| Fase 7 | 3-4h | Pulido |
| **TOTAL** | **~25-35h por persona** | |

---

## CHECKLIST RAPIDO ANTES DE CADA PR

- [ ] Compila sin errores (`ng build`)
- [ ] No hay console.log de debug
- [ ] Tipos correctos (no `any`)
- [ ] Componente tiene scss basico (no tiene que ser bonito aun)
- [ ] Rutas actualizadas si se anadio componente nuevo
- [ ] El otro lo ha revisado

---

## COMO USAR ESTE DOCUMENTO

1. Leed la FASE 0 juntos y hacedla.
2. Cada uno coge su parte de la FASE 1 (en paralelo).
3. Cuando ambos mergeen FASE 1, pasais a FASE 2 (en paralelo).
4. Repetid hasta FASE 7.
5. Antes de cada fase, re-leed vuestras tareas aqui.
6. Si surgen dudas, anotadlas aqui mismo o en un issue de GitHub.
