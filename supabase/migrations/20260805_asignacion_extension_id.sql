-- Vincula cada asignación a la extensión de engagement que la originó (si aplica)
alter table asignacion
  add column if not exists extension_id uuid references engagement_extension(id) on delete set null;

create index if not exists idx_asignacion_extension on asignacion(extension_id);
