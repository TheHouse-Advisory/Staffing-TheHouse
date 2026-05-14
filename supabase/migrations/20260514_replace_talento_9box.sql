-- Reemplaza talento (enum text) por coordenadas 9-box decimales
ALTER TABLE persona
  DROP COLUMN IF EXISTS talento,
  ADD COLUMN IF NOT EXISTS talento_potencial numeric(3,1)
    CHECK (talento_potencial >= 1 AND talento_potencial <= 5),
  ADD COLUMN IF NOT EXISTS talento_desempeno numeric(3,1)
    CHECK (talento_desempeno >= 1 AND talento_desempeno <= 5);
