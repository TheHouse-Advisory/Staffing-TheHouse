"use client";

import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  X, ChevronRight, AlertTriangle, CalendarX, Info, Zap, Loader2, CheckCircle,
} from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import {
  fetchPersonasFit,
  today,
  type ReqConEstado,
  type PersonaFit,
  type FitNivel,
  type AsignacionDetalle,
} from "@/lib/queries/planificacion";
import { expandirRango, COLOR_AUSENCIA } from "@/lib/queries/ausencias";
import type { TipoAusencia } from "@/lib/types/database";

// ─────────────────────────────────────────────────────────────
//  Helpers visuales
// ─────────────────────────────────────────────────────────────

function nivelColor(nivel: FitNivel) {
  switch (nivel) {
    case "excelente":   return { bg: "#dcf5e7", text: "#1a7a45" };
    case "bueno":       return { bg: "#e8f4ff", text: "#1a5276" };
    case "advertencia": return { bg: "#fff4d4", text: "#8a6200" };
    case "riesgo":      return { bg: "#ffd4d4", text: "#c02020" };
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

const TALENTO_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  talento:       { label: "Talento",       bg: "#f0fdf4", color: "#16a34a" },
  en_desarrollo: { label: "En desarrollo", bg: "#fefce8", color: "#ca8a04" },
  no_talento:    { label: "No talento",    bg: "#fef2f2", color: "#dc2626" },
};

// ─────────────────────────────────────────────────────────────
//  Mini-Gantt de capacidad
// ─────────────────────────────────────────────────────────────

const GANTT_COLORS = ["#94a3b8","#64748b","#7c9ebe","#8b9dc7","#a0aec0","#6b7fa8","#9badc7","#7b8fab"];

function MiniGantt({ req, asignaciones }: { req: ReqConEstado; asignaciones: AsignacionDetalle[] }) {
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
    return {
      left: Math.max(0, ((clampS - reqStart) / totalMs) * 100),
      width: Math.max(1, ((clampE - clampS) / totalMs) * 100),
    };
  }

  const asigSolap = asignaciones.filter((a) => {
    const s = new Date(a.fecha_inicio + "T00:00:00").getTime();
    const e = a.fecha_fin ? new Date(a.fecha_fin + "T00:00:00").getTime() : reqEnd + 1;
    return s < reqEnd && e > reqStart;
  });

  const rows = [
    ...asigSolap.map((a, i) => ({
      label: a.engagement_nombre,
      pct: a.pct_dedicacion,
      inicio: a.fecha_inicio,
      fin: a.fecha_fin,
      color: GANTT_COLORS[i % GANTT_COLORS.length],
      proposed: false,
    })),
    {
      label: "Esta asignación",
      pct: req.pct_dedicacion,
      inicio: req.fecha_inicio,
      fin: req.fecha_fin,
      color: "#3b82f6",
      proposed: true,
    },
  ];

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between text-[9px] text-[#aaa] px-0.5 mb-0.5">
        <span>{formatFecha(req.fecha_inicio)}</span>
        <span>{formatFecha(req.fecha_fin)}</span>
      </div>
      {rows.map((row, i) => {
        const pos = posAndWidth(row.inicio, row.fin);
        if (!pos) return null;
        return (
          <div key={i} className="flex items-center gap-1.5">
            <div
              className="w-[72px] text-[9px] text-right flex-shrink-0 truncate leading-tight"
              style={{ color: row.proposed ? "#3b82f6" : "#888" }}
              title={row.label}
            >
              {row.label}
            </div>
            <div className="relative flex-1 h-4 bg-[#f0f0f0] rounded-sm overflow-hidden">
              <div
                className="absolute top-0 h-full rounded-sm flex items-center overflow-hidden"
                style={{
                  left: `${pos.left}%`,
                  width: `${pos.width}%`,
                  background: row.color,
                  opacity: row.proposed ? 1 : 0.75,
                  border: row.proposed ? "1px solid rgba(59,130,246,0.5)" : "none",
                }}
              >
                <span className="text-[8px] font-semibold px-1 truncate leading-none text-white select-none relative z-10">
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
//  Popup de resumen de perfil
// ─────────────────────────────────────────────────────────────

interface ResumenPerfil {
  ocupacion: number;
  totalProyectos: number;
  industrias: string[];
  capacidades: string[];
  tematicas: string[];
  vacacionesDias: number;
  talento: string | null;
  mentorNombre: string | null;
  mentoreados: string[];
}

interface PopupPerfilProps {
  persona: PersonaFit;
  resumen: ResumenPerfil | null;
  loading: boolean;
  popupRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

function PopupPerfil({ persona, resumen, loading, popupRef, onClose }: PopupPerfilProps) {
  const color = avatarColor(persona.persona_id);
  return (
    <div className="absolute inset-0 bg-black/10 z-10 flex items-center justify-center p-4">
      <div
        ref={popupRef}
        className="bg-white rounded-xl shadow-xl border border-gray-100 w-full max-w-xs relative flex flex-col"
        style={{ maxHeight: "85%" }}
      >
        {/* Header fijo */}
        <div className="p-5 pb-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 text-gray-300 hover:text-gray-500"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-bold flex-shrink-0"
              style={{ backgroundColor: color }}
            >
              {iniciales(persona.nombre, persona.apellido)}
            </div>
            <div>
              <p className="font-bold text-[#1a1a2e]">
                {persona.nombre} {persona.apellido}
              </p>
              <p className="text-xs text-gray-400">{persona.cargo_actual ?? "Sin cargo"}</p>
            </div>
          </div>
        </div>

        {/* Contenido scrolleable */}
        <div className="overflow-y-auto px-5 pb-5 flex-1">
          {loading ? (
            <p className="text-sm text-gray-300 text-center py-4">Cargando...</p>
          ) : resumen && (
            <div className="space-y-3 text-sm">

              {/* Disponibilidad */}
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Disponibilidad</span>
                <span
                  className="font-semibold px-2 py-0.5 rounded-full text-xs"
                  style={
                    resumen.ocupacion >= 100
                      ? { background: "#fef2f2", color: "#dc2626" }
                      : resumen.ocupacion >= 80
                      ? { background: "#fefce8", color: "#ca8a04" }
                      : { background: "#f0fdf4", color: "#16a34a" }
                  }
                >
                  {Math.max(0, 100 - resumen.ocupacion)}% libre
                </span>
              </div>

              {/* Historial proyectos */}
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Nº proyectos</span>
                <span className="font-medium text-[#1a1a2e]">{resumen.totalProyectos}</span>
              </div>

              {/* Industrias */}
              <div>
                <p className="text-gray-400 mb-1">Industrias</p>
                {resumen.industrias.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {resumen.industrias.map((i) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-[#eaf4ff] text-[#1a5276]">{i}</span>
                    ))}
                  </div>
                ) : <p className="text-xs text-gray-300 italic">Sin industrias</p>}
              </div>

              {/* Capacidades */}
              <div>
                <p className="text-gray-400 mb-1">Capacidades</p>
                {resumen.capacidades.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {resumen.capacidades.map((c) => (
                      <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-[#f0f9f4] text-[#1e7e45]">{c}</span>
                    ))}
                  </div>
                ) : <p className="text-xs text-gray-300 italic">Sin capacidades</p>}
              </div>

              {/* Temáticas */}
              <div>
                <p className="text-gray-400 mb-1">Temáticas</p>
                {resumen.tematicas.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {resumen.tematicas.map((t) => (
                      <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-[#fdf4ff] text-[#6b21a8]">{t}</span>
                    ))}
                  </div>
                ) : <p className="text-xs text-gray-300 italic">Sin temáticas</p>}
              </div>

              {/* Ausencias */}
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Ausencias (año)</span>
                <span className="font-medium text-[#1a1a2e]">{resumen.vacacionesDias}</span>
              </div>

              {/* Talento */}
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Talento</span>
                {resumen.talento && TALENTO_CONFIG[resumen.talento] ? (
                  <span
                    className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                    style={{
                      background: TALENTO_CONFIG[resumen.talento].bg,
                      color:      TALENTO_CONFIG[resumen.talento].color,
                    }}
                  >
                    {TALENTO_CONFIG[resumen.talento].label}
                  </span>
                ) : (
                  <span className="text-gray-300 text-xs">Sin asignar</span>
                )}
              </div>

              {/* Mentor */}
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Mentor</span>
                <span className="font-medium text-[#1a1a2e]">
                  {resumen.mentorNombre ?? <span className="text-gray-300 text-xs">Sin mentor</span>}
                </span>
              </div>

              {/* Es mentor de */}
              {resumen.mentoreados.length > 0 && (
                <div>
                  <p className="text-gray-400 mb-1">Es mentor de</p>
                  <div className="flex flex-wrap gap-1">
                    {resumen.mentoreados.map((m) => (
                      <span key={m} className="text-xs px-2 py-0.5 rounded-full bg-[#f0f9f4] text-[#1e7e45] font-medium">
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Panel principal
// ─────────────────────────────────────────────────────────────

interface AusRow {
  tipo: TipoAusencia; tipoLabel: string;
  fechaInicio: string; fechaFin: string; numDias: number;
}

interface Props {
  reqId: string;
  engagementId: string;
  engagementNombre: string;
  engagementCliente: string;
  onClose: () => void;
  onAsignado: () => void;
  onCollapse?: () => void;
}

export function PanelFitAsignacion({
  reqId, engagementId, engagementNombre, engagementCliente, onClose, onAsignado, onCollapse,
}: Props) {
  const [req, setReq] = useState<ReqConEstado | null>(null);
  const [personas, setPersonas] = useState<PersonaFit[]>([]);
  const [loading, setLoading] = useState(true);
  const [ausenciasMap, setAusenciasMap] = useState<Map<string, AusRow[]>>(new Map());
  const [asignando, setAsignando] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Popup de perfil
  const [perfilAbierto, setPerfilAbierto] = useState<PersonaFit | null>(null);
  const [resumenPerfil, setResumenPerfil] = useState<ResumenPerfil | null>(null);
  const [loadingPerfil, setLoadingPerfil] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  // Cerrar popup al hacer clic fuera
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setPerfilAbierto(null);
        setResumenPerfil(null);
      }
    }
    if (perfilAbierto) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [perfilAbierto]);

  async function abrirPerfil(p: PersonaFit) {
    setPerfilAbierto(p);
    setResumenPerfil(null);
    setLoadingPerfil(true);
    const sb = createAnyClient();
    const añoActual = new Date().getFullYear();

    const [asigRes, histRes, vacRes, personaRes, indRes, capRes, temRes, mentoreRes] = await Promise.all([
      sb.from("asignacion").select("pct_dedicacion").eq("persona_id", p.persona_id).eq("estado", "activa"),
      sb.from("asignacion").select("engagement_id").eq("persona_id", p.persona_id),
      (sb as any).from("ausencia").select("id", { count: "exact", head: true })
        .eq("persona_id", p.persona_id)
        .gte("fecha_inicio", `${añoActual}-01-01`)
        .lte("fecha_fin", `${añoActual}-12-31`),
      sb.from("persona").select("talento, mentor_id").eq("id", p.persona_id).single(),
      (sb as any).from("persona_industria").select("cat_industria(nombre)").eq("persona_id", p.persona_id),
      (sb as any).from("persona_capacidad").select("cat_capacidad(nombre)").eq("persona_id", p.persona_id),
      (sb as any).from("persona_tematica").select("cat_tematica(nombre)").eq("persona_id", p.persona_id),
      sb.from("persona").select("nombre, apellido").eq("mentor_id", p.persona_id).eq("activo", true),
    ]);

    const personaData = personaRes.data as { talento: string | null; mentor_id: string | null } | null;
    let mentorNombre: string | null = null;
    if (personaData?.mentor_id) {
      const { data: md } = await sb.from("persona").select("nombre, apellido").eq("id", personaData.mentor_id).single();
      if (md) mentorNombre = `${(md as any).nombre} ${(md as any).apellido}`;
    }

    const ocupacion = ((asigRes.data ?? []) as any[]).reduce((sum, a) => sum + Number(a.pct_dedicacion), 0);
    const engUnicos = new Set(((histRes.data ?? []) as any[]).map((a) => a.engagement_id));

    setResumenPerfil({
      ocupacion,
      totalProyectos: engUnicos.size,
      industrias: ((indRes.data ?? []) as any[]).map((r: any) => r.cat_industria?.nombre).filter(Boolean) as string[],
      capacidades: ((capRes.data ?? []) as any[]).map((r: any) => r.cat_capacidad?.nombre).filter(Boolean) as string[],
      tematicas:   ((temRes.data ?? []) as any[]).map((r: any) => r.cat_tematica?.nombre).filter(Boolean) as string[],
      vacacionesDias: (vacRes as any).count ?? 0,
      talento: personaData?.talento ?? null,
      mentorNombre,
      mentoreados: ((mentoreRes.data ?? []) as { nombre: string; apellido: string }[]).map((m) => `${m.nombre} ${m.apellido}`),
    });
    setLoadingPerfil(false);
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      const sb = createAnyClient();
      const hoy = today();

      const [{ data: reqData }, { data: asigData }, { data: dcData }] = await Promise.all([
        sb.from("requerimiento_engagement")
          .select("id, engagement_id, cargo_requerido, pct_dedicacion, fecha_inicio, fecha_fin, fase_nombre")
          .eq("id", reqId)
          .single(),
        (sb as any).from("asignacion")
          .select("id, persona_id, pct_dedicacion, fecha_inicio, fecha_fin, persona:persona_id(nombre, apellido, cargo_actual)")
          .eq("requerimiento_id", reqId)
          .eq("estado", "activa"),
        (sb as any).from("dia_critico")
          .select("fecha")
          .eq("engagement_id", engagementId),
      ]);

      if (!reqData) { setLoading(false); return; }

      const reqEstado: ReqConEstado = {
        id: reqData.id,
        engagement_id: reqData.engagement_id,
        engagement_nombre: engagementNombre,
        engagement_cliente: engagementCliente,
        engagement_estado: "activo",
        cargo_requerido: reqData.cargo_requerido,
        pct_dedicacion: Number(reqData.pct_dedicacion),
        fecha_inicio: reqData.fecha_inicio,
        fecha_fin: reqData.fecha_fin,
        fase_nombre: reqData.fase_nombre,
        asignaciones: ((asigData ?? []) as any[]).map((a) => ({
          asignacion_id: a.id,
          persona_id: a.persona_id,
          persona_nombre: a.persona?.nombre ?? "—",
          persona_apellido: a.persona?.apellido ?? "",
          persona_cargo: a.persona?.cargo_actual ?? "—",
          pct_dedicacion: Number(a.pct_dedicacion),
          fecha_inicio: a.fecha_inicio,
          fecha_fin: a.fecha_fin ?? null,
        })),
        cubierto_desde_hoy: ((asigData ?? []) as any[]).some(
          (a) => a.fecha_inicio <= hoy && (a.fecha_fin === null || a.fecha_fin >= reqData.fecha_fin)
        ),
        dias_criticos: ((dcData ?? []) as any[])
          .map((d) => d.fecha as string)
          .filter((f) => f >= reqData.fecha_inicio && f <= reqData.fecha_fin),
      };

      setReq(reqEstado);

      const { personas: pFit } = await fetchPersonasFit(sb, reqEstado, [], []);
      setPersonas(pFit);

      // Batch load ausencias futuras para todas las personas recomendadas
      if (pFit.length > 0) {
        const hoyStr = today();
        const ids = pFit.map((p) => p.persona_id);
        const { data: ausData } = await (sb as any)
          .from("ausencia")
          .select("persona_id, tipo, fecha_inicio, fecha_fin")
          .in("persona_id", ids)
          .gte("fecha_fin", hoyStr)
          .order("fecha_inicio");
        const map = new Map<string, AusRow[]>();
        for (const a of (ausData ?? []) as any[]) {
          const tipo = a.tipo as TipoAusencia;
          const entry: AusRow = {
            tipo,
            tipoLabel: COLOR_AUSENCIA[tipo]?.label ?? a.tipo,
            fechaInicio: a.fecha_inicio,
            fechaFin: a.fecha_fin,
            numDias: expandirRango(a.fecha_inicio, a.fecha_fin).length,
          };
          if (!map.has(a.persona_id)) map.set(a.persona_id, []);
          map.get(a.persona_id)!.push(entry);
        }
        setAusenciasMap(map);
      }

      setLoading(false);
    }
    load();
  }, [reqId, engagementId, engagementNombre, engagementCliente]);

  async function handleAsignar(p: PersonaFit) {
    if (!req || asignando) return;
    setAsignando(p.persona_id);
    setErr(null);
    const sb = createAnyClient();

    const { error } = await (sb as any).from("asignacion").insert({
      engagement_id: engagementId,
      requerimiento_id: reqId,
      persona_id: p.persona_id,
      cargo_al_momento: p.cargo_actual,
      pct_dedicacion: req.pct_dedicacion,
      fecha_inicio: req.fecha_inicio,
      fecha_fin: req.fecha_fin,
      estado: "activa",
    });

    if (error) {
      setErr(error.message);
      setAsignando(null);
      return;
    }

    setExito(`${p.nombre} ${p.apellido} asignado/a correctamente.`);
    setAsignando(null);
    setTimeout(() => {
      onAsignado();
      onClose();
    }, 900);
  }

  return (
    <div className="h-full bg-white flex flex-col relative overflow-hidden">

      {/* Header */}
      <div className="px-5 py-4 border-b border-[#e8e8e8] bg-[#f9f9f9] flex-shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0 min-w-0">
              <p className="text-[10px] text-[#aaa] mb-0.5 truncate">
                {engagementNombre} · {engagementCliente}
              </p>
              {req ? (
                <>
                  <h3 className="text-sm font-bold text-[#1a1a1a]">
                    {req.cargo_requerido ?? "Sin cargo"}{" "}
                    <span className="font-normal text-[#888]">{req.pct_dedicacion}%</span>
                  </h3>
                  <p className="text-[10px] text-[#888] mt-1">
                    <span className="font-medium text-[#555]">A cubrir:</span>{" "}
                    {formatFecha(req.fecha_inicio)} → {formatFecha(req.fecha_fin)}
                  </p>
                  {req.dias_criticos.length > 0 && (
                    <div className="flex items-center gap-1 mt-1">
                      <Zap className="w-3 h-3 text-orange-500 flex-shrink-0" />
                      <span className="text-[10px] font-medium text-orange-600">
                        {req.dias_criticos.length} día{req.dias_criticos.length !== 1 ? "s" : ""} crítico{req.dias_criticos.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-[#888]">Cargando requerimiento...</p>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {onCollapse && (
                <button
                  onClick={onCollapse}
                  title="Colapsar panel"
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-[#aaa] hover:text-[#555] hover:bg-[#eee] transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={onClose}
                title="Cerrar"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#aaa] hover:text-[#555] hover:bg-[#eee] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Mensaje de error */}
        {err && (
          <div className="mx-5 mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex-shrink-0">
            {err}
          </div>
        )}

        {/* Mensaje de éxito */}
        {exito && (
          <div className="mx-5 mt-3 p-3 rounded-lg bg-green-50 border border-green-200 text-xs text-green-700 flex items-center gap-2 flex-shrink-0">
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {exito}
          </div>
        )}

        {/* Lista de personas */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-[#888]">
              <Loader2 className="w-5 h-5 animate-spin text-[#4a90e2]" />
              <span className="text-sm">Calculando fit...</span>
            </div>
          ) : personas.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center px-6 text-[#aaa]">
              <p className="text-sm font-medium text-[#888]">
                No hay personas con cargo <strong>"{req?.cargo_requerido}"</strong>
              </p>
              <p className="text-xs mt-1">Revisa los cargos en el catálogo de personas</p>
            </div>
          ) : (
            <div className="divide-y divide-[#f5f5f5]">
              {personas.map((p, idx) => {
                const colors = nivelColor(p.nivel);
                const emoji  = nivelEmoji(p.nivel);
                const yaEnReq = req?.asignaciones.some((a) => a.persona_id === p.persona_id) ?? false;
                const esteAsignando = asignando === p.persona_id;
                const exp = p.experiencia;
                const tieneExp = exp.industria || exp.capacidad || exp.tematica;

                return (
                  <div key={p.persona_id} className="px-5 py-4 hover:bg-[#fafafa] transition-colors">
                    {/* Posición en el ranking */}
                    <div className="flex items-center gap-3">
                      {/* Avatar clickeable → popup perfil */}
                      <div className="relative flex-shrink-0">
                        <button
                          onClick={() => abrirPerfil(p)}
                          title="Ver perfil"
                          className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-xs hover:scale-110 hover:shadow-md transition-transform"
                          style={{ background: avatarColor(p.persona_id) }}
                        >
                          {iniciales(p.nombre, p.apellido)}
                        </button>
                        <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-[#e8e8e8] text-[9px] font-bold text-[#888] flex items-center justify-center">
                          {idx + 1}
                        </span>
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-semibold text-[#1a1a1a] truncate">
                            {p.nombre} {p.apellido}
                          </p>
                          <span className="text-sm">{emoji}</span>
                        </div>
                        <p className="text-[10px] text-[#888]">{p.cargo_actual}</p>
                        {/* Badges de experiencia similar */}
                        {tieneExp && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {exp.industria && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-semibold">
                                Industria
                              </span>
                            )}
                            {exp.capacidad && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 font-semibold">
                                Capacidades
                              </span>
                            )}
                            {exp.tematica && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-600 font-semibold">
                                Temáticas
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Badge disponibilidad + botón */}
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        <span
                          className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: colors.bg, color: colors.text }}
                        >
                          {p.pct_si_asigna}%
                        </span>
                        <button
                          onClick={() => handleAsignar(p)}
                          disabled={!!asignando || !!exito}
                          className="text-[10px] font-semibold px-3 py-1 rounded-md bg-[#1a1a1a] text-white hover:bg-[#333] disabled:opacity-50 transition-colors flex items-center gap-1"
                        >
                          {esteAsignando && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                          {yaEnReq ? "Reasignar" : "Asignar"}
                        </button>
                      </div>
                    </div>

                    {/* Alertas */}
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

                    {/* Ausencias futuras con alerta de conflicto */}
                    {(ausenciasMap.get(p.persona_id) ?? []).map((a, i) => {
                      const conflicto = req
                        ? a.fechaInicio <= req.fecha_fin && a.fechaFin >= req.fecha_inicio
                        : false;
                      return (
                        <div key={i} className={`mt-1.5 flex items-start gap-1.5 text-[10px] rounded px-1.5 py-1 ${conflicto ? "bg-red-50 text-red-700" : "bg-[#f9f9f9] text-[#777]"}`}>
                          {conflicto
                            ? <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0 mt-px" />
                            : <CalendarX className="w-3 h-3 text-amber-400 flex-shrink-0 mt-px" />
                          }
                          <span className="leading-tight">
                            {conflicto && <strong className="font-semibold">Conflicto fechas · </strong>}
                            {a.tipoLabel} · {formatFecha(a.fechaInicio)} → {formatFecha(a.fechaFin)}{" "}
                            <span className="font-semibold">({a.numDias}d)</span>
                          </span>
                        </div>
                      );
                    })}

                    {/* Mini-Gantt */}
                    {req && <MiniGantt req={req} asignaciones={p.asignaciones} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer informativo */}
        <div className="px-5 py-3 border-t border-[#f0f0f0] bg-[#fafafa] flex-shrink-0">
          <p className="text-[10px] text-[#bbb] text-center">
            Recomendaciones ordenadas por disponibilidad y fit de cargo
          </p>
        </div>

      {/* Popup de perfil (overlay sobre el panel) */}
      {perfilAbierto && (
        <PopupPerfil
          persona={perfilAbierto}
          resumen={resumenPerfil}
          loading={loadingPerfil}
          popupRef={popupRef}
          onClose={() => { setPerfilAbierto(null); setResumenPerfil(null); }}
        />
      )}
    </div>
  );
}
