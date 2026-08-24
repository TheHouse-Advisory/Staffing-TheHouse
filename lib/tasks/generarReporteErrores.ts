/**
 * Script de validación: compara lib/tasks/sharepoint_raw.csv contra
 * lib/tasks/match_personas.json y genera lib/tasks/reporte_errores_sharepoint.csv
 * con 2 columnas nuevas: ESTADO_VALIDACION y DETALLE_ERROR.
 *
 * Detecta: fechas vacías, posible inversión de formato DD/MM en "Fecha término"
 * anterior a "Fecha Inicio", y participantes que no aparecen en match_personas.json.
 *
 * No imprime nombres reales en consola — solo un resumen numérico.
 *
 * Ejecutar con: npx tsx lib/tasks/generarReporteErrores.ts
 */
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

/** Escapa un valor para CSV (comillas si contiene coma, comillas o salto de línea). */
function escaparCsv(valor: string): string {
  if (/[",\n\r]/.test(valor)) return `"${valor.replace(/"/g, '""')}"`;
  return valor;
}

function escribirCsv(headers: string[], rows: string[][]): string {
  const lineas = [headers, ...rows].map((fila) => fila.map(escaparCsv).join(","));
  return lineas.join("\r\n") + "\r\n";
}

function separarNombres(valor: string): string[] {
  const v = valor.trim();
  if (!v) return [];
  if (v.startsWith("[")) {
    try {
      const arr = JSON.parse(v);
      if (Array.isArray(arr)) return arr.map(String).map((s) => s.trim()).filter(Boolean);
    } catch {
      // no era JSON, cae al split de texto plano
    }
  }
  return v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
}

type FechaPartes = { d: number; m: number; y: number } | null;

function parsearFechaPartes(valor: string): FechaPartes {
  const m = valor.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return { d: Number(m[1]), m: Number(m[2]), y: Number(m[3]) };
}

function aFechaUTC(p: { d: number; m: number; y: number }): number {
  return Date.UTC(p.y, p.m - 1, p.d);
}

/** true si d/m se pueden intercambiar sin generar una fecha inválida (ambos <=12, o el propio mes <=31 como día). */
function puedeIntercambiar(p: { d: number; m: number; y: number }): boolean {
  return p.m <= 12 && p.d <= 12; // ambigüedad real solo si ambos caben como día y como mes
}

function encontrarIndice(headers: string[], objetivo: string): number {
  return headers.findIndex((h) => normalizar(h) === objetivo);
}

function main() {
  const rutaCsv = localizarArchivo("sharepoint_raw.csv");
  const rutaMatch = localizarArchivo("match_personas.json");

  const contenido = readFileSync(rutaCsv, "utf-8");
  const { headers: headersOriginales, rows: rowsOriginales } = parseCsv(contenido);

  // Mismas columnas descartadas que en anonymizeCsv.ts: datos personales sin
  // anonimizar que no deben propagarse a los reportes derivados.
  const COLUMNAS_DESCARTAR = [
    "contraparte",
    "cargo contraparte",
    "link",
    "modificado por",
    "creado",
    "modificado",
    "encargado de proyecto n°1 (creador proyecto/modificador prez antiguo)",
    "encargado de proyecto n°2 (participante antiguo)",
    "encargado de proyecto n°3 (modificador prez reciente)",
  ];
  const idxMantener = headersOriginales
    .map((h, i) => i)
    .filter((i) => !COLUMNAS_DESCARTAR.includes(normalizar(headersOriginales[i])));
  const headers = idxMantener.map((i) => headersOriginales[i]);
  const rows = rowsOriginales.map((fila) => idxMantener.map((i) => fila[i] ?? ""));

  const matchPersonas: { coincidencias_exactas: Array<{ nombres_csv: string[] }> } = JSON.parse(
    readFileSync(rutaMatch, "utf-8")
  );
  const nombresMapeados = new Set<string>();
  for (const grupo of matchPersonas.coincidencias_exactas ?? []) {
    for (const n of grupo.nombres_csv ?? []) nombresMapeados.add(normalizar(n));
  }

  const idxInicio = encontrarIndice(headers, "fecha inicio");
  const idxTermino = headers.findIndex((h) => normalizar(h).includes("fecha termino") || normalizar(h).includes("fecha fin"));
  const idxParticipantes = headers.findIndex((h) => normalizar(h) === "participantes");

  let okCount = 0;
  let revisarCount = 0;
  let contFechaVacia = 0;
  let contFechaInvertida = 0;
  let contFechaInvalida = 0;
  let contPersonaNoMapeada = 0;

  const filasSalida: string[][] = [];

  for (const fila of rows) {
    const errores: string[] = [];

    if (idxInicio !== -1 && idxTermino !== -1) {
      const rawInicio = (fila[idxInicio] ?? "").trim();
      const rawTermino = (fila[idxTermino] ?? "").trim();

      if (!rawInicio || !rawTermino) {
        errores.push(!rawInicio && !rawTermino ? "Fecha Inicio y Fecha término vacías" : !rawInicio ? "Fecha Inicio vacía" : "Fecha término vacía");
        contFechaVacia++;
      } else {
        const pInicio = parsearFechaPartes(rawInicio);
        const pTermino = parsearFechaPartes(rawTermino);
        if (!pInicio || !pTermino) {
          errores.push("Formato de fecha no reconocido");
          contFechaInvalida++;
        } else {
          const fInicio = aFechaUTC(pInicio);
          const fTermino = aFechaUTC(pTermino);
          if (fTermino < fInicio) {
            // ¿Se resuelve intercambiando día/mes en alguna de las dos fechas? (confusión DD/MM vs MM/DD)
            const combos: number[] = [];
            if (puedeIntercambiar(pTermino)) combos.push(aFechaUTC({ ...pTermino, d: pTermino.m, m: pTermino.d }) - fInicio);
            if (puedeIntercambiar(pInicio)) combos.push(fTermino - aFechaUTC({ ...pInicio, d: pInicio.m, m: pInicio.d }));
            if (puedeIntercambiar(pInicio) && puedeIntercambiar(pTermino)) {
              combos.push(
                aFechaUTC({ ...pTermino, d: pTermino.m, m: pTermino.d }) - aFechaUTC({ ...pInicio, d: pInicio.m, m: pInicio.d })
              );
            }
            if (combos.some((diff) => diff >= 0)) {
              errores.push("Fecha término anterior a inicio por confusión de formato DD/MM");
              contFechaInvertida++;
            } else {
              errores.push("Fecha término anterior a fecha de inicio");
              contFechaInvertida++;
            }
          }
        }
      }
    }

    if (idxParticipantes !== -1) {
      const nombres = separarNombres(fila[idxParticipantes] ?? "");
      const noMapeados = nombres.filter((n) => !nombresMapeados.has(normalizar(n)));
      if (noMapeados.length > 0) {
        errores.push(noMapeados.length === nombres.length ? "Persona no mapeada" : `Persona no mapeada (${noMapeados.length}/${nombres.length})`);
        contPersonaNoMapeada++;
      }
    }

    const estado = errores.length > 0 ? "REVISAR" : "OK";
    if (estado === "REVISAR") revisarCount++;
    else okCount++;

    filasSalida.push([...fila, estado, errores.join("; ")]);
  }

  const headersSalida = [...headers, "ESTADO_VALIDACION", "DETALLE_ERROR"];
  const rutaSalida = join(join(rutaCsv, ".."), "reporte_errores_sharepoint.csv");
  writeFileSync(rutaSalida, escribirCsv(headersSalida, filasSalida), "utf-8");

  console.log(`   - Filas analizadas: ${rows.length}`);
  console.log(`   - OK: ${okCount}`);
  console.log(`   - REVISAR: ${revisarCount}`);
  console.log(`     · Fechas vacías: ${contFechaVacia}`);
  console.log(`     · Fechas invertidas/orden inválido: ${contFechaInvertida}`);
  console.log(`     · Fechas con formato no reconocido: ${contFechaInvalida}`);
  console.log(`     · Filas con alguna persona no mapeada: ${contPersonaNoMapeada}`);
  console.log("Reporte generado en lib/tasks/reporte_errores_sharepoint.csv");
}

main();
