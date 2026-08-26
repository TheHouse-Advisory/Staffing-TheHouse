/**
 * Exporta engagements + participantes a lib/tasks/engagements_master.xlsx,
 * ordenado por fecha_inicio descendente (más reciente primero).
 *
 * REGLA DE SEGURIDAD: no imprime en consola nombres reales de personas,
 * proyectos ni clientes — solo un resumen numérico.
 *
 * Ejecutar con: npx tsx lib/tasks/exportEngagementsExcel.ts
 */
import ExcelJS from "exceljs";
import { config } from "dotenv";
import { createServiceClient } from "@/lib/supabase/server";
import { join } from "path";

config({ path: join(__dirname, "..", "..", ".env.local") });

const RUTA_SALIDA = join(__dirname, "engagements_master.xlsx");

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

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Engagements");
  ws.addRow(HEADERS);
  ws.getRow(1).font = { bold: true };

  for (const e of (engagements ?? []) as any[]) {
    const participantes = (e.asignacion ?? [])
      .map((a: any) => (a.persona ? `${a.persona.nombre} ${a.persona.apellido}` : null))
      .filter(Boolean)
      .join(", ");

    ws.addRow([
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
    ]);
  }

  ws.columns.forEach((col) => (col.width = 22));
  await wb.xlsx.writeFile(RUTA_SALIDA);

  console.log(`✅ Export completado: ${(engagements ?? []).length} engagements.`);
  console.log(`   - Archivo: ${RUTA_SALIDA}`);
}

main().catch((err) => {
  console.error("❌ Error en el export:", err instanceof Error ? err.message : err);
  process.exit(1);
});
