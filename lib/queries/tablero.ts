/**
 * Queries para el Tablero de Capacidad.
 * Soporta vista diaria (7 días = 1 semana) por persona o por proyecto.
 */
import { format, addWeeks, addDays, startOfISOWeek } from "date-fns";
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import type { OcupacionSemana } from "@/lib/types/database";

// ─────────────────────────────────────────────────────────────
//  Constantes compartidas
// ─────────────────────────────────────────────────────────────

export const SEMANAS_VISIBLES = 6; // usado por las funciones legacy

// Jerarquía de cargos para ordenar el tablero por persona
export const ORDEN_CARGO: Record<string, number> = {
  Socio: 1,
  Director: 2,
  Gerente: 3,
  Asociado: 4,
  "Consultor Senior": 5,
  "Consultor Proyecto": 6,
  "Consultor Analista": 7,
};

// ─────────────────────────────────────────────────────────────
//  Tipos — vista por persona (diaria)
// ─────────────────────────────────────────────────────────────

export interface FilaPersona {
  persona_id: string;
  persona_nombre: string;
  cargo_actual: string;
  semanas: Record<string, { actual: number; proyectado: number }>;
}

/** Igual que FilaPersona pero con clave de día en lugar de semana */
export interface FilaDia {
  persona_id: string;
  persona_nombre: string;
  cargo_actual: string;
  dias: Record<string, { actual: number; proyectado: number }>; // key = "yyyy-MM-dd"
}

// ─────────────────────────────────────────────────────────────
//  Tipos — vista por proyecto (diaria)
// ─────────────────────────────────────────────────────────────

export interface DatoDiaProyecto {
  requerido: number;     // suma de pct_dedicacion de requerimientos ese día
  asignado: number;      // suma de asignaciones reales ese día
  asignadoPlan: number;  // suma de asignaciones del plan ese día
  /** (asignado + asignadoPlan) / requerido * 100, -1 si no hay requerimientos */
  cobertura: number;
}

export interface FilaProyecto {
  engagement_id: string;
  engagement_nombre: string;
  cliente: string;
  dias: Record<string, DatoDiaProyecto>; // key = "yyyy-MM-dd"
}

// ─────────────────────────────────────────────────────────────
//  Vista por persona — DIARIA
// ─────────────────────────────────────────────────────────────

/**
 * Computa la ocupación real y proyectada de cada persona activa
 * para cada uno de los 7 días de la semana indicada.
 * El proyectado incluye el plan si se pasa planId.
 */
