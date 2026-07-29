import type { TypedSupabaseClient } from "@/lib/supabase/types";
import { calcularDiasHabilesEnCargo } from "@/lib/utils/date-utils";
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
