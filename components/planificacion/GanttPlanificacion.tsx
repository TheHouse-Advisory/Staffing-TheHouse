"use client";

import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Save,
  Loader2,
  X,
  Info,
  Zap,
  CalendarX,
  UserMinus,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  fetchEngagementsConReqs,
  fetchPersonasFit,
  today,
  type EngagementConReqs,
  type ReqConEstado,
  type AsignacionActiva,
  type AsignacionDetalle,
  type PersonaFit,
  type FitNivel,
} from "@/lib/queries/planificacion";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
//  Tipos locales
// ─────────────────────────────────────────────────────────────

interface Tentativa {
  id: string;               // uuid local
  requerimiento_id: string;
  persona_id: string;
  nombre: string;
  apellido: string;
  cargo: string;
  pct: number;
  fecha_inicio: string;     // siempre "hoy"
  fecha_fin: string;        // req.fecha_fin
}

/** Terminación propuesta — solo existe en estado local hasta que se guarda el plan */
interface TerminacionTentativa {
  id: string;               // uuid local
  asignacion_id: string;    // asignacion real a terminar
  requerimiento_id: string;
  engagement_id: string;
  persona_id: string;
  persona_nombre: string;
  persona_apellido: string;
  pct_liberado: number;
  fecha_fin: string;        // fecha de término propuesta
}

// ─────────────────────────────────────────────────────────────
//  Utilidades
// ─────────────────────────────────────────────────────────────

function nivelColor(nivel: FitNivel) {
  switch (nivel) {
    case "excelente":   return { bg: "#dcf5e7", text: "#1a7a45", border: "#b2dfc8" };
    case "bueno":       return { bg: "#e8f4ff", text: "#1a5276", border: "#aacfee" };
    case "advertencia": return { bg: "#fff4d4", text: "#8a6200", border: "#f0d980" };
    case "riesgo":      return { bg: "#ffd4d4", text: "#c02020", border: "#f0aaaa" };
  }
}

function nivelEmoji(nivel: FitNivel) {
  switch (nivel) {
    case "excelente":   return "😊";
    case "bueno":       return "🙂";
    case "advertencia": return "😐";
    case "riesgo":      return "😟";
  }
}

function iniciales(nombre: string, apellido: string, custom?: string | null) {
  if (custom?.trim()) return custom.trim().toUpperCase().slice(0, 3);
  return `${nombre[0] ?? ""}${apellido[0] ?? ""}`.toUpperCase();
}