export async function fetchOcupacionDiariaPersona(
  supabase: TypedSupabaseClient,
  semanaInicio: Date,
  planId: string | null
): Promise<{ filas: FilaDia[]; dias: Date[]; diasCriticosPersona: Set<string>; error: string | null }> {
  const dias = Array.from({ length: 7 }, (_, i) => addDays(semanaInicio, i));
  const inicioStr = format(dias[0], "yyyy-MM-dd");
  const finStr    = format(dias[6], "yyyy-MM-dd");

  type PersonaRaw = { id: string; nombre: string; apellido: string; cargo_actual: string | null };
  type AsigRaw = { persona_id: string; engagement_id: string | null; pct_dedicacion: number; fecha_inicio: string; fecha_fin: string | null };

  // 1. Todas las personas activas
  const { data: personasRaw, error: personasErr } = await supabase
    .from("persona")
    .select("id, nombre, apellido, cargo_actual")
    .eq("activo", true)
    .order("apellido");

  if (personasErr) return { filas: [], dias, diasCriticosPersona: new Set(), error: personasErr.message };
  const personasData = (personasRaw ?? []) as unknown as PersonaRaw[];

  // 2. Asignaciones reales que solapan con la semana (incluye engagement_id para días críticos)
  const { data: asigRaw, error: asigErr } = await supabase
    .from("asignacion")
    .select("persona_id, engagement_id, pct_dedicacion, fecha_inicio, fecha_fin")
    .eq("estado", "activa")
    .lte("fecha_inicio", finStr)
    .or(`fecha_fin.gte.${inicioStr},fecha_fin.is.null`);

  if (asigErr) return { filas: [], dias, diasCriticosPersona: new Set(), error: asigErr.message };
  const asigData = (asigRaw ?? []) as unknown as AsigRaw[];

  // 3. Asignaciones del plan (si aplica)
  type AsigSimple    = { persona_id: string; pct_dedicacion: number; fecha_inicio: string; fecha_fin: string };
  type AsigPlanFull  = AsigSimple & { tipo: string | null; asignacion_a_terminar_id: string | null };
  /** Represents a freed slot: active from fecha_liberacion until the original assignment's fecha_fin */
  type AsigLiberada  = { persona_id: string; pct_dedicacion: number; fecha_liberacion: string; fecha_fin_orig: string | null };

  let planAsig: AsigSimple[]     = []; // tipo = asignar
  let asigLiberadas: AsigLiberada[] = []; // tipo = liberar, enriched with original dates

  if (planId) {
    const { data: planData } = await (supabase as any)
      .from("asignacion_propuesta")
      .select("persona_id, pct_dedicacion, fecha_inicio, fecha_fin, tipo, asignacion_a_terminar_id")
      .eq("plan_id", planId)
      .eq("estado", "borrador");

    const allPlan = (planData ?? []) as unknown as AsigPlanFull[];

    // Tipo asignar – filter to semana range
    planAsig = allPlan
      .filter((a) => a.tipo !== "liberar" && a.fecha_inicio <= finStr && a.fecha_fin >= inicioStr)
      .map((a) => ({ persona_id: a.persona_id, pct_dedicacion: a.pct_dedicacion, fecha_inicio: a.fecha_inicio, fecha_fin: a.fecha_fin }));

    // Tipo liberar – fetch original asignacion to get its full date range
    const liberaciones = allPlan.filter((a) => a.tipo === "liberar" && a.asignacion_a_terminar_id);
    if (liberaciones.length > 0) {
      const { data: origData } = await (supabase as any)
        .from("asignacion")
        .select("id, fecha_fin")
        .in("id", liberaciones.map((l) => l.asignacion_a_terminar_id!));

      const origMap = new Map<string, string | null>(
        (origData ?? []).map((o: { id: string; fecha_fin: string | null }) => [o.id, o.fecha_fin])
      );

      for (const lib of liberaciones) {
        asigLiberadas.push({
          persona_id: lib.persona_id,
          pct_dedicacion: lib.pct_dedicacion,
          fecha_liberacion: lib.fecha_fin, // termination date stored in fecha_fin of liberar row
          fecha_fin_orig: origMap.get(lib.asignacion_a_terminar_id!) ?? null,
        });
      }
    }
  }

  // 4. Construir mapa persona → días
  const porPersona = new Map<string, FilaDia>();

  for (const p of personasData) {
    porPersona.set(p.id, {
      persona_id: p.id,
      persona_nombre: `${p.nombre} ${p.apellido}`,
      cargo_actual: p.cargo_actual ?? "",
      dias: {},
    });
  }

  for (const dia of dias) {
    const diaStr = format(dia, "yyyy-MM-dd");

    for (const [personaId, fila] of porPersona) {
      const actual = asigData
        .filter(
          (a) =>
            a.persona_id === personaId &&
            a.fecha_inicio <= diaStr &&
            (a.fecha_fin === null || a.fecha_fin >= diaStr)
        )
        .reduce((s, a) => s + Number(a.pct_dedicacion), 0);

      // Capacity freed on this day by liberations in the plan
      const liberado = asigLiberadas
        .filter(
          (a) =>
            a.persona_id === personaId &&
            a.fecha_liberacion <= diaStr &&
            (a.fecha_fin_orig === null || a.fecha_fin_orig >= diaStr)
        )
        .reduce((s, a) => s + Number(a.pct_dedicacion), 0);

      const planExtra = planAsig
        .filter(
          (a) =>
            a.persona_id === personaId &&
            a.fecha_inicio <= diaStr &&
            a.fecha_fin >= diaStr
        )
        .reduce((s, a) => s + Number(a.pct_dedicacion), 0);

      fila.dias[diaStr] = { actual, proyectado: Math.max(0, actual - liberado) + planExtra };
    }
  }

  // 5. Días críticos de la semana: engagement_id|fecha
  const { data: dcRaw } = await (supabase as any)
    .from("dia_critico")
    .select("engagement_id, fecha")
    .gte("fecha", inicioStr)
    .lte("fecha", finStr);

  const criticosEng = new Set<string>(
    ((dcRaw ?? []) as { engagement_id: string; fecha: string }[])
      .map((r) => `${r.engagement_id}|${r.fecha}`)
  );

  // Set de "persona_id|yyyy-MM-dd" para celdas críticas
  const diasCriticosPersona = new Set<string>();
  for (const dia of dias) {
    const diaStr = format(dia, "yyyy-MM-dd");
    for (const p of personasData) {
      const tieneAsigCritica = asigData.some(
        (a) =>
          a.persona_id === p.id &&
          a.engagement_id &&
          a.fecha_inicio <= diaStr &&
          (a.fecha_fin === null || a.fecha_fin >= diaStr) &&
          criticosEng.has(`${a.engagement_id}|${diaStr}`)
      );
      if (tieneAsigCritica) diasCriticosPersona.add(`${p.id}|${diaStr}`);
    }
  }

  // 6. Ordenar
  const filas = Array.from(porPersona.values()).sort((a, b) => {
    const oa = ORDEN_CARGO[a.cargo_actual] ?? 99;
    const ob = ORDEN_CARGO[b.cargo_actual] ?? 99;
    if (oa !== ob) return oa - ob;
    return a.persona_nombre.localeCompare(b.persona_nombre, "es");
  });

  return { filas, dias, diasCriticosPersona, error: null };
}

