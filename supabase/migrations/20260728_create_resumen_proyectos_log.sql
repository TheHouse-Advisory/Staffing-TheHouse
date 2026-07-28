-- ──────────────────────────────────────────────────────────────────────────────
-- 20260728_create_resumen_proyectos_log.sql
--
-- Registro minimo de "quien edito por ultima vez" el Resumen de Proyectos
-- (celdas editables de asignacion). Usado por ResumenProyectosClient.tsx para
-- mostrar "Ultimo cambio realizado por X" junto al contador de proyectos.
-- No reemplaza una auditoria completa (antes/despues) -- solo el ultimo actor.
-- ──────────────────────────────────────────────────────────────────────────────

create table if not exists resumen_proyectos_log (
  id bigint generated always as identity primary key,
  actor_nombre text not null,
  engagement_id uuid references engagement(id) on delete set null,
  cargo text,
  creado_en timestamptz not null default now()
);

create index if not exists resumen_proyectos_log_creado_en_idx
  on resumen_proyectos_log (creado_en desc);

alter table resumen_proyectos_log enable row level security;

drop policy if exists "resumen_proyectos_log: lectura autenticados" on resumen_proyectos_log;
create policy "resumen_proyectos_log: lectura autenticados"
  on resumen_proyectos_log for select
  using (auth.role() = 'authenticated');

drop policy if exists "resumen_proyectos_log: insertar autenticados" on resumen_proyectos_log;
create policy "resumen_proyectos_log: insertar autenticados"
  on resumen_proyectos_log for insert
  with check (auth.role() = 'authenticated');