function avatarColor(personaId: string) {
  const palette = ["#4a90e2","#e2844a","#4ac27a","#9b4ae2","#e24a7a","#4ae2d5","#e2c24a","#7a4ae2"];
  let hash = 0;
  for (let i = 0; i < personaId.length; i++) hash = personaId.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

function formatFecha(f: string | null) {
  if (!f) return "∞";
  try { return format(new Date(f + "T00:00:00"), "d MMM yy", { locale: es }); }
  catch { return f; }
}

function formatFechaLarga(f: string) {
  try { return format(new Date(f + "T00:00:00"), "d 'de' MMMM yyyy", { locale: es }); }
  catch { return f; }
}

// ─────────────────────────────────────────────────────────────
//  Avatar
// ─────────────────────────────────────────────────────────────

function Avatar({
  personaId, nombre, apellido, inicialesCustom, size = "md", alerta = false, title,
}: {
  personaId: string; nombre: string; apellido: string; inicialesCustom?: string | null;
  size?: "sm" | "md"; alerta?: boolean; title?: string;
}) {
  const color = avatarColor(personaId);
  const dim = size === "sm" ? "w-7 h-7 text-[10px]" : "w-8 h-8 text-xs";
  return (
    <div className="relative flex-shrink-0" title={title ?? `${nombre} ${apellido}`}>
      <div
        className={cn(dim, "rounded-full flex items-center justify-center font-bold text-white select-none")}
        style={{ background: color }}
      >
        {iniciales(nombre, apellido, inicialesCustom)}
      </div>
      {alerta && (
        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-amber-400 rounded-full flex items-center justify-center">
          <AlertTriangle className="w-2 h-2 text-white" />
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Fila de requerimiento
// ─────────────────────────────────────────────────────────────

function FilaRequerimiento({
  req,
  tentativas,
  terminaciones,
  isSelected,
  onSelect,
  onRemoveTentativa,
  onProponerLiberar,
  onDeshacerTerminar,
}: {
  req: ReqConEstado;
  tentativas: Tentativa[];
  terminaciones: TerminacionTentativa[];
  isSelected: boolean;
  onSelect: () => void;
  onRemoveTentativa: (tentativaId: string) => void;
  onProponerLiberar: (asig: AsignacionActiva) => void;
  onDeshacerTerminar: (terminacionId: string) => void;
}) {
  const tieneTentativa = tentativas.some((t) => t.requerimiento_id === req.id);
  const hoy = today();

  // Asignaciones activas desde hoy
  const asigActivas = req.asignaciones.filter(
    (a) => a.fecha_fin === null || a.fecha_fin >= hoy
  );

  // Si TODAS las asignaciones activas están propuestas para liberación,
  // el req se trata como sin cubrir (clickeable para buscar reemplazo)
  const todasLiberadas =
    asigActivas.length > 0 &&
    asigActivas.every((a) => terminaciones.some((t) => t.asignacion_id === a.asignacion_id));

  const cubierto = req.cubierto_desde_hoy && !todasLiberadas;
  const clickeable = !cubierto;  // abre el fit panel para buscar candidatos

  return (
    <div
      onClick={clickeable ? onSelect : undefined}
      className={cn(
        "group px-4 py-3 border-b border-[#f5f5f5] transition-all",
        clickeable
          ? isSelected
            ? "bg-[#eaf4ff] cursor-pointer"
            : "hover:bg-[#f9f9f9] cursor-pointer"
          : "cursor-default opacity-80"
      )}
    >
      {/* Encabezado de la fila */}
      <div className="flex items-center gap-3">
        {/* Indicador */}
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: cubierto ? "#27ae60" : "#e2844a" }}
        />

        {/* Cargo + % + fase */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-[#1a1a1a]">
              {req.cargo_requerido ?? "Sin cargo"}
            </span>
            <span className="text-[10px] bg-[#f0f0f0] text-[#666] px-1.5 py-0.5 rounded-full font-medium">
              {req.pct_dedicacion}%
            </span>
            {req.fase_nombre && (
              <span className="text-[10px] text-[#aaa]">{req.fase_nombre}</span>
            )}
          </div>
          <p className="text-[10px] text-[#aaa] mt-0.5">
            {formatFecha(req.fecha_inicio)} → {formatFecha(req.fecha_fin)}
          </p>
          {req.dias_criticos.length > 0 && (
            <div className="flex items-center gap-1 mt-1">
              <Zap className="w-2.5 h-2.5 text-orange-500 flex-shrink-0" />
              <span className="text-[10px] font-medium text-orange-600">
                Contempla {req.dias_criticos.length} día{req.dias_criticos.length !== 1 ? "s" : ""} crítico{req.dias_criticos.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>

        {/* Chevron — solo visible si es clickeable */}
        {clickeable && (
          <ChevronRight
            className={cn("w-3.5 h-3.5 flex-shrink-0 transition-colors",
              isSelected ? "text-[#4a90e2]" : "text-[#ddd]"
            )}
          />
        )}
        {/* Ícono de check si está cubierto y no es clickeable */}
        {!clickeable && (
          <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 text-[#27ae60]" />
        )}
      </div>

      {/* Asignaciones confirmadas activas */}
      {asigActivas.length > 0 && (
        <div className="mt-2 space-y-1.5 ml-5">
          {asigActivas.map((a) => {
            const terminacion = terminaciones.find((t) => t.asignacion_id === a.asignacion_id);
            const propuestaTerminar = !!terminacion;

            return (
              <div
                key={a.asignacion_id}
                className={cn(
                  "flex items-center gap-2 rounded-md px-1 py-0.5 transition-colors",
                  propuestaTerminar ? "bg-red-50" : ""
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <div className={cn("relative flex-shrink-0", propuestaTerminar && "opacity-50")}>
                  <Avatar
                    personaId={a.persona_id}
                    nombre={a.persona_nombre}
                    apellido={a.persona_apellido}
                    size="sm"
                  />
                </div>
                <div className={cn("flex-1 min-w-0", propuestaTerminar && "opacity-60")}>
                  <p className={cn("text-[11px] font-medium truncate", propuestaTerminar ? "line-through text-red-700" : "text-[#333]")}>
                    {a.persona_nombre} {a.persona_apellido}
                  </p>
                  <p className="text-[9px] text-[#aaa]">
                    {formatFecha(a.fecha_inicio)} → {formatFecha(a.fecha_fin)} · {a.pct_dedicacion}%
                    {propuestaTerminar && (
                      <span className="text-amber-600 font-medium ml-1">
                        · propuesto liberar hoy
                      </span>
                    )}
                  </p>
                </div>

                {propuestaTerminar ? (
                  /* Botón deshacer */
                  <button
                    onClick={() => onDeshacerTerminar(terminacion!.id)}
                    className="flex items-center gap-1 text-[10px] text-red-500 hover:text-red-700 px-1.5 py-0.5 rounded hover:bg-red-100 transition-colors flex-shrink-0 font-medium"
                    title="Deshacer propuesta de liberación"
                  >
                    <X className="w-3 h-3" />
                    Deshacer
                  </button>
                ) : (
                  /* Botón proponer liberación — acción directa, sin diálogo */
                  <button
                    onClick={() => onProponerLiberar(a)}
                    className="flex items-center gap-1 text-[10px] text-[#bbb] hover:text-amber-600 px-1.5 py-0.5 rounded hover:bg-amber-50 transition-colors flex-shrink-0"
                    title="Proponer liberar esta persona (en plan borrador, desde hoy)"
                  >
                    <UserMinus className="w-3 h-3" />
                    <span className="hidden group-hover:inline">Liberar</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Tentativas (propuestas locales) */}
      {tentativas
        .filter((t) => t.requerimiento_id === req.id)
        .map((t) => (
          <div
            key={t.id}
            className="mt-1.5 flex items-center gap-2 ml-5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Avatar con borde punteado = propuesto */}
            <div className="relative flex-shrink-0">
              <Avatar personaId={t.persona_id} nombre={t.nombre} apellido={t.apellido} size="sm" />
              <div className="absolute inset-0 rounded-full ring-2 ring-dashed ring-[#4a90e2] ring-offset-1 pointer-events-none" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium text-[#4a90e2] truncate">
                {t.nombre} {t.apellido}
              </p>
              <p className="text-[9px] text-[#aaa]">
                {formatFecha(t.fecha_inicio)} → {formatFecha(t.fecha_fin)} · propuesto
              </p>
            </div>
            <button
              onClick={() => onRemoveTentativa(t.id)}
              className="w-5 h-5 rounded-full bg-[#f0f0f0] hover:bg-red-100 text-[#aaa] hover:text-red-500 flex items-center justify-center transition-colors flex-shrink-0"
              title="Quitar propuesta"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

      {/* Slot vacío */}
      {!cubierto && !tieneTentativa && (
        <div className="mt-1.5 ml-5 flex items-center gap-2">
          <div className="w-7 h-7 rounded-full border-2 border-dashed border-[#f0c040] bg-[#fffbec] flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-3 h-3 text-[#e2a010]" />
          </div>
          <span className="text-[10px] text-[#e2a010]">Sin cubrir desde hoy · Haz click para buscar candidatos</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Mini Gantt de capacidad por persona
// ─────────────────────────────────────────────────────────────

const GANTT_COLORS = [
  "#94a3b8", "#64748b", "#7c9ebe", "#8b9dc7", "#a0aec0",
  "#6b7fa8", "#9badc7", "#7b8fab",
];

function barColor(idx: number): string {
  return GANTT_COLORS[idx % GANTT_COLORS.length];
}

function MiniGantt({
  req,
  asignaciones,
  asignacionIdsALiberar = [],
}: {
  req: ReqConEstado;
  asignaciones: AsignacionDetalle[];
  asignacionIdsALiberar?: string[];
}) {
  const reqStart = new Date(req.fecha_inicio + "T00:00:00").getTime();
  const reqEnd   = new Date(req.fecha_fin   + "T00:00:00").getTime();
  const totalMs  = reqEnd - reqStart;

  if (totalMs <= 0) return null;

  function posAndWidth(inicio: string, fin: string | null) {
    const s = new Date(inicio + "T00:00:00").getTime();
    const e = fin ? new Date(fin + "T00:00:00").getTime() : reqEnd;
    const clampS = Math.max(s, reqStart);
    const clampE = Math.min(e, reqEnd);
    if (clampS >= clampE) return null;
    const left  = ((clampS - reqStart) / totalMs) * 100;
    const width = ((clampE - clampS)   / totalMs) * 100;
    return { left: Math.max(0, left), width: Math.max(1, width) };
  }

  // Filtrar asignaciones que realmente se solapan con el req
  const asigSolap = asignaciones.filter((a) => {
    const s = new Date(a.fecha_inicio + "T00:00:00").getTime();
    const e = a.fecha_fin ? new Date(a.fecha_fin + "T00:00:00").getTime() : reqEnd + 1;
    return s < reqEnd && e > reqStart;
  });

  const rows: Array<{
    label: string;
    pct: number;
    inicio: string;
    fin: string | null;
    color: string;
    isProposed: boolean;
    isLiberada: boolean;
  }> = [
    // Asignaciones existentes
    ...asigSolap.map((a, i) => ({
      label: a.engagement_nombre,
      pct: a.pct_dedicacion,
      inicio: a.fecha_inicio,
      fin: a.fecha_fin,
      color: barColor(i),
      isProposed: false,
      isLiberada: asignacionIdsALiberar.includes(a.asignacion_id),
    })),
    // La propuesta actual
    {
      label: "Esta propuesta",
      pct: req.pct_dedicacion,
      inicio: req.fecha_inicio,
      fin: req.fecha_fin,
      color: "#3b82f6",
      isProposed: true,
      isLiberada: false,
    },
  ];

  return (
    <div className="mt-2 space-y-1">
      {/* Eje de tiempo */}
      <div className="flex items-center justify-between text-[9px] text-[#aaa] px-0.5 mb-0.5">
        <span>{formatFecha(req.fecha_inicio)}</span>
        <span>{formatFecha(req.fecha_fin)}</span>
      </div>

      {rows.map((row, i) => {
        const pos = posAndWidth(row.inicio, row.fin);
        if (!pos) return null;

        return (
          <div key={i} className="flex items-center gap-1.5">
            {/* Label izquierda */}
            <div
              className={cn(
                "w-[72px] text-[9px] text-right flex-shrink-0 truncate leading-tight",
                row.isLiberada && "line-through"
              )}
              style={{
                color: row.isLiberada ? "#ef4444"
                  : row.isProposed ? "#3b82f6"
                  : "#888",
              }}
              title={row.isLiberada ? `${row.label} (propuesto liberar)` : row.label}
            >
              {row.label}
            </div>

            {/* Barra posicionada en el timeline */}
            <div className="relative flex-1 h-4 bg-[#f0f0f0] rounded-sm overflow-hidden">
              <div
                className="absolute top-0 h-full rounded-sm flex items-center overflow-hidden"
                style={{
                  left:       `${pos.left}%`,
                  width:      `${pos.width}%`,
                  background: row.isLiberada ? "#fca5a5"
                    : row.isProposed ? "#3b82f6"
                    : row.color,
                  opacity: row.isLiberada ? 0.6 : row.isProposed ? 1 : 0.75,
                  border: row.isProposed ? "1px solid rgba(59,130,246,0.5)"
                    : row.isLiberada ? "1px solid rgba(239,68,68,0.4)"
                    : "none",
                }}
                title={`${row.label} · ${row.pct}%${row.isLiberada ? " (propuesto liberar)" : ""}`}
              >
                {/* Línea tachada para liberadas */}
                {row.isLiberada && (
                  <div className="absolute inset-0 flex items-center pointer-events-none">
                    <div className="w-full h-px bg-red-500 opacity-70" />
                  </div>
                )}
                <span className={cn(
                  "text-[8px] font-semibold px-1 truncate leading-none select-none relative z-10",
                  row.isLiberada ? "text-red-700" : "text-white"
                )}>
                  {row.pct}%
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Panel de fit (derecha)
// ─────────────────────────────────────────────────────────────

function FitPanel({
  req, personas, loading, onAsignar, onCerrar, asignacionIdsALiberar = [],
}: {
  req: ReqConEstado | null;
  personas: PersonaFit[];
  loading: boolean;
  onAsignar: (p: PersonaFit) => void;
  onCerrar: () => void;
  asignacionIdsALiberar?: string[];
}) {
  const hoy = today();

  if (!req) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6 text-[#aaa]">
        <div className="w-14 h-14 rounded-full bg-[#f5f5f5] flex items-center justify-center mb-3">
          <Zap className="w-6 h-6 text-[#ddd]" />
        </div>
        <p className="text-sm font-medium text-[#888]">Selecciona un requerimiento</p>
        <p className="text-xs mt-1 text-[#bbb]">Ver personas disponibles y su fit para el rol</p>
      </div>
    );
  }

  const desdeEfectivo = req.fecha_inicio > hoy ? req.fecha_inicio : hoy;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#e8e8e8] bg-[#f9f9f9] flex-shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-[#aaa] mb-0.5 truncate">
              {req.engagement_nombre} · {req.engagement_cliente}
            </p>
            <h3 className="text-sm font-bold text-[#1a1a1a]">
              {req.cargo_requerido ?? "Sin cargo"}{" "}
              <span className="font-normal text-[#888]">{req.pct_dedicacion}%</span>
            </h3>
            {/* Período efectivo a cubrir */}
            <p className="text-[10px] text-[#888] mt-1">
              <span className="font-medium text-[#555]">A cubrir:</span>{" "}
              {formatFecha(desdeEfectivo)} → {formatFecha(req.fecha_fin)}
            </p>
            {desdeEfectivo !== req.fecha_inicio && (
              <p className="text-[10px] text-[#aaa]">
                (req. comenzó {formatFecha(req.fecha_inicio)}, se asigna desde hoy)
              </p>
            )}
          </div>
          <button
            onClick={onCerrar}
            className="w-6 h-6 rounded-md flex items-center justify-center text-[#aaa] hover:text-[#555] hover:bg-[#eee] transition-colors flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Lista de personas */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-[#888]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Calculando fit...</span>
          </div>
        ) : personas.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center px-4 text-[#aaa]">
            <p className="text-sm">No hay personas con cargo <strong>"{req.cargo_requerido}"</strong></p>
            <p className="text-xs mt-1">Revisa los cargos en el catálogo de personas</p>
          </div>
        ) : (
          <div className="divide-y divide-[#f5f5f5]">
            {personas.map((p) => {
              const colors = nivelColor(p.nivel);
              const emoji  = nivelEmoji(p.nivel);
              const yaEnReq = req.asignaciones.some((a) => a.persona_id === p.persona_id);

              return (
                <div key={p.persona_id} className="px-5 py-3 hover:bg-[#fafafa] transition-colors">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-xs flex-shrink-0"
                      style={{ background: avatarColor(p.persona_id) }}
                    >
                      {iniciales(p.nombre, p.apellido, p.iniciales)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-semibold text-[#1a1a1a] truncate">
                          {p.nombre} {p.apellido}
                        </p>
                        <span className="text-sm">{emoji}</span>
                      </div>
                      <p className="text-[10px] text-[#888]">{p.cargo_actual}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <span
                        className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: colors.bg, color: colors.text }}
                      >
                        {p.pct_si_asigna}%
                      </span>
                      <button
                        onClick={() => onAsignar(p)}
                        className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-[#1a1a1a] text-white hover:bg-[#333] transition-colors"
                      >
                        {yaEnReq ? "Reemplazar" : "Proponer"}
                      </button>
                    </div>
                  </div>

                  {/* Alertas soft */}
                  {p.alertas.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {p.alertas.map((a, i) => (
                        <div key={i} className="flex items-start gap-1.5">
                          {a.nivel === "error"
                            ? <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0 mt-px" />
                            : a.tipo === "ausencia_en_periodo"
                            ? <CalendarX className="w-3 h-3 text-amber-500 flex-shrink-0 mt-px" />
                            : <Info className="w-3 h-3 text-amber-500 flex-shrink-0 mt-px" />
                          }
                          <p className="text-[10px] text-[#666]">{a.mensaje}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Mini Gantt de capacidad */}
                  {req && (
                    <MiniGantt
                      req={req}
                      asignaciones={p.asignaciones}
                      asignacionIdsALiberar={asignacionIdsALiberar}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Card de engagement
// ─────────────────────────────────────────────────────────────

function EngagementCard({
  eng, tentativas, terminaciones, reqSeleccionado, onSelectReq,
  onRemoveTentativa, onProponerLiberar, onDeshacerTerminar,
}: {
  eng: EngagementConReqs;
  tentativas: Tentativa[];
  terminaciones: TerminacionTentativa[];
  reqSeleccionado: string | null;
  onSelectReq: (req: ReqConEstado) => void;
  onRemoveTentativa: (id: string) => void;
  onProponerLiberar: (asig: AsignacionActiva) => void;
  onDeshacerTerminar: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const totalReqs  = eng.requerimientos.length;
  const cubiertos  = eng.requerimientos.filter(
    (r) => r.cubierto_desde_hoy || tentativas.some((t) => t.requerimiento_id === r.id)
  ).length;
  const todosCubiertos = cubiertos === totalReqs;

  const estadoBadge: Record<string, { bg: string; text: string; label: string }> = {
    propuesta: { bg: "#fff3e8", text: "#c05000", label: "Propuesta" },
    activo:    { bg: "#e8f9ee", text: "#1a7a45", label: "Activo" },
    pausado:   { bg: "#f0f0f0", text: "#666",    label: "Pausado" },
  };
  const badge = estadoBadge[eng.estado] ?? { bg: "#f0f0f0", text: "#666", label: eng.estado };

  return (
    <div className="border border-[#e8e8e8] rounded-xl overflow-hidden mb-3 bg-white shadow-sm">
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#fafafa] transition-colors text-left"
      >
        {collapsed
          ? <ChevronRight className="w-4 h-4 text-[#aaa] flex-shrink-0" />
          : <ChevronDown  className="w-4 h-4 text-[#aaa] flex-shrink-0" />
        }
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-[#1a1a1a] truncate">{eng.nombre}</p>
            <span
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
              style={{ background: badge.bg, color: badge.text }}
            >
              {badge.label}
            </span>
          </div>
          <p className="text-[10px] text-[#888] mt-0.5">{eng.cliente}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {todosCubiertos
            ? <CheckCircle className="w-4 h-4 text-[#27ae60]" />
            : <AlertTriangle className="w-4 h-4 text-[#e2844a]" />
          }
          <span className="text-xs font-semibold text-[#888]">{cubiertos}/{totalReqs}</span>
        </div>
      </button>

      {!collapsed && (
        <div className="border-t border-[#f0f0f0]">
          {eng.requerimientos.map((req) => (
            <FilaRequerimiento
              key={req.id}
              req={req}
              tentativas={tentativas.filter((t) => t.requerimiento_id === req.id)}
              terminaciones={terminaciones.filter((t) => t.requerimiento_id === req.id)}
              isSelected={reqSeleccionado === req.id}
              onSelect={() => onSelectReq(req)}
              onRemoveTentativa={onRemoveTentativa}
              onProponerLiberar={onProponerLiberar}
              onDeshacerTerminar={onDeshacerTerminar}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Componente principal
// ─────────────────────────────────────────────────────────────

export function GanttPlanificacion() {
  const [engagements, setEngagements] = useState<EngagementConReqs[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  // Selección y fit
  const [reqSeleccionado, setReqSeleccionado] = useState<ReqConEstado | null>(null);
  const [fitPersonas, setFitPersonas]         = useState<PersonaFit[]>([]);
  const [fitLoading, setFitLoading]           = useState(false);

  // Propuestas borrador locales (adiciones)
  const [tentativas, setTentativas] = useState<Tentativa[]>([]);

  // Liberaciones tentativas locales (no van a BD hasta guardar plan)
  const [terminacionesTentativas, setTerminacionesTentativas] = useState<TerminacionTentativa[]>([]);

  // Guardado de plan
  const [guardando, setGuardando]     = useState(false);
  const [guardadoMsg, setGuardadoMsg] = useState<string | null>(null);

  // Búsqueda
  const [filtro, setFiltro] = useState("");

  // ── Carga ──────────────────────────────────────────────────

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const result = await fetchEngagementsConReqs(supabase);
    if (result.error) setError(result.error);
    else setEngagements(result.engagements);
    setLoading(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  // ── Seleccionar req → cargar fit ───────────────────────────

  const handleSelectReq = useCallback(async (req: ReqConEstado) => {
    if (reqSeleccionado?.id === req.id) {
      setReqSeleccionado(null);
      setFitPersonas([]);
      return;
    }
    setReqSeleccionado(req);
    setFitLoading(true);
    const supabase = createClient();
    const result = await fetchPersonasFit(
      supabase,
      req,
      tentativas.map((t) => ({ persona_id: t.persona_id, requerimiento_id: t.requerimiento_id, pct: t.pct })),
      terminacionesTentativas.map((t) => t.asignacion_id)
    );
    setFitPersonas(result.personas);
    setFitLoading(false);
  }, [reqSeleccionado?.id, tentativas, terminacionesTentativas]);

  // ── Proponer persona ───────────────────────────────────────

  const handleAsignar = useCallback((persona: PersonaFit) => {
    if (!reqSeleccionado) return;
    const hoy = today();
    setTentativas((prev) => {
      const sin = prev.filter((t) => t.requerimiento_id !== reqSeleccionado.id);
      return [
        ...sin,
        {
          id: crypto.randomUUID(),
          requerimiento_id: reqSeleccionado.id,
          persona_id: persona.persona_id,
          nombre: persona.nombre,
          apellido: persona.apellido,
          cargo: persona.cargo_actual,
          pct: reqSeleccionado.pct_dedicacion,
          fecha_inicio: hoy,
          fecha_fin: reqSeleccionado.fecha_fin,
        },
      ];
    });
    setGuardadoMsg(null);
  }, [reqSeleccionado]);

  // ── Proponer liberar asignación (solo local, siempre desde hoy) ──

  const handleProponerLiberar = useCallback((asig: AsignacionActiva) => {
    // Buscar a qué req y engagement pertenece esta asignación
    let reqId = "", engId = "";
    for (const eng of engagements) {
      for (const req of eng.requerimientos) {
        if (req.asignaciones.some((a) => a.asignacion_id === asig.asignacion_id)) {
          reqId = req.id;
          engId = req.engagement_id;
          break;
        }
      }
      if (reqId) break;
    }

    const hoy = today();

    setTerminacionesTentativas((prev) => {
      // Solo una liberación por asignación
      const sin = prev.filter((t) => t.asignacion_id !== asig.asignacion_id);
      return [
        ...sin,
        {
          id: crypto.randomUUID(),
          asignacion_id: asig.asignacion_id,
          requerimiento_id: reqId,
          engagement_id: engId,
          persona_id: asig.persona_id,
          persona_nombre: asig.persona_nombre,
          persona_apellido: asig.persona_apellido,
          pct_liberado: Number(asig.pct_dedicacion),
          fecha_fin: hoy,
        },
      ];
    });

    setGuardadoMsg(null);
  }, [engagements]);

  const handleDeshacerTerminar = useCallback((terminacionId: string) => {
    setTerminacionesTentativas((prev) => prev.filter((t) => t.id !== terminacionId));
    setGuardadoMsg(null);
  }, []);

  // ── Guardar plan ───────────────────────────────────────────

  const totalCambios = tentativas.length + terminacionesTentativas.length;

  const handleGuardarPlan = useCallback(async () => {
    if (totalCambios === 0) return;
    setGuardando(true);
    setGuardadoMsg(null);

    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const planNombre = `Plan ${format(new Date(), "d MMM yyyy HH:mm", { locale: es })}`;
    const { data: planData, error: planErr } = await sb
      .from("propuesta_plan")
      .insert({ nombre: planNombre, estado: "borrador" })
      .select("id")
      .single();

    if (planErr || !planData) {
      setGuardadoMsg(`Error al crear plan: ${planErr?.message ?? "desconocido"}`);
      setGuardando(false);
      return;
    }

    const planId = (planData as { id: string }).id;

    // 1. Asignaciones nuevas (tipo=asignar)
    const inserts = tentativas
      .map((t) => {
        const req = engagements.flatMap((e) => e.requerimientos).find((r) => r.id === t.requerimiento_id);
        return {
          plan_id: planId,
          persona_id: t.persona_id,
          engagement_id: req?.engagement_id ?? "",
          requerimiento_id: t.requerimiento_id,
          pct_dedicacion: t.pct,
          fecha_inicio: t.fecha_inicio,
          fecha_fin: t.fecha_fin,
          estado: "borrador",
          tipo: "asignar",
          cargo_al_momento: t.cargo,
        };
      })
      .filter((i) => i.engagement_id);

    // 2. Liberaciones propuestas (tipo=liberar)
    const liberaciones = terminacionesTentativas.map((t) => ({
      plan_id: planId,
      persona_id: t.persona_id,
      engagement_id: t.engagement_id,
      requerimiento_id: t.requerimiento_id,
      pct_dedicacion: t.pct_liberado,
      fecha_inicio: t.fecha_fin,
      fecha_fin: t.fecha_fin,
      estado: "borrador",
      tipo: "liberar",
      asignacion_a_terminar_id: t.asignacion_id,
      cargo_al_momento: null,
    }));

    const todosLosInserts = [...inserts, ...liberaciones];

    const { error: asigErr } = await sb.from("asignacion_propuesta").insert(todosLosInserts);

    if (asigErr) {
      await supabase.from("propuesta_plan").delete().eq("id", planId);
      setGuardadoMsg(`Error: ${asigErr.message}`);
    } else {
      const partes = [];
      if (tentativas.length > 0) partes.push(`${tentativas.length} asignación(es) nueva(s)`);
      if (terminacionesTentativas.length > 0) partes.push(`${terminacionesTentativas.length} liberación(es)`);
      setGuardadoMsg(`✓ Plan "${planNombre}" guardado — ${partes.join(", ")}`);
      setTentativas([]);
      setTerminacionesTentativas([]);
    }
    setGuardando(false);
  }, [tentativas, terminacionesTentativas, engagements, totalCambios]);

  // ── Filtrado y stats ───────────────────────────────────────

  // Función para saber si un engagement tiene algo pendiente/modificado (incluye terminaciones)
  const tienePendiente = (eng: EngagementConReqs) =>
    eng.requerimientos.some((r) => {
      const hasTentativa = tentativas.some((t) => t.requerimiento_id === r.id);
      const hasTerminacion = terminacionesTentativas.some((t) => t.requerimiento_id === r.id);
      // Pendiente si: no cubierto y sin tentativa, o tiene terminación propuesta
      return (!r.cubierto_desde_hoy && !hasTentativa) || hasTerminacion;
    });

  const engFiltrados = (filtro.trim()
    ? engagements.filter((e) =>
        e.nombre.toLowerCase().includes(filtro.toLowerCase()) ||
        e.cliente.toLowerCase().includes(filtro.toLowerCase()) ||
        e.requerimientos.some((r) => r.cargo_requerido?.toLowerCase().includes(filtro.toLowerCase()))
      )
    : engagements
  ).sort((a, b) => {
    const aPend = tienePendiente(a) ? 0 : 1;
    const bPend = tienePendiente(b) ? 0 : 1;
    if (aPend !== bPend) return aPend - bPend;
    return a.nombre.localeCompare(b.nombre, "es");
  });

  const allReqs   = engagements.flatMap((e) => e.requerimientos);
  const totalReqs = allReqs.length;
  const cubiertos = allReqs.filter(
    (r) => r.cubierto_desde_hoy || tentativas.some((t) => t.requerimiento_id === r.id)
  ).length;
  const pendientes = totalReqs - cubiertos;

  // ── Render ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-[#888]">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Cargando planificación...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-500 text-sm">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Panel izquierdo ── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden border-r border-[#e8e8e8]">

        {/* Topbar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[#e8e8e8] bg-white flex-shrink-0">
          {/* Stats */}
          <div className="flex items-center gap-4 flex-1">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[#27ae60]" />
              <span className="text-xs text-[#888]">{cubiertos} cubiertos</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[#e2844a]" />
              <span className="text-xs text-[#888]">{pendientes} sin cubrir</span>
            </div>
            {tentativas.length > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full border-2 border-dashed border-[#4a90e2]" />
                <span className="text-xs text-[#4a90e2] font-medium">{tentativas.length} propuestas pendientes</span>
              </div>
            )}
          </div>

          {/* Búsqueda */}
          <input
            type="text"
            placeholder="Buscar engagement o cargo..."
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            className="text-xs border border-[#e8e8e8] rounded-lg px-3 py-1.5 w-52 focus:outline-none focus:border-[#1a1a1a] bg-[#f9f9f9] focus:bg-white transition-colors"
          />

          {/* Guardar plan */}
          <button
            onClick={handleGuardarPlan}
            disabled={totalCambios === 0 || guardando}
            className={cn(
              "flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all",
              totalCambios > 0 && !guardando
                ? "bg-[#1a1a1a] text-white hover:bg-[#333] shadow-sm"
                : "bg-[#f0f0f0] text-[#bbb] cursor-not-allowed"
            )}
          >
            {guardando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Guardar plan
            {totalCambios > 0 && <span>({totalCambios})</span>}
          </button>
        </div>

        {/* Mensaje */}
        {guardadoMsg && (
          <div className={cn(
            "px-5 py-2 text-xs font-medium border-b",
            guardadoMsg.startsWith("✓")
              ? "bg-[#f0faf5] text-[#1a7a45] border-[#b2dfc8]"
              : "bg-red-50 text-red-600 border-red-200"
          )}>
            {guardadoMsg}
          </div>
        )}

        {/* Lista */}
        <div className="flex-1 overflow-y-auto p-4">
          {engFiltrados.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-[#aaa] gap-2">
              <p className="text-sm font-medium">
                {filtro
                  ? "Sin resultados para tu búsqueda"
                  : "No hay requerimientos vigentes en engagements activos"
                }
              </p>
              <p className="text-xs">Solo se muestran requerimientos con fecha fin ≥ hoy</p>
            </div>
          ) : (
            engFiltrados.map((eng) => (
              <EngagementCard
                key={eng.engagement_id}
                eng={eng}
                tentativas={tentativas.filter((t) =>
                  eng.requerimientos.some((r) => r.id === t.requerimiento_id)
                )}
                terminaciones={terminacionesTentativas.filter((t) =>
                  eng.requerimientos.some((r) => r.id === t.requerimiento_id)
                )}
                reqSeleccionado={reqSeleccionado?.id ?? null}
                onSelectReq={handleSelectReq}
                onRemoveTentativa={(id) => setTentativas((prev) => prev.filter((t) => t.id !== id))}
                onProponerLiberar={handleProponerLiberar}
                onDeshacerTerminar={handleDeshacerTerminar}
              />
            ))
          )}
        </div>

        {/* Leyenda */}
        <div className="px-4 py-2.5 border-t border-[#f0f0f0] bg-[#fafafa] flex items-center gap-5 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-[#27ae60]" />
            <span className="text-[10px] text-[#aaa]">Cubierto desde hoy</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-[#e2844a]" />
            <span className="text-[10px] text-[#aaa]">Sin cubrir</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-full border-2 border-dashed border-[#4a90e2]" />
            <span className="text-[10px] text-[#aaa]">Propuesto (borrador)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-1.5 bg-red-300 rounded-full opacity-70" />
            <span className="text-[10px] text-[#aaa]">Liberar propuesto (borrador)</span>
          </div>
        </div>
      </div>

      {/* ── Panel derecho: fit ── */}
      <div className={cn(
        "flex flex-col transition-all duration-200 overflow-hidden border-l border-[#e8e8e8]",
        reqSeleccionado ? "w-[340px]" : "w-[200px]"
      )}>
        <FitPanel
          req={reqSeleccionado}
          personas={fitPersonas}
          loading={fitLoading}
          onAsignar={handleAsignar}
          onCerrar={() => { setReqSeleccionado(null); setFitPersonas([]); }}
          asignacionIdsALiberar={terminacionesTentativas.map((t) => t.asignacion_id)}
        />
      </div>

    </div>
  );
}