// ─────────────────────────────────────────────────────────────
//  Vista por proyecto — DIARIA
// ─────────────────────────────────────────────────────────────

interface ReqRaw {
  id: string;
  engagement_id: string;
  pct_dedicacion: number;
  fecha_inicio: string;
  fecha_fin: string;
  cargo_requerido: string | null;
  engagement: { nombre: string; cliente: string } | null;
}

/**
 * Computa la cobertura real y proyectada de cada engagement activo
 * para cada día de la semana indicada.
 * cobertura = (asignado + asignadoPlan) / requerido * 100
 * -1 si no hay requerimientos ese día.
 */
export async function fetchCoberturaProyecto(
  supabase: TypedSupabaseClient,
  semanaInicio: Date,
  planId: string | null
): Promise<{ filas: FilaProyecto[]; dias: Date[]; diasCriticosEng: Set<string>; error: string | null }> {
  const dias = Array.from({ length: 7 }, (_, i) => addDays(semanaInicio, i));
  const inicioStr = format(dias[0], "yyyy-MM-dd");
  const finStr    = format(dias[6], "yyyy-MM-dd");

  // 1. Requerimientos que solapan con la semana (con nombre de engagement)
  const { data: reqRaw, error: reqErr } = await supabase
    .from("requerimiento_engagement")
    .select(
      "id, engagement_id, pct_dedicacion, fecha_inicio, fecha_fin, cargo_requerido, " +
      "engagement:engagement_id(nombre, cliente)"
    )
    .lte("fecha_inicio", finStr)
    .gte("fecha_fin", inicioStr);

  if (reqErr) return { filas: [], dias, diasCriticosEng: new Set(), error: reqErr.message };
  if (!reqRaw || reqRaw.length === 0) return { filas: [], dias, diasCriticosEng: new Set(), error: null };

  const reqs = reqRaw as unknown as ReqRaw[];
  const engIds = [...new Set(reqs.map((r) => r.engagement_id))];

  type AsigEng = { engagement_id: string; pct_dedicacion: number; fecha_inicio: string; fecha_fin: string | null };

  // 2. Asignaciones reales para esos engagements en la semana
  const { data: asigRawEng, error: asigErr } = await supabase
    .from("asignacion")
    .select("engagement_id, pct_dedicacion, fecha_inicio, fecha_fin")
    .eq("estado", "activa")
    .in("engagement_id", engIds)
    .lte("fecha_inicio", finStr)
    .or(`fecha_fin.gte.${inicioStr},fecha_fin.is.null`);

  if (asigErr) return { filas: [], dias, diasCriticosEng: new Set(), error: asigErr.message };
  const asigData = (asigRawEng ?? []) as unknown as AsigEng[];

  // 3. Asignaciones del plan (si aplica)
  type AsigEngPlan     = { engagement_id: string; pct_dedicacion: number; fecha_inicio: string; fecha_fin: string };
  type AsigEngPlanFull = AsigEngPlan & { tipo: string | null; asignacion_a_terminar_id: string | null };
  /** Freed slot for a given engagement: active from fecha_liberacion to the original end date */
  type AsigEngLiberada = { engagement_id: string; pct_dedicacion: number; fecha_liberacion: string; fecha_fin_orig: string | null };

  let planAsig: AsigEngPlan[]          = []; // tipo = asignar
  let planLiberadas: AsigEngLiberada[] = []; // tipo = liberar, enriched

  if (planId) {
    const { data: planData } = await (supabase as any)
      .from("asignacion_propuesta")
      .select("engagement_id, pct_dedicacion, fecha_inicio, fecha_fin, tipo, asignacion_a_terminar_id")
      .eq("plan_id", planId)
      .eq("estado", "borrador")
      .in("engagement_id", engIds);

    const allPlan = (planData ?? []) as unknown as AsigEngPlanFull[];

    // Tipo asignar – filter to semana range
    planAsig = allPlan
      .filter((a) => a.tipo !== "liberar" && a.fecha_inicio <= finStr && a.fecha_fin >= inicioStr)
      .map((a) => ({ engagement_id: a.engagement_id, pct_dedicacion: a.pct_dedicacion, fecha_inicio: a.fecha_inicio, fecha_fin: a.fecha_fin }));

    // Tipo liberar – enrich with original asignacion date range
    const liberaciones = allPlan.filter((a) => a.tipo === "liberar" && a.asignacion_a_terminar_id);
    if (liberaciones.length > 0) {
      const { data: origData } = await (supabase as any)
        .from("asignacion")
        .select("id, fecha_fin")
        .in("id", liberaciones.map((l) => l.asignacion_a_terminar_id!));

      const origMap = new Map<string, string | null>(
        (origData ?? []).map((o: { id: string; fecha_fin: string | null }) => [o.id, o.fecha_fin])
      );

      for (const lib of liberaciones) {
        planLiberadas.push({
          engagement_id: lib.engagement_id,
          pct_dedicacion: lib.pct_dedicacion,
          fecha_liberacion: lib.fecha_fin, // termination date
          fecha_fin_orig: origMap.get(lib.asignacion_a_terminar_id!) ?? null,
        });
      }
    }
  }

  // 4. Construir mapa engagement → días
  const engMap = new Map<string, FilaProyecto>();

  for (const req of reqs) {
    if (!engMap.has(req.engagement_id)) {
      engMap.set(req.engagement_id, {
        engagement_id: req.engagement_id,
        engagement_nombre: req.engagement?.nombre ?? "—",
        cliente: req.engagement?.cliente ?? "—",
        dias: {},
      });
    }
  }

  for (const dia of dias) {
    const diaStr = format(dia, "yyyy-MM-dd");

    for (const [engId, fila] of engMap) {
      const requerido = reqs
        .filter(
          (r) =>
            r.engagement_id === engId &&
            r.fecha_inicio <= diaStr &&
            r.fecha_fin >= diaStr
        )
        .reduce((s, r) => s + Number(r.pct_dedicacion), 0);

      const asignado = asigData
        .filter(
          (a) =>
            a.engagement_id === engId &&
            a.fecha_inicio <= diaStr &&
            (a.fecha_fin === null || a.fecha_fin >= diaStr)
        )
        .reduce((s, a) => s + Number(a.pct_dedicacion), 0);

      // Capacity freed from this engagement by the plan on this day
      const liberado = planLiberadas
        .filter(
          (a) =>
            a.engagement_id === engId &&
            a.fecha_liberacion <= diaStr &&
            (a.fecha_fin_orig === null || a.fecha_fin_orig >= diaStr)
        )
        .reduce((s, a) => s + Number(a.pct_dedicacion), 0);

      const asignadoPlan = planAsig
        .filter(
          (a) =>
            a.engagement_id === engId &&
            a.fecha_inicio <= diaStr &&
            a.fecha_fin >= diaStr
        )
        .reduce((s, a) => s + Number(a.pct_dedicacion), 0);

      const asignadoEfectivo = Math.max(0, asignado - liberado);
      const cobertura =
        requerido > 0
          ? Math.min(((asignadoEfectivo + asignadoPlan) / requerido) * 100, 100)
          : -1;

      fila.dias[diaStr] = { requerido, asignado: asignadoEfectivo, asignadoPlan, cobertura };
    }
  }

  const filas = Array.from(engMap.values()).sort((a, b) =>
    a.engagement_nombre.localeCompare(b.engagement_nombre, "es")
  );

  // Días críticos del período para engagements presentes en el tablero
  const { data: dcRawEng } = await (supabase as any)
    .from("dia_critico")
    .select("engagement_id, fecha")
    .in("engagement_id", engIds)
    .gte("fecha", inicioStr)
    .lte("fecha", finStr);

  const diasCriticosEng = new Set<string>(
    ((dcRawEng ?? []) as { engagement_id: string; fecha: string }[])
      .map((r) => `${r.engagement_id}|${r.fecha}`)
  );

  return { filas, dias, diasCriticosEng, error: null };
}

