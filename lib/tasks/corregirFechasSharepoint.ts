/**
 * Corrige la confusión de formato de fecha (MM/DD vs DD/MM) en
 * lib/tasks/sharepoint_raw.csv, en las columnas "Fecha Inicio" y "Fecha término".
 *
 * Reglas de corrección por fila:
 *  1. Inequívoca: si el "mes" de una fecha es > 12 (imposible como mes) y el
 *     "día" es <= 12, se intercambian día/mes (ej: 10/22/2018 -> 22/10/2018).
 *  2. Ambigua (ambos números <= 12): si tras la regla 1 la Fecha término sigue
 *     siendo anterior a la Fecha Inicio, se intercambia día/mes de Fecha
 *     término (y si aún no se resuelve, también de Fecha Inicio) — el mismo
 *     criterio que ya usaba generarReporteErrores.ts para detectar el problema.
 *  3. Si ninguna combinación resuelve el orden, la fila queda sin tocar y se
 *     cuenta como "no resuelta" para revisión manual.
 *
 * Hace un respaldo del CSV original antes de sobrescribirlo.
 * No imprime datos reales en consola — solo un resumen numérico.
 *
 * Ejecutar con: npx tsx lib/tasks/corregirFechasSharepoint.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
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
    .toLowerCase();
}

/** Parser CSV simple: soporta campos entre comillas, comas y comillas escapadas (""). */
function parseCsv(contenido: string): { headers: string[]; rows: string[][] } {
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
  const filasNoVacias = filas.filter((f) => f.some((v) => v.trim() !== ""));
  const [headers, ...rows] = filasNoVacias;
  return { headers: headers ?? [], rows };
}

function escaparCsv(valor: string): string {
  if (/[",\n\r]/.test(valor)) return `"${valor.replace(/"/g, '""')}"`;
  return valor;
}

function escribirCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((f) => f.map(escaparCsv).join(",")).join("\r\n") + "\r\n";
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

function intercambiar(p: Fecha): Fecha {
  return { d: p.m, m: p.d, y: p.y };
}

function formatear(p: Fecha): string {
  return `${p.d}/${p.m}/${p.y}`;
}

function main() {
  const rutaCsv = localizarArchivo("sharepoint_raw.csv");
  const contenido = readFileSync(rutaCsv, "utf-8");
  const { headers, rows } = parseCsv(contenido);

  const idxInicio = headers.findIndex((h) => normalizar(h) === "fecha inicio");
  const idxTermino = headers.findIndex((h) => normalizar(h).includes("fecha termino") || normalizar(h).includes("fecha fin"));

  if (idxInicio === -1 || idxTermino === -1) {
    throw new Error("No se encontraron las columnas 'Fecha Inicio' / 'Fecha término' en el CSV.");
  }

  let corregidasInequivocas = 0;
  let corregidasPorOrden = 0;
  let sinCambios = 0;
  let noResueltas = 0;

  const filasCorregidas = rows.map((fila) => {
    const nueva = [...fila];
    const rawInicio = (fila[idxInicio] ?? "").trim();
    const rawTermino = (fila[idxTermino] ?? "").trim();
    let pInicio = parsearFecha(rawInicio);
    let pTermino = parsearFecha(rawTermino);

    if (!pInicio || !pTermino) {
      sinCambios++;
      return nueva;
    }

    let cambioInequivoco = false;

    // Regla 1: mes imposible (>12) con día válido como mes (<=12) -> swap seguro.
    if (pTermino.m > 12 && pTermino.d <= 12) {
      pTermino = intercambiar(pTermino);
      cambioInequivoco = true;
    }
    if (pInicio.m > 12 && pInicio.d <= 12) {
      pInicio = intercambiar(pInicio);
      cambioInequivoco = true;
    }

    let cambioPorOrden = false;
    if (aFechaUTC(pTermino) < aFechaUTC(pInicio)) {
      // Regla 2: ambiguo (ambos <=12) -> probar swap de término, luego de inicio.
      if (pTermino.d <= 12 && pTermino.m <= 12) {
        const candidato = intercambiar(pTermino);
        if (aFechaUTC(candidato) >= aFechaUTC(pInicio)) {
          pTermino = candidato;
          cambioPorOrden = true;
        }
      }
      if (aFechaUTC(pTermino) < aFechaUTC(pInicio) && pInicio.d <= 12 && pInicio.m <= 12) {
        const candidato = intercambiar(pInicio);
        if (aFechaUTC(pTermino) >= aFechaUTC(candidato)) {
          pInicio = candidato;
          cambioPorOrden = true;
        }
      }
    }

    if (aFechaUTC(pTermino) < aFechaUTC(pInicio)) {
      noResueltas++;
      return nueva; // no se pudo resolver, se deja el original sin tocar
    }

    if (cambioInequivoco) corregidasInequivocas++;
    else if (cambioPorOrden) corregidasPorOrden++;
    else sinCambios++;

    nueva[idxInicio] = formatear(pInicio);
    nueva[idxTermino] = formatear(pTermino);
    return nueva;
  });

  // Respaldo del original antes de sobrescribir.
  const dirBackups = join(join(rutaCsv, ".."), "backups");
  mkdirSync(dirBackups, { recursive: true });
  const fecha = new Date().toISOString().slice(0, 10);
  const rutaBackup = join(dirBackups, `sharepoint_raw_antes_correccion_${fecha}.csv`);
  writeFileSync(rutaBackup, contenido, "utf-8");

  writeFileSync(rutaCsv, escribirCsv(headers, filasCorregidas), "utf-8");

  console.log("✅ Corrección de fechas completada.");
  console.log(`   - Filas totales: ${rows.length}`);
  console.log(`   - Corregidas (mes imposible >12, swap inequívoco): ${corregidasInequivocas}`);
  console.log(`   - Corregidas (por orden término/inicio, caso ambiguo): ${corregidasPorOrden}`);
  console.log(`   - Sin cambios (ya estaban OK o sin datos): ${sinCambios}`);
  console.log(`   - No resueltas (requieren revisión manual): ${noResueltas}`);
  console.log(`   - Respaldo del original: ${rutaBackup}`);
  console.log(`   - Archivo corregido: ${rutaCsv}`);
}

main();
