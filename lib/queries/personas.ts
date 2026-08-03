import type { TypedSupabaseClient } from "@/lib/supabase/types";
import { calcularDiasHabilesEnCargo, calculateBusinessDays } from "@/lib/utils/date-utils";
import { getDetailedPersonAbsences, type DetalleAusenciasPersona } from "@/lib/queries/ausencias";

export interface HistorialCargoRow {
  id: string;
  persona_id: string;
  cargo: string;
  fecha_inicio: string;       // ISO date
  fecha_fin: string | null;   // ISO date | null = cargo actual
  created_at: string;
  dias_habiles?: number;      // calculado en cliente
}

/**
 * Obtiene el historial de cargos de una persona ordenado cronológicamente
 * y calcula los días hábiles efectivos en cada cargo.
 */
export async function getHistorialCargos(
  supabase: TypedSupabaseClient,
  personaId: string
): Promise<HistorialCargoRow[]> {
  const { data, error } = await supabase
    .from("historial_cargos")
    .select("id, persona_id, cargo, fecha_inicio, fecha_fin, created_at")
    .eq("persona_id", personaId)
    .order("fecha_inicio", { ascending: true });

  if (error || !data) return [];

  const hoy = new Date().toISOString().split("T")[0];

  return (data as HistorialCargoRow[]).map((row) => ({
    ...row,
    dias_habiles: calcularDiasHabilesEnCargo(
      row.fecha_inicio,
      row.fecha_fin ?? hoy
    ),
  }));
}

// ─────────────────────────────────────────────────────────────
//  Descargables / Resguardo de información de personas
// ─────────────────────────────────────────────────────────────

// Cuadrantes 9-box — espejo de BOXES/getBoxIndex en MatrizTalentoClient.tsx
const CUADRANTE_TALENTO_TITULOS = [
  "Diamante en bruto", "Talento Emergente", "Futuro Líder",
  "Talento Inconsistente", "Futuro Prometedor", "Talento en Desarrollo",
  "Talento en Riesgo", "Talento Estancado", "Profesional Experimentado",
];
const TALENTO_B1 = 7 / 3;
const TALENTO_B2 = 11 / 3;

function getCuadranteTalento(potencial: number | null, desempeno: number | null): string | null {
  if (potencial == null || desempeno == null) return null;
  const row = potencial > TALENTO_B2 ? 0 : potencial > TALENTO_B1 ? 1 : 2;
  const col = desempeno <= TALENTO_B1 ? 0 : desempeno <= TALENTO_B2 ? 1 : 2;
  return CUADRANTE_TALENTO_TITULOS[row * 3 + col];
}

export interface NotaResguardo {
  titulo: string;
  contenido: string;
  carpeta: string | null;
  actualizadoEn: string;
}

export interface PersonaResguardoInfo {
  id: string;
  nombre: string;
  apellido: string;
  nombreCompleto: string;
  cargoActual: string | null;
  fechaIngreso: string | null;
  mentor: { id: string; nombreCompleto: string } | null;
  mentoreados: { id: string; nombreCompleto: string }[];
  ausencias: DetalleAusenciasPersona;
  notas: NotaResguardo[];
  historialCargos: HistorialCargoRow[];
  matrizTalento: {
    potencial: number | null;
    desempeno: number | null;
    cuadrante: string | null;
  };
  isLeverager: boolean;
  referente: boolean;
}

interface PersonaResguardoRaw {
  id: string;
  nombre: string;
  apellido: string;
  cargo_actual: string | null;
  fecha_ingreso: string | null;
  mentor_id: string | null;
  talento_potencial: number | null;
  talento_desempeno: number | null;
  is_leverager: boolean;
  referente: boolean;
}

/**
 * Consolida la información de personas para el respaldo descargable de
 * Reportes > Descargables: mentor/mentoreados, ausencias del año actual,
 * notas del notebook de desarrollo, historial de cargos y posición en la
 * matriz de talento. Excluye personas en papelera (is_deleted).
 */
