-- Ampliar el check constraint de engagement.tipo para incluir 'posibles_proyectos'

ALTER TABLE engagement
  DROP CONSTRAINT IF EXISTS engagement_tipo_check;

ALTER TABLE engagement
  ADD CONSTRAINT engagement_tipo_check
  CHECK (tipo IN ('propuesta', 'proyecto', 'ayuda_interna', 'posibles_proyectos'));
