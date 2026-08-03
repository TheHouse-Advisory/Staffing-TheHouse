-- Fecha (YYYY-MM-DD) en que cada usuario vio por última vez la vista de Alertas.
-- Permite ocultar el badge rojo de "Alertas" en el sidebar solo para quien ya la abrió hoy,
-- sin afectar a otros usuarios que aún no la han visto.
ALTER TABLE persona
  ADD COLUMN IF NOT EXISTS alertas_vista_en DATE;
