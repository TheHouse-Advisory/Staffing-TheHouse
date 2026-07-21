"use client";

import { useState, useEffect, useCallback } from "react";
import { format, isWeekend } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, X, User, CheckCircle, BarChart2, Search, Undo2 } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  fetchOcupacionDiariaPersona,
  fetchCoberturaProyecto,
  type FilaDia,
  type FilaProyecto,
} from "@/lib/queries/tablero";
import { cambiarTipoEngagement } from "@/lib/queries/engagements";
import { colorOcupacion, formatPct } from "@/lib/utils";
import { CARGOS, CARGO_COLORS, CARGO_COLOR_DEFAULT } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────
//  Props
// ─────────────────────────────────────────────────────────────

interface Props {
  semanaInicio: Date;
  planId: string | null;
  vista: "persona" | "proyecto";
  periodoVista?: "dia" | "semana" | "mes";
}

// ─────────────────────────────────────────────────────────────
//  Helpers — agrupación de columnas
// ─────────────────────────────────────────────────────────────

interface Columna {
  label: string;
  sublabel: string;
  dias: Date[];
}

function getColumnas(todosDias: Date[], pv: string): Columna[] {
  if (pv !== "semana" && pv !== "mes") {
    // dia: filtrar fines de semana
    return todosDias.filter((d) => !isWeekend(d)).map((d) => ({
      label: format(d, "EEE", { locale: es }),
      sublabel: format(d, "d MMM", { locale: es }),
      dias: [d],
    }));
  }
  if (pv === "semana") {
    const n = Math.floor(todosDias.length / 7);
    return Array.from({ length: n }, (_, i) => {
      const slice = todosDias.slice(i * 7, i * 7 + 7);
      return {
        label: format(slice[0], "d MMM", { locale: es }),
        sublabel: format(slice[Math.min(6, slice.length - 1)], "d MMM", { locale: es }),
        dias: slice,
      };
    });
  }
  // mes: agrupar por mes calendario
  const groups = new Map<string, Date[]>();
  for (const d of todosDias) {
    const key = format(d, "yyyy-MM");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }
  return Array.from(groups.entries()).map(([, days]) => ({
    label: format(days[0], "MMM", { locale: es }),
    sublabel: format(days[0], "yyyy"),
    dias: days,
  }));
}

function avgPersona(fila: FilaDia, columnaDias: Date[], planId: string | null): number {
  const habil = columnaDias.filter((d) => !isWeekend(d));
  if (habil.length === 0) return 0;
  const total = habil.reduce((s, d) => {
    const k = format(d, "yyyy-MM-dd");
    const v = fila.dias[k] ?? { actual: 0, proyectado: 0 };
    return s + (planId ? v.proyectado : v.actual);
  }, 0);
  return Math.round(total / habil.length);
}

function avgCoberturaCol(fila: FilaProyecto, columnaDias: Date[]): number {
  const habil = columnaDias.filter((d) => !isWeekend(d));
  const vals = habil
    .map((d) => fila.dias[format(d, "yyyy-MM-dd")]?.cobertura ?? -1)
    .filter((c) => c >= 0);
  if (vals.length === 0) return -1;
  return Math.round(vals.reduce((s, c) => s + c, 0) / vals.length);
}

// ─────────────────────────────────────────────────────────────
//  Color cobertura
// ─────────────────────────────────────────────────────────────

function colorCobertura(cobertura: number): { bg: string; text: string } {
  if (cobertura < 0)   return { bg: "#f0f0f0", text: "#999" };
  if (cobertura === 0) return { bg: "#ffd4d4", text: "#c02020" };
  if (cobertura < 50)  return { bg: "#ffe4c4", text: "#c45000" };
  if (cobertura < 80)  return { bg: "#fff4d4", text: "#8a6200" };
  if (cobertura < 100) return { bg: "#dcf5e7", text: "#1e7e45" };
  return { bg: "#27ae60", text: "#fff" };
}

// ─────────────────────────────────────────────────────────────
//  Celda clickeable (día individual)
// ─────────────────────────────────────────────────────────────

