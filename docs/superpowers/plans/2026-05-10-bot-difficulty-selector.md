# Bot Difficulty Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir un selector de dificultad de bots (Fácil / Normal / Difícil) en los ajustes de creación de sala, visible únicamente cuando "Rellenar con bots" está activado, y enviarlo correctamente al backend vía WebSocket.

**Architecture:** Se añade un signal `dificultadBots` al componente `CreateRoom`, se expone en el template con un selector condicional reutilizando los estilos de `turn-time-btn`, y se extiende la interfaz `RoomRules` del servicio WebSocket para incluir el campo. La llamada `ws.createRoom()` ya existente pasa a incluir el nuevo campo; el backend ya lo acepta y usa.

**Tech Stack:** Angular 21 (signals, `@if`), TypeScript, Jasmine/Karma (tests), Socket.io client.

---

## File Map

| Archivo | Acción | Responsabilidad |
|---------|--------|----------------|
| `src/app/services/websocket.ts` | Modificar | Añadir `dificultadBots?` a `RoomRules` |
| `src/app/components/create-room/create-room.ts` | Modificar | Signal + mapeo + payload a `crearSala()` |
| `src/app/components/create-room/create-room.html` | Modificar | UI condicional del selector |
| `src/app/components/create-room/create-room.spec.ts` | Crear | Tests del componente |

---

## Task 1: Ampliar `RoomRules` en websocket.ts

**Files:**
- Modify: `src/app/services/websocket.ts` (interfaz `RoomRules`, líneas ~154-161)

- [ ] **Step 1: Añadir `dificultadBots` a `RoomRules`**

Localiza la interfaz `RoomRules` (actualmente sin el campo) y añade el campo opcional:

```typescript
export interface RoomRules {
  maxPlayers: number;
  turnTimeSeconds: number;
  isPrivate: boolean;
  fillWithBots: boolean;
  dificultadBots?: 'facil' | 'media' | 'dificil';
  enabledPowers?: string[];
  deckCount?: number;
}
```

- [ ] **Step 2: Verificar compilación**

```bash
npx tsc --noEmit
```

Expected: sin errores relacionados con `RoomRules`.

- [ ] **Step 3: Commit**

```bash
git add src/app/services/websocket.ts
git commit -m "feat: add dificultadBots to RoomRules interface"
```

---

## Task 2: Añadir signal y lógica en `create-room.ts`

**Files:**
- Modify: `src/app/components/create-room/create-room.ts`

- [ ] **Step 1: Añadir signal `dificultadBots`**

En la sección de signals del componente (junto a `fillWithBots`), añade:

```typescript
dificultadBots = signal<'facil' | 'media' | 'dificil'>('media');
```

- [ ] **Step 2: Exponer opciones de dificultad como constante**

Justo después de `readonly turnTimeOptions`, añade:

```typescript
readonly dificultadOptions: { value: 'facil' | 'media' | 'dificil'; label: string }[] = [
  { value: 'facil',   label: 'Fácil' },
  { value: 'media',   label: 'Normal' },
  { value: 'dificil', label: 'Difícil' },
];
```

- [ ] **Step 3: Actualizar `crearSala()` — payload al backend**

En `crearSala()`, dentro de la llamada `this.ws.createRoom(nombreSala, { ... })`, añade el campo `dificultadBots` (solo cuando hay bots):

```typescript
const resp = await this.ws.createRoom(nombreSala, {
  maxPlayers: this.maxJugadores(),
  turnTimeSeconds: this.turnTime(),
  isPrivate: !this.esPublica(),
  fillWithBots: this.fillWithBots(),
  dificultadBots: this.fillWithBots() ? this.dificultadBots() : undefined,
  enabledPowers: reglasActivas,
  deckCount: this.numBarajas(),
});
```

- [ ] **Step 4: Actualizar `crearSala()` — `SalaData` local**

En la construcción del objeto `sala` (tipo `SalaData`), reemplaza el valor hardcodeado `dificultadBots: 'Normal'` por un mapeo desde el signal:

```typescript
const mapaDisplay: Record<'facil' | 'media' | 'dificil', 'Fácil' | 'Normal' | 'Difícil'> = {
  facil: 'Fácil',
  media: 'Normal',
  dificil: 'Difícil',
};

const sala: SalaData = {
  // ...resto igual...
  dificultadBots: mapaDisplay[this.dificultadBots()],
  // ...
};
```

Declara `mapaDisplay` dentro de `crearSala()`, justo antes de construir `sala`.

- [ ] **Step 5: Verificar compilación**

```bash
npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/app/components/create-room/create-room.ts
git commit -m "feat: add dificultadBots signal and wire to crearSala payload"
```

---

## Task 3: Añadir selector de dificultad en el template

**Files:**
- Modify: `src/app/components/create-room/create-room.html`

- [ ] **Step 1: Insertar el bloque condicional después del toggle de bots**

El toggle "Rellenar con bots" termina alrededor de la línea 59 (`</div>` del `config-field`). Inserta inmediatamente después:

```html
<!-- Dificultad de bots — visible solo si fillWithBots está activo -->
@if (fillWithBots()) {
  <div class="config-field">
    <label class="config-label">Dificultad de los bots</label>
    <div class="turn-time-row">
      @for (op of dificultadOptions; track op.value) {
        <button class="turn-time-btn"
                [class.turn-time-btn--active]="dificultadBots() === op.value"
                (click)="dificultadBots.set(op.value)">
          {{ op.label }}
        </button>
      }
    </div>
  </div>
}
```

