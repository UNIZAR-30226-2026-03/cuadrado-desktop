# Implementación: Navegación Programática en Angular

## Resumen

Se implementó la navegación programática entre componentes usando el `Router` de Angular y el servicio `Auth` como singleton de estado, aplicando el patrón de **Inyección de Dependencias**.

---

## Cambios realizados

### 1. `src/app/app.routes.ts` — Corrección de importaciones

**Qué se hizo:** Se corrigieron los paths y los nombres de clase en las importaciones. El archivo original referenciaba rutas inexistentes (`login.component`, `lobby.component`, `tablero.component`) y nombres de clase incorrectos (`LoginComponent`, `LobbyComponent`, `TableroComponent`).

**Antes:**
```typescript
import { LoginComponent } from './components/login/login.component';
import { LobbyComponent } from './components/lobby/lobby.component';
import { TableroComponent } from './components/tablero/tablero.component';
```

**Después:**
```typescript
import { Login } from './components/login/login';
import { Lobby } from './components/lobby/lobby';
import { Tablero } from './components/tablero/tablero';
```

**Por qué:** Angular resuelve las rutas en tiempo de compilación. Si los paths o los nombres exportados no coinciden exactamente con los archivos reales, el compilador lanza un error y el enrutador no puede instanciar los componentes.

---

### 2. `src/app/services/auth.ts` — Método `login()` en el servicio

**Qué se hizo:** Se añadió un estado interno `_isLoggedIn` y dos métodos públicos: `login()` (que establece el estado a `true`) e `isLoggedIn()` (que permite consultarlo desde cualquier componente).

**Por qué:** El servicio está decorado con `providedIn: 'root'`, lo que significa que Angular crea **una única instancia** (Singleton) para toda la aplicación. Al guardar el estado de autenticación aquí, los datos sobreviven a la destrucción del componente de Login cuando el router-outlet lo reemplaza por otro componente. Si el estado se guardase dentro del propio componente `Login`, se perdería al navegarse a otra ruta.

---

### 3. `src/app/components/login/login.ts` — Controlador del Login

**Qué se hizo:**
- Se importaron `Router` (de `@angular/router`) y `Auth` (del servicio propio).
- Se inyectaron ambos en el constructor usando la sintaxis de parámetros privados de TypeScript.
- Se definió el método `onAcceder()` que orquesta las dos acciones: registrar el login en el servicio y ordenar la navegación.

```typescript
constructor(private _auth: Auth, private _router: Router) {}

onAcceder(): void {
  this._auth.login();        // Actualiza el estado en el Singleton
  this._router.navigate(['/lobby']); // Ordena al Router cambiar de vista
}
```

**Por qué usar Inyección de Dependencias:** En lugar de instanciar los servicios con `new Auth()`, Angular los provee desde su contenedor IoC. Esto garantiza que se usa la misma instancia Singleton del servicio en todos los componentes, y facilita el testing unitario (se puede sustituir la dependencia real por un mock).

**Por qué `this._router.navigate(['/lobby'])`:** El método `navigate` acepta un array de segmentos de ruta. Angular busca en `app.routes.ts` el path `'lobby'` y carga el componente `Lobby` dentro del `<router-outlet>`, sin recargar la página (SPA).

---

### 4. `src/app/components/login/login.html` — Vista del Login

**Qué se hizo:** Se sustituyó el placeholder `<p>login works!</p>` por una plantilla mínima con un botón conectado al método del controlador mediante **event binding**.

```html
<div class="login-container">
  <h1>Cuadrado</h1>
  <button (click)="onAcceder()">Acceder al lobby</button>
</div>
```

**Por qué la sintaxis `(click)="onAcceder()"`:** En Angular, los paréntesis indican un binding de **evento del DOM al controlador**. Cuando el navegador dispara el evento `click` sobre el botón, Angular ejecuta la expresión `onAcceder()` en el contexto de la instancia del componente. Esto es la contraparte del property binding `[property]="valor"` (que va del componente al DOM).

---

### 5. `src/app/app.ts` — Sin cambios necesarios

`RouterOutlet` ya estaba incluido en el array `imports` del componente raíz. Esta directiva es la que representa el `<router-outlet>` en el HTML principal y actúa como el contenedor dinámico donde Angular inserta y destruye componentes según la ruta activa.

---

## Flujo completo tras los cambios

```
Usuario hace clic en "Acceder al lobby"
        │
        ▼
(click) dispara onAcceder() en Login
        │
        ├─► Auth.login()  →  _isLoggedIn = true  (persiste en el Singleton)
        │
        └─► Router.navigate(['/lobby'])
                │
                ▼
        app.routes.ts busca path 'lobby'  →  componente Lobby
                │
                ▼
        <router-outlet> destruye Login, instancia y renderiza Lobby
```

---

## Conceptos clave aplicados

| Concepto | Descripción |
|---|---|
| **Singleton** | Una sola instancia de `Auth` compartida en toda la app |
| **Inyección de Dependencias** | Angular provee las instancias; el componente las declara, no las crea |
| **Event Binding** | `(evento)="método()"` conecta eventos DOM con lógica TypeScript |
| **Navegación programática** | `Router.navigate()` cambia la ruta desde código, sin `<a routerLink>` |
| **router-outlet** | Punto de montaje dinámico donde el Router intercambia componentes |
