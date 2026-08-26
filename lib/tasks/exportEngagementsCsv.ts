/**
 * Exporta engagements + participantes a lib/tasks/engagements_master.csv,
 * ordenado por fecha_inicio descendente (más reciente primero).
 *
 * REGLA DE SEGURIDAD: no imprime en consola nombres reales de personas,
 * proyectos ni clientes — solo un resumen numérico.
 *
 * Ejecutar con: npx tsx lib/tasks/exportEngagementsCsv.ts
 */
import { config } from "dotenv";
import { writeFileSync } from "fs";
import { join } from "path";
import { createServiceClient } from "@/lib/supabase/server";

config({ path: join(__dirname, "..", "..", ".env.local") });

const RUTA_SALIDA = join(__dirname, "engagements_master.csv");

const HEADERS = [
  "Codigo",
  "Nombre Proyecto",
  "Cliente",
  "Industria",
  "Categoria Principal",
  "Participantes",
  "Tags",
  "Fecha Inicio",
  "Fecha Termino",
  "Resumen",
];

/** Escapa un campo para CSV plano delimitado por comas (RFC 4180). */
function csvField(valor: string): string {
  if (/[",\n\r]/.test(valor)) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

function csvRow(campos: string[]): string {
  return campos.map(csvField).join(",");
}

async function main() {
  const supabase = createServiceClient();

  const { data: engagements, error } = await supabase
    .from("engagement")
    .select(
      "codigo, nombre, cliente, descripcion, fecha_inicio, fecha_fin_estimada, industria:industria_id(nombre), asignacion(persona:persona_id(nombre, apellido))"
    )
    .eq("is_deleted", false)
    .order("fecha_inicio", { ascending: false });

  if (error) throw new Error(`Error consultando engagement: ${error.message}`);

  const lineas = [csvRow(HEADERS)];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const e of (engagements ?? []) as any[]) {
    const participantes = (e.asignacion ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((a: any) => (a.persona ? `${a.persona.nombre} ${a.persona.apellido}` : null))
      .filter(Boolean)
      .join(", ");

    lineas.push(
      csvRow([
        e.codigo ?? "",
        e.nombre ?? "",
        e.cliente ?? "",
        e.industria?.nombre ?? "",
        "", // Categoria Principal: no existe columna equivalente en el schema de `engagement`
        participantes,
        "", // Tags: no existe columna equivalente en el schema de `engagement`
        e.fecha_inicio ?? "",
        e.fecha_fin_estimada ?? "",
        e.descripcion ?? "",
      ])
    );
  }

  writeFileSync(RUTA_SALIDA, lineas.join("\r\n") + "\r\n", "utf-8");

  // No se imprimen nombres de proyectos/personas/clientes — solo el conteo.
  console.log(`✅ Export completado: ${(engagements ?? []).length} engagements.`);
  console.log(`   - Archivo: ${RUTA_SALIDA}`);
}

main().catch((err) => {
  console.error("❌ Error en el export:", err instanceof Error ? err.message : err);
  process.exit(1);
});