Reutiliza las clases `turn-time-row`, `turn-time-btn` y `turn-time-btn--active` ya definidas en el SCSS — no hay que añadir nuevos estilos.

- [ ] **Step 2: Verificar compilación del template**

```bash
npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 3: Verificar visual en el navegador**

Arranca el servidor de desarrollo:

```bash
npm run start
```

1. Navega a `/create-room` (debes estar logueado).
2. El selector de dificultad NO debe aparecer cuando "Rellenar con bots" está desactivado.
3. Al activar el toggle, aparecen los 3 botones: **Fácil / Normal / Difícil**. Normal está activo por defecto.
4. Pulsar cada botón cambia el activo visualmente.
5. Desactivar el toggle hace desaparecer el selector.

- [ ] **Step 4: Commit**

```bash
git add src/app/components/create-room/create-room.html
git commit -m "feat: show bot difficulty selector when fillWithBots is enabled"
```

---

## Task 4: Tests del componente `CreateRoom`

**Files:**
- Create: `src/app/components/create-room/create-room.spec.ts`

- [ ] **Step 1: Crear el spec con los providers mínimos**

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { CreateRoom } from './create-room';
import { AuthService } from '../../services/auth';
import { RoomService } from '../../services/room';
import { WebsocketService } from '../../services/websocket';

describe('CreateRoom — dificultad de bots', () => {
  let component: CreateRoom;
  let fixture: ComponentFixture<CreateRoom>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreateRoom],
      providers: [
        { provide: AuthService,     useValue: { usuario: () => ({ nombre: 'Test' }), getToken: () => 'tok' } },
        { provide: RoomService,     useValue: { generarCodigo: () => 'ABC123', guardarSala: () => {}, setEsAnfitrion: () => {} } },
        { provide: WebsocketService, useValue: { conectarYEsperar: () => Promise.resolve(), leaveRoomAck: () => Promise.resolve(), createRoom: () => Promise.resolve({ success: false }), estaConectado: () => false } },
        { provide: ActivatedRoute,  useValue: { snapshot: { queryParamMap: { get: () => null } } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateRoom);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
```

- [ ] **Step 2: Test — dificultad por defecto es "media"**

Añade dentro del `describe`:

```typescript
  it('defaults dificultadBots to media', () => {
    expect(component.dificultadBots()).toBe('media');
  });
```

- [ ] **Step 3: Test — el selector solo aparece cuando fillWithBots está activo**

```typescript
  it('does not render difficulty selector when fillWithBots is false', () => {
    component.fillWithBots.set(false);
    fixture.detectChanges();
    const selector = fixture.nativeElement.querySelector('.turn-time-row');
    // El turn-time-row del tiempo por turno siempre existe;
    // el de dificultad solo aparece con bots activos.
    // Contamos: sin bots → 1 fila (tiempo), con bots → 2 filas.
    expect(fixture.nativeElement.querySelectorAll('.turn-time-row').length).toBe(1);
  });

  it('renders difficulty selector when fillWithBots is true', () => {
    component.fillWithBots.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.turn-time-row').length).toBe(2);
  });
```

- [ ] **Step 4: Test — cambiar dificultad actualiza el signal**

```typescript
  it('sets dificultadBots signal when a button is clicked', () => {
    component.fillWithBots.set(true);
    fixture.detectChanges();

    // Los botones del selector de dificultad están en el segundo .turn-time-row
    const rows = fixture.nativeElement.querySelectorAll('.turn-time-row');
    const diffRow = rows[1] as HTMLElement;
    const buttons = diffRow.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;

    // buttons[0] = Fácil, [1] = Normal, [2] = Difícil
    buttons[0].click();
    expect(component.dificultadBots()).toBe('facil');

    buttons[2].click();
    expect(component.dificultadBots()).toBe('dificil');
  });

});
```

- [ ] **Step 5: Ejecutar los tests**

```bash
npx ng test --include="**/create-room.spec.ts" --watch=false
```

Expected: 5 specs, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/app/components/create-room/create-room.spec.ts
git commit -m "test: add CreateRoom bot difficulty selector specs"
```

---

## Self-Review

### Spec coverage

| Requisito | Tarea |
|-----------|-------|
| Selector de dificultad visible solo con bots | Task 3, Step 1 |
| 3 niveles: Fácil / Normal / Difícil | Task 2 Step 2, Task 3 Step 1 |
| Llamada al backend con `dificultadBots` | Task 2 Step 3 |
| `SalaData` local actualizado correctamente | Task 2 Step 4 |
| Tests del comportamiento | Task 4 |

### Tipos consistentes

- `dificultadBots signal`: `'facil' | 'media' | 'dificil'` (backend) — Task 2 Step 1
- `RoomRules.dificultadBots?`: mismo tipo — Task 1 Step 1
- `SalaData.dificultadBots`: `'Fácil' | 'Normal' | 'Difícil'` (display) — mappeo en Task 2 Step 4
- `dificultadOptions` array generado en Task 2 Step 2, consumido en Task 3 Step 1 ✓
