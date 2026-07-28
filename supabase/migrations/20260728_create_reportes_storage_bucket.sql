-- ──────────────────────────────────────────────────────────────────────────────
-- 20260728_create_reportes_storage_bucket.sql
--
-- Crea el bucket privado "reportes" en Supabase Storage, usado por
-- lib/utils/excel-sync.ts para guardar el libro Excel único de
-- "Resumen de Proyectos" (una pestaña por año). El endpoint
-- app/api/reportes/resumen-proyectos-excel/route.ts accede con la
-- service role key (bypassa RLS); estas políticas solo protegen un
-- futuro acceso directo vía cliente autenticado (admin/planificador),
-- reusando fn_is_editor_rol() creada en fix_write_permissions_fase4.sql.
-- ──────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('reportes', 'reportes', false)
on conflict (id) do nothing;

drop policy if exists "reportes: lectura admin/planificador" on storage.objects;
create policy "reportes: lectura admin/planificador"
  on storage.objects for select
  using (bucket_id = 'reportes' and public.fn_is_editor_rol());

drop policy if exists "reportes: crear admin/planificador" on storage.objects;
create policy "reportes: crear admin/planificador"
  on storage.objects for insert
  with check (bucket_id = 'reportes' and public.fn_is_editor_rol());

drop policy if exists "reportes: actualizar admin/planificador" on storage.objects;
create policy "reportes: actualizar admin/planificador"
  on storage.objects for update
  using (bucket_id = 'reportes' and public.fn_is_editor_rol())
  with check (bucket_id = 'reportes' and public.fn_is_editor_rol());

drop policy if exists "reportes: eliminar admin/planificador" on storage.objects;
create policy "reportes: eliminar admin/planificador"
  on storage.objects for delete
  using (bucket_id = 'reportes' and public.fn_is_editor_rol());
