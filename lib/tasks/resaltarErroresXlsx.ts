/**
 * Convierte lib/tasks/reporte_errores_sharepoint.csv a .xlsx, resaltando en
 * amarillo las filas con ESTADO_VALIDACION = "REVISAR" (lo que hay que
 * chequear antes de migrar).
 *
 * Ejecutar con: npx tsx lib/tasks/resaltarErroresXlsx.ts
 */
import ExcelJS from "exceljs";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

function localizarArchivo(nombre: string): string {
  const candidatos = [
    join(process.cwd().split(".claude")[0], "lib/tasks", nombre),
    join(process.cwd(), "lib/tasks", nombre),
    join(__dirname, nombre),
  ];
  for (const c of candidatos) {
    if (existsSync(c)) return c;
  }
  throw new Error(`No se encontró ${nombre}. Rutas probadas:\n` + candidatos.join("\n"));
}

/** Parser CSV simple: soporta campos entre comillas, comas y comillas escapadas (""). */
function parseCsv(contenido: string): string[][] {
  const texto = contenido.replace(/^﻿/, "");
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    const siguiente = texto[i + 1];
    if (entreComillas) {
      if (c === '"' && siguiente === '"') {
        campo += '"';
        i++;
      } else if (c === '"') {
        entreComillas = false;
      } else {
        campo += c;
      }
    } else {
      if (c === '"') entreComillas = true;
      else if (c === ",") {
        fila.push(campo);
        campo = "";
      } else if (c === "\r") {
        // ignorar
      } else if (c === "\n") {
        fila.push(campo);
        filas.push(fila);
        fila = [];
        campo = "";
      } else {
        campo += c;
      }
    }
  }
  if (campo.length > 0 || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((v) => v.trim() !== ""));
}

async function main() {
  const rutaCsv = localizarArchivo("reporte_errores_sharepoint.csv");
  const [headers, ...rows] = parseCsv(readFileSync(rutaCsv, "utf-8"));
  const idxEstado = headers.findIndex((h) => h.trim() === "ESTADO_VALIDACION");
  const idxDetalle = headers.findIndex((h) => h.trim() === "DETALLE_ERROR");

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Reporte errores");

  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).eachCell((cell) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDDDDD" } }));

  const amarillo: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF59D" } };
  let filasResaltadas = 0;

  for (const fila of rows) {
    const excelRow = ws.addRow(fila);
    const tienePersonaNoMapeada = idxDetalle !== -1 && (fila[idxDetalle] ?? "").includes("Persona no mapeada");
    if (idxEstado !== -1 && fila[idxEstado]?.trim() === "REVISAR" && !tienePersonaNoMapeada) {
      excelRow.eachCell({ includeEmpty: true }, (cell) => (cell.fill = amarillo));
      filasResaltadas++;
    }
  }

  ws.columns.forEach((col) => {
    col.width = 22;
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const rutaSalida = join(join(rutaCsv, ".."), "reporte_errores_sharepoint.xlsx");
  await wb.xlsx.writeFile(rutaSalida);

  console.log(`✅ Excel generado: ${filasResaltadas} filas resaltadas en amarillo (REVISAR) de ${rows.length} totales.`);
  console.log(`   - Archivo: ${rutaSalida}`);
}

main().catch((err) => {
  console.error("❌ Error generando el Excel:", err instanceof Error ? err.message : err);
  process.exit(1);
});
