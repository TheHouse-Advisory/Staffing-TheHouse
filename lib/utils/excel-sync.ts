/**
 * Sincroniza el reporte "Resumen de Proyectos" a un libro Excel único
 * guardado en Supabase Storage, con dos pestañas por año ("2026",
 * "Resumen ausencias 2026", ...). Si la pestaña del año existe, se
 * sobrescribe; si no, se crea con la estructura completa del año.
 *
 * Pestaña "[Año]": replica la simbología de
 * app/(dashboard)/reportes/resumen-proyectos/ResumenProyectosClient.tsx:
 *   Confirmados "X + Y" negrita/negro · Propuestos "X/Y" gris · Sin asignar "?" rojo.
 *
 * Pestaña "Resumen ausencias [Año]": replica la matriz de
 * components/ausencias/HeatmapAusencias.tsx (personas x días hábiles),
 * con el mismo relleno de color por tipo (COLOR_AUSENCIA) y la
 * descripción de la ausencia como comentario de celda.
 *
 * Nombres de pestaña (ver nombresHojaAnio): el año ACTUAL usa el nombre
 * "en vivo" ("staffing [año]" / "Resumen ausencias [año]"); los demás años
 * usan el nombre de archivo histórico ("Lista proyectos [año]" / "Lista
 * housers [año]"). Al cambiar de año, la pestaña se renombra sola.
 */
import ExcelJS from "exceljs";
import { CARGOS } from "@/lib/constants";
import { getIniciales } from "@/lib/utils/iniciales";
import { SENIORITY_ORDER, COLOR_AUSENCIA, diasDelMes } from "@/lib/queries/ausencias";
import type { TipoAusencia } from "@/lib/types/database";

export const EXCEL_SYNC_BUCKET = "reportes";
export const EXCEL_SYNC_PATH = "resumen-proyectos.xlsx";

// ── Tipos (espejo de ResumenProyectosClient.tsx) ──────────────────

interface EngRow {
  id: string;
  codigo: string | null;
  nombre: string;
  cliente: string;
  tipo: string;
  sort_order: number | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  estado: "activo" | "terminado";
}

interface ReqRow {
  engagement_id: string;
  cargo: string;
  fecha_inicio: string;
  fecha_fin: string;
}

interface AsigRow {
  engagement_id: string;
  cargo: string;
  iniciales: string;
  estado_staffing: "CONFIRMADO" | "PLAN";
  fecha_inicio: string;
  fecha_fin: string | null;
}

interface Semana {
  label: string;
  inicio: string; // yyyy-MM-dd (lunes)
  fin: string; // yyyy-MM-dd (viernes)
}

interface LineaCelda {
  textoConfirmado: string;
  textoPlan: string;
  vacio: boolean;
}

interface PersonaAus {
  id: string;
  nombre: string;
  apellido: string;
  cargo_actual: string | null;
}

interface AusenciaRow {
  persona_id: string;
  tipo: TipoAusencia;
  fecha_inicio: string;
  fecha_fin: string;
  descripcion: string | null;
}

export interface SyncResult {
  anios: number[];
  buffer: Buffer;
}

// ── Helpers de fechas/semanas ──────────────────────────────────────

function solapan(aInicio: string, aFin: string | null, bInicio: string, bFin: string): boolean {
  const aF = aFin ?? "9999-12-31";
  return aInicio <= bFin && aF >= bInicio;
}

