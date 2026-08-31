/**
 * Corrige fechas mal invertidas (DD/MM) en lib/tasks/engagements_master.csv:
 * detecta mes > 12 o Fecha Termino < Fecha Inicio, e invierte día/mes solo si el
 * resultado es una fecha calendario válida (y, de ser por orden, resuelve la inversión).
 * Si no se puede resolver con seguridad, la fila se deja intacta (no se fuerza un par inválido).
 *
 * REGLA DE SEGURIDAD: no imprime en consola nombres de clientes/proyectos/personas — solo conteos.
 *
 * Ejecutar con: npx tsx lib/tasks/fixCsvDates.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const RUTA_CSV = join(__dirname, "engagements_master.csv");
const COL_FECHA_INICIO = 7;
const COL_FECHA_TERMINO = 8;
const NUM_COLUMNAS = 10;

interface FechaYMD { y: number; m: number; d: number }

function parseISO(s: string): FechaYMD | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function esFechaValida(f: FechaYMD): boolean {
  if (f.m < 1 || f.m > 12) return false;
  const diasDelMes = new Date(f.y, f.m, 0).getDate();
  return f.d >= 1 && f.d <= diasDelMes;
}

function toISO(f: FechaYMD): string {
  return `${f.y}-${String(f.m).padStart(2, "0")}-${String(f.d).padStart(2, "0")}`;
}

function invertir(f: FechaYMD): FechaYMD {
  return { y: f.y, m: f.d, d: f.m };
}

// ── Parser CSV mínimo (RFC 4180: comillas dobles, comas y saltos de línea escapados) ──
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

function main() {
  const texto = readFileSync(RUTA_CSV, "utf-8");
  const filas = parseCSV(texto);
  const [header, ...datos] = filas;

  let corregidas = 0;
  let sinResolver = 0;

  const salida = datos.map((fila) => {
    if (fila.length !== NUM_COLUMNAS) return fila; // fila corrupta/inesperada: no se toca

    let inicio = parseISO(fila[COL_FECHA_INICIO]);
    let termino = fila[COL_FECHA_TERMINO] ? parseISO(fila[COL_FECHA_TERMINO]) : null;
    let cambio = false;
    let huboProblema = false;

    // 1. Mes > 12 en cada fecha individualmente
    if (inicio && inicio.m > 12) {
      huboProblema = true;
      const inv = invertir(inicio);
      if (esFechaValida(inv)) { inicio = inv; cambio = true; }
    }
    if (termino && termino.m > 12) {
      huboProblema = true;
      const inv = invertir(termino);
      if (esFechaValida(inv)) { termino = inv; cambio = true; }
    }

    // 2. Termino < Inicio: intenta invertir termino, luego inicio, luego ambos
    if (inicio && termino && toISO(termino) < toISO(inicio)) {
      huboProblema = true;
      const candidatos: [FechaYMD, FechaYMD][] = [
        [inicio, invertir(termino)],
        [invertir(inicio), termino],
        [invertir(inicio), invertir(termino)],
      ];
      const resuelto = candidatos.find(
        ([i, t]) => esFechaValida(i) && esFechaValida(t) && toISO(t) >= toISO(i)
      );
      if (resuelto) {
        [inicio, termino] = resuelto;
        cambio = true;
      }
    }

    if (huboProblema) {
      if (cambio) corregidas++;
      else sinResolver++; // se deja intacta, no se fuerza un par inválido
    }

    const nueva = [...fila];
    if (inicio) nueva[COL_FECHA_INICIO] = toISO(inicio);
    if (termino) nueva[COL_FECHA_TERMINO] = toISO(termino);
    return nueva;
  });

  const lineas = [csvRow(header), ...salida.map(csvRow)];
  writeFileSync(RUTA_CSV, lineas.join("\r\n") + "\r\n", "utf-8");

  console.log(`✅ fixCsvDates completado: ${datos.length} filas revisadas.`);
  console.log(`   - Corregidas: ${corregidas}`);
  console.log(`   - Sin resolver (dejadas intactas): ${sinResolver}`);
}

main();
