"use client";

import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertTriangle, CheckCircle, ChevronDown, ChevronUp,
  X, AlertCircle,
} from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { colorOcupacion, formatPct } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

// ─────────────────────────────────────────────────────────────
//  Tipos internos
// ─────────────────────────────────────────────────────────────

interface AsigEnriquecida {
  id: string;
  persona_id: string;
  persona_nombre: string;
  cargo_al_momento: string | null;
  persona_cargo_actual: string | null;
  engagement_id: string;
  engagement_nombre: string;
  pct_dedicacion: number;
  fecha_inicio: string;
  fecha_fin: string;
  tipo: string; // "asignar" | "liberar"
  asignacion_a_terminar_id: string | null;
  requerimiento_id: string | null;
}

interface PlanDetalle {
  id: string;
  nombre: string;
  descripcion: string | null;
  created_at: string;
  creada_por_nombre: string;
  asignaciones: AsigEnriquecida[];
}

interface CapacidadCheck {
  asignacion_id: string;
  persona_id: string;
  persona_nombre: string;
  cargo: string | null;
  pct_propuesto: number;
  pct_liberado: number;
  max_ocupacion: number;
  max_ajustado: number;
  final_pct: number;
  excede: boolean;
}

interface AusenciaRiesgo {
  persona_nombre: string;
  tipo: string;
  ausencia_inicio: string;
  ausencia_fin: string;
  engagement_nombre: string;
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return format(new Date(iso + "T00:00:00"), "d MMM yy", { locale: es });
}

const TIPO_AUSENCIA_LABEL: Record<string, string> = {
  vacaciones: "Vacaciones",
  dia_libre: "Día libre",
  dia_administrativo: "Día administrativo",
  permiso: "Permiso",
  licencia_medica: "Licencia médica",
  capacitacion: "Capacitación",
  otro: "Otro",
};

// ─────────────────────────────────────────────────────────────
//  Props
// ─────────────────────────────────────────────────────────────

interface Props {
  planId: string;
  miPersonaId: string;
  onSuccess: () => void; // llamado tras aprobar o descartar
  onClose: () => void;   // vuelve a vista real
}

// ─────────────────────────────────────────────────────────────
//  Componente principal
// ─────────────────────────────────────────────────────────────

