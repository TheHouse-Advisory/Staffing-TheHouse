-- Permite valores decimales (ej: 0.5) en capacidad de proyectos
ALTER TABLE capacity_planning
  ALTER COLUMN capacidad TYPE numeric(4,1) USING capacidad::numeric(4,1);

-- Ajustar el check constraint para que acepte el nuevo tipo
ALTER TABLE capacity_planning
  DROP CONSTRAINT IF EXISTS capacity_planning_capacidad_check;

ALTER TABLE capacity_planning
  ADD CONSTRAINT capacity_planning_capacidad_check
    CHECK (capacidad >= 0 AND capacidad <= 10);
