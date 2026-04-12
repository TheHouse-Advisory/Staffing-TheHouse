"use client";

import { useState, useEffect, useCallback } from "react";
import { format, addDays, isWeekend } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, X, User, CheckCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  fetchOcupacionDiariaPersona,
  fetchCoberturaProyecto,
  type FilaDia,
  type FilaProyecto,
} from "@/lib/queries/tablero";
import { colorOcupacion, formatPct } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
//  Props
// ─────────────────────────────────────────────────────────────

interface Props {
  semanaInicio: Date;
  planId: string | null;
  vista: "persona" | "proyecto";
}

// ─────────────────────────────────────────────────────────────
//  Color cobertura (verde = bien cubierto, rojo = descubierto)
// ─────────────────────────────────────────────────────────────

function colorCobertura(cobertura: number): { bg: string; text: string } {
  if (cobertura < 0)   return { bg: "#f0f0f0", text: "#999" };     // sin reqs
  if (cobertura === 0) return { bg: "#ffd4d4", text: "#c02020" };  // 0% cubierto
  if (cobertura < 50)  return { bg: "#ffe4c4", text: "#c45000" };  // <50%
  if (cobertura < 80)  return { bg: "#fff4d4", text: "#8a6200" };  // 50–79%
  if (cobertura < 100) return { bg: "#dcf5e7", text: "#1e7e45" };  // 80–99%
  return { bg: "#27ae60", text: "#fff" };                           // 100%
}

// ─────────────────────────────────────────────────────────────
//  Celda genérica
// ─────────────────────────────────────────────────────────────

