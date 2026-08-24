/**
 * Autocompleta fechas inválidas/faltantes en lib/tasks/sharepoint_anon.json
 * usando lib/tasks/staffing_excel.xlsx como fuente de verdad, resolviendo la
 * identidad real de cada proyecto (código/nombre) vía private_map.json.
 *
 * NOTA: el pedido original mencionaba "staffing_excel.csv", pero el archivo
 * presente en lib/tasks/ es staffing_excel.xlsx — se lee ese directamente.
 *
 * No imprime nombres/datos reales en consola — solo un resumen numérico.
 *
 * Ejecutar con: npx tsx lib/tasks/completarFechasStaffing.ts
 */
import ExcelJS from "exceljs";
import { existsSync, readFileSync, writeFileSync } from "fs";
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

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

type Fecha = { d: number; m: number; y: number };

function parsearFecha(valor: string): Fecha | null {
  const m = valor.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return { d: Number(m[1]), m: Number(m[2]), y: Number(m[3]) };
}

function aFechaUTC(p: Fecha): number {
  return Date.UTC(p.y, p.m - 1, p.d);
}

function formatear(p: Fecha): string {
  return `${p.d}/${p.m}/${p.y}`;
}

/** true si la fecha (string) está vacía o no representa un rango válido junto a la otra. */
function esInvalida(rawInicio: string, rawTermino: string): boolean {
  if (!rawInicio.trim() || !rawTermino.trim()) return true;
  const pInicio = parsearFecha(rawInicio);
  const pTermino = parsearFecha(rawTermino);
  if (!pInicio || !pTermino) return true;
  return aFechaUTC(pTermino) < aFechaUTC(pInicio);
}

/** Convierte el valor de una celda de ExcelJS (Date, string, fórmula) a "D/M/YYYY", o null. */
function celdaAFecha(valor: ExcelJS.CellValue): string | null {
  if (valor instanceof Date) {
    return `${valor.getUTCDate()}/${valor.getUTCMonth() + 1}/${valor.getUTCFullYear()}`;
  }
  if (typeof valor === "string") {
    const p = parsearFecha(valor);
    return p ? formatear(p) : null;
  }
  if (typeof valor === "object" && valor !== null && "result" in valor) {
    return celdaAFecha((valor as { result: ExcelJS.CellValue }).result);
  }
  return null;
}

function celdaATexto(valor: ExcelJS.CellValue): string {
  if (valor == null) return "";
  const obj = valor as unknown as Record<string, unknown>;
  if (typeof valor === "object" && "text" in obj) return String(obj.text ?? "");
  if (typeof valor === "object" && "result" in obj) return String(obj.result ?? "");
  return String(valor);
}

/** Código de proyecto tipo "PAR04", "RIO01": 2-6 letras seguidas de 1-3 dígitos. */
const CODIGO_REGEX = /[A-Z]{2,6}\d{1,3}/;

