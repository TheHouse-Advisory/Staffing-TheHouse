/**
 * Corrige Fecha Termino nula/invertida en sharepoint_raw.csv (fin de año de Fecha Inicio),
 * normaliza ambas fechas a ISO (YYYY-MM-DD) y sincroniza engagement.fecha_inicio /
 * fecha_fin_estimada en Supabase, haciendo match por engagement.codigo.
 *
 * Solo UPDATE (no crea filas nuevas): evita insertar engagements incompletos sin los
 * campos NOT NULL del schema real (cliente, tipo, estado, color, etc.).
 *
 * REGLA DE SEGURIDAD: no imprime códigos, nombres de clientes/personas ni filas — solo conteos.
 *
 * Ejecutar con: npx tsx lib/tasks/fixInconsistentEngagementDates.ts
 */
import { config } from "dotenv";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createServiceClient } from "@/lib/supabase/server";

config({ path: join(__dirname, "..", "..", ".env.local") });

const RUTA_CSV = join(__dirname, "sharepoint_raw.csv");
// Índices reales del header de sharepoint_raw.csv (19 columnas, no 10 — se preserva tal cual)
const COL_CODIGO = 0;
const COL_FECHA_INICIO = 9;
const COL_FECHA_TERMINO = 10;

// ── Parser/serializer CSV RFC 4180 (mismo usado en fixCsvDates.ts) ──
function parseCSV(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let dentroComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentroComillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') { dentroComillas = false; }
      else { campo += c; }
    } else if (c === '"') {
      dentroComillas = true;
    } else if (c === ",") {
      fila.push(campo); campo = "";
    } else if (c === "\r" && texto[i + 1] === "\n") {
      fila.push(campo); campo = ""; filas.push(fila); fila = []; i++;
    } else if (c === "\n") {
      fila.push(campo); campo = ""; filas.push(fila); fila = [];
    } else {
      campo += c;
    }
  }
  if (campo.length > 0 || fila.length > 0) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => !(f.length === 1 && f[0] === ""));
}
function csvField(valor: string): string {
  if (/[",\n\r]/.test(valor)) return `"${valor.replace(/"/g, '""')}"`;
  return valor;
}
function csvRow(campos: string[]): string {
  return campos.map(csvField).join(",");
}

/** "M/D/YYYY" o "MM/DD/YYYY" → "YYYY-MM-DD" (reformateo directo, sin invertir mes/día). */
function mdyToISO(v: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function finDeAnio(iso: string): string {
  return `${iso.slice(0, 4)}-12-31`;
}

async function main() {
  const texto = readFileSync(RUTA_CSV, "utf-8");
  const filas = parseCSV(texto);
  const [header, ...datos] = filas;

  let corregidas = 0;
  let sinFechaInicio = 0;
  const actualizacionesDB: { codigo: string; fecha_inicio: string; fecha_fin_estimada: string }[] = [];

  const salida = datos.map((fila) => {
    const codigo = (fila[COL_CODIGO] || "").trim();
    const inicioISO = mdyToISO(fila[COL_FECHA_INICIO] || "");
    if (!inicioISO) { sinFechaInicio++; return fila; } // sin fecha_inicio válida: no se toca

    const terminoRaw = (fila[COL_FECHA_TERMINO] || "").trim();
    const terminoISO = terminoRaw ? mdyToISO(terminoRaw) : null;

    const inconsistente = !terminoISO || terminoISO < inicioISO;
    const terminoFinal = inconsistente ? finDeAnio(inicioISO) : terminoISO;
    if (inconsistente) corregidas++;

    if (codigo) actualizacionesDB.push({ codigo, fecha_inicio: inicioISO, fecha_fin_estimada: terminoFinal });

    const nueva = [...fila];
    nueva[COL_FECHA_INICIO] = inicioISO;
    nueva[COL_FECHA_TERMINO] = terminoFinal;
    return nueva;
  });

  writeFileSync(RUTA_CSV, [csvRow(header), ...salida.map(csvRow)].join("\r\n") + "\r\n", "utf-8");

  // Sync a Supabase: UPDATE por codigo (nunca INSERT — evita filas incompletas)
  const supabase = createServiceClient();
  let actualizadas = 0, sinMatch = 0, errores = 0;
  for (const u of actualizacionesDB) {
    const { data, error } = await supabase
      .from("engagement")
      .update({ fecha_inicio: u.fecha_inicio, fecha_fin_estimada: u.fecha_fin_estimada } as never)
      .eq("codigo", u.codigo)
      .select("id");
    if (error) { errores++; continue; }
    if (!data || data.length === 0) sinMatch++; else actualizadas++;
  }

  console.log(`✅ fixInconsistentEngagementDates completado.`);
  console.log(`   - Filas CSV revisadas: ${datos.length}`);
  console.log(`   - Sin Fecha Inicio válida (no tocadas): ${sinFechaInicio}`);
  console.log(`   - Fecha Termino corregida (nula/invertida → fin de año): ${corregidas}`);
  console.log(`   - Supabase actualizados: ${actualizadas}`);
  console.log(`   - Supabase sin match por codigo: ${sinMatch}`);
  console.log(`   - Supabase errores: ${errores}`);
}

main().catch((err) => {
  console.error("❌ Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
