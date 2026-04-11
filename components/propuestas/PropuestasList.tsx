"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus, CheckCircle, XCircle, Clock, AlertTriangle,
  ChevronDown, ChevronUp, Layers, Users, Calendar,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { createClient, createAnyClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { FieldWrapper, Textarea } from "@/components/ui/FormField";
import { PlanificacionDrawer, type GapEngagement } from "./PlanificacionDrawer";
import { colorOcupacion, formatPct } from "@/lib/utils";
import type { AsignacionPropuesta, PropuestaPlan, RolSistema } from "@/lib/types/database";

interface Props { rolActual: RolSistema | null; }

// ── Tipos enriquecidos ─────────────────────────────────────────

interface AsignacionEnriquecida extends AsignacionPropuesta {
  persona_nombre: string;
  engagement_nombre: string;
}

interface PlanEnriquecido extends PropuestaPlan {
  creada_por_nombre: string;
  asignaciones: AsignacionEnriquecida[];
  // Engagements únicos involucrados
  engagements: { id: string; nombre: string }[];
}

// Verificación de capacidad por asignación (para el modal de aprobación)
interface CapacidadCheck {
  asignacion_id: string;
  persona_nombre: string;
  cargo: string | null;
  pct_propuesto: number;
  breakpoints: { fecha: string; ocupacion_pct: number }[];
  max_ocupacion: number;
  excede: boolean;
}

// ── Constantes visuales ────────────────────────────────────────

const ESTADO_ICONO: Record<string, React.ReactNode> = {
  borrador:  <Clock className="w-4 h-4 text-[#888]" />,
  aprobada:  <CheckCircle className="w-4 h-4 text-[#27ae60]" />,
  rechazada: <XCircle className="w-4 h-4 text-red-500" />,
};

const ESTADO_ESTILOS: Record<string, { bg: string; text: string }> = {
  borrador:  { bg: "#f0f0f0", text: "#555" },
  aprobada:  { bg: "#dcf5e7", text: "#1e7e45" },
  rechazada: { bg: "#ffd4d4", text: "#c02020" },
};

// ── Componente principal ───────────────────────────────────────

export function PropuestasList({ rolActual }: Props) {
  const [planes, setPlanes] = useState<PlanEnriquecido[]>([]);
  const [loading, setLoading] = useState(true);
  const [miPersonaId, setMiPersonaId] = useState<string>("");

  // PlanificacionDrawer
  const [planDrawerOpen, setPlanDrawerOpen] = useState(false);
  const [engPlanSeleccionado, setEngPlanSeleccionado] = useState<GapEngagement | null>(null);

  // Panel de gaps
  const [gapsEngagements, setGapsEngagements] = useState<GapEngagementUI[]>([]);
  const [gapsLoading, setGapsLoading] = useState(true);
  const [gapsPanelExpanded, setGapsPanelExpanded] = useState(true);

  // Planes expandidos en la UI
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  // Modal de revisión de plan completo
  const [revisionModal, setRevisionModal] = useState<{
    plan: PlanEnriquecido;
    accion: "aprobada" | "rechazada";
  } | null>(null);
  const [notasRevision, setNotasRevision] = useState("");
  const [capacidadChecks, setCapacidadChecks] = useState<CapacidadCheck[]>([]);
  const [capacidadLoading, setCapacidadLoading] = useState(false);
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);

  const isAdmin = rolActual === "admin";
  const isProposerOrAdmin = rolActual === "proposer" || isAdmin;

  // ── Cargar planes con sus asignaciones ──────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const sb = createAnyClient();
    const { data: { user } } = await supabase.auth.getUser();

    const [meRes, planesRes] = await Promise.all([
      user ? sb.from("persona").select("id").eq("auth_user_id", user.id).single()
           : Promise.resolve({ data: null }),
      sb
        .from("propuesta_plan")
        .select("*")
        .order("created_at", { ascending: false }),
    ]);

    if (meRes.data) setMiPersonaId(meRes.data.id);
    const planesData = (planesRes.data ?? []) as PropuestaPlan[];

    if (planesData.length === 0) {
      setPlanes([]);
      setLoading(false);
      return;
    }

    const planIds = planesData.map((p) => p.id);

    // Cargar asignaciones de todos los planes
    const { data: asigData } = await sb
      .from("asignacion_propuesta")
      .select("*")
      .in("plan_id", planIds)
      .order("created_at");

    const asignaciones = (asigData ?? []) as AsignacionPropuesta[];

    // IDs únicos para enriquecer
    const personaIds = [...new Set([
      ...asignaciones.map((a) => a.persona_id),
      ...planesData.map((p) => p.creada_por).filter(Boolean) as string[],
    ])];
    const engIds = [...new Set(asignaciones.map((a) => a.engagement_id))];

    const [pRes, eRes] = await Promise.all([
      personaIds.length > 0
        ? sb.from("persona").select("id,nombre,apellido").in("id", personaIds)
        : Promise.resolve({ data: [] }),
      engIds.length > 0
        ? sb.from("engagement").select("id,nombre").in("id", engIds)
        : Promise.resolve({ data: [] }),
    ]);

    const personaMap = new Map((pRes.data ?? []).map((p: any) => [p.id, `${p.nombre} ${p.apellido}`]));
    const engMap = new Map((eRes.data ?? []).map((e: any) => [e.id, e.nombre]));

    const planesEnriquecidos: PlanEnriquecido[] = planesData.map((plan: any) => {
      const asigsPlan = asignaciones
        .filter((a) => a.plan_id === plan.id)
        .map((a) => ({
          ...a,
          persona_nombre: personaMap.get(a.persona_id) ?? "—",
          engagement_nombre: engMap.get(a.engagement_id) ?? "—",
        }));

      const engsUnicos = [...new Map(
        asigsPlan.map((a) => [a.engagement_id, { id: a.engagement_id, nombre: a.engagement_nombre }])
      ).values()];

      return {
        ...plan,
        creada_por_nombre: plan.creada_por ? (personaMap.get(plan.creada_por) ?? "—") : "—",
        asignaciones: asigsPlan,
        engagements: engsUnicos,
      };
    });

    setPlanes(planesEnriquecidos);
    setLoading(false);
  }, []);

  // ── Cargar gaps de cobertura ───────────────────────────────
  const loadGaps = useCallback(async () => {
    setGapsLoading(true);
    const supabase = createAnyClient();
    const { data } = await supabase
      .from("cobertura_engagement")
      .select("engagement_id,engagement_nombre,cliente,requerimiento_id,fase_numero,fase_nombre,cargo_requerido,pct_requerido,pct_descubierto,req_fecha_inicio,req_fecha_fin")
      .gt("pct_descubierto", 0)
      .order("engagement_nombre")
      .order("fase_numero");

    if (!data || data.length === 0) {
      setGapsEngagements([]);
      setGapsLoading(false);
      return;
    }

    const engMap = new Map<string, GapEngagementUI>();
    for (const row of data) {
      if (!engMap.has(row.engagement_id)) {
        engMap.set(row.engagement_id, {
          engagement_id: row.engagement_id,
          engagement_nombre: row.engagement_nombre,
          cliente: row.cliente,
          gaps: [],
        });
      }
      engMap.get(row.engagement_id)!.gaps.push({
        requerimiento_id: row.requerimiento_id,
        fase_numero: row.fase_numero,
        fase_nombre: row.fase_nombre,
        cargo_requerido: row.cargo_requerido,
        pct_requerido: row.pct_requerido,
        pct_descubierto: row.pct_descubierto,
        req_fecha_inicio: row.req_fecha_inicio,
        req_fecha_fin: row.req_fecha_fin,
      });
    }
    setGapsEngagements(Array.from(engMap.values()));
    setGapsLoading(false);
  }, []);

  useEffect(() => { load(); loadGaps(); }, [load, loadGaps]);

  // ── Expandir/colapsar plan ─────────────────────────────────
  const toggleExpandido = (id: string) => {
    setExpandidos((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Abrir PlanificacionDrawer ──────────────────────────────
  const abrirPlanificacion = (eng: GapEngagementUI | null) => {
    setEngPlanSeleccionado(eng ? { engagement_id: eng.engagement_id, engagement_nombre: eng.engagement_nombre } : null);
    setPlanDrawerOpen(true);
  };

  // ── Modal de revisión del plan completo ────────────────────
  const abrirRevisionPlan = async (plan: PlanEnriquecido, accion: "aprobada" | "rechazada") => {
    setRevisionModal({ plan, accion });
    setNotasRevision("");
    setRevisionError(null);
    setCapacidadChecks([]);

    if (accion === "aprobada") {
      setCapacidadLoading(true);
      const supabase = createAnyClient();

      // Verificar capacidad para cada asignación del plan
      const checks: CapacidadCheck[] = await Promise.all(
        plan.asignaciones.map(async (asig) => {
          const { data } = await supabase.rpc("check_capacidad_disponible", {
            p_persona_id: asig.persona_id,
            p_fecha_inicio: asig.fecha_inicio,
            p_fecha_fin: asig.fecha_fin,
          });
          const breakpoints = (data ?? []) as { fecha: string; ocupacion_pct: number }[];
          const maxOcupacion = breakpoints.length > 0
            ? Math.max(...breakpoints.map((b) => Number(b.ocupacion_pct)))
            : 0;
          return {
            asignacion_id: asig.id,
            persona_nombre: asig.persona_nombre,
            cargo: asig.cargo_al_momento,
            pct_propuesto: Number(asig.pct_dedicacion),
            breakpoints,
            max_ocupacion: maxOcupacion,
            excede: maxOcupacion + Number(asig.pct_dedicacion) > 100,
          };
        })
      );

      setCapacidadChecks(checks);
      setCapacidadLoading(false);
    }
  };

  const hayConflictos = capacidadChecks.some((c) => c.excede);

  const confirmarRevisionPlan = async () => {
    if (!revisionModal) return;
    const { plan, accion } = revisionModal;

    setRevisionLoading(true);
    setRevisionError(null);
    const supabase = createAnyClient();

    const camposRevision = {
      revisado_por: miPersonaId || null,
      fecha_revision: new Date().toISOString(),
      notas_revision: notasRevision.trim() || null,
    };

    if (accion === "aprobada") {
      // BUG #3 FIX: Validar que todas las propuestas tienen cargo antes de aprobar
      const sinCargo = plan.asignaciones.filter((a) => !a.cargo_al_momento?.trim());
      if (sinCargo.length > 0) {
        setRevisionError("Algunas propuestas no tienen cargo registrado y no pueden aprobarse.");
        setRevisionLoading(false);
        return;
      }

      // 1. Marcar el plan como aprobado
      const { error: planErr } = await supabase
        .from("propuesta_plan")
        .update({ estado: "aprobada", ...camposRevision })
        .eq("id", plan.id);
      if (planErr) { setRevisionError(planErr.message); setRevisionLoading(false); return; }

      // 2. Marcar todas las asignaciones del plan como aprobadas
      const { error: asigUpdErr } = await supabase
        .from("asignacion_propuesta")
        .update({ estado: "aprobada", ...camposRevision })
        .eq("plan_id", plan.id);
      if (asigUpdErr) { setRevisionError(asigUpdErr.message); setRevisionLoading(false); return; }

      // 3. Crear todas las asignaciones reales y recuperar sus IDs
      const asignacionesACrear = plan.asignaciones.map((asig) => ({
        persona_id: asig.persona_id,
        engagement_id: asig.engagement_id,
        requerimiento_id: asig.requerimiento_id,
        cargo_al_momento: asig.cargo_al_momento!,   // validado arriba
        pct_dedicacion: asig.pct_dedicacion,
        fecha_inicio: asig.fecha_inicio,
        fecha_fin: asig.fecha_fin,
        estado: "activa",
        propuesta_origen_id: asig.id,
        aprobada_por: miPersonaId || null,
        fecha_aprobacion: new Date().toISOString(),
      }));

      const { data: asigCreadas, error: asigInsErr } = await supabase
        .from("asignacion")
        .insert(asignacionesACrear)
        .select("id, propuesta_origen_id");
      if (asigInsErr || !asigCreadas) {
        setRevisionError(asigInsErr?.message ?? "Error al crear asignaciones");
        setRevisionLoading(false);
        return;
      }

      // BUG #1 FIX: Vincular cada asignacion_propuesta con su asignacion real creada
      await Promise.all(
        asigCreadas
          .filter((a: { id: string; propuesta_origen_id: string | null }) => a.propuesta_origen_id)
          .map((a: { id: string; propuesta_origen_id: string | null }) =>
            supabase
              .from("asignacion_propuesta")
              .update({ asignacion_resultante_id: a.id })
              .eq("id", a.propuesta_origen_id!)
          )
      );

    } else {
      // Rechazar plan y todas sus asignaciones
      const { error: planErr } = await supabase
        .from("propuesta_plan")
        .update({ estado: "rechazada", ...camposRevision })
        .eq("id", plan.id);
      if (planErr) { setRevisionError(planErr.message); setRevisionLoading(false); return; }

      // BUG #2 FIX: verificar error en el rechazo de asignacion_propuesta
      const { error: asigRejErr } = await supabase
        .from("asignacion_propuesta")
        .update({ estado: "rechazada", ...camposRevision })
        .eq("plan_id", plan.id);
      if (asigRejErr) { setRevisionError(asigRejErr.message); setRevisionLoading(false); return; }
    }

    setRevisionLoading(false);
    setRevisionModal(null);
    load();
    loadGaps();
  };

  if (loading) return <p className="text-sm text-[#888]">Cargando...</p>;

  const borradores = planes.filter((p) => p.estado === "borrador");
  const revisados = planes.filter((p) => p.estado !== "borrador");

  return (
    <>
      {/* ── Panel de Gaps de Cobertura ─────────────────────── */}
      {(gapsLoading || gapsEngagements.length > 0) && (
        <div className="mb-6 border border-[#e8e8e8] rounded-2xl overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-5 py-3.5 bg-[#f5f7ff] hover:bg-[#edf0ff] transition-colors"
            onClick={() => setGapsPanelExpanded((v) => !v)}
          >
            <div className="flex items-center gap-2.5">
              <Layers className="w-4 h-4 text-[#4a90e2]" />
              <span className="text-sm font-semibold text-[#1a1a1a]">Gaps de cobertura</span>
              {!gapsLoading && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#4a90e2] text-white font-medium">
                  {gapsEngagements.length} engagement{gapsEngagements.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            {gapsPanelExpanded
              ? <ChevronUp className="w-4 h-4 text-[#888]" />
              : <ChevronDown className="w-4 h-4 text-[#888]" />
            }
          </button>

          {gapsPanelExpanded && (
            <div className="divide-y divide-[#f0f0f0]">
              {gapsLoading ? (
                <div className="px-5 py-4 text-sm text-[#888]">Calculando gaps...</div>
              ) : gapsEngagements.map((eng) => (
                <div key={eng.engagement_id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-[14px] text-[#1a1a1a]">{eng.engagement_nombre}</p>
                        <span className="text-xs text-[#aaa]">{eng.cliente}</span>
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {eng.gaps.map((gap) => (
                          <div key={gap.requerimiento_id} className="flex items-center gap-2 flex-wrap text-xs">
                            <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-medium">
                              Fase {gap.fase_numero}{gap.fase_nombre ? ` — ${gap.fase_nombre}` : ""}
                            </span>
                            {gap.cargo_requerido && (
                              <span className="px-1.5 py-0.5 rounded bg-[#eaf4ff] text-[#1a5276]">
                                {gap.cargo_requerido}
                              </span>
                            )}
                            <span className="text-[#c0392b] font-semibold">faltan {gap.pct_descubierto}%</span>
                            <span className="text-[#aaa]">
                              {format(new Date(gap.req_fecha_inicio + "T00:00:00"), "d MMM yy", { locale: es })}
                              {" → "}
                              {format(new Date(gap.req_fecha_fin + "T00:00:00"), "d MMM yy", { locale: es })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {isProposerOrAdmin && (
                      <Button size="sm" variant="secondary" onClick={() => abrirPlanificacion(eng)} className="flex-shrink-0 mt-0.5">
                        Crear plan
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5">
        <p className="text-sm text-[#888]">
          {borradores.length} plan{borradores.length !== 1 ? "es" : ""} pendiente{borradores.length !== 1 ? "s" : ""}
        </p>
        {isProposerOrAdmin && (
          <Button onClick={() => abrirPlanificacion(null)} size="sm">
            <Plus className="w-3.5 h-3.5" /> Nuevo plan
          </Button>
        )}
      </div>

      {/* ── Planes borrador ──────────────────────────────────── */}
      {borradores.length > 0 && (
        <div className="mb-8">
          <p className="text-xs font-semibold text-[#888] uppercase tracking-widest mb-3">
            Pendientes de revisión
          </p>
          <div className="space-y-3">
            {borradores.map((plan) => (
              <TarjetaPlan
                key={plan.id}
                plan={plan}
                expandido={expandidos.has(plan.id)}
                onToggle={() => toggleExpandido(plan.id)}
                isAdmin={isAdmin}
                onAprobar={() => abrirRevisionPlan(plan, "aprobada")}
                onRechazar={() => abrirRevisionPlan(plan, "rechazada")}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Historial ─────────────────────────────────────────── */}
      {revisados.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[#aaa] uppercase tracking-widest mb-3">Historial</p>
          <div className="space-y-3">
            {revisados.map((plan) => (
              <TarjetaPlan
                key={plan.id}
                plan={plan}
                expandido={expandidos.has(plan.id)}
                onToggle={() => toggleExpandido(plan.id)}
                isAdmin={false}
                onAprobar={() => {}}
                onRechazar={() => {}}
              />
            ))}
          </div>
        </div>
      )}

      {planes.length === 0 && gapsEngagements.length === 0 && !gapsLoading && (
        <div className="text-center py-12 text-[#888]">
          <p className="text-sm font-medium">No hay planes de asignación aún.</p>
          {isProposerOrAdmin && (
            <p className="text-xs mt-1">
              Crea un plan para cubrir los gaps de los engagements activos.
            </p>
          )}
        </div>
      )}

      {/* ── PlanificacionDrawer ────────────────────────────────── */}
      <PlanificacionDrawer
        open={planDrawerOpen}
        onClose={() => { setPlanDrawerOpen(false); setEngPlanSeleccionado(null); }}
        onSuccess={() => { load(); loadGaps(); }}
        engagementPreseleccionado={engPlanSeleccionado}
        miPersonaId={miPersonaId}
      />

      {/* ── Modal de revisión del plan ─────────────────────────── */}
      {revisionModal && (
        <Modal
          open={!!revisionModal}
          onClose={() => setRevisionModal(null)}
          title={
            revisionModal.accion === "aprobada"
              ? `Aprobar plan: ${revisionModal.plan.nombre}`
              : `Rechazar plan: ${revisionModal.plan.nombre}`
          }
          footer={
            <>
              <Button variant="secondary" onClick={() => setRevisionModal(null)} disabled={revisionLoading}>
                Cancelar
              </Button>
              <Button
                variant={revisionModal.accion === "aprobada" ? "primary" : "danger"}
                onClick={confirmarRevisionPlan}
                loading={revisionLoading}
                disabled={revisionModal.accion === "aprobada" && (capacidadLoading || hayConflictos)}
              >
                {revisionModal.accion === "aprobada"
                  ? `Aprobar y crear ${revisionModal.plan.asignaciones.length} asignaci${revisionModal.plan.asignaciones.length !== 1 ? "ones" : "ón"}`
                  : "Rechazar plan"
                }
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {/* Resumen del plan */}
            <div className="p-3 bg-[#f9f9f9] rounded-lg text-sm space-y-1">
              <p><span className="text-[#888]">Plan:</span> <strong>{revisionModal.plan.nombre}</strong></p>
              <p>
                <span className="text-[#888]">Asignaciones:</span>{" "}
                {revisionModal.plan.asignaciones.length} persona{revisionModal.plan.asignaciones.length !== 1 ? "s" : ""}
              </p>
              <p>
                <span className="text-[#888]">Engagements:</span>{" "}
                {revisionModal.plan.engagements.map((e) => e.nombre).join(", ")}
              </p>
            </div>

            {/* Verificación de capacidad (solo al aprobar) */}
            {revisionModal.accion === "aprobada" && (
              <div>
                <p className="text-xs font-semibold text-[#888] uppercase tracking-widest mb-2">
                  Verificación de capacidad
                </p>
                {capacidadLoading ? (
                  <p className="text-sm text-[#888]">Calculando...</p>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {capacidadChecks.map((check) => {
                      const total = check.max_ocupacion + check.pct_propuesto;
                      const { bg, text } = colorOcupacion(total);
                      return (
                        <div
                          key={check.asignacion_id}
                          className={`p-3 rounded-lg border text-sm ${
                            check.excede
                              ? "border-red-200 bg-red-50"
                              : "border-[#e8e8e8] bg-white"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="font-medium">{check.persona_nombre}</p>
                              {check.cargo && (
                                <p className="text-xs text-[#888]">{check.cargo}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-[#888]">
                                actual máx: {formatPct(check.max_ocupacion)}
                              </span>
                              <span className="text-xs font-bold" style={{ color: "#888" }}>+</span>
                              <span className="text-xs font-semibold">{check.pct_propuesto}%</span>
                              <span className="text-xs font-bold" style={{ color: "#888" }}>=</span>
                              <span
                                className="text-xs font-semibold px-2 py-0.5 rounded-full"
                                style={{ background: bg, color: text }}
                              >
                                {formatPct(total)}
                              </span>
                              {check.excede && (
                                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {hayConflictos && (
                  <div className="flex items-start gap-2 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">El plan no puede aprobarse</p>
                      <p className="text-xs mt-0.5">
                        Una o más personas superarían el 100% de ocupación. Ajusta el plan antes de aprobar.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {revisionError && (
              <p className="text-sm text-red-600">{revisionError}</p>
            )}

            <FieldWrapper label="Notas de revisión" hint="Opcional">
              <Textarea
                value={notasRevision}
                onChange={(e) => setNotasRevision(e.target.value)}
                placeholder={
                  revisionModal.accion === "rechazada"
                    ? "Motivo del rechazo..."
                    : "Comentarios adicionales..."
                }
                rows={2}
              />
            </FieldWrapper>
          </div>
        </Modal>
      )}
    </>
  );
}

// ── Tipos locales para el panel de gaps ───────────────────────

interface GapEngagementUI extends GapEngagement {
  cliente: string;
  gaps: {
    requerimiento_id: string;
    fase_numero: number;
    fase_nombre: string | null;
    cargo_requerido: string | null;
    pct_requerido: number;
    pct_descubierto: number;
    req_fecha_inicio: string;
    req_fecha_fin: string;
  }[];
}

// ── Tarjeta de plan ───────────────────────────────────────────

function TarjetaPlan({
  plan, expandido, onToggle, isAdmin, onAprobar, onRechazar,
}: {
  plan: PlanEnriquecido;
  expandido: boolean;
  onToggle: () => void;
  isAdmin: boolean;
  onAprobar: () => void;
  onRechazar: () => void;
}) {
  const estilos = ESTADO_ESTILOS[plan.estado] ?? ESTADO_ESTILOS.borrador;

  return (
    <div className="bg-white border border-[#e8e8e8] rounded-xl overflow-hidden">
      {/* Header del plan */}
      <div className="px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex-shrink-0">
            {ESTADO_ICONO[plan.estado]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-[15px]">{plan.nombre}</p>
              <span
                className="text-xs px-2.5 py-0.5 rounded-full font-medium"
                style={{ background: estilos.bg, color: estilos.text }}
              >
                {plan.estado}
              </span>
            </div>
            {plan.descripcion && (
              <p className="text-xs text-[#888] mt-0.5">{plan.descripcion}</p>
            )}
            {/* Metadata */}
            <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs text-[#888]">
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" />
                {plan.asignaciones.length} asignaci{plan.asignaciones.length !== 1 ? "ones" : "ón"}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {format(new Date(plan.created_at), "d MMM yyyy", { locale: es })}
              </span>
              {plan.creada_por_nombre !== "—" && (
                <span>por {plan.creada_por_nombre}</span>
              )}
            </div>
            {/* Engagements involucrados */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {plan.engagements.map((eng) => (
                <span
                  key={eng.id}
                  className="text-xs px-2 py-0.5 rounded-full bg-[#f0f0f0] text-[#555]"
                >
                  {eng.nombre}
                </span>
              ))}
            </div>
          </div>
          {/* Acciones */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {isAdmin && plan.estado === "borrador" && (
              <>
                <Button variant="secondary" size="sm" onClick={onRechazar}>Rechazar</Button>
                <Button size="sm" onClick={onAprobar}>Aprobar plan</Button>
              </>
            )}
            <button
              type="button"
              onClick={onToggle}
              className="w-7 h-7 rounded-md border border-[#e0e0e0] flex items-center justify-center text-[#888] hover:bg-[#f5f5f5] transition-colors"
            >
              {expandido ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Detalle expandible de asignaciones */}
      {expandido && plan.asignaciones.length > 0 && (
        <div className="border-t border-[#f0f0f0]">
          <div className="px-5 py-2 bg-[#fafafa]">
            <p className="text-xs font-semibold text-[#888] uppercase tracking-widest">
              Asignaciones del plan
            </p>
          </div>
          <div className="divide-y divide-[#f5f5f5]">
            {plan.asignaciones.map((asig) => (
              <div key={asig.id} className="px-5 py-3 flex items-center gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{asig.persona_nombre}</span>
                    {asig.cargo_al_momento && (
                      <span className="text-xs text-[#aaa]">({asig.cargo_al_momento})</span>
                    )}
                    <span className="text-[#aaa] text-xs">→</span>
                    <span className="text-[#555] truncate">{asig.engagement_nombre}</span>
                  </div>
                  <p className="text-xs text-[#888] mt-0.5">
                    {asig.pct_dedicacion}%
                    {" · "}
                    {format(new Date(asig.fecha_inicio), "d MMM yy", { locale: es })}
                    {" → "}
                    {format(new Date(asig.fecha_fin), "d MMM yy", { locale: es })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {expandido && plan.asignaciones.length === 0 && (
        <div className="border-t border-[#f0f0f0] px-5 py-4 text-sm text-[#aaa] text-center">
          Sin asignaciones en este plan.
        </div>
      )}
    </div>
  );
}