function Celda({
  bg, text, label, alerta, critico, isOpen, onClick,
}: {
  bg: string; text: string; label: string;
  alerta?: boolean; critico?: boolean; isOpen?: boolean;
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

// Celda no clickeable (período agregado)
function CeldaAgregada({
  bg, text, label, critico,
}: {
  bg: string; text: string; label: string; critico?: boolean;
}) {
  return (
    <div
      className="w-full h-10 rounded-md flex items-center justify-center text-xs font-semibold"
      style={{
        background: bg,
        color: text,
        boxShadow: critico ? "inset 0 0 0 2.5px #f97316" : undefined,
      }}
    >
      {label}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Popover container
// ─────────────────────────────────────────────────────────────

function PopoverContainer({
  rect, onClose, title, subtitle, children, accentColor,
}: {
  rect: DOMRect; onClose: () => void; title: string; subtitle: string; children: React.ReactNode; accentColor?: string;
}) {
  const popoverWidth = 300;
  const popoverHeight = 300;
  const viewportWidth  = typeof window !== "undefined" ? window.innerWidth  : 1200;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  let left = rect.right + 8;
  if (left + popoverWidth > viewportWidth - 8) { left = rect.left - popoverWidth - 8; if (left < 8) left = 8; }
  let top = rect.top;
  if (top + popoverHeight > viewportHeight - 8) top = viewportHeight - popoverHeight - 8;
  if (top < 8) top = 8;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed z-50 bg-white border border-[#e8e8e8] rounded-xl shadow-xl overflow-hidden" style={{ left, top, width: popoverWidth }}>
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-[#e8e8e8]"
          style={accentColor ? { background: `${accentColor}18` } : { background: "#f9f9f9" }}
        >
          <div className="flex-1 min-w-0 pr-2">
            {accentColor && <div className="w-8 h-0.5 rounded-full mb-1.5" style={{ background: accentColor }} />}
            <p className="text-xs font-semibold truncate" style={accentColor ? { color: accentColor } : { color: "#1a1a1a" }}>{title}</p>
            <p className="text-[10px] text-[#888]">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="w-5 h-5 flex items-center justify-center text-[#888] hover:text-[#333] transition-colors flex-shrink-0">
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

interface LineaPersona { engagement_nombre: string; pct: number; tipo: "real" | "plan" | "liberar"; }
interface PopoverPersonaState {
  tipo: "persona"; personaId: string; personaNombre: string; cargoActual: string;
  diaStr: string; diaLabel: string; pct: number; rect: DOMRect;
}

function PersonaPopover({ state, planId, onClose }: { state: PopoverPersonaState; planId: string | null; onClose: () => void; }) {
  const [lineas, setLineas] = useState<LineaPersona[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const resultado: LineaPersona[] = [];
      const diaStr = state.diaStr;
      type AsigDesglose = { id: string; pct_dedicacion: number; engagement: { nombre: string } | null };

      // !inner + filtro estado/is_deleted: descarta asignaciones "fantasma" del desglose y del total
      const { data: realRaw } = await supabase
        .from("asignacion")
        .select("id, pct_dedicacion, engagement:engagement_id!inner(nombre, codigo, estado, is_deleted)" as any)
        .eq("persona_id", state.personaId)
        .eq("estado", "activa")
        .eq("engagement.estado", "activo")
        .eq("engagement.is_deleted", false)
        .lte("fecha_inicio", diaStr)
        .or(`fecha_fin.gte.${diaStr},fecha_fin.is.null`);

      const realAsigs = (realRaw ?? []) as unknown as AsigDesglose[];
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
          .lte("fecha_fin", diaStr);
        for (const lib of (liberarRaw ?? []) as LibRow[]) {
          if (lib.asignacion_a_terminar_id) liberacionIds.add(lib.asignacion_a_terminar_id);
        }
      }

      for (const a of realAsigs) {
        resultado.push({ engagement_nombre: (a.engagement as any)?.codigo ? `${(a.engagement as any).codigo}: ${a.engagement?.nombre ?? "—"}` : a.engagement?.nombre ?? "—", pct: Number(a.pct_dedicacion), tipo: liberacionIds.has(a.id) ? "liberar" : "real" });
      }

      if (planId) {
        type AsigDesglosePlan = { pct_dedicacion: number; engagement: { nombre: string; codigo?: string | null } | null };
        const { data: planRaw } = await (supabase as any)
          .from("asignacion_propuesta")
          .select("pct_dedicacion, engagement:engagement_id(nombre, codigo)")
          .eq("persona_id", state.personaId)
          .eq("plan_id", planId)
          .eq("estado", "borrador")
          .neq("tipo", "liberar")
          .lte("fecha_inicio", diaStr)
          .gte("fecha_fin", diaStr);
        for (const a of (planRaw ?? []) as unknown as AsigDesglosePlan[]) {
          resultado.push({ engagement_nombre: a.engagement?.codigo ? `${a.engagement.codigo}: ${a.engagement.nombre ?? "—"}` : a.engagement?.nombre ?? "—", pct: Number(a.pct_dedicacion), tipo: "plan" });
        }
      }

      setLineas(resultado);
      setLoading(false);
    }
    load();
  }, [state.personaId, state.diaStr, planId]);

  const total = lineas.reduce((s, l) => s + (l.tipo === "liberar" ? -l.pct : l.pct), 0);

  const cargoColor = CARGO_COLORS[state.cargoActual] ?? CARGO_COLOR_DEFAULT;

  return (
    <PopoverContainer rect={state.rect} onClose={onClose} title={state.personaNombre} subtitle={state.diaLabel} accentColor={cargoColor}>
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
                  <p className={`text-xs font-medium truncate ${isLiberar ? "line-through text-red-600" : "text-[#1a1a1a]"}`}>{l.engagement_nombre}</p>
                  {l.tipo === "plan" && <p className="text-[10px] text-[#4a90e2]">propuesto</p>}
                  {isLiberar && <p className="text-[10px] text-red-400">liberado</p>}
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${isLiberar ? "line-through" : ""}`} style={isLiberar ? { background: "#fee2e2", color: "#b91c1c" } : { background: bg, color: text }}>
                  {formatPct(l.pct)}
                </span>
              </div>
            );
          })}
          {lineas.length > 1 && (
            <div className="border-t border-[#f0f0f0] pt-2 flex items-center justify-between">
              <span className="text-xs text-[#888]">Total efectivo</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={(() => { const { bg, text } = colorOcupacion(Math.max(0, total)); return { background: bg, color: text }; })()}>
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

interface AsignacionDia { persona_nombre: string; cargo: string; pct: number; tipo: "real" | "plan"; requerimiento_id: string | null; }
interface ReqPendiente { cargo_requerido: string | null; pct_requerido: number; }
interface PopoverProyectoState {
  tipo: "proyecto"; engagementId: string; engagementNombre: string; cliente: string;
  diaStr: string; diaLabel: string; cobertura: number; rect: DOMRect;
}

function ProyectoPopover({ state, planId, onClose }: { state: PopoverProyectoState; planId: string | null; onClose: () => void; }) {
  const [asignaciones, setAsignaciones] = useState<AsignacionDia[]>([]);
  const [pendientes, setPendientes] = useState<ReqPendiente[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const diaStr = state.diaStr;
      const engId = state.engagementId;

      interface AsigRaw { pct_dedicacion: number; cargo_al_momento: string | null; requerimiento_id: string | null; persona: { nombre: string; apellido: string; cargo_actual: string | null } | null; }
      type ReqRaw = { id: string; cargo_requerido: string | null; pct_dedicacion: number };

      const { data: realRaw } = await supabase
        .from("asignacion")
        .select("pct_dedicacion, cargo_al_momento, requerimiento_id, persona:persona_id(nombre, apellido, cargo_actual)")
        .eq("engagement_id", engId)
        .eq("estado", "activa")
        .lte("fecha_inicio", diaStr)
        .or(`fecha_fin.gte.${diaStr},fecha_fin.is.null`);

      const asigs: AsignacionDia[] = (realRaw ?? []).map((a) => {
        const ar = a as unknown as AsigRaw;
        return { persona_nombre: ar.persona ? `${ar.persona.nombre} ${ar.persona.apellido}` : "—", cargo: ar.cargo_al_momento ?? ar.persona?.cargo_actual ?? "—", pct: Number(ar.pct_dedicacion), tipo: "real", requerimiento_id: ar.requerimiento_id ?? null };
      });

      if (planId) {
        interface AsigPlanRaw { pct_dedicacion: number; requerimiento_id: string | null; persona: { nombre: string; apellido: string; cargo_actual: string | null } | null; }
        const { data: planRaw } = await supabase
          .from("asignacion_propuesta")
          .select("pct_dedicacion, requerimiento_id, persona:persona_id(nombre, apellido, cargo_actual)")
          .eq("engagement_id", engId)
          .eq("plan_id", planId)
          .eq("estado", "borrador")
          .lte("fecha_inicio", diaStr)
          .gte("fecha_fin", diaStr);
        for (const a of (planRaw ?? []) as unknown as AsigPlanRaw[]) {
          asigs.push({ persona_nombre: a.persona ? `${a.persona.nombre} ${a.persona.apellido}` : "—", cargo: a.persona?.cargo_actual ?? "—", pct: Number(a.pct_dedicacion), tipo: "plan", requerimiento_id: a.requerimiento_id ?? null });
        }
      }
      setAsignaciones(asigs);

      const { data: reqRaw } = await supabase
        .from("requerimiento_engagement")
        .select("id, cargo_requerido, pct_dedicacion")
        .eq("engagement_id", engId)
        .lte("fecha_inicio", diaStr)
        .gte("fecha_fin", diaStr);

      const reqs = (reqRaw ?? []) as unknown as ReqRaw[];
      if (reqs.length > 0) {
        const tieneVinculo = asigs.some((a) => a.requerimiento_id !== null);
        const pendientesNuevos: ReqPendiente[] = [];
        if (tieneVinculo) {
          for (const req of reqs) {
            if (!asigs.some((a) => a.requerimiento_id === req.id)) pendientesNuevos.push({ cargo_requerido: req.cargo_requerido, pct_requerido: Number(req.pct_dedicacion) });
          }
        } else {
          for (const req of reqs) pendientesNuevos.push({ cargo_requerido: req.cargo_requerido, pct_requerido: Number(req.pct_dedicacion) });
        }
        setPendientes(pendientesNuevos);
      }
      setLoading(false);
    }
    load();
  }, [state.engagementId, state.diaStr, planId]);

  const { bg: cobBg, text: cobText } = colorCobertura(state.cobertura);

  return (
    <PopoverContainer rect={state.rect} onClose={onClose} title={state.engagementNombre} subtitle={`${state.cliente} · ${state.diaLabel}`}>
      {loading ? (
        <p className="text-xs text-[#888] text-center py-2">Cargando...</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#888]">Cobertura del día</span>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: cobBg, color: cobText }}>
              {state.cobertura < 0 ? "Sin reqs" : `${Math.round(state.cobertura)}%`}
            </span>
          </div>
          {asignaciones.length > 0 ? (
            <div>
              <p className="text-[10px] font-semibold text-[#888] uppercase tracking-wide mb-1.5">Asignados</p>
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
                      {a.tipo === "plan" && <span className="text-[9px] text-[#4a90e2] flex-shrink-0">plan</span>}
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: bg, color: text }}>{formatPct(a.pct)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-xs text-[#aaa] italic">Sin personas asignadas este día.</p>
          )}
          {pendientes.length > 0 ? (
            <div className="border-t border-[#f0f0f0] pt-2">
              <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wide mb-1.5">Sin asignar</p>
              <div className="space-y-1.5">
                {pendientes.map((p, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[#555] flex-1 truncate">{p.cargo_requerido ?? "Sin cargo"}</span>
                    <span className="text-xs font-semibold text-red-500 flex-shrink-0 bg-red-50 px-2 py-0.5 rounded-full">{formatPct(p.pct_requerido)}</span>
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
//  Leyendas
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
        <span key={item.label} className="text-xs px-2 py-0.5 rounded-md font-medium" style={{ background: item.bg, color: item.text }}>{item.label}</span>
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
        <span key={item.label} className="text-xs px-2 py-0.5 rounded-md font-medium" style={{ background: item.bg, color: item.text }}>{item.label}</span>
      ))}
      <span className="text-xs text-[#aaa] ml-1">· Click en celda para ver detalle</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Componente principal
// ─────────────────────────────────────────────────────────────

export function TablonOcupacion({ semanaInicio, planId, vista, periodoVista }: Props) {
  const [filasPersona, setFilasPersona] = useState<FilaDia[]>([]);
  const [filasProyecto, setFilasProyecto] = useState<FilaProyecto[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [dias, setDias] = useState<Date[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [diasCriticosPersona, setDiasCriticosPersona] = useState<Set<string>>(new Set());
  const [diasCriticosEng, setDiasCriticosEng] = useState<Set<string>>(new Set());
  const [collapsedMonths, setCollapsedMonths] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  // Degrada un "Proyecto" a "Posible proyecto" (tipo → 'posibles_proyectos')
  async function moverAPosibleProyecto(fila: FilaProyecto) {
    const supabase = createClient();
    await cambiarTipoEngagement(supabase, fila.engagement_id, "posibles_proyectos");
    setFilasProyecto((prev) => prev.map((f) => (f.engagement_id !== fila.engagement_id ? f : { ...f, tipo: "posibles_proyectos" })));
    showToast("Proyecto movido a Posible de forma exitosa");
  }

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPopover(null);
    const supabase = createClient();
    const pv = periodoVista ?? "dia";
    const totalDias = pv === "semana" ? 35 : pv === "mes" ? 120 : 7;

    if (vista === "persona") {
      const result = await fetchOcupacionDiariaPersona(supabase, semanaInicio, planId, totalDias);
      if (result.error) {
        setError(result.error);
      } else {
        setFilasPersona(result.filas);
        setDiasCriticosPersona(result.diasCriticosPersona);
        setDias(result.dias); // todos los días, sin filtrar fines de semana
      }
    } else {
      const result = await fetchCoberturaProyecto(supabase, semanaInicio, planId, totalDias);
      if (result.error) {
        setError(result.error);
      } else {
        setFilasProyecto(result.filas);
        setDiasCriticosEng(result.diasCriticosEng);
        setDias(result.dias);
      }
    }
    setLoading(false);
  }, [semanaInicio, planId, vista, periodoVista]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { setPopover(null); }, [semanaInicio, planId, vista, periodoVista]);

  // Recarga cuando cambian asignaciones o engagements (ej: extensión de proyecto)
  useEffect(() => {
    const handler = () => cargar();
    window.addEventListener("asignacionChanged", handler);
    window.addEventListener("engagementChanged", handler);
    return () => {
      window.removeEventListener("asignacionChanged", handler);
      window.removeEventListener("engagementChanged", handler);
    };
  }, [cargar]);

  if (loading) return <div className="flex items-center justify-center h-48 text-sm text-[#888]">Cargando tablero...</div>;
  if (error)   return <div className="flex items-center justify-center h-48 text-sm text-red-500">Error: {error}</div>;

  const pv = periodoVista ?? "dia";
  const columnas = getColumnas(dias, pv);

  // ── Lógica de meses colapsables (solo vista semana) ──────
  const monthGroups = pv === "semana"
    ? Array.from(
        columnas.reduce((map, col, i) => {
          const key = format(col.dias[0], "yyyy-MM");
          if (!map.has(key)) map.set(key, { key, label: format(col.dias[0], "MMM yyyy", { locale: es }), indices: [] as number[] });
          map.get(key)!.indices.push(i);
          return map;
        }, new Map<string, { key: string; label: string; indices: number[] }>())
      ).map(([, g]) => g)
    : [];

  const toggleMonth = (key: string) =>
    setCollapsedMonths(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  const collapseAllMonths = () => setCollapsedMonths(monthGroups.map(g => g.key));
  const expandAllMonths  = () => setCollapsedMonths([]);

  // Devuelve todos los días de un mes a partir del índice de su primera columna
  const getMonthDias = (ci: number): Date[] => {
    const monthKey = format(columnas[ci].dias[0], "yyyy-MM");
    const group = monthGroups.find(g => g.key === monthKey);
    return group ? group.indices.flatMap(idx => columnas[idx].dias) : columnas[ci].dias;
  };

  // ── Vista por persona ────────────────────────────────────

  if (vista === "persona") {
    if (filasPersona.length === 0) {
      return (
        <div className="p-6 flex flex-col items-center justify-center h-48 text-[#888] gap-1">
          <p className="text-sm font-medium">Sin datos de ocupación.</p>
          <p className="text-xs">Asegúrate de tener personas activas y asignaciones.</p>
        </div>
      );
    }

    const handlePersonaClick = (e: React.MouseEvent<HTMLButtonElement>, fila: FilaDia, dia: Date, pctVal: number) => {
      const diaStr = format(dia, "yyyy-MM-dd");
      const diaLabel = format(dia, "EEEE d MMM", { locale: es });
      const rect = e.currentTarget.getBoundingClientRect();
      if (popover?.tipo === "persona" && (popover as PopoverPersonaState).personaId === fila.persona_id && (popover as PopoverPersonaState).diaStr === diaStr) {
        setPopover(null);
        return;
      }
      setPopover({ tipo: "persona", personaId: fila.persona_id, personaNombre: fila.persona_nombre, cargoActual: fila.cargo_actual, diaStr, diaLabel, pct: pctVal, rect });
    };

    return (
      <div className="p-6">
        <div className="flex justify-end mb-3">
          <Link href="/reportes/resumen-proyectos" className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border border-gray-100 text-gray-400 hover:text-[#4a90e2] hover:border-[#4a90e2]/30 hover:bg-blue-50 transition-all">
            <BarChart2 className="w-3 h-3" /><span>Resumen</span>
          </Link>
        </div>
        <LeyendaPersona />
        <div className="bg-white rounded-xl border border-[#e8e8e8] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                {pv === "semana" && (
                  <tr className="bg-[#f4f4f4]">
                    <th colSpan={2} className="px-4 py-1.5 sticky left-0 bg-[#f4f4f4] z-10">
                      <div className="flex gap-2">
                        <button type="button" onClick={collapseAllMonths} className="text-[10px] text-[#888] hover:text-[#333] underline">Colapsar todo</button>
                        <span className="text-[10px] text-[#ccc]">·</span>
                        <button type="button" onClick={expandAllMonths} className="text-[10px] text-[#888] hover:text-[#333] underline">Expandir todo</button>
                      </div>
                    </th>
                    {monthGroups.map((g) => (
                      <th key={g.key} colSpan={collapsedMonths.includes(g.key) ? 1 : g.indices.length} className="px-1.5 py-1.5 text-center border-l border-[#e8e8e8]">
                        <button type="button" onClick={() => toggleMonth(g.key)} className="flex items-center gap-1 mx-auto text-[11px] font-bold text-[#555] hover:text-[#333] capitalize">
                          <span>{g.label}</span>
                          <span className="text-[9px] text-[#aaa]">{collapsedMonths.includes(g.key) ? "▶" : "▼"}</span>
                        </button>
                      </th>
                    ))}
                  </tr>
                )}
                <tr className="border-b border-[#e8e8e8] bg-[#f9f9f9]">
                  <th className="text-left px-4 py-3 font-semibold text-[#555] w-48 sticky left-0 bg-[#f9f9f9] z-10">Persona</th>
                  <th className="text-left px-3 py-3 font-semibold text-[#555] w-32">Cargo</th>
                  {columnas.map((col, i) => {
                    if (pv === "semana") {
                      const monthKey = format(col.dias[0], "yyyy-MM");
                      const isCollapsed = collapsedMonths.includes(monthKey);
                      const group = monthGroups.find(g => g.key === monthKey)!;
                      if (isCollapsed) {
                        if (group.indices[0] !== i) return null;
                        return <th key={i} colSpan={group.indices.length} className="px-1.5 py-3 text-center min-w-[90px] text-[10px] font-normal text-[#aaa] italic border-l border-[#e8e8e8]">resumen</th>;
                      }
                    }
                    return (
                      <th key={i} className="px-1.5 py-3 font-semibold text-center min-w-[90px]">
                        <div className="text-[11px] font-bold text-[#333]">{col.label}</div>
                        <div className="text-[10px] font-normal text-[#888]">{col.sublabel}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const cargoOrden = [...CARGOS];
                  const sinCargo = filasPersona.filter(
                    (f) => !cargoOrden.includes(f.cargo_actual as typeof CARGOS[number])
                  );
                  const grupos = [
                    ...cargoOrden.map((c) => ({ cargo: c, lista: filasPersona.filter((f) => f.cargo_actual === c) })),
                    ...(sinCargo.length > 0 ? [{ cargo: "Sin cargo", lista: sinCargo }] : []),
                  ].filter((g) => g.lista.length > 0);

                  return grupos.flatMap(({ cargo, lista }) => {
                    const cargoColor = CARGO_COLORS[cargo] ?? CARGO_COLOR_DEFAULT;
                    const filaSeccion = (
                      <tr key={`sec-${cargo}`}>
                        <td colSpan={columnas.length + 2} className="px-4 pt-4 pb-1 bg-white">
                          <div className="flex items-center gap-2">
                            <div className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: cargoColor }} />
                            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: cargoColor }}>{cargo}</span>
                            <span className="text-[10px] text-gray-300">{lista.length}</span>
                            <div className="flex-1 h-0.5 rounded-full" style={{ background: cargoColor, opacity: 0.35 }} />
                          </div>
                        </td>
                      </tr>
                    );
                    const filasPersonaRows = lista.map((fila) => (
                      <tr key={fila.persona_id} className="border-b border-[#f5f5f5]">
                        <td className="px-4 py-2 font-medium sticky left-0 bg-white z-10">
                          <span className="truncate block max-w-[160px] text-sm">{fila.persona_nombre}</span>
                        </td>
                        <td className="px-3 py-2 text-xs" style={{ color: cargoColor }}>{fila.cargo_actual}</td>
                        {columnas.map((col, ci) => {
                          // Mes colapsado (solo semana)
                          if (pv === "semana") {
                            const monthKey = format(col.dias[0], "yyyy-MM");
                            const isCollapsed = collapsedMonths.includes(monthKey);
                            if (isCollapsed) {
                              const group = monthGroups.find(g => g.key === monthKey)!;
                              if (group.indices[0] !== ci) return null;
                              const allDias = getMonthDias(ci);
                              const pctAgg = avgPersona(fila, allDias, planId);
                              const { bg, text } = colorOcupacion(pctAgg);
                              const esCritico = allDias.some(d => diasCriticosPersona.has(`${fila.persona_id}|${format(d, "yyyy-MM-dd")}`));
                              return (
                                <td key={ci} colSpan={group.indices.length} className="px-1.5 py-2">
                                  <CeldaAgregada bg={pctAgg === 0 ? "#f0f0f0" : bg} text={pctAgg === 0 ? "#ccc" : text} label={pctAgg === 0 ? "—" : formatPct(pctAgg)} critico={esCritico} />
                                </td>
                              );
                            }
                          }
                          if (pv === "dia") {
                            const dia = col.dias[0];
                            const diaStr = format(dia, "yyyy-MM-dd");
                            const datos = fila.dias[diaStr] ?? { actual: 0, proyectado: 0 };
                            const pctVal = planId ? datos.proyectado : datos.actual;
                            const tieneAlerta = planId != null && datos.proyectado > 100;
                            const { bg, text } = colorOcupacion(pctVal);
                            const isOpen = popover?.tipo === "persona" && (popover as PopoverPersonaState).personaId === fila.persona_id && (popover as PopoverPersonaState).diaStr === diaStr;
                            const esCritico = diasCriticosPersona.has(`${fila.persona_id}|${diaStr}`);
                            return (
                              <td key={diaStr} className="px-1.5 py-2">
                                <div className={`relative ${isOpen ? "z-30" : ""}`}>
                                  <Celda bg={pctVal === 0 ? "#f0f0f0" : bg} text={pctVal === 0 ? "#ccc" : text} label={pctVal === 0 ? "—" : formatPct(pctVal)} alerta={tieneAlerta} critico={esCritico} isOpen={isOpen} onClick={(e) => handlePersonaClick(e, fila, dia, pctVal)} />
                                </div>
                              </td>
                            );
                          }
                          const pctAgg = avgPersona(fila, col.dias, planId);
                          const { bg, text } = colorOcupacion(pctAgg);
                          const esCritico = col.dias.some((d) => diasCriticosPersona.has(`${fila.persona_id}|${format(d, "yyyy-MM-dd")}`));
                          return (
                            <td key={ci} className="px-1.5 py-2">
                              <CeldaAgregada bg={pctAgg === 0 ? "#f0f0f0" : bg} text={pctAgg === 0 ? "#ccc" : text} label={pctAgg === 0 ? "—" : formatPct(pctAgg)} critico={esCritico} />
                            </td>
                          );
                        })}
                      </tr>
                    ));
                    return [filaSeccion, ...filasPersonaRows];
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-3 text-xs text-[#aaa]">
          {pv !== "dia" ? "Promedio de ocupación por período (días hábiles)." : planId ? "Vista de plan: asignaciones reales + propuestas en este plan." : "Vista real: solo asignaciones aprobadas."}
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
        <p className="text-sm font-medium">Sin proyectos con requerimientos esta semana.</p>
        <p className="text-xs">Define requerimientos en tus proyectos para ver la cobertura.</p>
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
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-xl shadow-lg px-4 py-2.5 text-sm font-medium">
          {toast}
        </div>
      )}
      <div className="flex flex-col gap-1.5 mb-3">
        {/* Fila 1: Resumen compacto alineado a la derecha */}
        <div className="flex justify-end">
          <Link href="/reportes/resumen-proyectos" className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-gray-200 text-[10px] text-gray-400 hover:text-[#4a90e2] hover:border-[#4a90e2]/40 hover:bg-blue-50 transition-all">
            <BarChart2 className="w-2.5 h-2.5" /><span>Resumen</span>
          </Link>
        </div>
        {/* Fila 2: buscador */}
        <div className="relative flex items-center">
          <Search className="absolute left-2 w-3 h-3 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por proyecto, código, cliente o persona..."
            className="pl-6 pr-2.5 py-1 text-[11px] rounded-lg border border-gray-200 bg-white text-gray-700 placeholder-gray-400 focus:outline-none focus:border-[#4a90e2] focus:ring-1 focus:ring-[#4a90e2]/30 w-72 transition-all"
          />
        </div>
      </div>
      <LeyendaProyecto />
      <div className="bg-white rounded-xl border border-[#e8e8e8] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              {pv === "semana" && (
                <tr className="bg-[#f4f4f4]">
                  <th colSpan={2} className="px-4 py-1.5 sticky left-0 bg-[#f4f4f4] z-10">
                    <div className="flex gap-2">
                      <button type="button" onClick={collapseAllMonths} className="text-[10px] text-[#888] hover:text-[#333] underline">Colapsar todo</button>
                      <span className="text-[10px] text-[#ccc]">·</span>
                      <button type="button" onClick={expandAllMonths} className="text-[10px] text-[#888] hover:text-[#333] underline">Expandir todo</button>
                    </div>
                  </th>
                  {monthGroups.map((g) => (
                    <th key={g.key} colSpan={collapsedMonths.includes(g.key) ? 1 : g.indices.length} className="px-1.5 py-1.5 text-center border-l border-[#e8e8e8]">
                      <button type="button" onClick={() => toggleMonth(g.key)} className="flex items-center gap-1 mx-auto text-[11px] font-bold text-[#555] hover:text-[#333] capitalize">
                        <span>{g.label}</span>
                        <span className="text-[9px] text-[#aaa]">{collapsedMonths.includes(g.key) ? "▶" : "▼"}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              )}
              <tr className="border-b border-[#e8e8e8] bg-[#f9f9f9]">
                <th className="text-left px-4 py-3 font-semibold text-[#555] w-52 sticky left-0 bg-[#f9f9f9] z-10">Proyecto</th>
                <th className="text-left px-3 py-3 font-semibold text-[#555] w-36">Cliente</th>
                {columnas.map((col, i) => {
                  if (pv === "semana") {
                    const monthKey = format(col.dias[0], "yyyy-MM");
                    const isCollapsed = collapsedMonths.includes(monthKey);
                    const group = monthGroups.find(g => g.key === monthKey)!;
                    if (isCollapsed) {
                      if (group.indices[0] !== i) return null;
                      return <th key={i} colSpan={group.indices.length} className="px-1.5 py-3 text-center min-w-[90px] text-[10px] font-normal text-[#aaa] italic border-l border-[#e8e8e8]">resumen</th>;
                    }
                  }
                  return (
                    <th key={i} className="px-1.5 py-3 font-semibold text-center min-w-[90px]">
                      <div className="text-[11px] font-bold text-[#333]">{col.label}</div>
                      <div className="text-[10px] font-normal text-[#888]">{col.sublabel}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {[
                { tipo: "proyecto",      label: "Proyectos",              color: "#4a90e2" },
                { tipo: "propuesta",     label: "Propuestas comerciales", color: "#9b59b6" },
                { tipo: "posibles_proyectos", label: "Posibles proyectos", color: "#f5a623" },
                { tipo: "ayuda_interna", label: "Desarrollo interno",          color: "#27ae60" },
              ].flatMap(({ tipo, label, color: secColor }) => {
                const q = searchTerm.toLowerCase().trim();
                const lista = filasProyecto.filter((f) => {
                  if (f.tipo !== tipo) return false;
                  if (!q) return true;
                  if (f.engagement_nombre.toLowerCase().includes(q)) return true;
                  if (f.cliente.toLowerCase().includes(q)) return true;
                  return false;
                });
                if (lista.length === 0) return [];
                const filaSeccion = (
                  <tr key={`sec-${tipo}`}>
                    <td colSpan={columnas.length + 2} className="px-4 pt-4 pb-1 bg-white sticky left-0">
                      <div className="flex items-center gap-2">
                        <div className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: secColor }} />
                        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: secColor }}>{label}</span>
                        <span className="text-[10px] text-gray-300">{lista.length}</span>
                        <div className="flex-1 h-0.5 rounded-full" style={{ background: secColor, opacity: 0.35 }} />
                      </div>
                    </td>
                  </tr>
                );
                const filasEng = lista.map((fila) => (
                  <tr key={fila.engagement_id} className="border-b border-[#f5f5f5]">
                    <td className="px-4 py-2 font-medium sticky left-0 bg-white z-10">
                      <div className="flex items-center gap-1">
                        <span className="truncate block max-w-[180px] text-sm">{fila.engagement_nombre}</span>
                        {fila.tipo === "proyecto" && (
                          <button
                            onClick={() => moverAPosibleProyecto(fila)}
                            title="Mover a Posible Proyecto"
                            className="p-0.5 rounded hover:bg-amber-50 text-gray-300 hover:text-amber-500 flex-shrink-0">
                            <Undo2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[#888] text-xs truncate max-w-[120px]">{fila.cliente}</td>
                    {columnas.map((col, ci) => {
                      // Mes colapsado (solo semana)
                      if (pv === "semana") {
                        const monthKey = format(col.dias[0], "yyyy-MM");
                        const isCollapsed = collapsedMonths.includes(monthKey);
                        if (isCollapsed) {
                          const group = monthGroups.find(g => g.key === monthKey)!;
                          if (group.indices[0] !== ci) return null;
                          const allDias = getMonthDias(ci);
                          const cobAgg = avgCoberturaCol(fila, allDias);
                          const { bg, text } = colorCobertura(cobAgg);
                          const esCriticoEng = allDias.some(d => diasCriticosEng.has(`${fila.engagement_id}|${format(d, "yyyy-MM-dd")}`));
                          return (
                            <td key={ci} colSpan={group.indices.length} className="px-1.5 py-2">
                              <CeldaAgregada bg={bg} text={text} label={cobAgg < 0 ? "—" : `${Math.round(cobAgg)}%`} critico={esCriticoEng} />
                            </td>
                          );
                        }
                      }
                      if (pv === "dia") {
                        const dia = col.dias[0];
                        const diaStr = format(dia, "yyyy-MM-dd");
                        const datos = fila.dias[diaStr] ?? { requerido: 0, asignado: 0, asignadoPlan: 0, cobertura: -1 };
                        const { bg, text } = colorCobertura(datos.cobertura);
                        const isOpen = popover?.tipo === "proyecto" && (popover as PopoverProyectoState).engagementId === fila.engagement_id && (popover as PopoverProyectoState).diaStr === diaStr;
                        const esCriticoEng = datos.cobertura >= 0 && diasCriticosEng.has(`${fila.engagement_id}|${diaStr}`);
                        return (
                          <td key={diaStr} className="px-1.5 py-2">
                            <div className={`relative ${isOpen ? "z-30" : ""}`}>
                              <Celda bg={bg} text={text} label={datos.cobertura < 0 ? "—" : `${Math.round(datos.cobertura)}%`} critico={esCriticoEng} isOpen={isOpen} onClick={(e) => handleProyectoClick(e, fila, dia, datos.cobertura)} />
                            </div>
                          </td>
                        );
                      }
                      const cobAgg = avgCoberturaCol(fila, col.dias);
                      const { bg, text } = colorCobertura(cobAgg);
                      const esCriticoEng = col.dias.some((d) => diasCriticosEng.has(`${fila.engagement_id}|${format(d, "yyyy-MM-dd")}`));
                      return (
                        <td key={ci} className="px-1.5 py-2">
                          <CeldaAgregada bg={bg} text={text} label={cobAgg < 0 ? "—" : `${Math.round(cobAgg)}%`} critico={esCriticoEng} />
                        </td>
                      );
                    })}
                  </tr>
                ));
                return [filaSeccion, ...filasEng];
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-3 text-xs text-[#aaa]">
        {pv !== "dia" ? "Promedio de cobertura por período (días hábiles)." : planId ? "Vista de plan: cobertura con asignaciones reales + propuestas en este plan." : "Vista real: cobertura solo con asignaciones aprobadas."}
      </p>
      {popover?.tipo === "proyecto" && (
        <ProyectoPopover state={popover as PopoverProyectoState} planId={planId} onClose={() => setPopover(null)} />
      )}
    </div>
  );
}
