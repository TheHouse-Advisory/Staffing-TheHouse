"use client";

import { useEffect, useMemo, useState } from "react";
import { format, isWeekend } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, ChevronDown, Trash2 } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { expandirRango } from "@/lib/queries/ausencias";
import { calculateBusinessDays } from "@/lib/utils/date-utils";
import type { AsignacionConEngagement } from "@/lib/types/database";

// ── Días hábiles ──────────────────────────────────────────────
function diasHabiles(desde: string, hasta: string): number {
  if (desde > hasta) return 0;
  return expandirRango(desde, hasta).length;
}
function calcDias(fechaInicio: string, fechaFin: string | null) {
  const hoy = new Date().toISOString().split("T")[0];
  if (fechaInicio > hoy) {
    return { dias: diasHabiles(hoy, fechaInicio) - 1, esFuturo: true };
  }
  const fin = fechaFin && fechaFin < hoy ? fechaFin : hoy;
  return { dias: diasHabiles(fechaInicio, fin), esFuturo: false };
}

// ── Tipos ─────────────────────────────────────────────────────
type PeriodoVista = "dia" | "semana" | "mes";

interface AsignacionRow {
  id: string;
  engagementNombre: string;
  engagementCliente: string;
  engagementIndustria: string;
  fechaInicio: string;
  fechaFin: string | null;
  pct: number;
  dias: number;
  esFuturo: boolean;
  diasRestantes: number | null;
}

interface Props {
  personaId: string;
  compact?: boolean;
  ocultarCarga?: boolean;
}

// ── Helpers de ventana temporal ───────────────────────────────
interface Columna {
  label: string;       // etiqueta principal
  sublabel?: string;   // etiqueta secundaria (día de semana en vista día)
  startMs: number;
  esFinDeSemana?: boolean;
}

/** Lunes de la semana actual */
function getLunes(): Date {
  const hoy = new Date();
  const dow = hoy.getDay();
  const d = new Date(hoy);
  d.setDate(hoy.getDate() - (dow === 0 ? 6 : dow - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

// Columnas y ventana según vista + offset de página
function buildVentana(pv: PeriodoVista, offset: number) {
  if (pv === "dia") {
    // 14 días por página (2 semanas)
    const base = getLunes();
    const windowStart = new Date(base);
    windowStart.setDate(base.getDate() + offset * 14);
    const windowEnd = new Date(windowStart);
    windowEnd.setDate(windowStart.getDate() + 14);

    const cols: Columna[] = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(windowStart);
      d.setDate(windowStart.getDate() + i);
      return {
        label:    format(d, "d/M"),
        sublabel: format(d, "EEE", { locale: es }),
        startMs:  d.getTime(),
        esFinDeSemana: isWeekend(d),
      };
    });
    return { cols, windowStart, windowEnd };
  }

  if (pv === "semana") {
    // 8 semanas por página
    const base = getLunes();
    const windowStart = new Date(base);
    windowStart.setDate(base.getDate() + offset * 8 * 7);
    const windowEnd = new Date(windowStart);
    windowEnd.setDate(windowStart.getDate() + 8 * 7);

    const cols: Columna[] = Array.from({ length: 8 }, (_, i) => {
      const d = new Date(windowStart);
      d.setDate(windowStart.getDate() + i * 7);
      return { label: format(d, "d MMM", { locale: es }), startMs: d.getTime() };
    });
    return { cols, windowStart, windowEnd };
  }

  // mes: 6 meses por página
  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth() + offset * 6, 1);
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(windowStart);
  windowEnd.setMonth(windowStart.getMonth() + 6);

  const cols: Columna[] = [];
  const cur = new Date(windowStart);
  while (cur < windowEnd) {
    cols.push({
      label:    format(cur, "MMM", { locale: es }),
      sublabel: format(cur, "yyyy"),
      startMs:  cur.getTime(),
    });
    cur.setMonth(cur.getMonth() + 1);
  }
  return { cols, windowStart, windowEnd };
}

// ── Colores ───────────────────────────────────────────────────
function barColor(pct: number): string {
  if (pct >= 100) return "#ef4444";
  if (pct >= 80)  return "#f59e0b";
  if (pct >= 50)  return "#6366f1";
  return "#4a90e2";
}
function pctBadgeStyle(pct: number): React.CSSProperties {
  if (pct >= 100) return { background: "#ffd4d4", color: "#c02020" };
  if (pct >= 50)  return { background: "#fff4d4", color: "#8a6200" };
  return { background: "#dbeafe", color: "#1d4ed8" };
}