/** Quita ruido típico de SharePoint/Excel (*, comillas, ":", paréntesis) y colapsa espacios. */
function limpiarTexto(s: string): string {
  return s
    .replace(/[*":()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extraerCodigo(texto: string): string | null {
  const m = limpiarTexto(texto).toUpperCase().match(CODIGO_REGEX);
  return m ? m[0] : null;
}

type FilaProyecto = {
  "Código proyecto"?: string;
  "Nombre proyecto"?: string;
  "Fecha Inicio"?: string;
  "Fecha término"?: string;
  [key: string]: unknown;
};

type FechaPar = { fechaInicio: string; fechaTermino: string };

type IndiceStaffing = {
  /** match exacto nombre/código/cliente normalizado (fallback del método anterior) */
  porTextoExacto: Map<string, FechaPar>;
  /** match por código de proyecto extraído con regex (ej. "PAR04") */
  porCodigoRegex: Map<string, FechaPar>;
  /** filas combinadas para "contains" cuando el código no calzó exacto en el regex del Excel */
  filasCombinadas: Array<{ textoUpper: string } & FechaPar>;
};

/**
 * El libro tiene muchas hojas (vacaciones, planificación semanal, etc.).
 * Se recorren todas y se usa cualquiera que tenga columnas de identidad de
 * proyecto (Código/Nombre/Cliente) + Fecha Inicio + fecha de término
 * (Fecha Cierre/Fecha término/Fecha Fin).
 */
async function leerStaffingExcel(ruta: string): Promise<IndiceStaffing> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(ruta);

  const porTextoExacto = new Map<string, FechaPar>();
  const porCodigoRegex = new Map<string, FechaPar>();
  const filasCombinadas: Array<{ textoUpper: string } & FechaPar> = [];
  let hojasUsadas = 0;

  for (const hoja of wb.worksheets) {
    const headers: string[] = [];
    hoja.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
      headers[colNumber] = normalizar(celdaATexto(cell.value));
    });

    const colCodigo = headers.findIndex((h) => h && h.includes("codigo"));
    const colNombre = headers.findIndex((h) => h && h === "nombre");
    const colCliente = headers.findIndex((h) => h && h.includes("cliente"));
    const colInicio = headers.findIndex((h) => h && h.includes("fecha inicio"));
    const colTermino = headers.findIndex(
      (h) => h && (h.includes("fecha cierre") || h.includes("fecha termino") || h.includes("fecha fin"))
    );

    if (colInicio === -1 || colTermino === -1 || (colCodigo === -1 && colNombre === -1 && colCliente === -1)) continue;
    hojasUsadas++;

    hoja.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const fechaInicio = celdaAFecha(row.getCell(colInicio).value);
      const fechaTermino = celdaAFecha(row.getCell(colTermino).value);
      if (!fechaInicio || !fechaTermino) return;
      const par: FechaPar = { fechaInicio, fechaTermino };

      const textosCelda: string[] = [];
      for (const col of [colCodigo, colNombre, colCliente]) {
        if (col === -1) continue;
        const texto = celdaATexto(row.getCell(col).value);
        textosCelda.push(texto);
        const identificador = normalizar(texto);
        if (identificador && !porTextoExacto.has(identificador)) porTextoExacto.set(identificador, par);
      }

      const textoUpper = limpiarTexto(textosCelda.join(" ")).toUpperCase();
      for (const m of textoUpper.matchAll(new RegExp(CODIGO_REGEX, "g"))) {
        if (!porCodigoRegex.has(m[0])) porCodigoRegex.set(m[0], par);
      }
      filasCombinadas.push({ textoUpper, ...par });
    });
  }

  if (hojasUsadas === 0) {
    throw new Error("No se encontró ninguna hoja en staffing_excel.xlsx con columnas de proyecto + fechas.");
  }

  return { porTextoExacto, porCodigoRegex, filasCombinadas };
}

/** Un encabezado de semana tipo "17/06 al 21/06" o "17/06/2024 al 21/06/2024". */
const RANGO_SEMANA_REGEX = /(\d{1,2})\/(\d{1,2})(?:\s*\/(\d{4}))?\s*al?\s*(\d{1,2})\/(\d{1,2})(?:\s*\/(\d{4}))?/i;

type RangoSemana = { d1: number; m1: number; y1?: number; d2: number; m2: number; y2?: number };

function parsearRangoSemana(texto: string): RangoSemana | null {
  const m = limpiarTexto(texto).match(RANGO_SEMANA_REGEX);
  if (!m) return null;
  return {
    d1: Number(m[1]),
    m1: Number(m[2]),
    y1: m[3] ? Number(m[3]) : undefined,
    d2: Number(m[4]),
    m2: Number(m[5]),
    y2: m[6] ? Number(m[6]) : undefined,
  };
}

const UN_DIA_MS = 24 * 60 * 60 * 1000;

function msAFecha(ms: number): Fecha {
  const dt = new Date(ms);
  return { d: dt.getUTCDate(), m: dt.getUTCMonth() + 1, y: dt.getUTCFullYear() };
}

/**
 * Lee las hojas tipo matriz/Gantt (columna de identidad "*PROYECTOS:*" seguida
 * de columnas semanales "DD/MM al DD/MM"). Para cada proyecto, fecha_inicio es
 * la fecha de la primera columna semanal con alguna celda no vacía en esa fila
 * y fecha_termino la de la última. Las columnas sin año explícito se resuelven
 * por aritmética de +7 días desde la única columna del libro que sí trae año.
 */
