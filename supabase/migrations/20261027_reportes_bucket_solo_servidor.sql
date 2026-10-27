-- ──────────────────────────────────────────────────────────────────────────────
-- Bucket 'reportes': solo el servidor (service_role) lee y escribe.
--
-- Antes: admin/personas/planificador podían subir o reemplazar
-- resumen-proyectos.xlsx directo con su sesión. La sincronización carga ese
-- archivo y conserva sus otras pestañas, y el cron lo sube a SharePoint como
-- respaldo oficial: un Excel alterado (links maliciosos, archivo dañado)
-- terminaba en el respaldo y en las descargas de los admin.
--
-- La app solo usa el bucket desde el servidor (/api/reportes y el cron, con
-- service_role, que no depende de estas políticas). Sin políticas, ningún
-- usuario puede tocar el bucket con su sesión.
-- Ejecutar en Supabase → SQL Editor (idempotente).
-- ──────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "reportes: lectura admin/planificador"    ON storage.objects;
DROP POLICY IF EXISTS "reportes: crear admin/planificador"      ON storage.objects;
DROP POLICY IF EXISTS "reportes: actualizar admin/planificador" ON storage.objects;
DROP POLICY IF EXISTS "reportes: eliminar admin/planificador"   ON storage.objects;

-- El bucket sigue privado
UPDATE storage.buckets SET public = false WHERE id = 'reportes';

-- Verificación: no debe quedar ninguna política que mencione 'reportes'
SELECT policyname FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (qual LIKE '%reportes%' OR with_check LIKE '%reportes%');