function Celda({
  bg,
  text,
  label,
  alerta,
  critico,
  isOpen,
  onClick,
}: {
  bg: string;
  text: string;
  label: string;
  alerta?: boolean;
  /** Día marcado como crítico para este engagement/persona — borde naranja grueso */
  critico?: boolean;
  isOpen?: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={critico ? "Día crítico — Click para ver desglose" : "Click para ver desglose"}
      className={`w-full h-10 rounded-md flex items-center justify-center text-xs font-semibold transition-all hover:opacity-80 cursor-pointer relative ${isOpen ? "ring-2 ring-[#4a90e2] ring-offset-1" : "hover:ring-2 hover:ring-[#4a90e2] hover:ring-offset-1"}`}
      style={{
        background: bg,
        color: text,
        boxShadow: critico ? "inset 0 0 0 2.5px #f97316" : undefined,
      }}
    >
      {label}
      {alerta && (
        <span className="absolute -top-1 -right-1">
          <AlertTriangle className="w-3 h-3 text-red-500" />
        </span>
      )}
      {critico && !alerta && (
        <span className="absolute -top-1 -right-1">
          <span className="block w-2.5 h-2.5 rounded-full bg-orange-500 border border-white" />
        </span>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
//  Contenedor del popover
// ─────────────────────────────────────────────────────────────

function PopoverContainer({
  rect,
  onClose,
  title,
  subtitle,
  children,
}: {
  rect: DOMRect;
  onClose: () => void;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const popoverWidth = 300;
  const popoverHeight = 300;

  const viewportWidth  = typeof window !== "undefined" ? window.innerWidth  : 1200;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;

  let left = rect.right + 8;
  if (left + popoverWidth > viewportWidth - 8) {
    left = rect.left - popoverWidth - 8;
    if (left < 8) left = 8;
  }
  let top = rect.top;
  if (top + popoverHeight > viewportHeight - 8) {
    top = viewportHeight - popoverHeight - 8;
  }
  if (top < 8) top = 8;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-white border border-[#e8e8e8] rounded-xl shadow-xl overflow-hidden"
        style={{ left, top, width: popoverWidth }}
      >
        <div className="flex items-center justify-between px-4 py-3 bg-[#f9f9f9] border-b border-[#e8e8e8]">
          <div className="flex-1 min-w-0 pr-2">
            <p className="text-xs font-semibold text-[#1a1a1a] truncate">{title}</p>
            <p className="text-[10px] text-[#888]">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-5 h-5 flex items-center justify-center text-[#888] hover:text-[#333] transition-colors flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="px-4 py-3 max-h-72 overflow-y-auto">{children}</div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
//  Popover — vista por persona
// ─────────────────────────────────────────────────────────────

interface LineaPersona {
  engagement_nombre: string;
  pct: number;
  tipo: "real" | "plan" | "liberar";
}

interface PopoverPersonaState {
  tipo: "persona";
  personaId: string;
  personaNombre: string;
  diaStr: string;
  diaLabel: string;
  pct: number;
  rect: DOMRect;
}

function PersonaPopover({
  state,
  planId,
  onClose,
}: {
  state: PopoverPersonaState;
  planId: string | null;
  onClose: () => void;
}) {
  const [lineas, setLineas] = useState<LineaPersona[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const resultado: LineaPersona[] = [];
      const diaStr = state.diaStr;

      type AsigDesglose = { id: string; pct_dedicacion: number; engagement: { nombre: string } | null };

      // 1. Asignaciones reales
      const { data: realRaw } = await supabase
        .from("asignacion")
        .select("id, pct_dedicacion, engagement:engagement_id(nombre)")
        .eq("persona_id", state.personaId)
        .eq("estado", "activa")
        .lte("fecha_inicio", diaStr)
        .or(`fecha_fin.gte.${diaStr},fecha_fin.is.null`);

      const realAsigs = (realRaw ?? []) as unknown as AsigDesglose[];

      // 2. Liberaciones del plan (termina asignaciones reales) que aplican este día
      const liberacionIds = new Set<string>();
      if (planId) {
        type LibRow = { asignacion_a_terminar_id: string | null; fecha_fin: string };
        const { data: liberarRaw } = await (supabase as any)
          .from("asignacion_propuesta")
          .select("asignacion_a_terminar_id, fecha_fin")
          .eq("persona_id", state.personaId)
          .eq("plan_id", planId)
          .eq("estado", "borrador")
          .eq("tipo", "liberar")
          .lte("fecha_fin", diaStr); // liberation date <= this day

        for (const lib of (liberarRaw ?? []) as LibRow[]) {
          if (lib.asignacion_a_terminar_id) {
            liberacionIds.add(lib.asignacion_a_terminar_id);
          }
        }
      }

      // 3. Agregar asignaciones reales — liberadas se muestran tachadas
      for (const a of realAsigs) {
        resultado.push({
          engagement_nombre: a.engagement?.nombre ?? "—",
          pct: Number(a.pct_dedicacion),
          tipo: liberacionIds.has(a.id) ? "liberar" : "real",
        });
      }

      // 4. Asignaciones nuevas del plan (tipo=asignar)
      if (planId) {
        type AsigDesglosePlan = { pct_dedicacion: number; engagement: { nombre: string } | null };
        const { data: planRaw } = await (supabase as any)
          .from("asignacion_propuesta")
          .select("pct_dedicacion, engagement:engagement_id(nombre)")
          .eq("persona_id", state.personaId)
          .eq("plan_id", planId)
          .eq("estado", "borrador")
          .neq("tipo", "liberar")
          .lte("fecha_inicio", diaStr)
          .gte("fecha_fin", diaStr);

        for (const a of (planRaw ?? []) as unknown as AsigDesglosePlan[]) {
          resultado.push({ engagement_nombre: a.engagement?.nombre ?? "—", pct: Number(a.pct_dedicacion), tipo: "plan" });
        }
      }

      setLineas(resultado);
      setLoading(false);
    }
    load();
  }, [state.personaId, state.diaStr, planId]);

  // Liberadas se descuentan del total
  const total = lineas.reduce((s, l) => s + (l.tipo === "liberar" ? -l.pct : l.pct), 0);

  return (
    <PopoverContainer rect={state.rect} onClose={onClose} title={state.personaNombre} subtitle={state.diaLabel}>
      {loading ? (
        <p className="text-xs text-[#888] text-center py-2">Cargando...</p>
      ) : lineas.length === 0 ? (
        <p className="text-xs text-[#888] text-center py-2">Sin asignaciones este día.</p>
      ) : (
        <div className="space-y-2">
          {lineas.map((l, i) => {
            const isLiberar = l.tipo === "liberar";
            const { bg, text } = colorOcupacion(l.pct);
            return (
              <div key={i} className={`flex items-center gap-2 ${isLiberar ? "opacity-60" : ""}`}>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-medium truncate ${isLiberar ? "line-through text-red-600" : "text-[#1a1a1a]"}`}>
                    {l.engagement_nombre}
                  </p>
                  {l.tipo === "plan" && <p className="text-[10px] text-[#4a90e2]">propuesto</p>}
                  {isLiberar && <p className="text-[10px] text-red-400">liberado</p>}
                </div>
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${isLiberar ? "line-through" : ""}`}
                  style={isLiberar ? { background: "#fee2e2", color: "#b91c1c" } : { background: bg, color: text }}
                >
                  {formatPct(l.pct)}
                </span>
              </div>
            );
          })}
          {lineas.length > 1 && (
            <div className="border-t border-[#f0f0f0] pt-2 flex items-center justify-between">
              <span className="text-xs text-[#888]">Total efectivo</span>
              <span
                className="text-xs font-bold px-2 py-0.5 rounded-full"
                style={(() => { const { bg, text } = colorOcupacion(Math.max(0, total)); return { background: bg, color: text }; })()}
              >
                {formatPct(Math.max(0, total))}
              </span>
            </div>
          )}
        </div>
      )}
    </PopoverContainer>
  );
}

// ─────────────────────────────────────────────────────────────
//  Popover — vista por proyecto
// ─────────────────────────────────────────────────────────────

interface AsignacionDia {
  persona_nombre: string;
  cargo: string;
  pct: number;
  tipo: "real" | "plan";
  requerimiento_id: string | null;
}

// Requerimiento es binario: está asignado o no lo está
interface ReqPendiente {
  cargo_requerido: string | null;
  pct_requerido: number;
}

interface PopoverProyectoState {
  tipo: "proyecto";
  engagementId: string;
  engagementNombre: string;
  cliente: string;
  diaStr: string;
  diaLabel: string;
  cobertura: number;
  rect: DOMRect;
}

function ProyectoPopover({
  state,
  planId,
  onClose,
}: {
  state: PopoverProyectoState;
  planId: string | null;
  onClose: () => void;
}) {
  const [asignaciones, setAsignaciones] = useState<AsignacionDia[]>([]);
  const [pendientes, setPendientes] = useState<ReqPendiente[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const diaStr = state.diaStr;
      const engId = state.engagementId;

      interface AsigRaw {
        pct_dedicacion: number;
        cargo_al_momento: string | null;
        requerimiento_id: string | null;
        persona: { nombre: string; apellido: string; cargo_actual: string | null } | null;
      }
      type ReqRaw = { id: string; cargo_requerido: string | null; pct_dedicacion: number };

      // 1. Asignaciones reales activas ese día
      const { data: realRaw } = await supabase
        .from("asignacion")
        .select("pct_dedicacion, cargo_al_momento, requerimiento_id, persona:persona_id(nombre, apellido, cargo_actual)")
        .eq("engagement_id", engId)
        .eq("estado", "activa")
        .lte("fecha_inicio", diaStr)
        .or(`fecha_fin.gte.${diaStr},fecha_fin.is.null`);

      const asigs: AsignacionDia[] = (realRaw ?? []).map((a) => {
        const ar = a as unknown as AsigRaw;
        return {
          persona_nombre: ar.persona ? `${ar.persona.nombre} ${ar.persona.apellido}` : "—",
          cargo: ar.cargo_al_momento ?? ar.persona?.cargo_actual ?? "—",
          pct: Number(ar.pct_dedicacion),
          tipo: "real",
          requerimiento_id: ar.requerimiento_id ?? null,
        };
      });

      // 2. Asignaciones del plan ese día
      if (planId) {
        interface AsigPlanRaw {
          pct_dedicacion: number;
          requerimiento_id: string | null;
          persona: { nombre: string; apellido: string; cargo_actual: string | null } | null;
        }
        const { data: planRaw } = await supabase
          .from("asignacion_propuesta")
          .select("pct_dedicacion, requerimiento_id, persona:persona_id(nombre, apellido, cargo_actual)")
          .eq("engagement_id", engId)
          .eq("plan_id", planId)
          .eq("estado", "borrador")
          .lte("fecha_inicio", diaStr)
          .gte("fecha_fin", diaStr);

        for (const a of (planRaw ?? []) as unknown as AsigPlanRaw[]) {
          asigs.push({
            persona_nombre: a.persona ? `${a.persona.nombre} ${a.persona.apellido}` : "—",
            cargo: a.persona?.cargo_actual ?? "—",
            pct: Number(a.pct_dedicacion),
            tipo: "plan",
            requerimiento_id: a.requerimiento_id ?? null,
          });
        }
      }

      setAsignaciones(asigs);

      // 3. Requerimientos activos ese día (con id para cruzar)
      const { data: reqRaw } = await supabase
        .from("requerimiento_engagement")
        .select("id, cargo_requerido, pct_dedicacion")
        .eq("engagement_id", engId)
        .lte("fecha_inicio", diaStr)
        .gte("fecha_fin", diaStr);

      const reqs = (reqRaw ?? []) as unknown as ReqRaw[];

      if (reqs.length > 0) {
        // Lógica binaria: un requerimiento está cubierto si existe una asignación
        // vinculada (requerimiento_id === req.id). Si no hay vínculos, se
        // considera que todos están pendientes.
        const tieneVinculo = asigs.some((a) => a.requerimiento_id !== null);

        const pendientesNuevos: ReqPendiente[] = [];

        if (tieneVinculo) {
          for (const req of reqs) {
            const cubierto = asigs.some((a) => a.requerimiento_id === req.id);
            if (!cubierto) {
              pendientesNuevos.push({
                cargo_requerido: req.cargo_requerido,
                pct_requerido: Number(req.pct_dedicacion),
              });
            }
          }
        } else {
          // Sin vínculo: no podemos saber cuál req está cubierto → mostrar todos
          for (const req of reqs) {
            pendientesNuevos.push({
              cargo_requerido: req.cargo_requerido,
              pct_requerido: Number(req.pct_dedicacion),
            });
          }
        }

        setPendientes(pendientesNuevos);
      }

      setLoading(false);
    }
    load();
  }, [state.engagementId, state.diaStr, planId]);

  const { bg: cobBg, text: cobText } = colorCobertura(state.cobertura);

  return (
    <PopoverContainer
      rect={state.rect}
      onClose={onClose}
      title={state.engagementNombre}
      subtitle={`${state.cliente} · ${state.diaLabel}`}
    >
      {loading ? (
        <p className="text-xs text-[#888] text-center py-2">Cargando...</p>
      ) : (
        <div className="space-y-3">
          {/* Cobertura global */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#888]">Cobertura del día</span>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: cobBg, color: cobText }}>
              {state.cobertura < 0 ? "Sin reqs" : `${Math.round(state.cobertura)}%`}
            </span>
          </div>

          {/* Personas asignadas */}
          {asignaciones.length > 0 ? (
            <div>
              <p className="text-[10px] font-semibold text-[#888] uppercase tracking-wide mb-1.5">
                Asignados
              </p>
              <div className="space-y-1.5">
                {asignaciones.map((a, i) => {
                  const { bg, text } = colorOcupacion(a.pct);
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <User className="w-3 h-3 text-[#aaa] flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-[#1a1a1a] truncate">{a.persona_nombre}</p>
                        <p className="text-[10px] text-[#888] truncate">{a.cargo}</p>
                      </div>
                      {a.tipo === "plan" && (
                        <span className="text-[9px] text-[#4a90e2] flex-shrink-0">plan</span>
                      )}
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: bg, color: text }}>
                        {formatPct(a.pct)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-xs text-[#aaa] italic">Sin personas asignadas este día.</p>
          )}

          {/* Pendiente por requerimiento — lógica binaria (o está asignado o no) */}
          {pendientes.length > 0 ? (
            <div className="border-t border-[#f0f0f0] pt-2">
              <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wide mb-1.5">
                Sin asignar
              </p>
              <div className="space-y-1.5">
                {pendientes.map((p, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[#555] flex-1 truncate">
                      {p.cargo_requerido ?? "Sin cargo"}
                    </span>
                    <span className="text-xs font-semibold text-red-500 flex-shrink-0 bg-red-50 px-2 py-0.5 rounded-full">
                      {formatPct(p.pct_requerido)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : asignaciones.length > 0 && state.cobertura >= 100 ? (
            <div className="flex items-center gap-1.5 text-[#27ae60] border-t border-[#f0f0f0] pt-2">
              <CheckCircle className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">Totalmente cubierto</span>
            </div>
          ) : null}
        </div>
      )}
    </PopoverContainer>
  );
}

type PopoverState = PopoverPersonaState | PopoverProyectoState;

// ─────────────────────────────────────────────────────────────
//  Leyenda
// ─────────────────────────────────────────────────────────────

function LeyendaPersona() {
  return (
    <div className="flex items-center gap-3 mb-4 flex-wrap">
      <span className="text-xs text-[#888] font-medium">Ocupación:</span>
      {[
        { label: "Sin asignar", bg: "#f0f0f0", text: "#888" },
        { label: "1–50%",   bg: "#dcf5e7", text: "#1e7e45" },
        { label: "51–80%",  bg: "#fff4d4", text: "#8a6200" },
        { label: "81–99%",  bg: "#ffe4c4", text: "#c45000" },
        { label: "100%",    bg: "#ffd4d4", text: "#c02020" },
        { label: ">100%",   bg: "#ffc0c0", text: "#c02020" },
      ].map((item) => (
        <span key={item.label} className="text-xs px-2 py-0.5 rounded-md font-medium" style={{ background: item.bg, color: item.text }}>
          {item.label}
        </span>
      ))}
      <span className="text-xs text-[#aaa] ml-1">· Click en celda para ver desglose</span>
    </div>
  );
}

function LeyendaProyecto() {
  return (
    <div className="flex items-center gap-3 mb-4 flex-wrap">
      <span className="text-xs text-[#888] font-medium">Cobertura:</span>
      {[
        { label: "Sin reqs",  bg: "#f0f0f0", text: "#999" },
        { label: "0%",        bg: "#ffd4d4", text: "#c02020" },
        { label: "1–49%",    bg: "#ffe4c4", text: "#c45000" },
        { label: "50–79%",   bg: "#fff4d4", text: "#8a6200" },
        { label: "80–99%",   bg: "#dcf5e7", text: "#1e7e45" },
        { label: "100%",     bg: "#27ae60", text: "#fff" },
      ].map((item) => (
        <span key={item.label} className="text-xs px-2 py-0.5 rounded-md font-medium" style={{ background: item.bg, color: item.text }}>
          {item.label}
        </span>
      ))}
      <span className="text-xs text-[#aaa] ml-1">· Click en celda para ver detalle</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Componente principal
// ─────────────────────────────────────────────────────────────

export function TablonOcupacion({ semanaInicio, planId, vista }: Props) {
  const [filasPersona, setFilasPersona] = useState<FilaDia[]>([]);
  const [filasProyecto, setFilasProyecto] = useState<FilaProyecto[]>([]);
  const [dias, setDias] = useState<Date[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  // "persona_id|yyyy-MM-dd" → persona asignada a un engagement con ese día marcado como crítico
  const [diasCriticosPersona, setDiasCriticosPersona] = useState<Set<string>>(new Set());
  // "engagement_id|yyyy-MM-dd" → engagement con ese día marcado como crítico
  const [diasCriticosEng, setDiasCriticosEng] = useState<Set<string>>(new Set());

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPopover(null);
    const supabase = createClient();

    if (vista === "persona") {
      const result = await fetchOcupacionDiariaPersona(supabase, semanaInicio, planId);
      if (result.error) {
        setError(result.error);
      } else {
        setFilasPersona(result.filas);
        setDiasCriticosPersona(result.diasCriticosPersona);
        setDias(result.dias.filter((d) => !isWeekend(d)));
      }
    } else {
      const result = await fetchCoberturaProyecto(supabase, semanaInicio, planId);
      if (result.error) {
        setError(result.error);
      } else {
        setFilasProyecto(result.filas);
        setDiasCriticosEng(result.diasCriticosEng);
        setDias(result.dias.filter((d) => !isWeekend(d)));
      }
    }
    setLoading(false);
  }, [semanaInicio, planId, vista]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { setPopover(null); }, [semanaInicio, planId, vista]);

  if (loading) {
    return <div className="flex items-center justify-center h-48 text-sm text-[#888]">Cargando tablero...</div>;
  }
  if (error) {
    return <div className="flex items-center justify-center h-48 text-sm text-red-500">Error: {error}</div>;
  }

  // ── Vista por persona ─────────────────────────────────────

  if (vista === "persona") {
    if (filasPersona.length === 0) {
      return (
        <div className="p-6 flex flex-col items-center justify-center h-48 text-[#888] gap-1">
          <p className="text-sm font-medium">Sin datos de ocupación.</p>
          <p className="text-xs">Asegúrate de tener personas activas y asignaciones.</p>
        </div>
      );
    }

    const handlePersonaClick = (e: React.MouseEvent<HTMLButtonElement>, fila: FilaDia, dia: Date, pct: number) => {
      const diaStr = format(dia, "yyyy-MM-dd");
      const diaLabel = format(dia, "EEEE d MMM", { locale: es });
      const rect = e.currentTarget.getBoundingClientRect();
      if (popover?.tipo === "persona" && (popover as PopoverPersonaState).personaId === fila.persona_id && (popover as PopoverPersonaState).diaStr === diaStr) {
        setPopover(null);
        return;
      }
      setPopover({ tipo: "persona", personaId: fila.persona_id, personaNombre: fila.persona_nombre, diaStr, diaLabel, pct, rect });
    };

    return (
      <div className="p-6">
        <LeyendaPersona />
        <div className="bg-white rounded-xl border border-[#e8e8e8] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-[#e8e8e8] bg-[#f9f9f9]">
                  <th className="text-left px-4 py-3 font-semibold text-[#555] w-48 sticky left-0 bg-[#f9f9f9] z-10">Persona</th>
                  <th className="text-left px-3 py-3 font-semibold text-[#555] w-32">Cargo</th>
                  {dias.map((dia) => (
                    <th key={format(dia, "yyyy-MM-dd")} className="px-1.5 py-3 font-semibold text-center min-w-[90px]">
                      <div className="text-[11px] font-bold text-[#333]">{format(dia, "EEE", { locale: es })}</div>
                      <div className="text-[10px] font-normal text-[#888]">{format(dia, "d MMM", { locale: es })}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filasPersona.map((fila, idx) => (
                  <tr key={fila.persona_id} className={`border-b border-[#f5f5f5] ${idx % 2 !== 0 ? "bg-[#fafafa]" : ""}`}>
                    <td className="px-4 py-2 font-medium sticky left-0 bg-inherit z-10">
                      <span className="truncate block max-w-[160px] text-sm">{fila.persona_nombre}</span>
                    </td>
                    <td className="px-3 py-2 text-[#888] text-xs">{fila.cargo_actual}</td>
                    {dias.map((dia) => {
                      const diaStr = format(dia, "yyyy-MM-dd");
                      const datos = fila.dias[diaStr] ?? { actual: 0, proyectado: 0 };
                      const pct = planId ? datos.proyectado : datos.actual;
                      const tieneAlerta = planId != null && datos.proyectado > 100;
                      const { bg, text } = colorOcupacion(pct);
                      const isOpen = popover?.tipo === "persona" && (popover as PopoverPersonaState).personaId === fila.persona_id && (popover as PopoverPersonaState).diaStr === diaStr;
                      const esCritico = diasCriticosPersona.has(`${fila.persona_id}|${diaStr}`);
                      return (
                        <td key={diaStr} className="px-1.5 py-2">
                          <div className={`relative ${isOpen ? "z-30" : ""}`}>
                            <Celda
                              bg={pct === 0 ? "#f0f0f0" : bg}
                              text={pct === 0 ? "#ccc" : text}
                              label={pct === 0 ? "—" : formatPct(pct)}
                              alerta={tieneAlerta}
                              critico={esCritico}
                              isOpen={isOpen}
                              onClick={(e) => handlePersonaClick(e, fila, dia, pct)}
                            />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-3 text-xs text-[#aaa]">
          {planId ? "Vista de plan: asignaciones reales + propuestas en este plan." : "Vista real: solo asignaciones aprobadas."}
        </p>
        {popover?.tipo === "persona" && (
          <PersonaPopover state={popover as PopoverPersonaState} planId={planId} onClose={() => setPopover(null)} />
        )}
      </div>
    );
  }

  // ── Vista por proyecto ────────────────────────────────────

  if (filasProyecto.length === 0) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-48 text-[#888] gap-1">
        <p className="text-sm font-medium">Sin engagements con requerimientos esta semana.</p>
        <p className="text-xs">Define requerimientos en tus engagements para ver la cobertura.</p>
      </div>
    );
  }

  const handleProyectoClick = (e: React.MouseEvent<HTMLButtonElement>, fila: FilaProyecto, dia: Date, cobertura: number) => {
    const diaStr = format(dia, "yyyy-MM-dd");
    const diaLabel = format(dia, "EEEE d MMM", { locale: es });
    const rect = e.currentTarget.getBoundingClientRect();
    if (popover?.tipo === "proyecto" && (popover as PopoverProyectoState).engagementId === fila.engagement_id && (popover as PopoverProyectoState).diaStr === diaStr) {
      setPopover(null);
      return;
    }
    setPopover({ tipo: "proyecto", engagementId: fila.engagement_id, engagementNombre: fila.engagement_nombre, cliente: fila.cliente, diaStr, diaLabel, cobertura, rect });
  };

  return (
    <div className="p-6">
      <LeyendaProyecto />
      <div className="bg-white rounded-xl border border-[#e8e8e8] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-[#e8e8e8] bg-[#f9f9f9]">
                <th className="text-left px-4 py-3 font-semibold text-[#555] w-52 sticky left-0 bg-[#f9f9f9] z-10">Engagement</th>
                <th className="text-left px-3 py-3 font-semibold text-[#555] w-36">Cliente</th>
                {dias.map((dia) => (
                  <th key={format(dia, "yyyy-MM-dd")} className="px-1.5 py-3 font-semibold text-center min-w-[90px]">
                    <div className="text-[11px] font-bold text-[#333]">{format(dia, "EEE", { locale: es })}</div>
                    <div className="text-[10px] font-normal text-[#888]">{format(dia, "d MMM", { locale: es })}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filasProyecto.map((fila, idx) => (
                <tr key={fila.engagement_id} className={`border-b border-[#f5f5f5] ${idx % 2 !== 0 ? "bg-[#fafafa]" : ""}`}>
                  <td className="px-4 py-2 font-medium sticky left-0 bg-inherit z-10">
                    <span className="truncate block max-w-[180px] text-sm">{fila.engagement_nombre}</span>
                  </td>
                  <td className="px-3 py-2 text-[#888] text-xs truncate max-w-[120px]">{fila.cliente}</td>
                  {dias.map((dia) => {
                    const diaStr = format(dia, "yyyy-MM-dd");
                    const datos = fila.dias[diaStr] ?? { requerido: 0, asignado: 0, asignadoPlan: 0, cobertura: -1 };
                    const { bg, text } = colorCobertura(datos.cobertura);
                    const isOpen = popover?.tipo === "proyecto" && (popover as PopoverProyectoState).engagementId === fila.engagement_id && (popover as PopoverProyectoState).diaStr === diaStr;
                    // Solo marcar como crítico si el engagement tiene reqs ese día (cobertura >= 0)
                    const esCriticoEng = datos.cobertura >= 0 && diasCriticosEng.has(`${fila.engagement_id}|${diaStr}`);
                    return (
                      <td key={diaStr} className="px-1.5 py-2">
                        <div className={`relative ${isOpen ? "z-30" : ""}`}>
                          <Celda
                            bg={bg}
                            text={text}
                            label={datos.cobertura < 0 ? "—" : `${Math.round(datos.cobertura)}%`}
                            critico={esCriticoEng}
                            isOpen={isOpen}
                            onClick={(e) => handleProyectoClick(e, fila, dia, datos.cobertura)}
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-3 text-xs text-[#aaa]">
        {planId ? "Vista de plan: cobertura con asignaciones reales + propuestas en este plan." : "Vista real: cobertura solo con asignaciones aprobadas."}
      </p>
      {popover?.tipo === "proyecto" && (
        <ProyectoPopover state={popover as PopoverProyectoState} planId={planId} onClose={() => setPopover(null)} />
      )}
    </div>
  );
}
