# Staffing Hub — Guía de arranque

## 1. Crear proyecto en Supabase

1. Ve a [supabase.com](https://supabase.com) y crea un nuevo proyecto
2. En **SQL Editor**, ejecuta el archivo `../fase1_schema.sql` (está en la carpeta Staffing)
3. Ve a **Settings → API** y copia:
   - `Project URL`
   - `anon public` key
   - `service_role` key

## 2. Configurar variables de entorno

```bash
cp .env.local.example .env.local
```

Edita `.env.local` con las credenciales del paso anterior:

```
NEXT_PUBLIC_SUPABASE_URL=https://TU_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
```

## 3. Configurar Auth en Supabase

En el dashboard de Supabase → **Authentication → URL Configuration**:

- **Site URL**: `http://localhost:3000` (dev) / tu dominio en producción
- **Redirect URLs**: agrega ambos patrones (el `*` permite el `?next=...`):
  - `http://localhost:3000/auth/callback*`
  - `https://TU_DOMINIO/auth/callback*` (producción)

En **Authentication → Sign In / Providers → Email**: activa "Enable Email
Confirmations".

### 3.1. SMTP propio — OBLIGATORIO para que lleguen los correos

> **Causa del error `email rate limit exceeded` (429).** El servicio de
> correo integrado de Supabase es solo para pruebas y está limitado a
> **2 correos por hora** para todo el proyecto. Al superarlo, las
> invitaciones y los enlaces de recuperación **dejan de enviarse** aunque
> la app diga lo contrario.

Para que las invitaciones y la recuperación de contraseña funcionen de
verdad hay que configurar un SMTP propio:

1. Crea una cuenta en un proveedor de correo (Resend, SendGrid, AWS SES,
   Postmark, etc.).
2. En **Authentication → Emails → SMTP Settings** activa "Enable Custom
   SMTP" y completa host, puerto, usuario, contraseña y el remitente.
3. En **Authentication → Rate Limits** sube el límite de correos a un
   valor razonable (p.ej. 30–50 por hora).

### 3.2. Plantillas de correo (recomendado)

Para que el enlace funcione de forma robusta tanto en invitaciones como en
recuperación, en **Authentication → Emails → Templates** edita las
plantillas **Invite user** y **Reset Password** y apunta el enlace directo
a `/auth/callback` con `token_hash`:

```
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/auth/set-password">Aceptar invitación</a>
```

```
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/auth/set-password">Restablecer contraseña</a>
```

El callback (`app/auth/callback/route.ts`) también acepta el formato PKCE
(`?code=...`) por defecto, así que con las plantillas estándar la
recuperación desde `/login` sigue funcionando.

## 4. Instalar dependencias y correr

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000)

## 5. Crear el primer usuario admin

Después de ejecutar el SQL, inserta una persona admin vinculada a tu cuenta:

```sql
-- Primero inicia sesión con magic link para crear el auth.users
-- Luego corre esto en SQL Editor reemplazando con tu auth user ID:

INSERT INTO persona (
  auth_user_id,
  nombre,
  apellido,
  email,
  rol_sistema
) VALUES (
  'TU_AUTH_USER_ID',   -- lo encuentras en Authentication → Users
  'Tu Nombre',
  'Tu Apellido',
  'tu@thehouse.cl',
  'admin'
);
```

## Estructura del proyecto

```
staffing-hub/
├── app/
│   ├── (auth)/login/          # Página de login (magic link)
│   ├── (dashboard)/           # Rutas protegidas con sidebar
│   │   ├── tablero/           # Tablero de ocupación
│   │   ├── engagements/       # Lista y detalle de engagements
│   │   ├── personas/          # Lista y perfil de personas
│   │   └── propuestas/        # Propuestas de asignación
│   └── auth/callback/         # Callback de Supabase Auth
├── components/
│   ├── layout/                # Sidebar, Topbar
│   ├── tablero/               # TablonOcupacion
│   ├── engagements/           # EngagementsList, EngagementDetail
│   ├── personas/              # PersonasList, PersonaProfile
│   └── propuestas/            # PropuestasList
├── lib/
│   ├── supabase/              # client.ts, server.ts, middleware.ts
│   ├── types/database.ts      # Tipos TypeScript del schema
│   ├── auth.ts                # Helpers de autenticación
│   └── utils.ts               # cn(), colorOcupacion(), etc.
└── middleware.ts               # Protección de rutas
```

## Próximos pasos (Bloques 2 y 3)

- **Bloque 2**: queries temporales `ocupacion_semana` y `cobertura_engagement`
- **Bloque 3**: flujo completo de propuestas y aprobación con validación de capacidad
