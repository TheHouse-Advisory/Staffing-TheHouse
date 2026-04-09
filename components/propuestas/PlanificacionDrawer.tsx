"use client";

/**
 * PlanificacionDrawer
 * -------------------
 * Flujo de creación de propuestas centrado en los GAPS del engagement.
 *
 * Para cada requerimiento sin cubrir muestra las personas con el cargo
 * correcto y su ocupación proyectada si fueran asignadas.
 * El % de dedicación queda bloqueado al % del requerimiento.
 * Solo personas con cargo coincidente son elegibles.
 */

import { useState, useEffect } from "react";
import { AlertTriangle, CheckCircle, UserX } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { createClient } from "@/lib/supabase/client";
import { Drawer } from "@/components/ui/Drawer";
import { Button } from "@/components/ui/Button";
import { FieldWrapper, Select, Input } from "@/components/ui/FormField";

// ─────────────────────────────────────────────────────────────
//  Tipos
// ─────────────────────────────────────────────────────────────

export interface GapEngagement {
  engagement_id: string;
  engagement_nombre: string;
}

interface CoberturaReq {
  requerimiento_id: string;
  fase_numero: number;
  fase_nombre: string | null;
  cargo_requerido: string | null;
  pct_requerido: number;
  req_fecha_inicio: string;
  req_fecha_fin: string;
  pct_cubierto: number;
  pct_descubierto: number;
}

interface PersonaData {
  id: string;
  nombre: string;
  apellido: string;
  cargo_actual: string;
}

interface AsignacionSimple {
  persona_id: string;
  pct_dedicacion: number;
  fecha_inicio: string;
  fecha_fin: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** Si se pasa, el engagement viene pre-seleccionado */
  engagementPreseleccionado?: GapEngagement | null;
  miPersonaId: string;
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

function colorOcupacion(pct: number) {
  if (pct === 0)   return { bg: "#f0f0f0", text: "#888" };
  if (pct <= 50)   return { bg: "#dcf5e7", text: "#1e7e45" };
  if (pct <= 80)   return { bg: "#fff4d4", text: "#8a6200" };
  if (pct <= 100)  return { bg: "#ffe4c4", text: "#c45000" };
  return { bg: "#ffd4d4", text: "#c02020" };
}

function ocupacionDB(
  personaId: string,
  fechaInicio: string,
  fechaFin: string,
  asignaciones: AsignacionSimple[]
): number {
  return asignaciones
    .filter(
      (a) =>
        a.persona_id === personaId &&
        a.fecha_inicio <= fechaFin &&
        (a.fecha_fin === null || a.fecha_fin >= fechaInicio)
    )
    .reduce((sum, a) => sum + Number(a.pct_dedicacion), 0);
}

// ─────────────────────────────────────────────────────────────
//  Componente
// ─────────────────────────────────────────────────────────────

export function PlanificacionDrawer({
  open,
  onClose,
  onSuccess,
  engagementPreseleccionado,
  miPersonaId,
}: Props) {
  const [engagementId, setEngagementId] = useState(
    engagementPreseleccionado?.engagement_id ?? ""
  );
  const [engagements, setEngagements] = useState<{ value: string; label: string }[]>([]);
  const [gaps, setGaps] = useState<CoberturaReq[]>([]);
  const [personas, setPersonas] = useState<PersonaData[]>([]);
  const [asignaciones, setAsignaciones] = useState<AsignacionSimple[]>([]);
  // reqId → personaId seleccionada
  const [selecciones, setSelecciones] = useState<Record<string, string>>({});
  const [planNombre, setPlanNombre] = useState("");
  const [dataLoading, setDataLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nombre por defecto cuando se abre
  const nombreDefault = () => {
    const fecha = new Date().toLocaleDateString("es-CL", { month: "short", year: "numeric" });
    return `Plan ${fecha}`;
  };

  // Reset al abrir/cerrar
  useEffect(() => {
    if (!open) {
      setEngagementId(engagementPreseleccionado?.engagement_id ?? "");
      setGaps([]);
      setPersonas([]);
      setAsignaciones([]);
      setSelecciones({});
      setError(null);
      setPlanNombre("");
      return;
    }
    setEngagementId(engagementPreseleccionado?.engagement_id ?? "");
    setPlanNombre(nombreDefault());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, engagementPreseleccionado]);

  // Cargar lista de engagements al abrir
  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    supabase
      .from("engagement")
      .select("id, nombre")
      .in("estado", ["propuesta", "activo"])
      .order("nombre")
      .then(({ data }) =>
        setEngagements((data ?? []).map((e) => ({ value: e.id, label: e.nombre })))
      );
  }, [open]);