function lunesDe(fecha: Date): Date {
  const d = new Date(fecha);
  const dia = d.getDay(); // 0 = domingo
  d.setDate(d.getDate() + (dia === 0 ? -6 : 1 - dia));
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** yyyy-MM-dd -> DD/MM/AAAA (para columnas Inicio/Término). */
function fmtDDMMYYYY(fecha: string): string {
  const [y, m, d] = fecha.split("-");
  return `${d}/${m}/${y}`;
}

/** Todas las semanas (lunes a viernes) cuyo lunes cae dentro del año dado. */
function generarSemanasAnio(anio: number): Semana[] {
  const semanas: Semana[] = [];
  let lunes = lunesDe(new Date(anio, 0, 1));
  if (lunes.getFullYear() < anio) lunes = new Date(lunes.getTime() + 7 * 86400000);
  while (lunes.getFullYear() === anio) {
    const viernes = new Date(lunes.getTime() + 4 * 86400000);
    semanas.push({
      label: `${String(lunes.getDate()).padStart(2, "0")}/${String(lunes.getMonth() + 1).padStart(2, "0")} a ${String(viernes.getDate()).padStart(2, "0")}/${String(viernes.getMonth() + 1).padStart(2, "0")}`,
      inicio: fmt(lunes),
      fin: fmt(viernes),
    });
    lunes = new Date(lunes.getTime() + 7 * 86400000);
  }
  return semanas;
}

// ── Simbología (idéntica a ResumenProyectosClient.tsx) ─────────────

function buildLineas(engId: string, semana: Semana, reqs: ReqRow[], asigs: AsigRow[]): LineaCelda[] {
  const reqsActivos = reqs.filter(
    (r) => r.engagement_id === engId && solapan(r.fecha_inicio, r.fecha_fin, semana.inicio, semana.fin)
  );
  if (reqsActivos.length === 0) return [];

  const asigsSemana = asigs.filter(
    (a) => a.engagement_id === engId && solapan(a.fecha_inicio, a.fecha_fin, semana.inicio, semana.fin)
  );

  const cargosConReq = [...new Set(reqsActivos.map((r) => r.cargo))];
  const cargosOrdenados = [
    ...CARGOS.filter((c) => cargosConReq.includes(c)),
    ...cargosConReq.filter((c) => !(CARGOS as readonly string[]).includes(c)),
  ];

  return cargosOrdenados.map((cargo) => {
    const asigsCargo = asigsSemana.filter((a) => {
      // Normalizar: Director de Proyectos <-> Gerente de Proyectos cuentan para el mismo req (idem UI)
      const esDG = ["Director de Proyectos", "Gerente de Proyectos"].includes(a.cargo);
      const reqEsDG = ["Director de Proyectos", "Gerente de Proyectos"].includes(cargo);
      const esACS = ["Asociado", "Consultor Senior"].includes(a.cargo);
      const reqEsACS = ["Asociado", "Consultor Senior"].includes(cargo);
      if (esDG && reqEsDG) return true;
      if (esACS && reqEsACS) return true;
      return a.cargo === cargo;
    });

    const confirmados = asigsCargo.filter((a) => a.estado_staffing === "CONFIRMADO");
    const plan = asigsCargo.filter((a) => a.estado_staffing === "PLAN");

    return {
      textoConfirmado: confirmados.map((a) => a.iniciales).join(" + "),
      textoPlan: plan.map((a) => a.iniciales).join("/"),
      vacio: confirmados.length === 0 && plan.length === 0,
    };
  });
}

/**
 * Roster para la columna "Equipo": a diferencia de buildLineas, se arma directo
 * desde las asignaciones (no depende de que exista un requerimiento activo esa
 * fecha), para no dejar vacíos engagements con personas staffeadas pero sin
 * requerimiento formal cubriendo la fecha de referencia.
 */
function buildEquipoLineas(engId: string, fecha: string, asigs: AsigRow[]): LineaCelda[] {
  const asigsDia = asigs.filter((a) => a.engagement_id === engId && solapan(a.fecha_inicio, a.fecha_fin, fecha, fecha));
  if (asigsDia.length === 0) return [];

  const cargosConAsig = [...new Set(asigsDia.map((a) => a.cargo))];
  const cargosOrdenados = [
    ...CARGOS.filter((c) => cargosConAsig.includes(c)),
    ...cargosConAsig.filter((c) => !(CARGOS as readonly string[]).includes(c)),
  ];

  return cargosOrdenados.map((cargo) => {
    const asigsCargo = asigsDia.filter((a) => a.cargo === cargo);
    const confirmados = asigsCargo.filter((a) => a.estado_staffing === "CONFIRMADO");
    const plan = asigsCargo.filter((a) => a.estado_staffing === "PLAN");
    return {
      textoConfirmado: confirmados.map((a) => a.iniciales).join(" + "),
      textoPlan: plan.map((a) => a.iniciales).join("/"),
      vacio: false, // sin noción de "requerimiento sin cubrir" acá
    };
  });
}

const FONT_CONFIRMADO = { bold: true, color: { argb: "FF1A1A1A" } };
const FONT_PLAN = { color: { argb: "FF888888" }, italic: true };
const FONT_SEPARADOR = { color: { argb: "FFCCCCCC" } };
const FONT_VACIO = { bold: true, color: { argb: "FFE53E3E" } };

function celdaRichText(lineas: LineaCelda[]): ExcelJS.CellValue {
  if (lineas.length === 0) return "";
  const richText: { font?: Partial<ExcelJS.Font>; text: string }[] = [];
  lineas.forEach((l, i) => {
    if (i > 0) richText.push({ text: "\n" });
    if (l.textoPlan) richText.push({ font: FONT_PLAN, text: l.textoPlan });
    if (l.textoPlan && l.textoConfirmado) richText.push({ font: FONT_SEPARADOR, text: " · " });
    if (l.textoConfirmado) richText.push({ font: FONT_CONFIRMADO, text: l.textoConfirmado });
    if (l.vacio) richText.push({ font: FONT_VACIO, text: "?" });
  });
  return { richText } as unknown as ExcelJS.CellValue;
}

// ── Nombres de pestaña: el año ACTUAL usa el nombre "en vivo"; los demás
//    años (pasados o futuros) usan el nombre de archivo histórico. Al cambiar
//    de año, la pestaña se renombra sola (se limpian los nombres de eras
//    anteriores) para que el libro nunca acumule pestañas duplicadas. ──

function nombresHojaAnio(anio: number, anioActual: number) {
  const esActual = anio === anioActual;
  const proyectos = esActual ? `staffing ${anio}` : `Lista proyectos ${anio}`;
  const ausencias = esActual ? `Resumen ausencias ${anio}` : `Lista housers ${anio}`;
  const legacyProyectos = [`${anio}`, `staffing ${anio}`, `Lista proyectos ${anio}`].filter((n) => n !== proyectos);
  const legacyAusencias = [`Resumen ausencias ${anio}`, `Lista housers ${anio}`].filter((n) => n !== ausencias);
  return { proyectos, ausencias, legacyProyectos, legacyAusencias };
}

function removerHojasLegacy(workbook: ExcelJS.Workbook, nombres: string[]) {
  for (const nombre of nombres) {
    const hoja = workbook.getWorksheet(nombre);
    if (hoja) workbook.removeWorksheet(hoja.id);
  }
}

// ── Hoja de ausencias (espejo de HeatmapAusencias.tsx) ──

function hexToArgb(hex: string): string {
  return `FF${hex.replace("#", "").toUpperCase()}`;
}

function seniorityIdx(cargo: string | null): number {
  if (!cargo) return SENIORITY_ORDER.length;
  const idx = SENIORITY_ORDER.findIndex((s) => s.toLowerCase() === cargo.toLowerCase());
  return idx === -1 ? SENIORITY_ORDER.length : idx;
}

/** Todos los días hábiles (lun-vie) del año, mes a mes. */
function diasHabilesAnio(anio: number): string[] {
  const dias: string[] = [];
  for (let mes = 1; mes <= 12; mes++) dias.push(...diasDelMes(anio, mes));
  return dias;
}

function escribirHojaAusencias(
  workbook: ExcelJS.Workbook,
  nombreHoja: string,
  anio: number,
  personas: PersonaAus[],
  ausencias: AusenciaRow[]
) {
  const existente = workbook.getWorksheet(nombreHoja);
  if (existente) workbook.removeWorksheet(existente.id);
  const sheet = workbook.addWorksheet(nombreHoja);

  const dias = diasHabilesAnio(anio);
  const personasOrdenadas = [...personas].sort((a, b) => {
    const si = seniorityIdx(a.cargo_actual) - seniorityIdx(b.cargo_actual);
    return si !== 0 ? si : a.apellido.localeCompare(b.apellido, "es");
  });

  // Fila 1: mes (celdas fusionadas) — Fila 2: día/mes — Fila 3+: personas
  const filaMes = sheet.getRow(1);
  const filaDia = sheet.getRow(2);
  filaDia.getCell(1).value = "Persona";
  filaMes.getCell(1).value = "";

  let mesActual = -1;
  let inicioBloqueMes = 2; // columna donde empieza el mes actual
  dias.forEach((fechaIso, i) => {
    const col = 2 + i;
    const fecha = new Date(fechaIso + "T00:00:00");
    filaDia.getCell(col).value = fecha.getDate();
    filaDia.getCell(col).alignment = { horizontal: "center" };

    const mes = fecha.getMonth();
    if (mes !== mesActual) {
      if (mesActual !== -1 && inicioBloqueMes < col) {
        sheet.mergeCells(1, inicioBloqueMes, 1, col - 1);
      }
      mesActual = mes;
      inicioBloqueMes = col;
      filaMes.getCell(col).value = fecha.toLocaleDateString("es-CL", { month: "short" }).toUpperCase();
      filaMes.getCell(col).alignment = { horizontal: "center" };
      filaMes.getCell(col).font = { bold: true, size: 9 };
    }
  });
  if (inicioBloqueMes < 2 + dias.length - 1) sheet.mergeCells(1, inicioBloqueMes, 1, 1 + dias.length);

  [filaMes, filaDia].forEach((row) => {
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9F9F9" } };
      cell.border = { bottom: { style: "thin" } };
    });
  });
  filaDia.getCell(1).font = { bold: true };

  // Ausencias por persona, indexadas para lookup rápido por día
  const ausPorPersona = new Map<string, AusenciaRow[]>();
  ausencias.forEach((a) => {
    if (!ausPorPersona.has(a.persona_id)) ausPorPersona.set(a.persona_id, []);
    ausPorPersona.get(a.persona_id)!.push(a);
  });

  personasOrdenadas.forEach((p, idx) => {
    const row = sheet.getRow(3 + idx);
    row.getCell(1).value = `${p.nombre} ${p.apellido}`;
    const ausPersona = ausPorPersona.get(p.id) ?? [];

    dias.forEach((fechaIso, i) => {
      const cell = row.getCell(2 + i);
      const aus = ausPersona.find((a) => solapan(a.fecha_inicio, a.fecha_fin, fechaIso, fechaIso));
      if (!aus) return;
      const color = COLOR_AUSENCIA[aus.tipo]?.bg ?? "#9ca3af";
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: hexToArgb(color) } };
      if (aus.descripcion) {
        cell.note = aus.descripcion;
      }
    });
  });

  sheet.getColumn(1).width = 28;
  for (let c = 2; c <= dias.length + 1; c++) sheet.getColumn(c).width = 3;
}