export async function getPersonasResguardoInfo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<PersonaResguardoInfo[]> {
  const { data: personasRaw, error } = await supabase
    .from("persona")
    .select("id, nombre, apellido, cargo_actual, fecha_ingreso, mentor_id, talento_potencial, talento_desempeno, is_leverager, referente")
    .eq("is_deleted", false)
    .order("apellido");

  if (error || !personasRaw) return [];

  const personas = personasRaw as PersonaResguardoRaw[];
  const ids = personas.map((p) => p.id);
  const byId = new Map(personas.map((p) => [p.id, p]));
  const nombreCompletoDe = (p: { nombre: string; apellido: string }) => `${p.nombre} ${p.apellido}`;

  const [foldersRes, notesRes] = await Promise.all([
    supabase.from("notebook_folder").select("id, nombre").in("persona_id", ids),
    supabase.from("notebook_note").select("persona_id, titulo, contenido, folder_id, actualizado_en").in("persona_id", ids),
  ]);

  const folderNombre = new Map<string, string>(
    ((foldersRes.data ?? []) as { id: string; nombre: string }[]).map((f) => [f.id, f.nombre])
  );
  const notasByPersona = new Map<string, NotaResguardo[]>();
  for (const n of (notesRes.data ?? []) as { persona_id: string; titulo: string; contenido: string; folder_id: string | null; actualizado_en: string }[]) {
    const lista = notasByPersona.get(n.persona_id) ?? [];
    lista.push({
      titulo: n.titulo,
      contenido: n.contenido,
      carpeta: n.folder_id ? folderNombre.get(n.folder_id) ?? null : null,
      actualizadoEn: n.actualizado_en,
    });
    notasByPersona.set(n.persona_id, lista);
  }

  const [ausenciasPorPersona, historialesPorPersona] = await Promise.all([
    Promise.all(personas.map((p) => getDetailedPersonAbsences(supabase, p.id))),
    Promise.all(personas.map((p) => getHistorialCargos(supabase, p.id))),
  ]);

  return personas.map((p, idx) => ({
    id: p.id,
    nombre: p.nombre,
    apellido: p.apellido,
    nombreCompleto: nombreCompletoDe(p),
    cargoActual: p.cargo_actual,
    fechaIngreso: p.fecha_ingreso,
    mentor: p.mentor_id && byId.has(p.mentor_id)
      ? { id: p.mentor_id, nombreCompleto: nombreCompletoDe(byId.get(p.mentor_id)!) }
      : null,
    mentoreados: personas
      .filter((m) => m.mentor_id === p.id)
      .map((m) => ({ id: m.id, nombreCompleto: nombreCompletoDe(m) })),
    ausencias: ausenciasPorPersona[idx],
    notas: notasByPersona.get(p.id) ?? [],
    historialCargos: historialesPorPersona[idx],
    matrizTalento: {
      potencial: p.talento_potencial,
      desempeno: p.talento_desempeno,
      cuadrante: getCuadranteTalento(p.talento_potencial, p.talento_desempeno),
    },
    isLeverager: p.is_leverager,
    referente: p.referente,
  }));
}

// ─────────────────────────────────────────────────────────────
//  Experiencia dinámica (industrias/capacidades/temáticas) — calculada a
//  partir de los engagements en que participó, contando solo aquellos donde
//  estuvo más de 10 días hábiles (sin fines de semana, feriados ni ausencias).
// ─────────────────────────────────────────────────────────────

export interface EngagementExperienciaRow {
  engagement_id: string;
  nombre: string;
  cliente: string | null;
  fecha_inicio: string;
  fecha_fin: string | null; // null = presente
  diasHabiles: number;
}

export interface TagExperiencia {
  id: string;
  nombre: string;
  engagements: EngagementExperienciaRow[];
}

export interface ExperienciaDinamica {
  industrias: TagExperiencia[];
  capacidades: TagExperiencia[];
  tematicas: TagExperiencia[];
}

const UMBRAL_DIAS_HABILES_EXPERIENCIA = 10; // "más de 10 días hábiles"

/** Días hábiles de los tramos indicados, descontando los días hábiles cubiertos por ausencias. */
function diasHabilesSinAusencias(
  segmentos: { fecha_inicio: string; fecha_fin: string }[],
  ausencias: { fecha_inicio: string; fecha_fin: string }[]
): number {
  let total = 0;
  for (const seg of segmentos) {
    total += calculateBusinessDays(seg.fecha_inicio, seg.fecha_fin);
    for (const aus of ausencias) {
      const ini = aus.fecha_inicio > seg.fecha_inicio ? aus.fecha_inicio : seg.fecha_inicio;
      const fin = aus.fecha_fin    < seg.fecha_fin    ? aus.fecha_fin    : seg.fecha_fin;
      if (ini <= fin) total -= calculateBusinessDays(ini, fin);
    }
  }
  return Math.max(0, total);
}

interface EngInfoRow {
  id: string;
  nombre: string;
  cliente: string | null;
  industria_id: string | null;
  cat_industria: { id: string; nombre: string } | null;
}

/**
 * Calcula dinámicamente las industrias, capacidades y temáticas de una persona a partir de
 * los engagements en los que participó: solo se cuentan los engagements donde estuvo asignada
 * por más de 10 días hábiles (excluyendo fines de semana, feriados y días de ausencia).
 */