const VISTAS: { id: PeriodoVista; label: string }[] = [
  { id: "dia",    label: "Día"    },
  { id: "semana", label: "Semana" },
  { id: "mes",    label: "Mes"    },
];

// ── Componente ────────────────────────────────────────────────
export function ProyectosPersonaDetalle({ personaId, compact = false, ocultarCarga = false }: Props) {
  const [asignaciones, setAsignaciones] = useState<AsignacionRow[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [pv,           setPv]           = useState<PeriodoVista>("semana");
  const [offset,       setOffset]       = useState(0);

  // Reset offset al cambiar de vista
  function cambiarVista(v: PeriodoVista) { setPv(v); setOffset(0); }

  useEffect(() => {
    async function load() {
      setLoading(true);
      const sb = createAnyClient();
      const hoy = new Date().toISOString().split("T")[0];
      // !inner + filtro por estado/is_deleted del engagement: descarta asignaciones "fantasma"
      // de engagements borrados, en papelera o no activos
      const { data } = await sb
        .from("asignacion")
        .select("id, fecha_inicio, fecha_fin, pct_dedicacion, engagement:engagement_id!inner(id, nombre, cliente, industria:industria_id(nombre), estado, is_deleted, tipo)")
        .eq("persona_id", personaId)
        .eq("estado", "activa")
        .eq("engagement.estado", "activo")
        .eq("engagement.is_deleted", false)
        .neq("engagement.tipo", "posibles_proyectos")
        .or(`fecha_fin.gte.${hoy},fecha_fin.is.null`) // sin fecha_fin = en curso, no debe excluirse
        .order("fecha_inicio");

      setAsignaciones(
        ((data ?? []) as AsignacionConEngagement[]).map((a) => {
          const { dias, esFuturo } = calcDias(a.fecha_inicio, a.fecha_fin);
          const diasRestantes = a.fecha_fin && !esFuturo
            ? diasHabiles(hoy, a.fecha_fin)
            : null;
          return {
            id: a.id,
            engagementNombre:    a.engagement?.nombre  ?? "—",
            engagementCliente:   a.engagement?.cliente ?? "",
            engagementIndustria: a.engagement?.industria?.nombre ?? "",
            fechaInicio: a.fecha_inicio,
            fechaFin:    a.fecha_fin,
            pct:         Number(a.pct_dedicacion),
            dias,
            esFuturo,
            diasRestantes,
          };
        })
      );
      setLoading(false);
    }
    load();
  }, [personaId]);

  if (loading) return <p className="text-xs text-gray-300">Cargando proyectos...</p>;
  if (asignaciones.length === 0)
    return <p className="text-xs text-gray-300 italic">Sin proyectos activos o futuros.</p>;

  // ── Modo compacto ────────────────────────────────────────────
  if (compact) {
    return (
      <div className="space-y-1.5">
        {asignaciones.map((a) => (
          <div key={a.id} className="px-2 py-1 rounded-lg bg-amber-50 border border-amber-100">
            {/* Fila única: nombre+cliente · fecha */}
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0 flex items-baseline gap-1.5">
                {!ocultarCarga && (
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={pctBadgeStyle(a.pct)}>
                    {a.pct}%
                  </span>
                )}
                <span className="text-[11px] font-semibold text-slate-800 truncate leading-tight">{a.engagementNombre}</span>
                {a.engagementCliente && <span className="text-[9px] text-gray-400 truncate">{a.engagementCliente}</span>}
              </div>
              <span className="text-[9px] text-slate-400 flex-shrink-0">
                {a.esFuturo ? "Inicia:" : "Inicio:"} {format(new Date(a.fechaInicio + "T00:00:00"), "d MMM yyyy", { locale: es })}
              </span>
            </div>
            {/* Fila días: en línea horizontal */}
            {!ocultarCarga && (
            <div className="flex justify-end gap-2 mt-0.5">
              {a.esFuturo ? (
                <span className="text-[9px] font-semibold" style={{ color: "#15803d" }}>Inicia en {a.dias}d</span>
              ) : (
                <>
                  <span className="text-[9px] font-semibold" style={{ color: "#1d4ed8" }}>{a.dias}d en el proyecto</span>
                  {a.diasRestantes !== null && (
                    <><span className="text-[9px] text-gray-300">·</span><span className="text-[9px] font-semibold" style={{ color: "#92400e" }}>{a.diasRestantes}d restantes</span></>
                  )}
                </>
              )}
            </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // ── Modo completo: Mini-Gantt ─────────────────────────────────
  // Memoizado: solo recalcula al cambiar vista/página, no en cada re-render del padre.
  const { cols, windowStart, windowEnd } = useMemo(() => buildVentana(pv, offset), [pv, offset]);
  const windowMs = windowEnd.getTime() - windowStart.getTime();

  // Marcador de hoy
  const hoyMs = new Date().setHours(0, 0, 0, 0);
  const todayPct = ((hoyMs - windowStart.getTime()) / windowMs) * 100;
  const showToday = todayPct >= 0 && todayPct <= 100;

  // Posicionamiento porcentual de cada barra
  const rows = useMemo(() => asignaciones.map((a) => {
    const iniMs  = new Date(a.fechaInicio + "T00:00:00").getTime();
    const finRaw = a.fechaFin
      ? new Date(a.fechaFin + "T00:00:00").getTime() + 86_400_000
      : windowEnd.getTime();
    const finMs  = Math.min(finRaw, windowEnd.getTime());
    const visible = finMs > windowStart.getTime() && iniMs < windowEnd.getTime();

    const left  = Math.max(0, ((iniMs - windowStart.getTime()) / windowMs) * 100);
    const right = Math.min(100, ((finMs - windowStart.getTime()) / windowMs) * 100);
    const width = Math.max(0.5, right - left);
    return { ...a, visible, left, width, iniMs, finMs };
  }), [asignaciones, windowStart, windowEnd, windowMs]);

  // Sobreasignación por columna
  const pctPorCol = useMemo(() => cols.map((col, i) => {
    const colEnd = i < cols.length - 1 ? cols[i + 1].startMs : windowEnd.getTime();
    return rows.reduce((sum, r) => {
      if (!r.visible) return sum;
      return sum + (r.iniMs < colEnd && r.finMs > col.startMs ? r.pct : 0);
    }, 0);
  }), [cols, rows, windowEnd]);

  const INFO_W = 156;

  return (
    <div className="select-none">
      {/* ── Controles: toggle + navegación ── */}
      <div className="flex items-center justify-between mb-3 gap-2">
        {/* Toggle día/semana/mes */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
          {VISTAS.map((v) => (
            <button
              key={v.id}
              onClick={() => cambiarVista(v.id)}
              className={`px-3 py-1 rounded-md text-[10px] font-semibold transition-all ${
                pv === v.id
                  ? "bg-white text-[#1a1a2e] shadow-sm"
                  : "text-slate-400 hover:text-slate-600"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        {/* Navegación temporal */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setOffset((o) => o - 1)}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            title="Período anterior"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          {offset !== 0 && (
            <button
              onClick={() => setOffset(0)}
              className="px-2 py-0.5 rounded-md text-[9px] font-semibold text-[#4a90e2] hover:bg-[#eaf4ff] transition-colors"
            >
              Hoy
            </button>
          )}
          <button
            onClick={() => setOffset((o) => o + 1)}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            title="Período siguiente"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Header: etiquetas de columnas ── */}
      <div className="flex mb-1" style={{ paddingLeft: INFO_W }}>
        <div className="flex-1 flex">
          {cols.map((col, i) => {
            const over = pctPorCol[i] > 100;
            return (
              <div
                key={i}
                title={over ? `Sobreasignado: ${Math.round(pctPorCol[i])}%` : undefined}
                className={`flex-1 text-center pb-1 border-b min-w-0 overflow-hidden ${
                  over
                    ? "border-red-300"
                    : col.esFinDeSemana
                    ? "border-slate-50"
                    : "border-slate-100"
                }`}
              >
                {col.sublabel && (
                  <span className={`block text-[6px] leading-none mb-0.5 ${
                    col.esFinDeSemana ? "text-slate-200" : "text-slate-300"
                  }`}>
                    {col.sublabel}
                  </span>
                )}
                <span className={`text-[7px] font-semibold leading-none ${
                  over
                    ? "text-red-400"
                    : col.esFinDeSemana
                    ? "text-slate-200"
                    : "text-slate-400"
                }`}>
                  {col.label}
                </span>
                {/* Indicador sobreasignación: borde inferior coloreado, sin símbolo */}
                {over && (
                  <div className="h-0.5 bg-red-300 mt-0.5 rounded-full" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Filas de proyectos ── */}
      <div className="space-y-1.5">
        {rows.map((a) => (
          <div key={a.id} className="flex items-center">
            {/* Panel izquierdo */}
            <div className="flex-shrink-0 pr-3" style={{ width: INFO_W }}>
              <p className="text-[11px] font-semibold text-slate-700 truncate leading-tight">{a.engagementNombre}</p>
              {a.engagementCliente && (
                <p className="text-[9px] text-slate-400 truncate">{a.engagementCliente}</p>
              )}
              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                {!ocultarCarga && (
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full" style={pctBadgeStyle(a.pct)}>
                  {a.pct}%
                </span>
                )}
                <span className="text-[8px] text-slate-400">
                  {format(new Date(a.fechaInicio + "T00:00:00"), "d MMM", { locale: es })}
                  {a.fechaFin ? ` → ${format(new Date(a.fechaFin + "T00:00:00"), "d MMM", { locale: es })}` : ""}
                </span>
              </div>
            </div>

            {/* Panel gantt */}
            <div className="flex-1 relative h-7">
              {/* Fondo de columnas */}
              {cols.map((col, i) => {
                const colW = i < cols.length - 1
                  ? ((cols[i + 1].startMs - col.startMs) / windowMs) * 100
                  : ((windowEnd.getTime() - col.startMs) / windowMs) * 100;
                const colL = ((col.startMs - windowStart.getTime()) / windowMs) * 100;
                return (
                  <div
                    key={i}
                    className={`absolute inset-y-0 border-l ${
                      col.esFinDeSemana
                        ? "border-slate-50 bg-slate-50/70"
                        : pctPorCol[i] > 100
                        ? "border-red-100"
                        : "border-slate-100"
                    }`}
                    style={{ left: `${colL}%`, width: `${colW}%` }}
                  />
                );
              })}

              {/* Marcador de hoy */}
              {showToday && (
                <div
                  className="absolute inset-y-0 w-px bg-[#4a90e2] z-10"
                  style={{ left: `${todayPct}%` }}
                />
              )}

              {/* Barra */}
              {a.visible && (
                <div
                  className="absolute top-1 bottom-1 rounded flex items-center overflow-hidden z-20"
                  style={{
                    left:       `${a.left}%`,
                    width:      `${a.width}%`,
                    background: barColor(a.pct),
                    opacity:    a.esFuturo ? 0.55 : 1,
                    minWidth:   4,
                  }}
                  title={`${a.engagementNombre} · ${a.pct}%${a.esFuturo ? " (futuro)" : ""}`}
                >
                  {!ocultarCarga && (
                  <span className="text-[7px] font-bold text-white/90 px-1.5 truncate leading-none">
                    {a.pct}%
                  </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Leyenda ── */}
      <div className="flex items-center gap-3 mt-3 pt-2 border-t border-slate-100">
        <div className="flex items-center gap-1">
          <div className="w-3 h-2 rounded-sm bg-[#4a90e2]" />
          <span className="text-[8px] text-slate-400">Activo</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-2 rounded-sm bg-[#4a90e2] opacity-55" />
          <span className="text-[8px] text-slate-400">Futuro</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-2 rounded-sm bg-[#ef4444]" />
          <span className="text-[8px] text-slate-400">≥100%</span>
        </div>
        {showToday && (
          <div className="flex items-center gap-1 ml-auto">
            <div className="w-px h-3 bg-[#4a90e2]" />
            <span className="text-[8px] text-slate-400">Hoy</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Historial de proyectos: acordeón por año ────────────────────
interface HistorialEngRow {
  id: string;            // id de la asignación (key de fila)
  engagementId: string;
  nombre: string;
  cliente: string;
  cargo: string;
  fechaInicio: string;
  fechaFin: string | null;  // null = sigue activo (va a "Actuales")
  diasHabiles: number;
  esActual: boolean;
}

interface HistorialAccordionProps {
  personaId: string;
  personaNombreCompleto: string;
  rolActual: string | null;
  onVerDetalle: (engagementId: string) => void;
}

/**
 * Consolida en una sola tarjeta las sub-asignaciones del mismo engagement (mismo nombre,
 * p.ej. splits semanales o duplicados de "Propuesta Comercial"/"Frente comercial"):
 * toma la fecha_inicio más antigua, la fecha_fin más lejana (null = en curso, domina)
 * y suma los días hábiles trabajados de todas.
 */
function consolidarPorEngagement(items: HistorialEngRow[]): HistorialEngRow[] {
  const porNombre = new Map<string, HistorialEngRow>();
  for (const item of items) {
    const key = item.nombre.trim().toLowerCase();
    const existente = porNombre.get(key);
    if (!existente) {
      porNombre.set(key, { ...item });
      continue;
    }
    existente.fechaInicio = item.fechaInicio < existente.fechaInicio ? item.fechaInicio : existente.fechaInicio;
    existente.fechaFin =
      existente.fechaFin === null || item.fechaFin === null
        ? null
        : item.fechaFin > existente.fechaFin ? item.fechaFin : existente.fechaFin;
    existente.diasHabiles += item.diasHabiles;
    existente.esActual = existente.esActual || item.esActual;
  }
  return [...porNombre.values()];
}

/** Roles sin visibilidad de días/carga (mismos que en ProyectosPersonaDetalle) */
function rolSinDias(rol: string | null) {
  return rol === "GyD" || rol === "AySr" || rol === "planificador";
}
function rolSinBorrar(rol: string | null) {
  return rolSinDias(rol) || rol === "Desarrollo";
}

export function HistorialProyectosAccordion({ personaId, personaNombreCompleto, rolActual, onVerDetalle }: HistorialAccordionProps) {
  const [rows,       setRows]       = useState<HistorialEngRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [openYear,   setOpenYear]   = useState<string | null>(null);
  const [deletingEng, setDeletingEng] = useState<{ engagementId: string; nombre: string } | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const sb = createAnyClient();
      const hoy = new Date().toISOString().slice(0, 10);
      // TODAS las asignaciones (activas y finalizadas) — se clasifican en "Actuales" vs
      // años históricos en el render. !inner + exclusión de "posibles_proyectos": no
      // deben contarse como historial real.
      const { data } = await sb
        .from("asignacion")
        .select("id, fecha_inicio, fecha_fin, cargo_al_momento, engagement:engagement_id!inner(id, nombre, cliente, tipo, is_deleted)")
        .eq("persona_id", personaId)
        .neq("engagement.tipo", "posibles_proyectos")
        .order("fecha_inicio", { ascending: false });

      setRows(
        ((data ?? []) as AsignacionConEngagement[]).map((r) => {
          const fechaFin = r.fecha_fin;
          // "Actuales": en curso hoy y el engagement no está en papelera
          const esActual = r.fecha_inicio <= hoy && (fechaFin === null || fechaFin >= hoy) && !r.engagement?.is_deleted;
          return {
            id:           r.id,
            engagementId: r.engagement?.id ?? "",
            nombre:       r.engagement?.nombre  ?? "—",
            cliente:      r.engagement?.cliente ?? "",
            cargo:        r.cargo_al_momento ?? "",
            fechaInicio:  r.fecha_inicio,
            fechaFin,
            diasHabiles:  calculateBusinessDays(r.fecha_inicio, fechaFin ?? hoy),
            esActual,
          };
        })
      );
      setLoading(false);
    }
    load();
  }, [personaId]);

  // "Actuales" (en curso hoy) primero; el resto agrupado por año de fecha_inicio, años desc.
  const ACTUALES = "Actuales";
  const porAnio = new Map<string, HistorialEngRow[]>();
  rows.forEach((r) => {
    const grupo = r.esActual ? ACTUALES : r.fechaInicio.slice(0, 4);
    (porAnio.get(grupo) ?? porAnio.set(grupo, []).get(grupo)!).push(r);
  });
  const aniosHistoricos = [...porAnio.keys()].filter((g) => g !== ACTUALES).sort((a, b) => b.localeCompare(a));
  const anios = porAnio.has(ACTUALES) ? [ACTUALES, ...aniosHistoricos] : aniosHistoricos;
  // Consolida duplicados (mismo engagement_id/nombre) dentro de cada grupo antes de ordenar
  anios.forEach((a) => porAnio.set(a, consolidarPorEngagement(porAnio.get(a)!).sort((x, y) => x.fechaInicio.localeCompare(y.fechaInicio))));

  async function confirmarEliminar() {
    if (!deletingEng) return;
    const { engagementId } = deletingEng;
    setRows((prev) => prev.filter((r) => r.engagementId !== engagementId)); // optimista
    setDeletingEng(null);
    const sb = createAnyClient();
    await sb.from("asignacion").delete().eq("persona_id", personaId).eq("engagement_id", engagementId);
  }

  if (loading) return <p className="text-xs text-gray-300">Cargando historial...</p>;
  if (anios.length === 0) return <p className="text-sm text-[#ccc] italic">Sin proyectos registrados.</p>;

  return (
    <div>
      <div className="divide-y divide-[#f0f0f0]">
        {anios.map((anio) => {
          const items = porAnio.get(anio)!;
          const abierto = openYear === anio;
          return (
            <div key={anio}>
              <button
                onClick={() => setOpenYear(abierto ? null : anio)}
                className="w-full flex items-center justify-between py-3 first:pt-0 text-left"
              >
                <span className="text-sm font-semibold text-[#1a1a2e]">{anio}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#888]">{items.length} {items.length === 1 ? "proyecto" : "proyectos"}</span>
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${abierto ? "rotate-180" : ""}`} />
                </div>
              </button>

              {abierto && (
                <div className="pb-3 space-y-2">
                  {items.map((h) => (
                    <div key={h.id} className="flex items-center justify-between gap-4 p-3 bg-gray-50 border border-gray-100 rounded-lg group">
                      {/* Columna izquierda: info del engagement */}
                      <div className="flex-1 min-w-0">
                        <button
                          onClick={() => onVerDetalle(h.engagementId)}
                          className="block w-full font-medium text-gray-900 truncate text-left hover:underline hover:text-[#4a90e2] transition-colors"
                        >
                          {h.nombre}
                        </button>
                        {h.cargo && <p className="text-xs text-gray-500 mt-0.5">{h.cargo}</p>}
                      </div>

                      {/* Columna derecha: metadatos y acciones — shrink-0 evita que se solape */}
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-gray-500 whitespace-nowrap">
                          {format(new Date(h.fechaInicio + "T00:00:00"), "d MMM yyyy", { locale: es })}
                          {" al "}
                          {h.fechaFin ? format(new Date(h.fechaFin + "T00:00:00"), "d MMM yyyy", { locale: es }) : "Presente"}
                        </span>
                        {!rolSinDias(rolActual) && (
                          <span className="px-2.5 py-1 text-xs font-semibold text-blue-600 bg-blue-50 rounded-md whitespace-nowrap">
                            {h.diasHabiles} {h.diasHabiles === 1 ? "día hábil trabajado" : "días hábiles trabajados"}
                          </span>
                        )}
                        {!rolSinBorrar(rolActual) && (
                          <button
                            onClick={() => setDeletingEng({ engagementId: h.engagementId, nombre: h.nombre })}
                            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500"
                            title="Eliminar del historial"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Pop-up de confirmación de borrado ── */}
      {deletingEng && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-100 p-6 w-full max-w-sm mx-4">
            <p className="text-[14px] font-semibold text-[#1a1a2e] mb-2">¿Eliminar proyecto del historial?</p>
            <p className="text-[12px] text-amber-600 font-medium leading-relaxed mb-3">
              ⚠️ Atención: Esta acción eliminará permanentemente el registro histórico de staffing. ¿Deseas continuar?
            </p>
            <p className="text-[12px] text-slate-500 leading-relaxed mb-5">
              Se eliminarán todas las asignaciones de <span className="font-semibold text-slate-700">{personaNombreCompleto}</span> en <span className="font-semibold text-slate-700">{deletingEng.nombre}</span>. Esta operación no se puede deshacer.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeletingEng(null)}
                className="px-4 py-2 text-[12px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarEliminar}
                className="px-4 py-2 text-[12px] font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