  // Cargar gaps y personas cuando cambia el engagement
  useEffect(() => {
    setGaps([]);
    setPersonas([]);
    setAsignaciones([]);
    setSelecciones({});
    if (!engagementId) return;

    setDataLoading(true);
    async function loadData() {
      const supabase = createClient();

      // 1. Requerimientos sin cubrir al 100%
      const { data: gapsData } = await supabase
        .from("cobertura_engagement")
        .select(
          "requerimiento_id, fase_numero, fase_nombre, cargo_requerido, " +
          "pct_requerido, req_fecha_inicio, req_fecha_fin, pct_cubierto, pct_descubierto"
        )
        .eq("engagement_id", engagementId)
        .gt("pct_descubierto", 0)
        .order("fase_numero");

      const loadedGaps = (gapsData ?? []) as CoberturaReq[];
      setGaps(loadedGaps);
      if (loadedGaps.length === 0) { setDataLoading(false); return; }

      // 2. Todas las personas activas
      const { data: personasData } = await supabase
        .from("persona")
        .select("id, nombre, apellido, cargo_actual")
        .eq("activo", true)
        .order("apellido");

      const loadedPersonas = (personasData ?? []) as PersonaData[];
      setPersonas(loadedPersonas);

      // 3. Asignaciones activas en el rango total de los gaps
      const minDate = loadedGaps.reduce(
        (m, g) => (g.req_fecha_inicio < m ? g.req_fecha_inicio : m),
        loadedGaps[0].req_fecha_inicio
      );
      const maxDate = loadedGaps.reduce(
        (m, g) => (g.req_fecha_fin > m ? g.req_fecha_fin : m),
        loadedGaps[0].req_fecha_fin
      );
      const personaIds = loadedPersonas.map((p) => p.id);

      if (personaIds.length > 0) {
        const { data: asigData } = await supabase
          .from("asignacion")
          .select("persona_id, pct_dedicacion, fecha_inicio, fecha_fin")
          .eq("estado", "activa")
          .in("persona_id", personaIds)
          .lte("fecha_inicio", maxDate)
          .or(`fecha_fin.gte.${minDate},fecha_fin.is.null`);
        setAsignaciones((asigData ?? []) as AsignacionSimple[]);
      }

      setDataLoading(false);
    }
    loadData();
  }, [engagementId]);

  // Personas elegibles para un gap (solo cargo coincidente)
  const personasParaGap = (gap: CoberturaReq): PersonaData[] => {
    if (!gap.cargo_requerido) return personas;
    return personas.filter((p) => p.cargo_actual === gap.cargo_requerido);
  };

  /**
   * Ocupación total de una persona en el período de un gap.
   * Incluye asignaciones de la DB + selecciones ya hechas en ESTA sesión
   * para otros gaps que se solapen con el período actual.
   */
  const getOcupacionTotal = (personaId: string, req: CoberturaReq): number => {
    const db = ocupacionDB(personaId, req.req_fecha_inicio, req.req_fecha_fin, asignaciones);

    const enSesion = Object.entries(selecciones)
      .filter(([reqId, pId]) => pId === personaId && reqId !== req.requerimiento_id)
      .reduce((sum, [reqId]) => {
        const otro = gaps.find((g) => g.requerimiento_id === reqId);
        if (!otro) return sum;
        // Solape de fechas
        if (otro.req_fecha_inicio <= req.req_fecha_fin && otro.req_fecha_fin >= req.req_fecha_inicio) {
          return sum + otro.pct_requerido;
        }
        return sum;
      }, 0);

    return db + enSesion;
  };

  const toggleSeleccion = (reqId: string, personaId: string) => {
    setSelecciones((prev) => {
      const next = { ...prev };
      if (next[reqId] === personaId) {
        delete next[reqId];
      } else {
        next[reqId] = personaId;
      }
      return next;
    });
  };

  const seleccionadas = Object.values(selecciones).filter(Boolean).length;

