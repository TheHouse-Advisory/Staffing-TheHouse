/**
 * Script de anonimización: lee lib/tasks/sharepoint_raw.csv, detecta columnas
 * de personas y proyectos por nombre de encabezado, y genera:
 *  - lib/tasks/private_map.json   → mapeo valor real -> ID ficticio (privado, NO subir a git)
 *  - lib/tasks/sharepoint_anon.json → filas con esas columnas reemplazadas por IDs ficticios
 *
 * Ejecutar con: npx tsx lib/tasks/anonymizeCsv.ts
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";

/** Busca sharepoint_raw.csv probando las rutas típicas según desde dónde se ejecute el script. */
function localizarCsv(): string {
  const candidatos = [
    // Raíz del proyecto principal (evita quedar dentro de un worktree de .claude)
    resolve(process.cwd().split(".claude")[0], "lib/tasks/sharepoint_raw.csv"),
    join(process.cwd(), "lib/tasks/sharepoint_raw.csv"),
    join(__dirname, "sharepoint_raw.csv"),
    resolve("lib/tasks/sharepoint_raw.csv"),
  ];

  for (const candidato of candidatos) {
    if (existsSync(candidato)) return candidato;
  }

  console.error("❌ No se encontró sharepoint_raw.csv. Rutas probadas:");
  candidatos.forEach((c) => console.error(`   - ${c}`));
  throw new Error("sharepoint_raw.csv no encontrado.");
}

const RUTA_CSV = localizarCsv();
console.log(`📄 Leyendo CSV desde: ${RUTA_CSV}`);
const RUTA_MAP = join(dirname(RUTA_CSV), "private_map.json");
const RUTA_ANON = join(dirname(RUTA_CSV), "sharepoint_anon.json");

// Palabras clave para detectar columnas sensibles por nombre de encabezado
// (sin distinguir mayúsculas/acentos).
const KEYWORDS_PERSONA = ["nombre", "apellido", "persona", "consultor", "empleado", "staff", "colaborador", "participantes"];
const KEYWORDS_PROYECTO = ["proyecto", "engagement", "cliente", "project"];

// Columnas que se descartan por completo del resultado (no aportan al análisis
// y/o son datos personales que no vale la pena anonimizar, solo eliminar).
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

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/** Parser CSV simple: soporta campos entre comillas, comas y comillas escapadas (""). */
function parseCsv(contenido: string): { headers: string[]; rows: string[][] } {
  const texto = contenido.replace(/^﻿/, ""); // quitar BOM si existe
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
      if (c === '"') {
        entreComillas = true;
      } else if (c === ",") {
        fila.push(campo);
        campo = "";
      } else if (c === "\r") {
        // ignorar, el \n lo maneja el siguiente char
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

function detectarColumnas(headers: string[], keywords: string[]): number[] {
  return headers
    .map((h, i) => (keywords.some((k) => normalizar(h).includes(k)) ? i : -1))
    .filter((i) => i !== -1);
}

/** Separa una lista de nombres en un mismo campo: JSON-array, o texto con comas/;/saltos de línea. */
function separarNombres(valor: string): string[] {
  const v = valor.trim();
  if (!v) return [];
  if (v.startsWith("[")) {
    try {
      const arr = JSON.parse(v);
      if (Array.isArray(arr)) return arr.map(String).map((s) => s.trim()).filter(Boolean);
    } catch {
      // no era JSON válido, cae al split de texto plano
    }
  }
  return v
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function main() {
  const contenido = readFileSync(RUTA_CSV, "utf-8");
  const { headers, rows } = parseCsv(contenido);

  const idxDescartar = new Set(
    headers.map((h, i) => (COLUMNAS_DESCARTAR.includes(normalizar(h)) ? i : -1)).filter((i) => i !== -1)
  );
  const idxParticipantes = headers.findIndex((h) => normalizar(h) === "participantes");

  const colsPersona = detectarColumnas(headers, KEYWORDS_PERSONA).filter(
    (i) => !idxDescartar.has(i) && i !== idxParticipantes
  );
  const colsProyecto = detectarColumnas(headers, KEYWORDS_PROYECTO).filter((i) => !idxDescartar.has(i));

  if (colsPersona.length === 0 && colsProyecto.length === 0 && idxParticipantes === -1) {
    console.warn("⚠️  No se detectaron columnas de personas ni proyectos. Revisa los encabezados del CSV.");
  }

  const mapaPersonas = new Map<string, string>();
  const mapaProyectos = new Map<string, string>();
  let contadorPersona = 0;
  let contadorProyecto = 0;

  function idFicticio(valor: string, esPersona: boolean): string {
    const mapa = esPersona ? mapaPersonas : mapaProyectos;
    const existente = mapa.get(valor);
    if (existente) return existente;
    const id = esPersona
      ? `PERSON_${String(++contadorPersona).padStart(4, "0")}`
      : `PROJECT_${String(++contadorProyecto).padStart(4, "0")}`;
    mapa.set(valor, id);
    return id;
  }

  const filasAnon = rows.map((fila) => {
    const nueva = [...fila];
    for (const col of colsPersona) {
      const valor = (fila[col] ?? "").trim();
      if (valor) nueva[col] = idFicticio(valor, true);
    }
    for (const col of colsProyecto) {
      const valor = (fila[col] ?? "").trim();
      if (valor) nueva[col] = idFicticio(valor, false);
    }
    if (idxParticipantes !== -1) {
      const nombres = separarNombres(fila[idxParticipantes] ?? "");
      nueva[idxParticipantes] = JSON.stringify(nombres.map((n) => idFicticio(n, true)));
    }
    return headers.reduce<Record<string, string>>((obj, h, i) => {
      if (idxDescartar.has(i)) return obj; // columna descartada, no va en el resultado
      obj[h] = nueva[i] ?? "";
      return obj;
    }, {});
  });

  const mapaPrivado = {
    personas: Object.fromEntries(mapaPersonas),
    proyectos: Object.fromEntries(mapaProyectos),
  };

  writeFileSync(RUTA_MAP, JSON.stringify(mapaPrivado, null, 2), "utf-8");
  writeFileSync(RUTA_ANON, JSON.stringify(filasAnon, null, 2), "utf-8");

  console.log("✅ Anonimización completada.");
  console.log(`   - Filas procesadas: ${rows.length}`);
  console.log(`   - Columnas persona detectadas: ${colsPersona.map((i) => headers[i]).join(", ") || "ninguna"}`);
  console.log(`   - Columnas proyecto detectadas: ${colsProyecto.map((i) => headers[i]).join(", ") || "ninguna"}`);
  console.log(`   - Columna Participantes: ${idxParticipantes !== -1 ? "anonimizada (lista de PERSON_XXXX)" : "no encontrada"}`);
  console.log(`   - Columnas descartadas: ${[...idxDescartar].map((i) => headers[i]).join(", ") || "ninguna"}`);
  console.log(`   - Personas únicas: ${mapaPersonas.size} | Proyectos únicos: ${mapaProyectos.size}`);
  console.log(`   - Mapa privado: ${RUTA_MAP}`);
  console.log(`   - Datos anonimizados: ${RUTA_ANON}`);
}

main();