// ── Escritura de la hoja ────────────────────────────────────────────

function escribirBloque(
  sheet: ExcelJS.Worksheet,
  filaInicio: number,
  titulo: string,
  engs: EngRow[],
  semanas: Semana[],
  reqs: ReqRow[],
  asigs: AsigRow[]
): number {
  if (engs.length === 0) return filaInicio;
  let fila = filaInicio;

  sheet.getCell(fila, 1).value = titulo;
  sheet.getCell(fila, 1).font = { bold: true, size: 12 };
  fila++;

  const filaHeader = sheet.getRow(fila);
  filaHeader.getCell(1).value = "Proyecto";
  filaHeader.getCell(2).value = "Inicio";
  filaHeader.getCell(3).value = "Término";
  filaHeader.getCell(4).value = "Equipo";
  semanas.forEach((s, i) => (filaHeader.getCell(5 + i).value = s.label));
  filaHeader.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9F9F9" } };
    cell.border = { bottom: { style: "thin" } };
  });
  fila++;

  // Staffing vigente hoy o, si el engagement ya terminó, el último equipo real:
  // se toma la fecha más tardía con una asignación (no la fecha_fin del engagement,
  // que puede no calzar exacto con esos registros y dejar la celda vacía). El
  // roster se arma con buildEquipoLineas (basado solo en asignaciones, no en
  // requerimientos) para no perder personas staffeadas sin requerimiento formal.
  const hoy = fmt(new Date());
  const fechaFinalEquipo = (engId: string, terminado: boolean): string => {
    if (!terminado) return hoy;
    const fines = asigs
      .filter((a) => a.engagement_id === engId)
      .map((a) => a.fecha_fin ?? hoy);
    return fines.length > 0 ? fines.reduce((max, f) => (f > max ? f : max)) : hoy;
  };

  engs.forEach((eng) => {
    const row = sheet.getRow(fila);
    row.getCell(1).value = eng.codigo ? `${eng.codigo}: ${eng.nombre}` : eng.nombre;
    row.getCell(2).value = eng.fecha_inicio ? fmtDDMMYYYY(eng.fecha_inicio) : "—";
    // "En proceso" solo si está activo hoy (estado); si ya terminó, se indica su fecha de término.
    row.getCell(3).value =
      eng.estado === "activo" ? "En proceso" : eng.fecha_fin ? fmtDDMMYYYY(eng.fecha_fin) : "—";
    const fechaRefEquipo = fechaFinalEquipo(eng.id, eng.estado !== "activo");
    const cellEquipo = row.getCell(4);
    cellEquipo.value = celdaRichText(buildEquipoLineas(eng.id, fechaRefEquipo, asigs));
    cellEquipo.alignment = { wrapText: true, vertical: "top" };
    semanas.forEach((s, i) => {
      const cell = row.getCell(5 + i);
      cell.value = celdaRichText(buildLineas(eng.id, s, reqs, asigs));
      cell.alignment = { wrapText: true, vertical: "top" };
    });
    fila++;
  });

  return fila + 1; // deja una fila en blanco de separación
}