  const handleSubmit = async () => {
    if (seleccionadas === 0) {
      setError("Selecciona al menos una persona para continuar.");
      return;
    }
    if (!planNombre.trim()) {
      setError("El plan necesita un nombre.");
      return;
    }
    setSubmitLoading(true);
    setError(null);
    const supabase = createClient();

    // 0. Verificar que no exista otro borrador con el mismo nombre
    const { data: existente } = await supabase
      .from("propuesta_plan")
      .select("id")
      .eq("nombre", planNombre.trim())
      .eq("estado", "borrador")
      .maybeSingle();

    if (existente) {
      setError(`Ya existe un plan en borrador con el nombre "${planNombre.trim()}". Elige otro nombre.`);
      setSubmitLoading(false);
      return;
    }

    // 1. Crear el propuesta_plan que agrupa estas asignaciones
    const { data: planData, error: planErr } = await supabase
      .from("propuesta_plan")
      .insert({
        nombre: planNombre.trim(),
        estado: "borrador",
        creada_por: miPersonaId || null,
      })
      .select("id")
      .single();

    if (planErr || !planData) {
      setError(planErr?.message ?? "No se pudo crear el plan.");
      setSubmitLoading(false);
      return;
    }

    const planId = planData.id;

    // 2. Insertar todas las asignacion_propuesta vinculadas al plan
    const toInsert = Object.entries(selecciones)
      .filter(([, pId]) => pId)
      .map(([reqId, personaId]) => {
        const req = gaps.find((g) => g.requerimiento_id === reqId)!;
        const persona = personas.find((p) => p.id === personaId)!;
        return {
          plan_id: planId,
          persona_id: personaId,
          engagement_id: engagementId,
          requerimiento_id: reqId,
          pct_dedicacion: req.pct_requerido, // BLOQUEADO al % del requerimiento
          cargo_al_momento: persona.cargo_actual,
          fecha_inicio: req.req_fecha_inicio,
          fecha_fin: req.req_fecha_fin,
          propuesto_por: miPersonaId || null,
          estado: "borrador",
        };
      });

    const { error: insertErr } = await supabase
      .from("asignacion_propuesta")
      .insert(toInsert);

    if (insertErr) {
      // Limpiar el plan huérfano si falla el insert
      await supabase.from("propuesta_plan").delete().eq("id", planId);
      setError(insertErr.message);
      setSubmitLoading(false);
      return;
    }

    setSubmitLoading(false);
    onSuccess();
    onClose();
  };

