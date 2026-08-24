/**
 * Script de respaldo: exporta engagement, persona, plan_simulacion, asignacion,
 * asignacion_historial y ausencia a JSON local.
 * Ejecutar con: npm run backup
 */
import { config } from "dotenv";
import { createServiceClient } from "@/lib/supabase/server";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

config({ path: join(__dirname, "..", "..", ".env.local") });

const TABLAS = ["engagement", "persona", "plan_simulacion", "asignacion", "asignacion_historial", "ausencia"] as const;
const DIR_BACKUPS = join(__dirname, "backups");

async function main() {
  const supabase = createServiceClient();
  const resultado: Record<string, unknown[]> = {};

  for (const tabla of TABLAS) {
    const { data, error } = await supabase.from(tabla).select("*");
    if (error) throw new Error(`Error consultando "${tabla}": ${error.message}`);
    resultado[tabla] = data ?? [];
  }

  mkdirSync(DIR_BACKUPS, { recursive: true });
  const fecha = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const ruta = join(DIR_BACKUPS, `backup_${fecha}.json`);
  writeFileSync(ruta, JSON.stringify(resultado, null, 2), "utf-8");

  console.log(`✅ Respaldo completado: ${ruta}`);
  for (const tabla of TABLAS) {
    console.log(`   - ${tabla}: ${resultado[tabla].length} registros`);
  }
}

main().catch((err) => {
  console.error("❌ Error en el respaldo:", err);
  process.exit(1);
});