// ── Función principal ────────────────────────────────────────────────

/**
 * `sb` debe ser un cliente Supabase server-side (service role recomendado,
 * ya que Storage y escritura de reportes están gateados a admin/planificador
 * según supabase/fix_write_permissions_fase4.sql).
 *
 * Requiere que exista el bucket de Storage `reportes` (crear manualmente
 * o vía migración antes del primer uso).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function syncExcelResumenProyectos(sb: any): Promise<SyncResult> {
  const { data: engData, error: engErr } = await sb
    .from("engagement")
    .select("id, codigo, nombre, cliente, tipo, sort_order, fecha_inicio, fecha_fin_estimada, fecha_fin_real, estado")
    .in("tipo", ["proyecto", "propuesta"])
    .eq("is_deleted", false);
  if (engErr) throw new Error(`Error leyendo engagements: ${engErr.message}`);

  // Nota: ya no se filtra por estado === "activo". El filtro por año (más abajo,
  // por pestaña) decide qué engagements aparecen: cualquiera activo en algún
  // momento dentro del año, aunque ya esté "terminado" a la fecha de hoy.
  const engs: EngRow[] = (engData ?? [])
    .map((e: any) => ({
      id: e.id,
      codigo: e.codigo ?? null,
      nombre: e.nombre,
      cliente: e.cliente,
      tipo: e.tipo ?? "",
      sort_order: e.sort_order ?? null,
      fecha_inicio: e.fecha_inicio ?? null,
      fecha_fin: e.fecha_fin_real ?? e.fecha_fin_estimada ?? null,
      estado: e.estado === "activo" ? "activo" : "terminado",
    }));

  if (engs.length === 0) {
    const vacio = new ExcelJS.Workbook();
    return { anios: [], buffer: (await vacio.xlsx.writeBuffer()) as unknown as Buffer };
  }

  const engIds = engs.map((e) => e.id);

  // Años cubiertos: desde inicio hasta fin de cada engagement, sin superar el año actual
  // (sin fin -> se acota al año actual; no se generan pestañas de años futuros).
  const anioActual = new Date().getFullYear();
  const anios = new Set<number>();
  engs.forEach((e) => {
    const y0 = e.fecha_inicio ? new Date(e.fecha_inicio).getFullYear() : anioActual;
    const y1 = e.fecha_fin ? new Date(e.fecha_fin).getFullYear() : anioActual;
    for (let y = y0; y <= Math.min(y1, anioActual); y++) anios.add(y);
  });

  const [{ data: reqData }, { data: asigData }, { data: personaData }, { data: ausenciaData }] = await Promise.all([
    sb
      .from("requerimiento_engagement")
      .select("engagement_id, cargo_requerido, fecha_inicio, fecha_fin")
      .in("engagement_id", engIds),
    sb
      .from("asignacion")
      .select("engagement_id, cargo_al_momento, fecha_inicio, fecha_fin, estado_staffing, persona:persona_id(nombre, apellido)")
      .in("engagement_id", engIds)
      .eq("estado", "activa"),
    sb.from("persona").select("id, nombre, apellido, cargo_actual").eq("activo", true),
    sb.from("ausencia").select("persona_id, tipo, fecha_inicio, fecha_fin, descripcion"),
  ]);

  const reqs: ReqRow[] = (reqData ?? [])
    .filter((r: any) => r.cargo_requerido)
    .map((r: any) => ({
      engagement_id: r.engagement_id,
      cargo: r.cargo_requerido,
      fecha_inicio: r.fecha_inicio,
      fecha_fin: r.fecha_fin,
    }));

  const asigs: AsigRow[] = (asigData ?? []).map((a: any) => ({
    engagement_id: a.engagement_id,
    cargo: a.cargo_al_momento ?? "",
    iniciales: a.persona ? getIniciales(a.persona.nombre ?? "?", a.persona.apellido ?? "?") : "??",
    estado_staffing: a.estado_staffing ?? "CONFIRMADO",
    fecha_inicio: a.fecha_inicio,
    fecha_fin: a.fecha_fin ?? null,
  }));

  const personasAus: PersonaAus[] = (personaData ?? []).map((p: any) => ({
    id: p.id,
    nombre: p.nombre,
    apellido: p.apellido,
    cargo_actual: p.cargo_actual ?? null,
  }));

  const ausencias: AusenciaRow[] = (ausenciaData ?? []).map((a: any) => ({
    persona_id: a.persona_id,
    tipo: a.tipo,
    fecha_inicio: a.fecha_inicio,
    fecha_fin: a.fecha_fin,
    descripcion: a.descripcion ?? null,
  }));

  // 1. Cargar libro existente desde Storage (si existe) para no perder otras pestañas/años
  const workbook = new ExcelJS.Workbook();
  const { data: existing } = await sb.storage.from(EXCEL_SYNC_BUCKET).download(EXCEL_SYNC_PATH);
  if (existing) {
    const arrayBuffer = await existing.arrayBuffer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(Buffer.from(arrayBuffer) as any);
  }

  // 1b. Purgar pestañas huérfanas de años futuros (> anioActual) que hayan quedado
  //     de sincronizaciones anteriores, ya que ya no se generan.
  workbook.worksheets
    .filter((ws) => {
      const m = ws.name.match(/(\d{4})$/);
      return m && Number(m[1]) > anioActual;
    })
    .forEach((ws) => workbook.removeWorksheet(ws.id));

  // 2. Sobrescribir (o crear) la pestaña de cada año afectado
  // Más recientes arriba: por fecha de inicio descendente.
  const byFechaDesc = (a: EngRow, b: EngRow) => (b.fecha_inicio ?? "").localeCompare(a.fecha_inicio ?? "");

  // Pestañas de año más reciente a más antiguo (orden de creación = orden de tabs).
  const aniosOrdenados = [...anios].sort((a, b) => b - a);
  for (const anio of aniosOrdenados) {
    const { proyectos: nombreHoja, ausencias: nombreHojaAusencias, legacyProyectos, legacyAusencias } =
      nombresHojaAnio(anio, anioActual);

    removerHojasLegacy(workbook, legacyProyectos);
    const existente = workbook.getWorksheet(nombreHoja);
    if (existente) workbook.removeWorksheet(existente.id);
    const sheet = workbook.addWorksheet(nombreHoja);

    const semanas = generarSemanasAnio(anio);
    const rangoInicio = semanas[0].inicio;
    const rangoFin = semanas[semanas.length - 1].fin;
    const reqsAnio = reqs.filter((r) => solapan(r.fecha_inicio, r.fecha_fin, rangoInicio, rangoFin));
    const asigsAnio = asigs.filter((a) => solapan(a.fecha_inicio, a.fecha_fin, rangoInicio, rangoFin));

    // Engagements activos en cualquier momento del año (fecha_inicio <= 31/12 y
    // fecha_fin >= 01/01 o sin fecha_fin), no solo los "activo" a la fecha actual.
    const rangoInicioAnio = `${anio}-01-01`;
    const rangoFinAnio = `${anio}-12-31`;
    // Excluye "terminado" sin fecha_fin registrada (dato incompleto, no se puede mostrar término).
    const activosEnAnio = (e: EngRow) =>
      (e.estado === "activo" || e.fecha_fin !== null) &&
      solapan(e.fecha_inicio ?? rangoInicioAnio, e.fecha_fin, rangoInicioAnio, rangoFinAnio);
    const proyectosAnio = engs.filter((e) => e.tipo === "proyecto" && activosEnAnio(e)).sort(byFechaDesc);
    const propuestasAnio = engs.filter((e) => e.tipo === "propuesta" && activosEnAnio(e)).sort(byFechaDesc);

    let fila = escribirBloque(sheet, 1, "Proyectos Activos", proyectosAnio, semanas, reqsAnio, asigsAnio);
    escribirBloque(sheet, fila, "Propuestas Comerciales", propuestasAnio, semanas, reqsAnio, asigsAnio);

    sheet.getColumn(1).width = 34;
    sheet.getColumn(2).width = 12;
    sheet.getColumn(3).width = 12;
    sheet.getColumn(4).width = 16;
    for (let c = 5; c <= semanas.length + 4; c++) sheet.getColumn(c).width = 14;

    // Colapsa por defecto las semanas ya pasadas (no se eliminan, solo se ocultan);
    // el usuario las expande con el botón de agrupación (+) que genera Excel.
    const hoy = fmt(new Date());
    semanas.forEach((s, i) => {
      if (s.fin < hoy) {
        const col = sheet.getColumn(5 + i);
        col.outlineLevel = 1;
        col.hidden = true;
      }
    });
    sheet.properties.outlineProperties = { summaryBelow: true, summaryRight: true };

    removerHojasLegacy(workbook, legacyAusencias);
    const ausenciasAnio = ausencias.filter((a) => solapan(a.fecha_inicio, a.fecha_fin, rangoInicioAnio, rangoFinAnio));
    escribirHojaAusencias(workbook, nombreHojaAusencias, anio, personasAus, ausenciasAnio);
  }

  // 3. Subir el libro actualizado (upsert, mismo path -> nunca duplica archivos)
  const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  const { error: uploadErr } = await sb.storage.from(EXCEL_SYNC_BUCKET).upload(EXCEL_SYNC_PATH, buffer, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    upsert: true,
  });
  if (uploadErr) throw new Error(`Error subiendo Excel a Storage: ${uploadErr.message}`);

  return { anios: aniosOrdenados, buffer };
}
