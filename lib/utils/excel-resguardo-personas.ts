/**
 * Genera el Excel de respaldo de personas (Reportes > Descargables), con dos hojas:
 *  - "Info personas [año]": ficha consolidada por persona, ordenada por cargo (CARGOS) y apellido.
 *  - "Anotaciones [año]": listado de la sección Anotaciones (sidebar) del año actual.
 */
import ExcelJS from "exceljs";
import { CARGOS } from "@/lib/constants";
import type { PersonaResguardoInfo } from "@/lib/queries/personas";
import type { Anotacion, AnotacionFolder } from "@/lib/types/database";

const COLUMNS = [
  { header: "Nombre", key: "nombre", width: 16 },
  { header: "Apellido", key: "apellido", width: 16 },
  { header: "Cargo Actual", key: "cargo", width: 24 },
  { header: "Mentor / Mentoreados", key: "mentor", width: 40 },
  { header: "Ausencias (año actual)", key: "ausencias", width: 55 },
  { header: "Desarrollo de Carrera", key: "desarrollo", width: 45 },
  { header: "Matriz de Talento", key: "matriz", width: 35 },
  { header: "Notebook de Desarrollo (Anotaciones)", key: "notebook", width: 60 },
];

const ANOTACIONES_COLUMNS = [
  { header: "Fecha", key: "fecha", width: 14 },
  { header: "Persona / Autor", key: "autor", width: 22 },
  { header: "Carpeta", key: "carpeta", width: 22 },
  { header: "Título", key: "titulo", width: 30 },
  { header: "Nota / Contenido", key: "contenido", width: 60 },
];

function estilarHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A1A2E" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

function ordenCargo(cargo: string | null): number {
  if (!cargo) return CARGOS.length;
  const idx = (CARGOS as readonly string[]).indexOf(cargo);
  return idx === -1 ? CARGOS.length : idx;
}

function textoMentor(p: PersonaResguardoInfo): string {
  const mentor = p.mentor ? `Su mentor es ${p.mentor.nombreCompleto}.` : "No tiene mentor asignado.";
  const mentoreados = p.mentoreados.length > 0
    ? `Es mentor/a de ${p.mentoreados.map((m) => m.nombreCompleto).join(", ")}.`
    : "No es mentor/a de nadie.";
  return `${mentor}\n${mentoreados}`;
}

function textoAusencias(p: PersonaResguardoInfo, anio: number): string {
  const { totalDiasAnioActual, ausenciasPasadasAnioActual, ausenciasFuturas } = p.ausencias;
  const detalle = (lista: typeof ausenciasFuturas) =>
    lista.map((a) => `${a.tipoLabel} (${a.fechaInicio} a ${a.fechaFin}, ${a.numDias} día${a.numDias === 1 ? "" : "s"})`).join("; ");

  return [
    `Total días ${anio}: ${totalDiasAnioActual}`,
    `Ausencias pasadas: ${ausenciasPasadasAnioActual.length > 0 ? detalle(ausenciasPasadasAnioActual) : "sin registros."}`,
    `Ausencias futuras: ${ausenciasFuturas.length > 0 ? detalle(ausenciasFuturas) : "sin registros."}`,
  ].join("\n");
}

function textoDesarrollo(p: PersonaResguardoInfo): string {
  const ingreso = p.fechaIngreso ? `Fecha de ingreso: ${p.fechaIngreso}` : "Fecha de ingreso: no registrada.";
  const cargos = p.historialCargos.length > 0
    ? p.historialCargos.map((h) => `${h.cargo} (${h.fecha_inicio} a ${h.fecha_fin ?? "actual"})`).join("; ")
    : "sin registros.";
  return `${ingreso}\nHistorial de cargos: ${cargos}`;
}

function textoMatrizTalento(p: PersonaResguardoInfo): string {
  const { potencial, desempeno, cuadrante } = p.matrizTalento;
  const posicion = cuadrante
    ? `Cuadrante: ${cuadrante} (Potencial: ${potencial}, Desempeño: ${desempeno})`
    : "Sin evaluación de matriz de talento.";
  return [
    posicion,
    `Apalancador/a: ${p.isLeverager ? "Sí" : "No"}`,
    `Referente: ${p.referente ? "Sí" : "No"}`,
  ].join("\n");
}

function textoNotebook(p: PersonaResguardoInfo): string {
  if (p.notas.length === 0) return "Sin anotaciones registradas.";
  return p.notas
    .map((n) => `${n.titulo}${n.carpeta ? ` [${n.carpeta}]` : ""}: ${n.contenido || "(sin contenido)"}`)
    .join("\n\n");
}

export async function buildExcelPersonasResguardo(
  personas: PersonaResguardoInfo[],
  anotaciones: Anotacion[],
  folders: AnotacionFolder[]
): Promise<Buffer> {
  const anio = new Date().getFullYear();
  const wb = new ExcelJS.Workbook();

  // ── Hoja 1: Info personas ────────────────────────────────────
  const ordenadas = [...personas].sort((a, b) => {
    const diff = ordenCargo(a.cargoActual) - ordenCargo(b.cargoActual);
    return diff !== 0 ? diff : a.apellido.localeCompare(b.apellido, "es");
  });

  const sheetPersonas = wb.addWorksheet(`Info personas ${anio}`, { views: [{ state: "frozen", ySplit: 1 }] });
  sheetPersonas.columns = COLUMNS;
  estilarHeader(sheetPersonas.getRow(1));

  for (const p of ordenadas) {
    const row = sheetPersonas.addRow({
      nombre: p.nombre,
      apellido: p.apellido,
      cargo: p.cargoActual ?? "—",
      mentor: textoMentor(p),
      ausencias: textoAusencias(p, anio),
      desarrollo: textoDesarrollo(p),
      matriz: textoMatrizTalento(p),
      notebook: textoNotebook(p),
    });
    row.alignment = { vertical: "top", wrapText: true };
  }

  // ── Hoja 2: Anotaciones del año actual ────────────────────────
  const folderNombre = new Map(folders.map((f) => [f.id, f.nombre]));
  const anotacionesAnio = anotaciones
    .filter((a) => new Date(a.created_at).getFullYear() === anio)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const sheetAnotaciones = wb.addWorksheet(`Anotaciones ${anio}`, { views: [{ state: "frozen", ySplit: 1 }] });
  sheetAnotaciones.columns = ANOTACIONES_COLUMNS;
  estilarHeader(sheetAnotaciones.getRow(1));

  for (const a of anotacionesAnio) {
    const row = sheetAnotaciones.addRow({
      fecha: a.created_at.split("T")[0],
      autor: a.creado_por ?? "—",
      carpeta: a.folder_id ? folderNombre.get(a.folder_id) ?? "—" : "Sin carpeta",
      titulo: a.titulo,
      contenido: a.contenido || "(sin contenido)",
    });
    row.alignment = { vertical: "top", wrapText: true };
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
