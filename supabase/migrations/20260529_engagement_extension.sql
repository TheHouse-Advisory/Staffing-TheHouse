-- Tabla para registrar extensiones temporales con salto de un engagement
create table if not exists engagement_extension (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references engagement(id) on delete cascade,
  fecha_inicio  date not null,
  fecha_fin     date not null,
  created_at    timestamptz not null default now(),
  constraint ext_fechas_ok check (fecha_fin >= fecha_inicio)
);

create index if not exists idx_ext_engagement on engagement_extension(engagement_id);

-- RLS: mismos permisos que engagement (acceso abierto en este proyecto)
alter table engagement_extension enable row level security;
create policy "allow_all_engagement_extension" on engagement_extension
  for all using (true) with check (true);