export async function getExperienciaDinamica(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  personaId: string
): Promise<ExperienciaDinamica> {
  const { data: asigData } = await supabase
    .from("asignacion")
    .select("engagement_id, fecha_inicio, fecha_fin")
    .eq("persona_id", personaId)
    .eq("estado", "activa");

  const asigRows = (asigData ?? []) as { engagement_id: string; fecha_inicio: string; fecha_fin: string | null }[];
  if (asigRows.length === 0) return { industrias: [], capacidades: [], tematicas: [] };

  const engagementIds = [...new Set(asigRows.map((a) => a.engagement_id))];
  const hoy = new Date().toISOString().split("T")[0];

  const [engRes, capRes, temRes, ausRes] = await Promise.all([
    supabase.from("engagement").select("id, nombre, cliente, industria_id, cat_industria(id, nombre)").in("id", engagementIds),
    supabase.from("engagement_capacidad").select("engagement_id, cat_capacidad(id, nombre)").in("engagement_id", engagementIds),
    supabase.from("engagement_tematica").select("engagement_id, cat_tematica(id, nombre)").in("engagement_id", engagementIds),
    supabase.from("ausencia").select("fecha_inicio, fecha_fin").eq("persona_id", personaId),
  ]);

  const ausencias = (ausRes.data ?? []) as { fecha_inicio: string; fecha_fin: string }[];

  // Agrupa los tramos de asignación por engagement (una persona puede tener varias filas
  // de asignación al mismo engagement: extensiones, reincorporaciones, etc.)
  const segmentosPorEngagement = new Map<string, { fecha_inicio: string; fecha_fin: string }[]>();
  for (const a of asigRows) {
    const arr = segmentosPorEngagement.get(a.engagement_id) ?? [];
    arr.push({ fecha_inicio: a.fecha_inicio, fecha_fin: a.fecha_fin ?? hoy });
    segmentosPorEngagement.set(a.engagement_id, arr);
  }

  const engagementsInfo = new Map<string, EngInfoRow>(
    ((engRes.data ?? []) as EngInfoRow[]).map((e) => [e.id, e])
  );

  // Solo engagements donde estuvo MÁS de 10 días hábiles reales (sin ausencias)
  const engagementsCalificados: EngagementExperienciaRow[] = [];
  for (const [engId, segmentos] of segmentosPorEngagement) {
    const info = engagementsInfo.get(engId);
    if (!info) continue;
    const diasHabiles = diasHabilesSinAusencias(segmentos, ausencias);
    if (diasHabiles <= UMBRAL_DIAS_HABILES_EXPERIENCIA) continue;

    const fechaInicio = segmentos.reduce((min, s) => (s.fecha_inicio < min ? s.fecha_inicio : min), segmentos[0].fecha_inicio);
    const siguesActivo = asigRows.some((a) => a.engagement_id === engId && a.fecha_fin === null);
    const fechaFin = siguesActivo
      ? null
      : segmentos.reduce((max, s) => (s.fecha_fin > max ? s.fecha_fin : max), segmentos[0].fecha_fin);

    engagementsCalificados.push({
      engagement_id: engId,
      nombre: info.nombre,
      cliente: info.cliente,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      diasHabiles,
    });
  }

  const industriaPorEng = new Map<string, { id: string; nombre: string }>();
  for (const e of (engRes.data ?? []) as EngInfoRow[]) {
    if (e.cat_industria) industriaPorEng.set(e.id, { id: e.cat_industria.id, nombre: e.cat_industria.nombre });
  }
  const capacidadesPorEng = new Map<string, { id: string; nombre: string }[]>();
  for (const r of (capRes.data ?? []) as { engagement_id: string; cat_capacidad: { id: string; nombre: string } | null }[]) {
    if (!r.cat_capacidad) continue;
    const arr = capacidadesPorEng.get(r.engagement_id) ?? [];
    arr.push(r.cat_capacidad);
    capacidadesPorEng.set(r.engagement_id, arr);
  }
  const tematicasPorEng = new Map<string, { id: string; nombre: string }[]>();
  for (const r of (temRes.data ?? []) as { engagement_id: string; cat_tematica: { id: string; nombre: string } | null }[]) {
    if (!r.cat_tematica) continue;
    const arr = tematicasPorEng.get(r.engagement_id) ?? [];
    arr.push(r.cat_tematica);
    tematicasPorEng.set(r.engagement_id, arr);
  }

  const industrias  = new Map<string, TagExperiencia>();
  const capacidades = new Map<string, TagExperiencia>();
  const tematicas   = new Map<string, TagExperiencia>();

  for (const eng of engagementsCalificados) {
    const industria = industriaPorEng.get(eng.engagement_id);
    if (industria) {
      const tag = industrias.get(industria.id) ?? { id: industria.id, nombre: industria.nombre, engagements: [] };
      tag.engagements.push(eng);
      industrias.set(industria.id, tag);
    }
    for (const cap of capacidadesPorEng.get(eng.engagement_id) ?? []) {
      const tag = capacidades.get(cap.id) ?? { id: cap.id, nombre: cap.nombre, engagements: [] };
      tag.engagements.push(eng);
      capacidades.set(cap.id, tag);
    }
    for (const tem of tematicasPorEng.get(eng.engagement_id) ?? []) {
      const tag = tematicas.get(tem.id) ?? { id: tem.id, nombre: tem.nombre, engagements: [] };
      tag.engagements.push(eng);
      tematicas.set(tem.id, tag);
    }
  }

  const ordenarTags = (m: Map<string, TagExperiencia>) =>
    [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return {
    industrias: ordenarTags(industrias),
    capacidades: ordenarTags(capacidades),
    tematicas: ordenarTags(tematicas),
  };
}