// ─────────────────────────────────────────────────────────────
//  Legacy — funciones semanales (usadas por el plan RPC)
// ─────────────────────────────────────────────────────────────

export async function fetchOcupacionSemanas(
  supabase: TypedSupabaseClient,
  desde: Date,
  cantidad = SEMANAS_VISIBLES
): Promise<{ filas: FilaPersona[]; semanas: Date[]; error: string | null }> {
  const inicio = startOfISOWeek(desde);
  const fin = addWeeks(inicio, cantidad);

  const { data, error } = await supabase
    .from("ocupacion_semana")
    .select("*")
    .gte("semana_inicio", format(inicio, "yyyy-MM-dd"))
    .lt("semana_inicio", format(fin, "yyyy-MM-dd"))
    .order("persona_nombre");

  if (error) return { filas: [], semanas: [], error: error.message };
  if (!data || data.length === 0) return { filas: [], semanas: [], error: null };

  const semanas: Date[] = Array.from({ length: cantidad }, (_, i) => addWeeks(inicio, i));
  const porPersona = new Map<string, FilaPersona>();

  for (const row of data as OcupacionSemana[]) {
    if (!porPersona.has(row.persona_id)) {
      porPersona.set(row.persona_id, {
        persona_id: row.persona_id,
        persona_nombre: row.persona_nombre,
        cargo_actual: row.cargo_actual,
        semanas: {},
      });
    }
    porPersona.get(row.persona_id)!.semanas[row.semana_inicio] = {
      actual: Number(row.ocupacion_actual_pct),
      proyectado: Number(row.ocupacion_proyectada_pct),
    };
  }

  const filas = Array.from(porPersona.values()).sort((a, b) => {
    const oa = ORDEN_CARGO[a.cargo_actual] ?? 99;
    const ob = ORDEN_CARGO[b.cargo_actual] ?? 99;
    if (oa !== ob) return oa - ob;
    return a.persona_nombre.localeCompare(b.persona_nombre, "es");
  });

  return { filas, semanas, error: null };
}

