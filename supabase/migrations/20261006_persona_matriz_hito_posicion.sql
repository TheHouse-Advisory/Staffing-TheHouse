-- Posición exacta (pin) en la 9-box, escala 1-5. `cuadrante` se mantiene
-- derivado de estas coordenadas para el título/badge y registros antiguos.
ALTER TABLE persona_matriz_hito ADD COLUMN IF NOT EXISTS potencial NUMERIC(3, 2) CHECK (potencial BETWEEN 1 AND 5);
ALTER TABLE persona_matriz_hito ADD COLUMN IF NOT EXISTS desempeno NUMERIC(3, 2) CHECK (desempeno BETWEEN 1 AND 5);