  const engNombre =
    engagementPreseleccionado?.engagement_nombre ??
    engagements.find((e) => e.value === engagementId)?.label;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Planificar cobertura"
      subtitle={engNombre}
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitLoading}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            loading={submitLoading}
            disabled={seleccionadas === 0 || !planNombre.trim()}
          >
            Guardar plan ({seleccionadas} asignaci{seleccionadas !== 1 ? "ones" : "ón"})
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Nombre del plan */}
        <FieldWrapper label="Nombre del plan" required>
          <Input
            value={planNombre}
            onChange={(e) => setPlanNombre(e.target.value)}
            placeholder="ej. Plan Q2 2025, Escenario conservador..."
          />
        </FieldWrapper>

        {/* Selector de engagement (solo si no viene pre-seleccionado) */}
        {!engagementPreseleccionado && (
          <FieldWrapper label="Engagement">
            <Select
              value={engagementId}
              onChange={(e) => setEngagementId(e.target.value)}
              options={engagements}
              placeholder="Seleccionar engagement..."
            />
          </FieldWrapper>
        )}

        {dataLoading && (
          <p className="text-sm text-[#888] text-center py-4">Cargando requerimientos...</p>
        )}

        {!dataLoading && engagementId && gaps.length === 0 && (
          <div className="text-center py-10 text-[#888]">
            <CheckCircle className="w-8 h-8 text-[#27ae60] mx-auto mb-2" />
            <p className="text-sm font-medium">¡Todo cubierto!</p>
            <p className="text-xs mt-1">Este engagement no tiene gaps de cobertura pendientes.</p>
          </div>
        )}

        {/* Un card por cada requerimiento pendiente */}
        {gaps.map((gap) => {
          const disponibles = personasParaGap(gap);
          const personaSelId = selecciones[gap.requerimiento_id];
          const personaSel = personas.find((p) => p.id === personaSelId);

          return (
            <div
              key={gap.requerimiento_id}
              className="border border-[#e8e8e8] rounded-xl overflow-hidden"
            >
              {/* Header del requerimiento */}
              <div className="px-4 py-3 bg-[#f9f9f9] border-b border-[#e8e8e8]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-[#333] uppercase tracking-wide">
                        Fase {gap.fase_numero}
                        {gap.fase_nombre ? ` — ${gap.fase_nombre}` : ""}
                      </span>
                      {gap.cargo_requerido ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[#eaf4ff] text-[#1a5276] font-medium">
                          {gap.cargo_requerido}
                        </span>
                      ) : (
                        <span className="text-xs text-[#aaa]">Cualquier cargo</span>
                      )}
                    </div>
                    <p className="text-xs text-[#888] mt-0.5">
                      <strong>{gap.pct_requerido}% dedicación</strong>
                      {" · "}
                      {format(new Date(gap.req_fecha_inicio + "T00:00:00"), "d MMM yy", { locale: es })}
                      {" → "}
                      {format(new Date(gap.req_fecha_fin + "T00:00:00"), "d MMM yy", { locale: es })}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full flex-shrink-0">
                    Faltan {gap.pct_descubierto}%
                  </span>
                </div>
              </div>

              {/* Personas elegibles */}
              {disponibles.length === 0 ? (
                <div className="flex items-center gap-2 px-4 py-4 text-sm text-[#888]">
                  <UserX className="w-4 h-4 flex-shrink-0" />
                  No hay personas activas con cargo {gap.cargo_requerido ?? "requerido"}.
                </div>
              ) : (
                <div className="divide-y divide-[#f5f5f5]">
                  {disponibles.map((persona) => {
                    const ocupActual = ocupacionDB(
                      persona.id,
                      gap.req_fecha_inicio,
                      gap.req_fecha_fin,
                      asignaciones
                    );
                    const ocupSesion = getOcupacionTotal(persona.id, gap);
                    const pctConPropuesta = ocupSesion + gap.pct_requerido;
                    const excede = pctConPropuesta > 100;
                    const selected = selecciones[gap.requerimiento_id] === persona.id;
                    const { bg, text } = colorOcupacion(pctConPropuesta);
                    const haySeleccionOtraSesion = ocupSesion > ocupActual;

                    return (
                      <button
                        key={persona.id}
                        type="button"
                        onClick={() => toggleSeleccion(gap.requerimiento_id, persona.id)}
                        className={`w-full text-left px-4 py-3 flex items-center justify-between gap-3 transition-colors ${
                          selected ? "bg-[#eaf4ff]" : "hover:bg-[#fafafa]"
                        }`}
                      >
                        {/* Radio indicator */}
                        <div
                          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                            selected
                              ? "border-[#4a90e2] bg-[#4a90e2]"
                              : "border-[#d0d0d0]"
                          }`}
                        >
                          {selected && (
                            <div className="w-1.5 h-1.5 rounded-full bg-white" />
                          )}
                        </div>

                        {/* Info persona */}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">
                            {persona.apellido}, {persona.nombre}
                          </p>
                          <p className="text-xs text-[#888]">
                            {persona.cargo_actual}
                            {" · "}
                            ocupación actual: <strong>{ocupActual}%</strong>
                            {haySeleccionOtraSesion && (
                              <span className="text-amber-600">
                                {" "}(+{ocupSesion - ocupActual}% en esta sesión → {ocupSesion}%)
                              </span>
                            )}
                          </p>
                        </div>

                        {/* Badge proyectado */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span
                            className="text-xs font-semibold px-2.5 py-1 rounded-full"
                            style={{ background: bg, color: text }}
                          >
                            → {pctConPropuesta}%
                          </span>
                          {excede && (
                            <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Pie: persona seleccionada */}
              {personaSel && (
                <div className="px-4 py-2 bg-[#eaf4ff] border-t border-[#c7ddff] text-xs text-[#1a5276]">
                  <span className="font-semibold">
                    ✓ {personaSel.nombre} {personaSel.apellido}
                  </span>
                  {" — "}
                  {gap.pct_requerido}% del{" "}
                  {format(new Date(gap.req_fecha_inicio + "T00:00:00"), "d MMM", { locale: es })}
                  {" al "}
                  {format(new Date(gap.req_fecha_fin + "T00:00:00"), "d MMM yy", { locale: es })}
                  <button
                    type="button"
                    onClick={() => toggleSeleccion(gap.requerimiento_id, personaSel.id)}
                    className="ml-2 underline hover:no-underline"
                  >
                    Quitar
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Drawer>
  );
}
