-- Agrega campo talento a persona: 3 valores posibles + null (sin asignar)
ALTER TABLE persona
  ADD COLUMN IF NOT EXISTS talento text
  CHECK (talento IN ('talento', 'en_desarrollo', 'no_talento'));
