# Manual de Handoff — Staffing Hub (The House)

Este documento existe para que otra persona pueda tomar el rol de mantención/desarrollo de esta app sin depender de quien la creó originalmente. Está pensado para trabajar junto a un asistente de código (Claude Code): con esto debería bastar para pedirle cambios con contexto suficiente.

## 1. Stack y arranque local

- **Next.js 15** (App Router) + **React 19** + **Supabase** (BD + Auth + Storage) + **Tailwind**.
- Ver `SETUP.md` para el paso a paso de instalación inicial (crear proyecto Supabase, primer admin, config de Auth/SMTP).
- Variables de entorno (`.env.local`, ver `.env.local.example`):
  - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`: públicas, van al cliente.
  - `SUPABASE_SERVICE_ROLE_KEY`: **privada**, bypassa Row Level Security. Solo se usa en `lib/supabase/server.ts → createServiceClient()`, y solo tras validar `requireAdmin()`. Nunca debe llegar al browser ni a un componente `"use client"`.
- Comandos: `npm run dev`, `npm run build`, `npm run type-check` (correr este último tras cualquier cambio de tipos o schema).

## 2. Estructura de carpetas

La guía de navegación completa vive en [`mapa.txt`](mapa.txt) (raíz del proyecto) — lista cada archivo de `app/` y `components/` con una línea de descripción. **Regla del proyecto: actualizar `mapa.txt` cada vez que se crea o mueve un archivo.** Es lo primero que hay que consultar antes de buscar algo en el código, para no gastar tiempo/tokens leyendo carpetas enteras.

Resumen de alto nivel:
- `app/` — vistas y rutas (App Router), agrupadas en `(auth)` y `(dashboard)`.
- `components/` — componentes visuales, organizados por feature (personas, engagements, planificacion, capacity, ausencias, tablero, reportes, etc.) + `components/ui/` con los base reutilizables (Button, Modal, Drawer, MultiSelect, FormField).
- `lib/` — lógica de negocio y acceso a datos (detalle abajo).
- `supabase/` — SQL de schema y migraciones (detalle abajo).

## 3. Capa de datos (`lib/`)

### Clientes Supabase (`lib/supabase/`)
- `client.ts` → cliente para el browser.
- `server.ts` → cliente para Server Components/Actions (usa cookies), incluye `createServiceClient()` (privilegiado, ver advertencia arriba).
- `middleware.ts` → `updateSession()`, refresca la sesión en cada request (usado por `middleware.ts` de la raíz) y redirige a `/login` si no hay usuario.
- `types.ts` → solo el tipo `TypedSupabaseClient`. **No es autogenerado.**

### Tipos del schema (`lib/types/database.ts`)
Define a mano todas las interfaces de tablas (`Persona`, `Engagement`, `Ausencia`, etc.) y el tipo `Database` que usa `supabase-js` para tipar queries. **Importante:** este proyecto no usa `supabase gen types` — cualquier cambio de columna/tabla en la BD real hay que reflejarlo manualmente aquí, o el type-check no lo va a detectar y las queries quedarán mal tipadas silenciosamente.

### Queries (`lib/queries/`)
Un archivo por feature, cada uno con las funciones de lectura/escritura contra Supabase que usan las vistas de esa sección: `ausencias.ts`, `capacity.ts`, `engagements.ts`, `personas.ts`, `planificacion.ts` (el más complejo: motor de "fit" para asignar personas a requerimientos), `tablero.ts`.

### Autenticación y accesos (`lib/auth.ts`, `lib/auth/actions.ts`)
- `requireAuth()` / `requireAdmin()` / `getAuthUser()`: guardas de sesión para Server Components/Actions.
- Roles de sistema (`RolSistema`): `admin | GyD | AySr | Desarrollo | proposer` (+ `planificador` definido en tipos pero no confirmado como asignable — revisar antes de usarlo).
- Estado de acceso (`EstadoAcceso`): `invitada | activa | suspendida`.
- Flujo real: un admin **invita** a una persona ya existente en la tabla `persona` (no es self-signup) → Supabase envía correo → `app/auth/callback/route.ts` (soporta PKCE y OTP) → `/auth/set-password` → cuenta queda `activa`.
- Reforzado en la BD con un trigger (`persona_guard_acceso`, mencionado en migraciones) que rechaza cambios de rol/acceso que no vengan de un admin o del `service_role` — defensa en profundidad además del control en el código.
- Row Level Security está activo mayormente por feature (cada tabla nueva agrega su policy en el mismo script que la crea). No está auditado policy por policy en este documento — si hace falta el detalle fino de "qué rol puede hacer qué", hay que revisar la migración puntual de esa tabla.

### Otros
- `lib/constants.ts` — fuente única de verdad de cargos (`CARGOS`, colores, cargos ocultos para rol GyD).
- `lib/constants/holidays.ts` — feriados de Chile **hardcodeados solo para 2026-2027**. Hay que actualizar esta lista a mano cada año.
- `lib/tasks/cleanupEngagements.ts` — borrado permanente de registros en "papelera" con más de 30 días.
- `lib/utils*.ts` — helpers de formato de fecha, color por % de ocupación, iniciales para avatares, merge de clases Tailwind.

## 4. Base de datos y migraciones (`supabase/`)

- **`supabase/migrations/`**: migraciones oficiales vigentes, nombradas `YYYYMMDD_descripcion.sql`. **Esta es la convención a seguir para cualquier cambio de schema nuevo.**
- **`.sql` sueltos en la raíz de `supabase/`** (`add_*`, `create_*`, `fix_*`, `alter_*`, `drop_*`, `reset.sql`, `seed.sql`): scripts históricos, ya ejecutados sobre la BD real, **no son idempotentes**. `reset.sql` limpia datos transaccionales preservando usuarios; `seed.sql` puebla datos de prueba para desarrollo. No usarlos como referencia de "estado actual del schema", son un log de cómo se llegó hasta acá.
- **⚠️ Gap importante:** el schema base original (`fase1_schema.sql`, mencionado en `SETUP.md`) **no está dentro de este repositorio** — vive en una carpeta hermana fuera de `Staffing-TheHouse`. Si se necesitara reconstruir la BD desde cero, hoy faltaría ese archivo. Recomendación prioritaria: exportar el schema completo actual desde Supabase (`supabase db dump` o el SQL editor) y guardarlo dentro de este repo.

## 5. Deploy

- Next.js está pensado para desplegarse en **Vercel** (confirmar con quien administra el hosting si es el proveedor real usado).
- Las mismas variables de entorno de `.env.local` deben configurarse en el panel del proveedor de hosting (no se puede tomar el `.env.local` local).
- Después de cualquier cambio de schema en Supabase, correr `npm run type-check` antes de deployar para detectar tipos desincronizados en `lib/types/database.ts`.

## 6. Cómo seguir trabajando con un asistente de código (Claude Code)

- Mantener `mapa.txt` al día — es la forma en que el asistente ubica archivos sin tener que leer todo el repo (ahorra tiempo y costo).
- Pedir cambios acotados/incrementales en vez de "rehacer" secciones completas — permite revisar más fácil y gasta menos recursos.
- Si el cambio requiere tocar `lib/`, `supabase/` o configuración raíz, es normal que el asistente pida confirmación antes de explorar esas carpetas (por diseño, para no leer de más).
- Antes de aceptar un cambio que modifique columnas/tablas en Supabase, verificar que se haya creado la migración correspondiente en `supabase/migrations/` con el naming `YYYYMMDD_descripcion.sql`, y que `lib/types/database.ts` se haya actualizado a mano.

## 7. Riesgos/pendientes detectados (prioridad para quien tome el rol)

1. `fase1_schema.sql` fuera del repo — respaldar el schema completo dentro de `Staffing-TheHouse`.
2. `lib/types/database.ts` mantenido a mano — evaluar automatizar con `supabase gen types` para evitar desincronización silenciosa.
3. Feriados de Chile hardcodeados solo hasta 2027 (`lib/constants/holidays.ts`) — agendar actualización anual.
4. Confirmar si el rol `planificador` (definido en tipos) debe habilitarse como asignable en `lib/auth/actions.ts` (`ROLES_VALIDOS`) o es código muerto.
5. No hay `README.md` — solo `SETUP.md` (instalación) y este `ONBOARDING.md` (arquitectura/mantención). Mantener ambos actualizados.