function leerMatrizStaffing(wb: ExcelJS.Workbook): Map<string, FechaPar> {
  // 1. Ancla global: primera columna, en cualquier hoja, con año explícito.
  let anclaInicioMs: number | null = null;
  let anclaFinMs: number | null = null;
  let anclaD1 = 0;
  let anclaM1 = 0;

  for (const hoja of wb.worksheets) {
    const fila1 = hoja.getRow(1);
    let encontrada = false;
    fila1.eachCell({ includeEmpty: true }, (cell) => {
      if (encontrada || anclaInicioMs !== null) return;
      const rango = parsearRangoSemana(celdaATexto(cell.value));
      if (rango && rango.y1) {
        anclaInicioMs = Date.UTC(rango.y1, rango.m1 - 1, rango.d1);
        anclaFinMs = Date.UTC(rango.y2 ?? rango.y1, rango.m2 - 1, rango.d2);
        anclaD1 = rango.d1;
        anclaM1 = rango.m1;
        encontrada = true;
      }
    });
    if (anclaInicioMs !== null) break;
  }

  const resultado = new Map<string, FechaPar>();
  if (anclaInicioMs === null || anclaFinMs === null) return resultado; // no hay año de referencia en todo el libro

  for (const hoja of wb.worksheets) {
    const headers: string[] = [];
    hoja.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
      headers[colNumber] = celdaATexto(cell.value);
    });

    const colIdentidad = headers.findIndex((h) => h && limpiarTexto(h).toUpperCase().includes("PROYECTOS"));
    if (colIdentidad === -1) continue;

    // columnas semanales = las que están después de la identidad y matchean el patrón de rango
    const rangosPorColumna = new Map<number, RangoSemana>();
    headers.forEach((h, i) => {
      if (i <= colIdentidad || !h) return;
      const r = parsearRangoSemana(h);
      if (r) rangosPorColumna.set(i, r);
    });
    if (rangosPorColumna.size < 3) continue; // no parece una hoja matriz real

    // columna local que coincide (mismo día/mes) con el ancla global, para alinear semanas
    let colAncla: number | null = null;
    for (const [col, r] of rangosPorColumna) {
      if (r.d1 === anclaD1 && r.m1 === anclaM1) {
        colAncla = col;
        break;
      }
    }
    if (colAncla === null) continue; // esta hoja no comparte el calendario del ancla, no se puede alinear con seguridad

    const columnasSemana = [...rangosPorColumna.keys()].sort((a, b) => a - b);
    const fechaPorColumna = new Map<number, FechaPar>();
    for (const col of columnasSemana) {
      const offsetSemanas = col - colAncla;
      const inicio = msAFecha(anclaInicioMs + offsetSemanas * 7 * UN_DIA_MS);
      const fin = msAFecha(anclaFinMs + offsetSemanas * 7 * UN_DIA_MS);
      fechaPorColumna.set(col, { fechaInicio: formatear(inicio), fechaTermino: formatear(fin) });
    }

    hoja.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const identidad = celdaATexto(row.getCell(colIdentidad).value);
      const codigo = extraerCodigo(identidad);
      if (!codigo) return;

      let primeraCol: number | null = null;
      let ultimaCol: number | null = null;
      for (const col of columnasSemana) {
        const tieneAsignacion = celdaATexto(row.getCell(col).value).trim() !== "";
        if (tieneAsignacion) {
          if (primeraCol === null) primeraCol = col;
          ultimaCol = col;
        }
      }
      if (primeraCol === null || ultimaCol === null) return;

      const inicio = fechaPorColumna.get(primeraCol)!.fechaInicio;
      const termino = fechaPorColumna.get(ultimaCol)!.fechaTermino;
      const previo = resultado.get(codigo);
      if (!previo) {
        resultado.set(codigo, { fechaInicio: inicio, fechaTermino: termino });
      } else {
        // fusiona con ocurrencias en otras hojas: rango más amplio (min inicio, max término)
        const nuevoInicio = aFechaUTC(parsearFecha(inicio)!) < aFechaUTC(parsearFecha(previo.fechaInicio)!) ? inicio : previo.fechaInicio;
        const nuevoTermino = aFechaUTC(parsearFecha(termino)!) > aFechaUTC(parsearFecha(previo.fechaTermino)!) ? termino : previo.fechaTermino;
        resultado.set(codigo, { fechaInicio: nuevoInicio, fechaTermino: nuevoTermino });
      }
    });
  }

  return resultado;
}

