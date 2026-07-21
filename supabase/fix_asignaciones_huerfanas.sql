-- Elimina asignaciones "fantasma" que siguen sumando a la carga de las personas:
--   1) el engagement_id ya no existe (FK huerfana), o
--   2) el engagement esta en papelera (is_deleted = true)
-- NO toca asignaciones de engagements archivados (estado = 'terminado' pero is_deleted = false),
-- ya que esas son historial valido y deben seguir apareciendo en "Historial de proyectos".

-- 1. Diagnostico: revisar antes de borrar
select a.id, a.persona_id, p.nombre, p.apellido, a.engagement_id, e.nombre as engagement_nombre, e.estado, e.is_deleted
from asignacion a
left join persona p on p.id = a.persona_id
left join engagement e on e.id = a.engagement_id
where e.id is null or e.is_deleted = true;

-- 2. Eliminar asignaciones cuyo engagement esta en papelera
delete from asignacion a
using engagement e
where a.engagement_id = e.id
  and e.is_deleted = true;

-- 3. Eliminar asignaciones con engagement_id que ya no existe (FK huerfana)
delete from asignacion a
where a.engagement_id is not null
  and not exists (select 1 from engagement e where e.id = a.engagement_id);
