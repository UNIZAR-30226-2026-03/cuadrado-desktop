# Workflow profesional (Ruben + Juan)

Este documento define el flujo de trabajo recomendado para `cuadrado-desktop` cuando sois 2 personas trabajando en paralelo.

Objetivos:
- Evitar solapamientos y conflictos.
- Tener trazabilidad clara (quien hizo que y por que).
- Mantener una rutina profesional, aunque cueste un poco mas.

---

## 1) Reglas base del equipo

1. Nadie trabaja directamente en `main`.
2. Cada tarea vive en una rama propia.
3. Todo cambio entra por Pull Request (PR), nunca por push directo a `main`.
4. PR pequena y revisable (ideal: 1 tarea, 1 objetivo).
5. Antes de empezar, se anuncia que archivos/carpeta vas a tocar.

Formato rapido de anuncio (chat):
- `Cojo tarea: Login service`
- `Rama: feature/login-service-ruben`
- `Tocare: src/app/services/auth.ts, src/app/services/auth.spec.ts`

---

## 2) Convencion de ramas (obligatoria)

- `feature/<tema>-<nombre>`
- `fix/<tema>-<nombre>`
- `chore/<tema>-<nombre>`

Ejemplos:
- `feature/login-service-ruben`
- `feature/game-api-juan`
- `fix/routing-guard-ruben`

---

## 3) Configuracion inicial (una sola vez por persona)

Ejecutar en PowerShell dentro de `cuadrado-desktop`:

```powershell
git config user.name "Tu Nombre"
git config user.email "tu-correo@ejemplo.com"
git remote -v
git fetch origin
git branch -a
```

Comprobar que existe `origin/main` y que no hay errores de autenticacion.

---

## 4) Rutina diaria (siempre igual)

### Paso A: Empezar el dia

```powershell
git switch main
git pull origin main
git status
```

`git status` debe quedar limpio antes de crear nueva rama.

### Paso B: Crear rama de tarea

```powershell
git switch -c feature/<tema>-<nombre>
```

Ejemplo:

```powershell
git switch -c feature/login-service-ruben
```

### Paso C: Trabajar y commitear en pequeno

```powershell
git status
git add <archivo1> <archivo2>
git commit -m "feat(auth): implementar servicio de login"
```

Repite add/commit en bloques pequenos.

### Paso D: Subir rama

```powershell
git push -u origin feature/<tema>-<nombre>
```

### Paso E: Abrir PR en GitHub

Regla de PR:
- Titulo: claro y corto.
- Descripcion: que cambia, por que, como probar.
- Reviewer: el otro companero (si Ruben abre, revisa Juan y viceversa).

---

## 5) Plantilla de PR (copiar/pegar)

```md
## Que cambia
- ...

## Por que
- ...

## Como probar
1. ...
2. ...

## Riesgos
- ...
```

---

## 6) Regla anti-solapamiento (muy importante)

Antes de empezar cada tarea, definid propietario temporal por zonas:

- Ruben: `src/app/services/**`
- Juan: `src/app/components/**`
- Compartido (coordinar antes): `src/app/app.routes.ts`, `src/app/models/**`

Si una tarea necesita tocar zona del otro:
1. Avisar por chat.
2. Acordar orden (quien mergea primero).
3. PR pequeno y rapido para liberar el fichero.

---

## 7) Como actualizar tu rama con cambios nuevos de main

Si `main` avanzo mientras trabajas:

```powershell
git fetch origin
git switch feature/<tema>-<nombre>
git merge origin/main
```

Resolver conflictos si aparecen, luego:

```powershell
git add .
git commit -m "chore: resolver conflictos con main"
git push
```

Nota: para aprender y mantenerlo simple, usar `merge` (no `rebase`) al principio.

---

## 8) Que hacer cuando hay conflictos

1. Ejecutar merge de `origin/main` en tu rama.
2. Abrir archivos en conflicto y decidir version final.
3. Verificar compilacion y tests.
4. `git add .` y commit de resolucion.
5. Push y avisar en PR que hubo conflicto resuelto.

Comandos utiles:

```powershell
git status
git diff
git diff --staged
```

---

## 9) Definition of Done (DoD) para mergear

No se mergea una PR si falta algo de esta lista:

- Compila (`ng build`) sin errores.
- Tests relevantes pasan (`ng test` si aplica).
- Cambios revisados por el otro.
- Sin archivos basura (logs, temporales, etc).
- Descripcion de PR completa.

---

## 10) Checklist express de cada tarea

1. `git switch main && git pull origin main`
2. `git switch -c feature/<tema>-<nombre>`
3. Implementar
4. `git add ...`
5. `git commit -m "..."`
6. `git push -u origin ...`
7. Abrir PR y pedir review
8. Corregir feedback
9. Merge a `main`
10. Borrar rama en local y remoto:

```powershell
git switch main
git pull origin main
git branch -d feature/<tema>-<nombre>
git push origin --delete feature/<tema>-<nombre>
```

---

## 11) Recomendacion para vosotros dos (modo comodo + profesional)

- 1 mini-sync diaria de 10 minutos.
- 1 tablero simple de tareas (GitHub Projects o un markdown compartido).
- PR pequenas y frecuentes (menos dolor al integrar).
- Nunca trabajar dos personas a la vez sobre el mismo archivo sin avisar.

Si seguis este documento durante 2 semanas, el caos de commits y ramas baja muchisimo.