function escaparCsv(valor: string): string {
  if (/[",\n\r]/.test(valor)) return `"${valor.replace(/"/g, '""')}"`;
  return valor;
}

async function main() {
  const rutaAnon = localizarArchivo("sharepoint_anon.json");
  const rutaPrivateMap = localizarArchivo("private_map.json");
  const rutaStaffingExcel = localizarArchivo("staffing_excel.xlsx");

  const filasAnon: FilaProyecto[] = JSON.parse(readFileSync(rutaAnon, "utf-8"));
  const privateMap: { proyectos: Record<string, string> } = JSON.parse(readFileSync(rutaPrivateMap, "utf-8"));
  const realPorId = new Map<string, string>();
  for (const [real, id] of Object.entries(privateMap.proyectos ?? {})) realPorId.set(id, real);

  const indiceStaffing = await leerStaffingExcel(rutaStaffingExcel);
  const wbMatriz = new ExcelJS.Workbook();
  await wbMatriz.xlsx.readFile(rutaStaffingExcel);
  const indiceMatriz = leerMatrizStaffing(wbMatriz);

  let autocompletadas = 0;
  let porRegex = 0;
  let porTextoExacto = 0;
  let porMatriz = 0;
  let sinCoincidencia = 0;
  let coincidenciaSinFechasValidas = 0;
  let yaEstabanOk = 0;
  let totalInvalidas = 0;

  const filasPendientes: string[][] = [];
  const filasAsociadas: string[][] = [];

  for (const fila of filasAnon) {
    const rawInicio = fila["Fecha Inicio"] ?? "";
    const rawTermino = fila["Fecha término"] ?? "";

    if (!esInvalida(rawInicio, rawTermino)) {
      yaEstabanOk++;
      continue;
    }
    totalInvalidas++;

    const codigoReal = realPorId.get(fila["Código proyecto"] ?? "") ?? "";
    const nombreReal = realPorId.get(fila["Nombre proyecto"] ?? "") ?? "";

    // 1. Código extraído por regex (ej. "PAR04") desde el código/nombre real de SharePoint.
    const codigoSp = extraerCodigo(codigoReal) ?? extraerCodigo(nombreReal);
    let match: FechaPar | undefined;
    let viaRegex = false;

    if (codigoSp) {
      match = indiceStaffing.porCodigoRegex.get(codigoSp);
      if (!match) {
        // el código de SharePoint está "contenido" en el texto de alguna celda del Excel
        const fila2 = indiceStaffing.filasCombinadas.find((f) => f.textoUpper.includes(codigoSp));
        match = fila2 ? { fechaInicio: fila2.fechaInicio, fechaTermino: fila2.fechaTermino } : undefined;
      }
      if (match) viaRegex = true;
    }

    // 2. Fallback: match exacto por nombre/código/cliente normalizado (método anterior).
    if (!match) {
      match =
        (codigoReal && indiceStaffing.porTextoExacto.get(normalizar(codigoReal))) ||
        (nombreReal && indiceStaffing.porTextoExacto.get(normalizar(nombreReal))) ||
        undefined;
    }

    // 3. Deducción desde la matriz/Gantt semanal (primera/última columna con asignaciones).
    let viaMatriz = false;
    if (!match && codigoSp) {
      const deducida = indiceMatriz.get(codigoSp);
      if (deducida) {
        match = deducida;
        viaMatriz = true;
      }
    }

    if (!match) {
      sinCoincidencia++;
      filasPendientes.push([
        fila["Código proyecto"] ?? "",
        fila["Nombre proyecto"] ?? "",
        rawInicio,
        rawTermino,
        "Sin coincidencia en staffing_excel.xlsx",
      ]);
      continue;
    }

    if (esInvalida(match.fechaInicio, match.fechaTermino)) {
      coincidenciaSinFechasValidas++;
      filasPendientes.push([
        fila["Código proyecto"] ?? "",
        fila["Nombre proyecto"] ?? "",
        rawInicio,
        rawTermino,
        "Coincidencia encontrada pero también con fechas inválidas en staffing_excel.xlsx",
      ]);
      continue;
    }

    fila["Fecha Inicio"] = match.fechaInicio;
    fila["Fecha término"] = match.fechaTermino;
    autocompletadas++;
    if (viaMatriz) porMatriz++;
    else if (viaRegex) porRegex++;
    else porTextoExacto++;
    const metodo = viaMatriz ? "matriz staffing" : viaRegex ? "substring" : "texto exacto";
    filasAsociadas.push([codigoReal, nombreReal, match.fechaInicio, match.fechaTermino, metodo]);
  }

  writeFileSync(rutaAnon, JSON.stringify(filasAnon, null, 2), "utf-8");

  const rutaReporte = join(join(rutaAnon, ".."), "reporte_errores_fechas.csv");
  const headersReporte = ["Código proyecto (PROJECT_id)", "Nombre proyecto (PROJECT_id)", "Fecha Inicio actual", "Fecha término actual", "Motivo"];
  const csv = [headersReporte, ...filasPendientes].map((f) => f.map(escaparCsv).join(",")).join("\r\n") + "\r\n";
  writeFileSync(rutaReporte, csv, "utf-8");

  const rutaResumen = join(join(rutaAnon, ".."), "resumen_fechas_asociadas.csv");
  const headersResumen = ["Código proyecto", "Nombre proyecto", "Fecha Inicio asignada", "Fecha término asignada", "Método"];
  const csvResumen = [headersResumen, ...filasAsociadas].map((f) => f.map(escaparCsv).join(",")).join("\r\n") + "\r\n";
  writeFileSync(rutaResumen, csvResumen, "utf-8");

  console.log(`${porMatriz} fechas deducidas desde la matriz de staffing.`);
  console.log("Proceso de matriz completado");
}

main().catch((err) => {
  console.error("❌ Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
