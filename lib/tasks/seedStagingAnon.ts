/**
 * Script de seed: carga lib/tasks/sharepoint_anon.json a la tabla staging_sharepoint.
 *
 * IMPORTANTE: supabase-js (PostgREST) no puede ejecutar DDL (CREATE TABLE).
 * Si la tabla no existe, este script imprime el SQL exacto para crearla una
 * vez en el SQL Editor de Supabase y se detiene sin insertar nada.
 *
 * Cada fila del JSON se guarda completa en la columna `data` (jsonb), ya que
 * los encabezados originales (con tildes/espacios/"N°") no son nombres de
 * columna SQL válidos.
 *
 * Ejecutar con: npx tsx lib/tasks/seedStagingAnon.ts
 */
import { config } from "dotenv";
import { createServiceClient } from "@/lib/supabase/server";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";

config({ path: join(__dirname, "..", "..", ".env.local") });

const TABLA = "staging_sharepoint";

const SQL_CREAR_TABLA = `
create table if not exists public.${TABLA} (
  id bigint generated always as identity primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);
`.trim();

/** Localiza sharepoint_anon.json (mismo criterio que anonymizeCsv.ts). */
function localizarAnon(): string {
  const candidatos = [
    resolve(process.cwd().split(".claude")[0], "lib/tasks/sharepoint_anon.json"),
    join(process.cwd(), "lib/tasks/sharepoint_anon.json"),
    join(__dirname, "sharepoint_anon.json"),
    resolve("lib/tasks/sharepoint_anon.json"),
  ];
  for (const c of candidatos) {
    if (existsSync(c)) return c;
  }
  console.error("❌ No se encontró sharepoint_anon.json. Rutas probadas:");
  candidatos.forEach((c) => console.error(`   - ${c}`));
  throw new Error("sharepoint_anon.json no encontrado. Ejecuta antes: npx tsx lib/tasks/anonymizeCsv.ts");
}

const TAMANO_LOTE = 500;

async function main() {
  const rutaAnon = localizarAnon();
  console.log(`📄 Leyendo datos anonimizados desde: ${rutaAnon}`);
  const filas: Record<string, unknown>[] = JSON.parse(readFileSync(rutaAnon, "utf-8"));

  // `staging_sharepoint` no existe en los tipos generados de Database (es una
  // tabla temporal de staging) -> cliente sin tipos estrictos para esta tabla.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceClient() as any;

  // Verifica si la tabla existe intentando una consulta liviana.
  const { error: errorExiste } = await supabase.from(TABLA).select("id").limit(1);
  if (errorExiste) {
    console.error(`⚠️  La tabla "${TABLA}" no existe o no es accesible: ${errorExiste.message}`);
    console.error("\nCréala una vez en el SQL Editor de Supabase con:\n");
    console.error(SQL_CREAR_TABLA);
    console.error("\nLuego vuelve a ejecutar: npx tsx lib/tasks/seedStagingAnon.ts");
    process.exit(1);
  }

  // Limpia la tabla antes de re-sembrar (PostgREST no soporta TRUNCATE, se usa
  // un DELETE que matchea todas las filas por id).
  const { error: errorDelete } = await supabase.from(TABLA).delete().gte("id", 0);
  if (errorDelete) throw new Error(`Error limpiando "${TABLA}": ${errorDelete.message}`);

  let insertados = 0;
  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    const lote = filas.slice(i, i + TAMANO_LOTE).map((fila) => ({ data: fila }));
    const { error, count } = await supabase.from(TABLA).insert(lote, { count: "exact" });
    if (error) throw new Error(`Error insertando lote ${i}-${i + lote.length}: ${error.message}`);
    insertados += count ?? lote.length;
  }

  console.log(`✅ Seed completado: ${insertados} registros insertados en "${TABLA}".`);
}

main().catch((err) => {
  console.error("❌ Error en el seed:", err);
  process.exit(1);
});