export async function fetchOcupacionSemanasPlan(
  supabase: TypedSupabaseClient,
  desde: Date,
  planId: string,
  cantidad = SEMANAS_VISIBLES
): Promise<{ filas: FilaPersona[]; semanas: Date[]; error: string | null }> {
  const inicio = startOfISOWeek(desde);
  const fin = addWeeks(inicio, cantidad);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rpcData, error } = await (supabase as any).rpc("ocupacion_semana_con_plan", { p_plan_id: planId });

  if (error) return { filas: [], semanas: [], error: error.message };
  const data = rpcData as unknown as OcupacionSemana[] | null;
  if (!data || data.length === 0) return { filas: [], semanas: [], error: null };

  const inicioStr = format(inicio, "yyyy-MM-dd");
  const finStr    = format(fin, "yyyy-MM-dd");
  const filtered  = (data as OcupacionSemana[]).filter(
    (r) => r.semana_inicio >= inicioStr && r.semana_inicio < finStr
  );

  const semanas: Date[] = Array.from({ length: cantidad }, (_, i) => addWeeks(inicio, i));
  const porPersona = new Map<string, FilaPersona>();

  for (const row of filtered) {
    if (!porPersona.has(row.persona_id)) {
      porPersona.set(row.persona_id, {
        persona_id: row.persona_id,
        persona_nombre: row.persona_nombre,
        cargo_actual: row.cargo_actual,
        semanas: {},
      });
    }
    porPersona.get(row.persona_id)!.semanas[row.semana_inicio] = {
      actual: Number(row.ocupacion_actual_pct),
      proyectado: Number(row.ocupacion_proyectada_pct),
    };
  }

  const filas = Array.from(porPersona.values()).sort((a, b) => {
    const oa = ORDEN_CARGO[a.cargo_actual] ?? 99;
    const ob = ORDEN_CARGO[b.cargo_actual] ?? 99;
    if (oa !== ob) return oa - ob;
    return a.persona_nombre.localeCompare(b.persona_nombre, "es");
  });

  return { filas, semanas, error: null };
}