export function PlanReviewPanel({ planId, miPersonaId, onSuccess, onClose }: Props) {
  const [plan, setPlan] = useState<PlanDetalle | null>(null);
  const [capacidadChecks, setCapacidadChecks] = useState<CapacidadCheck[]>([]);
  const [ausenciaRiesgos, setAusenciaRiesgos] = useState<AusenciaRiesgo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  // Confirmación inline: "aprobar" | "descartar" | null
  const [confirmando, setConfirmando] = useState<"aprobar" | "descartar" | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Carga de datos ─────────────────────────────────────────
  const loadPlan = useCallback(async () => {
    setLoading(true);
    setCapacidadChecks([]);
    setAusenciaRiesgos([]);
    setConfirmando(null);
    setActionError(null);

    const sb = createAnyClient();

    const { data: planRaw } = await sb
      .from("propuesta_plan")
      .select("id, nombre, descripcion, created_at, creada_por")
      .eq("id", planId)
      .single();

    if (!planRaw) { setLoading(false); return; }

    const { data: asigRaw } = await sb
      .from("asignacion_propuesta")
      .select("id, persona_id, engagement_id, requerimiento_id, pct_dedicacion, fecha_inicio, fecha_fin, tipo, asignacion_a_terminar_id, cargo_al_momento")
      .eq("plan_id", planId)
      .eq("estado", "borrador");

    const asigs = (asigRaw ?? []) as any[];

    if (asigs.length === 0) {
      setPlan({ ...planRaw, creada_por_nombre: "—", asignaciones: [] });
      setLoading(false);
      return;
    }

    // Enriquecer con nombres
    const personaIds = [...new Set(asigs.map((a) => a.persona_id))];
    const engIds     = [...new Set(asigs.map((a) => a.engagement_id))];
    const allIds     = [...new Set([...personaIds, planRaw.creada_por].filter(Boolean))];

    const [pRes, eRes] = await Promise.all([
      sb.from("persona").select("id, nombre, apellido, cargo_actual").in("id", allIds),
      sb.from("engagement").select("id, nombre").in("id", engIds),
    ]);

    type PersonaRow = { id: string; nombre: string; apellido: string; cargo_actual: string | null };
    type EngRow     = { id: string; nombre: string };

    const personaMap = new Map<string, PersonaRow>(
      ((pRes.data ?? []) as unknown as PersonaRow[]).map((p) => [p.id, p])
    );
    const engMap = new Map<string, string>(
      ((eRes.data ?? []) as unknown as EngRow[]).map((e) => [e.id, e.nombre])
    );

    const creador = planRaw.creada_por ? personaMap.get(planRaw.creada_por) : null;
    const creada_por_nombre = creador ? `${creador.nombre} ${creador.apellido}` : "—";

    const asigEnriquecidas: AsigEnriquecida[] = asigs.map((a) => {
      const persona = personaMap.get(a.persona_id);
      return {
        id: a.id,
        persona_id: a.persona_id,
        persona_nombre: persona ? `${persona.nombre} ${persona.apellido}` : "—",
        cargo_al_momento: a.cargo_al_momento ?? null,
        persona_cargo_actual: persona?.cargo_actual ?? null,
        engagement_id: a.engagement_id,
        engagement_nombre: engMap.get(a.engagement_id) ?? "—",
        pct_dedicacion: Number(a.pct_dedicacion),
        fecha_inicio: a.fecha_inicio,
        fecha_fin: a.fecha_fin,
        tipo: a.tipo ?? "asignar",
        asignacion_a_terminar_id: a.asignacion_a_terminar_id ?? null,
        requerimiento_id: a.requerimiento_id ?? null,
      };
    });

    const planDetalle: PlanDetalle = {
      ...planRaw,
      creada_por_nombre,
      asignaciones: asigEnriquecidas,
    };

    // ── Capacity checks (para tipo=asignar) ───────────────────
    const asigAsignar = asigEnriquecidas.filter((a) => a.tipo !== "liberar");
    const asigLiberar = asigEnriquecidas.filter((a) => a.tipo === "liberar");

    const pctLiberadoPorPersona = new Map<string, number>();
    for (const lib of asigLiberar) {
      pctLiberadoPorPersona.set(
        lib.persona_id,
        (pctLiberadoPorPersona.get(lib.persona_id) ?? 0) + lib.pct_dedicacion
      );
    }

    if (asigAsignar.length > 0) {
      const checks: CapacidadCheck[] = await Promise.all(
        asigAsignar.map(async (asig) => {
          const { data: rpcData } = await sb.rpc("check_capacidad_disponible", {
            p_persona_id: asig.persona_id,
            p_fecha_inicio: asig.fecha_inicio,
            p_fecha_fin: asig.fecha_fin,
          });
          const breakpoints = (rpcData ?? []) as { ocupacion_pct: number }[];
          const maxOcupacion = breakpoints.length > 0
            ? Math.max(...breakpoints.map((b) => Number(b.ocupacion_pct)))
            : 0;
          const pctLiberado = pctLiberadoPorPersona.get(asig.persona_id) ?? 0;
          const maxAjustado = Math.max(0, maxOcupacion - pctLiberado);
          const finalPct = maxAjustado + asig.pct_dedicacion;
          return {
            asignacion_id: asig.id,
            persona_id: asig.persona_id,
            persona_nombre: asig.persona_nombre,
            cargo: asig.cargo_al_momento ?? asig.persona_cargo_actual,
            pct_propuesto: asig.pct_dedicacion,
            pct_liberado: pctLiberado,
            max_ocupacion: maxOcupacion,
            max_ajustado: maxAjustado,
            final_pct: finalPct,
            excede: finalPct > 100,
          };
        })
      );
      setCapacidadChecks(checks);
    }

    // ── Ausencia risk check ────────────────────────────────────
    if (asigAsignar.length > 0 && personaIds.length > 0) {
      const minFecha = asigAsignar.reduce(
        (m, a) => (a.fecha_inicio < m ? a.fecha_inicio : m),
        asigAsignar[0].fecha_inicio
      );
      const maxFecha = asigAsignar.reduce(
        (m, a) => (a.fecha_fin > m ? a.fecha_fin : m),
        asigAsignar[0].fecha_fin
      );

      const { data: ausData } = await sb
        .from("ausencia")
        .select("persona_id, tipo, fecha_inicio, fecha_fin")
        .in("persona_id", personaIds)
        .lte("fecha_inicio", maxFecha)
        .gte("fecha_fin", minFecha);

      const ausencias = (ausData ?? []) as {
        persona_id: string; tipo: string; fecha_inicio: string; fecha_fin: string;
      }[];

      const seen = new Set<string>();
      const riesgos: AusenciaRiesgo[] = [];

      for (const asig of asigAsignar) {
        for (const aus of ausencias) {
          if (aus.persona_id !== asig.persona_id) continue;
          if (aus.fecha_inicio > asig.fecha_fin || aus.fecha_fin < asig.fecha_inicio) continue;
          const key = `${asig.persona_id}|${asig.engagement_id}|${aus.fecha_inicio}`;
          if (seen.has(key)) continue;
          seen.add(key);
          riesgos.push({
            persona_nombre: asig.persona_nombre,
            tipo: aus.tipo,
            ausencia_inicio: aus.fecha_inicio,
            ausencia_fin: aus.fecha_fin,
            engagement_nombre: asig.engagement_nombre,
          });
        }
      }
      setAusenciaRiesgos(riesgos);
    }

    setPlan(planDetalle);
    setLoading(false);
  }, [planId]);

  useEffect(() => { loadPlan(); }, [loadPlan]);

  // ── Aprobar ────────────────────────────────────────────────
  const handleAprobar = async () => {
    if (!plan) return;
    setActionLoading(true);
    setActionError(null);
    const sb = createAnyClient();

    const asigAsignar = plan.asignaciones.filter((a) => a.tipo !== "liberar");
    const asigLiberar = plan.asignaciones.filter((a) => a.tipo === "liberar");
    const ahora = new Date().toISOString();
    const camposRevision = { revisado_por: miPersonaId || null, fecha_revision: ahora, notas_revision: null };

    // 1. Marcar plan como aprobado
    const { error: planErr } = await sb
      .from("propuesta_plan").update({ estado: "aprobada", ...camposRevision }).eq("id", planId);
    if (planErr) { setActionError(planErr.message); setActionLoading(false); return; }

    // 2. Marcar todas las asig propuestas como aprobadas
    const { error: asigUpdErr } = await sb
      .from("asignacion_propuesta").update({ estado: "aprobada", ...camposRevision }).eq("plan_id", planId);
    if (asigUpdErr) { setActionError(asigUpdErr.message); setActionLoading(false); return; }

    // 3a. Ejecutar liberaciones
    if (asigLiberar.length > 0) {
      const errores: string[] = [];
      await Promise.all(
        asigLiberar.map(async (lib) => {
          if (!lib.asignacion_a_terminar_id) return;
          const { error } = await sb
            .from("asignacion")
            .update({ estado: "finalizada", fecha_fin: lib.fecha_fin })
            .eq("id", lib.asignacion_a_terminar_id);
          if (error) errores.push(error.message);
        })
      );
      if (errores.length > 0) { setActionError(`Error al terminar asignaciones: ${errores[0]}`); setActionLoading(false); return; }
    }

    // 3b. Crear asignaciones reales para tipo=asignar
    if (asigAsignar.length > 0) {
      const nuevas = asigAsignar.map((asig) => ({
        persona_id: asig.persona_id,
        engagement_id: asig.engagement_id,
        requerimiento_id: asig.requerimiento_id,
        cargo_al_momento: asig.cargo_al_momento ?? asig.persona_cargo_actual ?? "—",
        pct_dedicacion: asig.pct_dedicacion,
        fecha_inicio: asig.fecha_inicio,
        fecha_fin: asig.fecha_fin,
        estado: "activa",
        propuesta_origen_id: asig.id,
        aprobada_por: miPersonaId || null,
        fecha_aprobacion: ahora,
      }));

      const { data: creadas, error: insErr } = await sb
        .from("asignacion").insert(nuevas).select("id, propuesta_origen_id");
      if (insErr || !creadas) { setActionError(insErr?.message ?? "Error al crear asignaciones"); setActionLoading(false); return; }

      await Promise.all(
        (creadas as { id: string; propuesta_origen_id: string | null }[])
          .filter((a) => a.propuesta_origen_id)
          .map((a) =>
            sb.from("asignacion_propuesta")
              .update({ asignacion_resultante_id: a.id })
              .eq("id", a.propuesta_origen_id!)
          )
      );
    }

    setActionLoading(false);
    onClose(); // volver a vista real
    onSuccess();
  };

  // ── Descartar (eliminar plan + asignaciones) ───────────────
  const handleDescartar = async () => {
    setActionLoading(true);
    setActionError(null);
    const sb = createAnyClient();

    const { error: delAsigErr } = await sb
      .from("asignacion_propuesta").delete().eq("plan_id", planId);
    if (delAsigErr) { setActionError(delAsigErr.message); setActionLoading(false); return; }

    const { error: delPlanErr } = await sb
      .from("propuesta_plan").delete().eq("id", planId);
    if (delPlanErr) { setActionError(delPlanErr.message); setActionLoading(false); return; }

    setActionLoading(false);
    onClose();
    onSuccess();
  };

  // ── Estado derivado ────────────────────────────────────────
  const hayConflictos = capacidadChecks.some((c) => c.excede);
  const asigNuevas   = plan?.asignaciones.filter((a) => a.tipo !== "liberar") ?? [];
  const asigLiberar  = plan?.asignaciones.filter((a) => a.tipo === "liberar") ?? [];

  // ── Render ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="bg-white border-b-2 border-[#2563eb] px-6 py-3.5 text-sm text-[#888]">
        Cargando detalles del plan...
      </div>
    );
  }

  if (!plan) return null;

  return (
    <div className="bg-white border-b-2 border-[#2563eb] flex-shrink-0">

      {/* ── Header ── */}
      <div className="px-6 py-3 flex items-center gap-4 border-b border-[#f0f0f0]">
        {/* Dot + nombre + meta */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 flex-shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold text-[14px] text-[#1a1a1a] leading-tight truncate">{plan.nombre}</p>
            <p className="text-[11px] text-[#888]">
              Creado por {plan.creada_por_nombre}
              {" · "}
              {format(new Date(plan.created_at), "d MMM yyyy", { locale: es })}
            </p>
          </div>
        </div>

        {/* Chips de riesgo */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {hayConflictos && (
            <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700">
              <AlertTriangle className="w-3 h-3" />
              {capacidadChecks.filter((c) => c.excede).length} conflicto{capacidadChecks.filter((c) => c.excede).length !== 1 ? "s" : ""}
            </span>
          )}
          {ausenciaRiesgos.length > 0 && (
            <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
              <AlertCircle className="w-3 h-3" />
              {ausenciaRiesgos.length} ausencia{ausenciaRiesgos.length !== 1 ? "s" : ""}
            </span>
          )}
          {!hayConflictos && ausenciaRiesgos.length === 0 && !loading && (
            <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700">
              <CheckCircle className="w-3 h-3" />
              Sin conflictos
            </span>
          )}
        </div>

        {/* Separador */}
        <div className="h-7 w-px bg-[#e8e8e8] flex-shrink-0" />

        {/* Acciones */}
        {confirmando === null ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => setConfirmando("descartar")}
              className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 font-medium transition-colors"
            >
              Descartar plan
            </button>
            <Button
              size="sm"
              onClick={() => setConfirmando("aprobar")}
              disabled={hayConflictos}
              title={hayConflictos ? "Hay conflictos de capacidad. Ajusta el plan antes de aprobar." : undefined}
            >
              Aprobar plan
            </Button>
          </div>
        ) : confirmando === "aprobar" ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-[#555]">
              ¿Confirmar? Se crearán {asigNuevas.length} asignación{asigNuevas.length !== 1 ? "es" : ""}
              {asigLiberar.length > 0 ? ` y se liberarán ${asigLiberar.length}` : ""}.
            </span>
            <button
              type="button"
              onClick={() => setConfirmando(null)}
              className="text-xs px-3 py-1.5 rounded-lg border border-[#e0e0e0] text-[#555] hover:bg-[#f5f5f5] font-medium"
            >
              Cancelar
            </button>
            <Button size="sm" onClick={handleAprobar} loading={actionLoading}>
              Confirmar aprobación
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-red-600 font-medium">¿Eliminar plan y todas sus propuestas?</span>
            <button
              type="button"
              onClick={() => setConfirmando(null)}
              className="text-xs px-3 py-1.5 rounded-lg border border-[#e0e0e0] text-[#555] hover:bg-[#f5f5f5] font-medium"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleDescartar}
              disabled={actionLoading}
              className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 font-medium disabled:opacity-50"
            >
              {actionLoading ? "Eliminando..." : "Sí, eliminar"}
            </button>
          </div>
        )}

        {/* Collapse toggle */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-7 h-7 rounded-md border border-[#e0e0e0] flex items-center justify-center text-[#888] hover:bg-[#f5f5f5] flex-shrink-0"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Error inline */}
      {actionError && (
        <div className="px-6 py-2 bg-red-50 border-b border-red-100 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {actionError}
        </div>
      )}

      {/* ── Body: 3 columnas ── */}
      {expanded && (
        <div className="px-6 py-4 grid grid-cols-3 gap-6">

          {/* ── Col 1: Cambios propuestos ── */}
          <div>
            <p className="text-[10px] font-bold text-[#aaa] uppercase tracking-widest mb-3">
              Cambios propuestos
            </p>
            <div className="space-y-2">
              {asigNuevas.map((a) => (
                <div key={a.id} className="flex items-start gap-2 p-2.5 rounded-lg bg-[#eff6ff] border border-[#bfdbfe]">
                  <span className="text-[#2563eb] text-sm font-bold mt-0.5 flex-shrink-0">＋</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#1a1a1a] truncate">{a.persona_nombre}</p>
                    <p className="text-[10px] text-[#555] truncate">{a.engagement_nombre}</p>
                    <p className="text-[10px] text-[#888]">{fmtDate(a.fecha_inicio)} → {fmtDate(a.fecha_fin)}</p>
                  </div>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#dbeafe] text-[#1d4ed8] flex-shrink-0">
                    {a.pct_dedicacion}%
                  </span>
                </div>
              ))}
              {asigLiberar.map((a) => (
                <div key={a.id} className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200">
                  <span className="text-red-500 text-sm font-bold mt-0.5 flex-shrink-0">↩</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-red-700 line-through truncate">{a.persona_nombre}</p>
                    <p className="text-[10px] text-red-500 truncate">{a.engagement_nombre}</p>
                    <p className="text-[10px] text-red-400">libera desde {fmtDate(a.fecha_fin)}</p>
                  </div>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600 line-through flex-shrink-0">
                    {a.pct_dedicacion}%
                  </span>
                </div>
              ))}
              {plan.asignaciones.length === 0 && (
                <p className="text-xs text-[#aaa] italic">Sin movimientos en este plan.</p>
              )}
            </div>
          </div>

          {/* ── Col 2: Capacidad proyectada ── */}
          <div>
            <p className="text-[10px] font-bold text-[#aaa] uppercase tracking-widest mb-3">
              Capacidad proyectada
            </p>
            {capacidadChecks.length === 0 && asigLiberar.length === 0 ? (
              <p className="text-xs text-[#aaa] italic">Sin personas con nueva asignación.</p>
            ) : (
              <div className="space-y-2.5">
                {/* Personas con nueva asignación */}
                {capacidadChecks.map((check) => {
                  const final = Math.max(0, check.final_pct);
                  const { bg, text } = colorOcupacion(final);
                  const barW = Math.min(final, 120); // allow overflow visual
                  return (
                    <div key={check.asignacion_id}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-[#1a1a1a] truncate flex-1 mr-2">{check.persona_nombre}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {check.pct_liberado > 0 && (
                            <span className="text-[10px] text-emerald-600 font-semibold">−{check.pct_liberado}%</span>
                          )}
                          <span className="text-[10px] text-[#888]">+{check.pct_propuesto}%</span>
                          <span
                            className="text-[11px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                            style={{ background: bg, color: text }}
                          >
                            {formatPct(final)}
                          </span>
                          {check.excede && <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                        </div>
                      </div>
                      <div className="h-1.5 bg-[#f0f0f0] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${Math.min(barW, 100)}%`, background: check.excede ? "#f87171" : bg }}
                        />
                      </div>
                    </div>
                  );
                })}
                {/* Personas solo liberadas (sin nueva asignación en este plan) */}
                {asigLiberar
                  .filter((lib) => !capacidadChecks.some((c) => c.persona_id === lib.persona_id))
                  .map((lib) => (
                    <div key={lib.id}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-[#1a1a1a] truncate flex-1 mr-2">{lib.persona_nombre}</span>
                        <span className="text-[10px] text-emerald-600 font-semibold flex-shrink-0">−{lib.pct_dedicacion}% liberado</span>
                      </div>
                      <div className="h-1.5 bg-emerald-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-400" style={{ width: "30%" }} />
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* ── Col 3: Riesgos ── */}
          <div>
            <p className="text-[10px] font-bold text-[#aaa] uppercase tracking-widest mb-3">
              Riesgos detectados
            </p>
            <div className="space-y-2">
              {/* Conflictos de capacidad (HIGH) */}
              {capacidadChecks.filter((c) => c.excede).map((c) => (
                <div key={c.asignacion_id} className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200">
                  <span className="text-sm flex-shrink-0">🔴</span>
                  <div>
                    <p className="text-xs font-semibold text-red-700">{c.persona_nombre} supera 100%</p>
                    <p className="text-[10px] text-red-500 mt-0.5">
                      Quedaría al {formatPct(c.final_pct)}. El plan no puede aprobarse así.
                    </p>
                  </div>
                </div>
              ))}

              {/* Ausencias solapadas (MEDIUM) */}
              {ausenciaRiesgos.map((r, i) => (
                <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                  <span className="text-sm flex-shrink-0">🟡</span>
                  <div>
                    <p className="text-xs font-semibold text-amber-700">
                      {r.persona_nombre} · {TIPO_AUSENCIA_LABEL[r.tipo] ?? r.tipo}
                    </p>
                    <p className="text-[10px] text-amber-600 mt-0.5">
                      {fmtDate(r.ausencia_inicio)} – {fmtDate(r.ausencia_fin)} solapa con {r.engagement_nombre}
                    </p>
                  </div>
                </div>
              ))}

              {/* Sin riesgos (GREEN) */}
              {!hayConflictos && ausenciaRiesgos.length === 0 && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-green-50 border border-green-200">
                  <span className="text-sm flex-shrink-0">🟢</span>
                  <div>
                    <p className="text-xs font-semibold text-green-700">Plan aprobable</p>
                    <p className="text-[10px] text-green-600 mt-0.5">
                      Sin conflictos de capacidad ni ausencias detectadas.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
