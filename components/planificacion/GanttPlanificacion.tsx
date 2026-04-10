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
  terminarAsignacion,
  today,
  type EngagementConReqs,
  type ReqConEstado,
  type AsignacionActiva,
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

function iniciales(nombre: string, apellido: string) {
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
  personaId, nombre, apellido, size = "md", alerta = false, title,
}: {
  personaId: string; nombre: string; apellido: string;
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
        {iniciales(nombre, apellido)}
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
//  Dialog de confirmación de terminación
// ─────────────────────────────────────────────────────────────

function DialogTerminar({
  asignacion,
  onConfirm,
  onCancel,
  loading,
}: {
  asignacion: AsignacionActiva;
  onConfirm: (fechaFin: string) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const hoy = today();
  const [fecha, setFecha] = useState(hoy);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl border border-[#e8e8e8] shadow-2xl w-full max-w-sm mx-4">
        <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center justify-between">
          <h3 className="text-[14px] font-bold text-[#1a1a1a]">Terminar asignación</h3>
          <button onClick={onCancel} className="text-[#bbb] hover:text-[#555]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-[13px] text-[#555]">
            ¿Terminar la asignación de{" "}
            <strong>{asignacion.persona_nombre} {asignacion.persona_apellido}</strong>?
          </p>
          <div>
            <label className="block text-[11px] font-semibold text-[#888] uppercase tracking-wide mb-1">
              Fecha de término
            </label>
            <input
              type="date"
              value={fecha}
              max={hoy}
              onChange={(e) => setFecha(e.target.value)}
              className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-[13px] text-[#1a1a1a] focus:outline-none focus:border-[#1a1a1a]"
            />
          </div>
          <p className="text-[11px] text-[#aaa]">
            La persona quedará libre a partir del {formatFechaLarga(fecha)}.
            Se podrá asignar un reemplazo desde esa fecha.
          </p>
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-[#f0f0f0]">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg border border-[#e0e0e0] text-[13px] text-[#555] hover:bg-[#f5f5f5] transition-colors font-medium"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(fecha)}
            disabled={loading}
            className="flex-1 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-[13px] font-semibold text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Terminar asignación
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Fila de requerimiento
// ─────────────────────────────────────────────────────────────

function FilaRequerimiento({
  req,
  tentativas,
  isSelected,
  onSelect,
  onRemoveTentativa,
  onTerminarAsignacion,
}: {
  req: ReqConEstado;
  tentativas: Tentativa[];
  isSelected: boolean;
  onSelect: () => void;
  onRemoveTentativa: (tentativaId: string) => void;
  onTerminarAsignacion: (asig: AsignacionActiva) => void;
}) {
  const tieneTentativa = tentativas.some((t) => t.requerimiento_id === req.id);
  // Un req cubierto desde hoy NO es clickeable para buscar propuestas.
  // Solo se puede interactuar para terminar asignaciones.
  const cubierto = req.cubierto_desde_hoy;
  const clickeable = !cubierto;  // solo abre el fit panel si no está cubierto
  const hoy = today();

  // Asignaciones activas desde hoy
  const asigActivas = req.asignaciones.filter(
    (a) => a.fecha_fin === null || a.fecha_fin >= hoy
  );

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
          {asigActivas.map((a) => (
            <div
              key={a.asignacion_id}
              className="flex items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <Avatar
                personaId={a.persona_id}
                nombre={a.persona_nombre}
                apellido={a.persona_apellido}
                size="sm"
              />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-[#333] truncate">
                  {a.persona_nombre} {a.persona_apellido}
                </p>
                <p className="text-[9px] text-[#aaa]">
                  {formatFecha(a.fecha_inicio)} → {formatFecha(a.fecha_fin)} · {a.pct_dedicacion}%
                </p>
              </div>
              <button
                onClick={() => onTerminarAsignacion(a)}
                className="flex items-center gap-1 text-[10px] text-[#bbb] hover:text-red-500 px-1.5 py-0.5 rounded hover:bg-red-50 transition-colors flex-shrink-0"
                title="Terminar esta asignación"
              >
                <UserMinus className="w-3 h-3" />
                <span className="hidden group-hover:inline">Terminar</span>
              </button>
            </div>
          ))}
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
//  Panel de fit (derecha)
// ─────────────────────────────────────────────────────────────

function FitPanel({
  req, personas, loading, onAsignar, onCerrar,
}: {
  req: ReqConEstado | null;
  personas: PersonaFit[];
  loading: boolean;
  onAsignar: (p: PersonaFit) => void;
  onCerrar: () => void;
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
                      {iniciales(p.nombre, p.apellido)}
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

                  {/* Barra de capacidad */}
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[9px] text-[#aaa]">Capacidad desde hoy</span>
                      <span className="text-[9px] font-medium text-[#666]">
                        {p.pct_ocupado_en_rango}% ocupado
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#f0f0f0] overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, p.pct_si_asigna)}%`,
                          background: p.pct_si_asigna > 100 ? "#ef4444"
                            : p.pct_si_asigna > 80 ? "#f59e0b"
                            : "#27ae60",
                        }}
                      />
                    </div>
                  </div>
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
  eng, tentativas, reqSeleccionado, onSelectReq, onRemoveTentativa, onTerminarAsignacion,
}: {
  eng: EngagementConReqs;
  tentativas: Tentativa[];
  reqSeleccionado: string | null;
  onSelectReq: (req: ReqConEstado) => void;
  onRemoveTentativa: (id: string) => void;
  onTerminarAsignacion: (asig: AsignacionActiva) => void;
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
              isSelected={reqSeleccionado === req.id}
              onSelect={() => onSelectReq(req)}
              onRemoveTentativa={onRemoveTentativa}
              onTerminarAsignacion={onTerminarAsignacion}
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

  // Propuestas borrador locales
  const [tentativas, setTentativas] = useState<Tentativa[]>([]);

  // Dialog de terminación
  const [dialogTerminar, setDialogTerminar] = useState<AsignacionActiva | null>(null);
  const [terminando, setTerminando]         = useState(false);

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
      supabase, req,
      tentativas.map((t) => ({ persona_id: t.persona_id, requerimiento_id: t.requerimiento_id, pct: t.pct }))
    );
    setFitPersonas(result.personas);
    setFitLoading(false);
  }, [reqSeleccionado?.id, tentativas]);

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

  // ── Terminar asignación ────────────────────────────────────

  const handleTerminarAsignacion = useCallback(async (fechaFin: string) => {
    if (!dialogTerminar) return;
    setTerminando(true);
    const supabase = createClient();
    const { error: err } = await terminarAsignacion(supabase, dialogTerminar.asignacion_id, fechaFin);
    setTerminando(false);
    setDialogTerminar(null);
    if (err) {
      setGuardadoMsg(`Error al terminar: ${err}`);
    } else {
      await cargar();
      // Si el req seleccionado era de este engagement, recargar el fit
      if (reqSeleccionado) {
        const supabase2 = createClient();
        const result = await fetchPersonasFit(
          supabase2, reqSeleccionado,
          tentativas.map((t) => ({ persona_id: t.persona_id, requerimiento_id: t.requerimiento_id, pct: t.pct }))
        );
        setFitPersonas(result.personas);
      }
    }
  }, [dialogTerminar, cargar, reqSeleccionado, tentativas]);

  // ── Guardar plan ───────────────────────────────────────────

  const handleGuardarPlan = useCallback(async () => {
    if (tentativas.length === 0) return;
    setGuardando(true);
    setGuardadoMsg(null);

    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // Sistema sin auth: creada_por y propuesto_por siempre null.
    // La migración fix_propuestas_rls.sql eliminó la FK de creada_por
    // y hace nullable propuesto_por.
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
          cargo_al_momento: t.cargo,
        };
      })
      .filter((i) => i.engagement_id);

    const { error: asigErr } = await sb.from("asignacion_propuesta").insert(inserts);

    if (asigErr) {
      await supabase.from("propuesta_plan").delete().eq("id", planId);
      setGuardadoMsg(`Error: ${asigErr.message}`);
    } else {
      setGuardadoMsg(`✓ Plan "${planNombre}" guardado con ${tentativas.length} propuesta(s)`);
      setTentativas([]);
    }
    setGuardando(false);
  }, [tentativas, engagements]);

  // ── Filtrado y stats ───────────────────────────────────────

  const engFiltrados = filtro.trim()
    ? engagements.filter((e) =>
        e.nombre.toLowerCase().includes(filtro.toLowerCase()) ||
        e.cliente.toLowerCase().includes(filtro.toLowerCase()) ||
        e.requerimientos.some((r) => r.cargo_requerido?.toLowerCase().includes(filtro.toLowerCase()))
      )
    : engagements;

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
            disabled={tentativas.length === 0 || guardando}
            className={cn(
              "flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all",
              tentativas.length > 0 && !guardando
                ? "bg-[#1a1a1a] text-white hover:bg-[#333] shadow-sm"
                : "bg-[#f0f0f0] text-[#bbb] cursor-not-allowed"
            )}
          >
            {guardando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Guardar plan
            {tentativas.length > 0 && <span>({tentativas.length})</span>}
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
                reqSeleccionado={reqSeleccionado?.id ?? null}
                onSelectReq={handleSelectReq}
                onRemoveTentativa={(id) => setTentativas((prev) => prev.filter((t) => t.id !== id))}
                onTerminarAsignacion={(asig) => setDialogTerminar(asig)}
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
            <UserMinus className="w-3.5 h-3.5 text-[#aaa]" />
            <span className="text-[10px] text-[#aaa]">Terminar asignación</span>
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
        />
      </div>

      {/* Dialog de terminación */}
      {dialogTerminar && (
        <DialogTerminar
          asignacion={dialogTerminar}
          onConfirm={handleTerminarAsignacion}
          onCancel={() => setDialogTerminar(null)}
          loading={terminando}
        />
      )}
    </div>
  );
}
