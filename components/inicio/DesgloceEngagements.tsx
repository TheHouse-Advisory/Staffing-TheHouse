"use client";

import { useEffect, useRef, useState } from "react";
import {
  startOfISOWeek, addDays, addWeeks, addMonths,
  subWeeks, subMonths, format, startOfMonth, endOfMonth,
} from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, Pencil, X, Calendar, Users, Building2, AlignLeft, Briefcase } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { EngagementForm } from "@/components/engagements/EngagementForm";
import type { Engagement } from "@/lib/types/database";

// ── Cargos Asociado y Consultor Senior son la misma categoría visual ──
const GRUPO_SENIOR = ["Asociado", "Consultor Senior", "Asociado / Consultor Senior"];
const LABEL_SENIOR = "Asociado / Consultor Senior";

function normalizeCargoDisplay(cargo: string): string {
  return GRUPO_SENIOR.includes(cargo) ? LABEL_SENIOR : cargo;
}
function matchesCargo(reqCargo: string | null, rowCargo: string): boolean {
  if (!reqCargo) return false;
  if (normalizeCargoDisplay(reqCargo) === rowCargo) return true;
  return false;
}

const JERARQUIA: Record<string, number> = {
  "Socio": 1, "Director de Proyectos": 2, "Director": 2,
  "Gerente de Proyectos": 3, "Gerente": 3,
  "Asociado / Consultor Senior": 4,
  "Asociado": 4, "Consultor Senior": 4,
  "Consultor de Proyectos": 5, "Consultor Proyecto": 5,
  "Consultor": 5, "Consultor Analista": 6, "Analista Senior": 6,
  "Consultor Trainee": 7, "Analista": 7, "Practicante": 8,
};

const COLORES: Record<string, string> = {
  "Socio": "#1a1a2e", "Director de Proyectos": "#4a90e2", "Director": "#4a90e2",
  "Gerente de Proyectos": "#7c5cbf", "Gerente": "#7c5cbf",
  "Asociado / Consultor Senior": "#e2884a",
  "Asociado": "#e2884a", "Consultor Senior": "#4ab89a",
  "Consultor de Proyectos": "#e24a6a",
  "Consultor Analista": "#a0b84a", "Consultor Trainee": "#c07c4a",
};
const COLOR_DEFAULT = "#94a3b8";

type Vista = "dia" | "semana" | "mes";
interface Columna { label: string; sublabel: string; inicio: Date; fin: Date; }

function columnasDia(base: Date): Columna[] {
  const lunes = startOfISOWeek(base);
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(lunes, i);
    return { label: format(d, "EEE", { locale: es }), sublabel: format(d, "d MMM", { locale: es }), inicio: d, fin: d };
  });
}
function columnasSemana(base: Date): Columna[] {
  const inicio = startOfISOWeek(base);
  return Array.from({ length: 5 }, (_, i) => {
    const s = addWeeks(inicio, i);
    const fin = addDays(s, 6);
    return { label: format(s, "d MMM", { locale: es }), sublabel: format(fin, "d MMM", { locale: es }), inicio: s, fin };
  });
}
function columnasMes(base: Date): Columna[] {
  return Array.from({ length: 4 }, (_, i) => {
    const m = addMonths(base, i);
    return { label: format(m, "MMM", { locale: es }), sublabel: format(m, "yyyy"), inicio: startOfMonth(m), fin: endOfMonth(m) };
  });
}
function rangoSolapan(aIni: string, aFin: string | null, cIni: Date, cFin: Date) {
  if (!aFin) return new Date(aIni) <= cFin;
  return new Date(aIni) <= cFin && new Date(aFin) >= cIni;
}
function iniciales(nombre: string, apellido: string) {
  return `${nombre[0] ?? ""}${apellido[0] ?? ""}`.toUpperCase();
}

interface PersonaAsig {
  id: string; nombre: string; apellido: string;
  cargo: string | null; pct: number;
  fecha_inicio: string; fecha_fin: string;
  asignacionId: string;
}
interface ReqData {
  id: string; cargo_requerido: string | null;
  fecha_inicio: string; fecha_fin: string;
  pct_dedicacion: number;
}
interface EngRow {
  id: string; nombre: string; cliente: string | null; tipo: string;
  fecha_inicio: string; fecha_fin: string | null;
  personas: PersonaAsig[];
  reqs: ReqData[];
  raw: Engagement;
}

export interface PanelInfo {
  reqId: string; engId: string; engNombre: string; engCliente: string;
}

interface Props {
  onAsignacionChange?: () => void;
  onOpenPanel?: (info: PanelInfo | null) => void;
  externalReloadKey?: number;
}

export function DesgloceEngagements({ onAsignacionChange, onOpenPanel, externalReloadKey }: Props) {
  const [vista, setVista] = useState<Vista>("semana");
  const [base, setBase] = useState<Date>(new Date());
  const [engs, setEngs] = useState<EngRow[]>([]);
  const [ausencias, setAusencias] = useState<{ persona_id: string; fecha_inicio: string; fecha_fin: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // Form crear/editar engagement
  const [formOpen, setFormOpen] = useState(false);
  const [engToEdit, setEngToEdit] = useState<Engagement | undefined>();

  // Modal detalle engagement
  const [engModal, setEngModal] = useState<EngRow | null>(null);
  const [modalIndustria, setModalIndustria] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Drag & Drop
  const [dragOverReqId, setDragOverReqId] = useState<string | null>(null);
  const [desasignando, setDesasignando] = useState<string | null>(null);

  const columnas: Columna[] =
    vista === "dia" ? columnasDia(base) :
    vista === "semana" ? columnasSemana(base) :
    columnasMes(base);

  const inicioStr = format(columnas[0].inicio, "yyyy-MM-dd");
  const finStr = format(columnas[columnas.length - 1].fin, "yyyy-MM-dd");

  useEffect(() => {
    async function load() {
      setLoading(true);
      const sb = createAnyClient();

      const [engRes, asigRes, ausRes] = await Promise.all([
        sb.from("engagement")
          .select("id, nombre, cliente, tipo, estado, descripcion, fecha_inicio, fecha_fin_estimada, fecha_fin_real, industria_id")
          .eq("estado", "activo")
          .lte("fecha_inicio", finStr)
          .or(`fecha_fin_real.gte.${inicioStr},fecha_fin_estimada.gte.${inicioStr},fecha_fin_real.is.null`),

        sb.from("asignacion")
          .select("id, engagement_id, persona_id, pct_dedicacion, fecha_inicio, fecha_fin, persona:persona_id(nombre, apellido, cargo_actual)" as any)
          .eq("estado", "activa")
          .lte("fecha_inicio", finStr)
          .gte("fecha_fin", inicioStr),

        sb.from("ausencia")
          .select("persona_id, fecha_inicio, fecha_fin")
          .lte("fecha_inicio", finStr)
          .gte("fecha_fin", inicioStr),
      ]);

      const engMap = new Map<string, EngRow>();
      for (const e of (engRes.data ?? []) as any[]) {
        engMap.set(e.id, {
          id: e.id, nombre: e.nombre, cliente: e.cliente,
          tipo: e.tipo ?? "proyecto",
          fecha_inicio: e.fecha_inicio,
          fecha_fin: e.fecha_fin_real ?? e.fecha_fin_estimada ?? null,
          personas: [], reqs: [], raw: e as Engagement,
        });
      }

      for (const a of (asigRes.data ?? []) as any[]) {
        const eng = engMap.get(a.engagement_id);
        if (!eng) continue;
        eng.personas.push({
          id: a.persona_id,
          nombre: a.persona?.nombre ?? "?",
          apellido: a.persona?.apellido ?? "",
          cargo: a.persona?.cargo_actual ?? null,
          pct: Number(a.pct_dedicacion),
          fecha_inicio: a.fecha_inicio,
          fecha_fin: a.fecha_fin,
          asignacionId: a.id,
        });
      }

      for (const eng of engMap.values()) {
        eng.personas.sort((a, b) => {
          const ia = JERARQUIA[a.cargo ?? ""] ?? 99;
          const ib = JERARQUIA[b.cargo ?? ""] ?? 99;
          return ia !== ib ? ia - ib : a.apellido.localeCompare(b.apellido);
        });
      }

      // Requerimientos (para círculos vacíos)
      const engIds = [...engMap.keys()];
      if (engIds.length > 0) {
        const { data: reqData } = await sb.from("requerimiento_engagement")
          .select("id, engagement_id, cargo_requerido, fecha_inicio, fecha_fin, pct_dedicacion")
          .in("engagement_id", engIds);
        for (const r of (reqData ?? []) as any[]) {
          const eng = engMap.get(r.engagement_id);
          if (eng) eng.reqs.push({
            id: r.id,
            cargo_requerido: r.cargo_requerido,
            fecha_inicio: r.fecha_inicio,
            fecha_fin: r.fecha_fin,
            pct_dedicacion: Number(r.pct_dedicacion),
          });
        }
      }

      setEngs([...engMap.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")));
      setAusencias((ausRes.data ?? []) as { persona_id: string; fecha_inicio: string; fecha_fin: string }[]);
      setLoading(false);
    }
    load();
  }, [inicioStr, finStr, reloadKey, externalReloadKey]);

  async function abrirDetalleEng(eng: EngRow) {
    setEngModal(eng);
    setModalIndustria(null);
    if (eng.raw.industria_id) {
      const sb = createAnyClient();
      const { data } = await sb.from("cat_industria").select("nombre").eq("id", eng.raw.industria_id).single();
      setModalIndustria((data as any)?.nombre ?? null);
    }
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setEngModal(null);
      }
    }
    if (engModal) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [engModal]);

  function navAnterior() {
    if (vista === "dia")    setBase((b) => addDays(startOfISOWeek(b), -7));
    if (vista === "semana") setBase((b) => subWeeks(b, 5));
    if (vista === "mes")    setBase((b) => subMonths(b, 4));
  }
  function navSiguiente() {
    if (vista === "dia")    setBase((b) => addDays(startOfISOWeek(b), 7));
    if (vista === "semana") setBase((b) => addWeeks(b, 5));
    if (vista === "mes")    setBase((b) => addMonths(b, 4));
  }

  function refresh() {
    setReloadKey((k) => k + 1);
    onAsignacionChange?.();
  }

  // Drop de persona desde cuadrante EQUIPO sobre un slot vacío
  async function handleDrop(e: React.DragEvent, eng: EngRow, req: ReqData) {
    e.preventDefault();
    setDragOverReqId(null);
    let data: { personaId: string; nombre: string; apellido: string; cargo_actual: string } | null = null;
    try { data = JSON.parse(e.dataTransfer.getData("persona")); } catch { return; }
    if (!data?.personaId) return;

    const sb = createAnyClient();
    await (sb as any).from("asignacion").insert({
      engagement_id: eng.id,
      requerimiento_id: req.id,
      persona_id: data.personaId,
      cargo_al_momento: data.cargo_actual,
      pct_dedicacion: req.pct_dedicacion,
      fecha_inicio: req.fecha_inicio,
      fecha_fin: req.fecha_fin,
      estado: "activa",
    });
    refresh();
    onOpenPanel?.(null); // cierra panel lateral al llenar el slot por drag & drop
  }

  // Eliminar asignación (botón X en avatar)
  async function handleDesasignar(asignacionId: string) {
    setDesasignando(asignacionId);
    const sb = createAnyClient();
    await sb.from("asignacion").delete().eq("id", asignacionId);
    setDesasignando(null);
    refresh();
  }

  const hoy = new Date();

  return (
    <div className="flex flex-col h-full relative">
      {/* Barra de controles */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <button
          onClick={() => { setEngToEdit(undefined); setFormOpen(true); }}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white transition-colors hover:opacity-90"
          style={{ background: "#4a90e2" }}
        >
          <Plus className="w-3 h-3" />
          Nuevo Engagement
        </button>
        <div className="flex items-center gap-1">
          <div className="flex rounded-md overflow-hidden border border-gray-100 text-[11px] font-semibold">
            {(["dia", "semana", "mes"] as Vista[]).map((v) => (
              <button key={v} onClick={() => setVista(v)}
                className="px-2.5 py-1 transition-colors"
                style={vista === v ? { background: "#4a90e2", color: "#fff" } : { background: "#f9f9f9", color: "#888" }}>
                {v === "dia" ? "Día" : v === "semana" ? "Semana" : "Mes"}
              </button>
            ))}
          </div>
          <button onClick={navAnterior} className="p-1 rounded hover:bg-gray-100 text-gray-400">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button onClick={navSiguiente} className="p-1 rounded hover:bg-gray-100 text-gray-400">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-300">Cargando...</p>
      ) : engs.length === 0 ? (
        <p className="text-sm text-gray-300 italic">Sin engagements activos en este período.</p>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse"
            style={{ minWidth: `${180 + columnas.length * 80}px` }}>
            <thead className="sticky top-0 bg-white z-20">
              <tr>
                <th className="text-left pr-3 pb-2 text-gray-400 font-semibold sticky left-0 bg-white z-30" style={{ minWidth: 160 }}>
                  Engagement
                </th>
                {columnas.map((col, i) => {
                  const esHoy = col.inicio <= hoy && hoy <= col.fin;
                  return (
                    <th key={i} className="text-center pb-2 font-semibold"
                      style={{ minWidth: 76, color: esHoy ? "#4a90e2" : "#aaa" }}>
                      <div className="capitalize">{col.label}</div>
                      <div className="font-normal text-[10px]">{col.sublabel}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {[
                { tipo: "proyecto",      label: "Proyectos",              color: "#4a90e2" },
                { tipo: "propuesta",     label: "Propuestas comerciales", color: "#9b59b6" },
                { tipo: "ayuda_interna", label: "Ayuda interna",          color: "#27ae60" },
              ].flatMap(({ tipo, label, color: secColor }) => {
                const lista = engs.filter((e) => e.tipo === tipo);
                if (lista.length === 0) return [];

                const filaSeccion = (
                  <tr key={`sec-${tipo}`}>
                    <td colSpan={columnas.length + 1} className="pt-4 pb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: secColor }} />
                        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: secColor }}>{label}</span>
                        <span className="text-[10px] text-gray-300">{lista.length}</span>
                        <div className="flex-1 h-0.5 rounded-full" style={{ background: secColor, opacity: 0.35 }} />
                      </div>
                    </td>
                  </tr>
                );

                const filasEngs = lista.flatMap((eng, ei) => {
                  // Cargos únicos normalizados (Asociado + Consultor Senior → un solo row)
                  const cargosDePersonas = eng.personas.map((p) => normalizeCargoDisplay(p.cargo ?? "Sin cargo"));
                  const cargosDeReqs = eng.reqs
                    .filter((r) => r.cargo_requerido)
                    .map((r) => normalizeCargoDisplay(r.cargo_requerido!));
                  const cargosUnicos = Array.from(new Set([...cargosDePersonas, ...cargosDeReqs]))
                    .sort((a, b) => (JERARQUIA[a] ?? 99) - (JERARQUIA[b] ?? 99));

                  const personaIdsEng = new Set(eng.personas.map((p) => p.id));

                  const separador = ei > 0 ? (
                    <tr key={`sep-${eng.id}`}>
                      <td colSpan={columnas.length + 1} className="py-0.5">
                        <div className="border-t-2 border-gray-100" />
                      </td>
                    </tr>
                  ) : null;

                  const filaHdr = (
                    <tr key={`hdr-${eng.id}`}>
                      <td className="pr-3 pt-2 pb-1 sticky left-0 bg-white z-10">
                        <div className="flex items-center gap-1 group">
                          <div className="flex-1 min-w-0">
                            <button
                              onClick={() => abrirDetalleEng(eng)}
                              className="font-bold text-[#1a1a2e] truncate max-w-[130px] text-[12px] text-left hover:text-[#4a90e2] hover:underline transition-colors"
                              title="Ver detalle del engagement"
                            >
                              {eng.nombre}
                            </button>
                            {eng.cliente && <p className="text-[10px] text-gray-400 truncate max-w-[130px]">{eng.cliente}</p>}
                          </div>
                          <button onClick={() => { setEngToEdit(eng.raw); setFormOpen(true); }}
                            title="Editar engagement"
                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-100 text-gray-400 transition-opacity flex-shrink-0">
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                      {columnas.map((col, i) => {
                        const esHoy = col.inicio <= hoy && hoy <= col.fin;
                        const activo = rangoSolapan(eng.fecha_inicio, eng.fecha_fin, col.inicio, col.fin);
                        return (
                          <td key={i} className="py-1 px-1">
                            {activo && <div className="h-1.5 rounded-full"
                              style={{ background: esHoy ? "#bfdbfe" : "#e0e7ff" }} />}
                          </td>
                        );
                      })}
                    </tr>
                  );

                  const filasCargo = cargosUnicos.map((cargo) => {
                    // Personas que coinciden con este row (normalizado)
                    const personas = eng.personas.filter((p) =>
                      normalizeCargoDisplay(p.cargo ?? "Sin cargo") === cargo
                    );
                    const cargoColor = COLORES[cargo] ?? COLOR_DEFAULT;

                    return (
                      <tr key={`cargo-${eng.id}-${cargo}`}>
                        <td className="pr-3 py-0.5 sticky left-0 bg-white z-10">
                          <p className="text-gray-400 truncate max-w-[150px] pl-3 text-[11px]">{cargo}</p>
                        </td>
                        {columnas.map((col, i) => {
                          const esHoy = col.inicio <= hoy && hoy <= col.fin;
                          const activos = personas.filter((p) =>
                            rangoSolapan(p.fecha_inicio, p.fecha_fin, col.inicio, col.fin)
                          );
                          // Requerimientos de este cargo en este periodo (sin cubrir)
                          const reqsEnCol = eng.reqs.filter((r) =>
                            matchesCargo(r.cargo_requerido, cargo) &&
                            rangoSolapan(r.fecha_inicio, r.fecha_fin, col.inicio, col.fin)
                          );
                          const unfilledReqs = reqsEnCol.slice(activos.length);

                          return (
                            <td key={i} className="py-0.5 px-1">
                              <div className="flex flex-wrap gap-1 justify-center min-h-[36px] items-center">
                                {/* Personas asignadas con botón X */}
                                {activos.map((p) => (
                                  <div key={p.asignacionId}
                                    title={`${p.nombre} ${p.apellido} · ${p.pct}%`}
                                    className="flex flex-col items-center gap-0.5 relative group/persona">
                                    <div
                                      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shadow-sm"
                                      style={{
                                        backgroundColor: cargoColor,
                                        opacity: desasignando === p.asignacionId ? 0.4 : esHoy ? 1 : 0.75,
                                        outline: esHoy ? `2px solid ${cargoColor}` : "none",
                                        outlineOffset: "2px",
                                      }}>
                                      {iniciales(p.nombre, p.apellido)}
                                    </div>
                                    {/* X para desasignar */}
                                    <button
                                      onClick={() => handleDesasignar(p.asignacionId)}
                                      title="Desasignar"
                                      className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white opacity-0 group-hover/persona:opacity-100 flex items-center justify-center transition-opacity z-10 hover:bg-red-600"
                                    >
                                      <span className="text-[9px] leading-none font-bold">×</span>
                                    </button>
                                    <span className="text-[9px] font-bold px-1 rounded-full leading-tight"
                                      style={{
                                        background: esHoy ? "#dbeafe" : "#f1f5f9",
                                        color: esHoy ? "#1d4ed8" : "#64748b",
                                      }}>
                                      {p.pct}%
                                    </span>
                                  </div>
                                ))}

                                {/* Slots vacíos — clicables y drop targets */}
                                {unfilledReqs.map((req) => {
                                  const isDragOver = dragOverReqId === req.id;
                                  return (
                                    <div
                                      key={`vacio-${req.id}`}
                                      title="Clic para asignar · Arrastra una persona aquí"
                                      onClick={() => onOpenPanel?.({
                                        reqId: req.id,
                                        engId: eng.id,
                                        engNombre: eng.nombre,
                                        engCliente: eng.cliente ?? "",
                                      })}
                                      onDragOver={(e) => { e.preventDefault(); setDragOverReqId(req.id); }}
                                      onDragLeave={() => setDragOverReqId(null)}
                                      onDrop={(e) => handleDrop(e, eng, req)}
                                      className="w-7 h-7 rounded-full flex items-center justify-center cursor-pointer transition-all duration-150"
                                      style={{
                                        border: `2px dashed ${cargoColor}`,
                                        opacity: isDragOver ? 1 : 0.6,
                                        background: isDragOver ? `${cargoColor}22` : "transparent",
                                        transform: isDragOver ? "scale(1.15)" : "scale(1)",
                                      }}
                                    >
                                      <span className="text-[10px] font-bold" style={{ color: cargoColor }}>+</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  });

                  const filaAusentes = (
                    <tr key={`aus-${eng.id}`}>
                      <td className="pr-3 py-0.5 sticky left-0 bg-white z-10">
                        <p className="text-orange-400 pl-3 text-[11px]">Ausentes</p>
                      </td>
                      {columnas.map((col, i) => {
                        const ausentesEnCol = ausencias.filter((a) =>
                          personaIdsEng.has(a.persona_id) &&
                          rangoSolapan(a.fecha_inicio, a.fecha_fin, col.inicio, col.fin)
                        );
                        const vistos = new Set<string>();
                        const ausUnicos = ausentesEnCol.reduce<PersonaAsig[]>((acc, a) => {
                          if (vistos.has(a.persona_id)) return acc;
                          vistos.add(a.persona_id);
                          const p = eng.personas.find((pe) => pe.id === a.persona_id);
                          if (p) acc.push(p);
                          return acc;
                        }, []);
                        return (
                          <td key={i} className="py-0.5 px-1">
                            <div className="flex flex-wrap gap-1 justify-center min-h-[28px] items-center">
                              {ausUnicos.map((p) => (
                                <div key={p.id} title={`${p.nombre} ${p.apellido} — ausente`}
                                  className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold"
                                  style={{ background: "#fed7aa", color: "#c2410c" }}>
                                  {iniciales(p.nombre, p.apellido)}
                                </div>
                              ))}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );

                  return [separador, filaHdr, ...filasCargo, filaAusentes].filter(Boolean);
                });

                return [filaSeccion, ...filasEngs];
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal detalle engagement ── */}
      {engModal && (
        <div className="absolute inset-0 bg-black/10 rounded-xl z-20 flex items-start justify-end p-3">
          <div
            ref={modalRef}
            className="bg-white rounded-xl shadow-xl border border-gray-100 w-80 flex flex-col overflow-hidden"
            style={{ maxHeight: "96%" }}
          >
            {/* Header */}
            <div className="p-4 pb-3 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{
                        background: engModal.tipo === "proyecto" ? "#eaf4ff" : engModal.tipo === "propuesta" ? "#f5f0ff" : "#f0fdf4",
                        color:      engModal.tipo === "proyecto" ? "#1a5276"  : engModal.tipo === "propuesta" ? "#6b21a8"  : "#15803d",
                      }}>
                      {engModal.tipo === "proyecto" ? "Proyecto" : engModal.tipo === "propuesta" ? "Propuesta" : "Ayuda interna"}
                    </span>
                  </div>
                  <h3 className="font-bold text-[#1a1a2e] text-sm leading-tight">{engModal.nombre}</h3>
                  {engModal.cliente && (
                    <p className="text-xs text-gray-400 mt-0.5">{engModal.cliente}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => { setEngToEdit(engModal.raw); setFormOpen(true); setEngModal(null); }}
                    title="Editar"
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setEngModal(null)}
                    title="Cerrar"
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Body scrolleable */}
            <div className="overflow-y-auto p-4 flex-1 space-y-4">

              {/* Fechas */}
              <div className="flex items-start gap-2.5">
                <Calendar className="w-3.5 h-3.5 text-gray-300 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Fechas</p>
                  <p className="text-xs text-[#1a1a2e]">
                    {engModal.fecha_inicio
                      ? format(new Date(engModal.fecha_inicio + "T00:00:00"), "d 'de' MMM yyyy", { locale: es })
                      : "—"}
                    {" → "}
                    {engModal.fecha_fin
                      ? format(new Date(engModal.fecha_fin + "T00:00:00"), "d 'de' MMM yyyy", { locale: es })
                      : "Sin fecha de término"}
                  </p>
                </div>
              </div>

              {/* Industria */}
              {(modalIndustria || engModal.raw.industria_id) && (
                <div className="flex items-start gap-2.5">
                  <Building2 className="w-3.5 h-3.5 text-gray-300 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Industria</p>
                    <p className="text-xs text-[#1a1a2e]">
                      {modalIndustria ?? <span className="text-gray-300 italic">Cargando...</span>}
                    </p>
                  </div>
                </div>
              )}

              {/* Descripción */}
              {engModal.raw.descripcion && (
                <div className="flex items-start gap-2.5">
                  <AlignLeft className="w-3.5 h-3.5 text-gray-300 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Descripción</p>
                    <p className="text-xs text-[#555] leading-relaxed whitespace-pre-line">{engModal.raw.descripcion}</p>
                  </div>
                </div>
              )}

              {/* Roles / perfiles requeridos */}
              {engModal.reqs.length > 0 && (() => {
                const cargosUnicos = Array.from(
                  new Set(engModal.reqs.map((r) => r.cargo_requerido).filter(Boolean) as string[])
                ).sort((a, b) => (JERARQUIA[a] ?? 99) - (JERARQUIA[b] ?? 99));
                return (
                  <div className="flex items-start gap-2.5">
                    <Briefcase className="w-3.5 h-3.5 text-gray-300 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Perfiles requeridos</p>
                      <div className="flex flex-wrap gap-1.5">
                        {cargosUnicos.map((c) => {
                          const count = engModal.reqs.filter((r) => r.cargo_requerido === c).length;
                          return (
                            <span key={c} className="text-[11px] px-2 py-0.5 rounded-full bg-[#f1f5f9] text-[#475569] font-medium">
                              {c}{count > 1 && <span className="ml-1 text-[#94a3b8]">×{count}</span>}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Personas asignadas actualmente */}
              {engModal.personas.length > 0 && (
                <div className="flex items-start gap-2.5">
                  <Users className="w-3.5 h-3.5 text-gray-300 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Equipo asignado</p>
                    <div className="space-y-1">
                      {engModal.personas.map((p) => (
                        <div key={p.asignacionId} className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <div
                              className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                              style={{ background: COLORES[normalizeCargoDisplay(p.cargo ?? "")] ?? COLOR_DEFAULT }}
                            >
                              {(p.nombre[0] ?? "")}{(p.apellido[0] ?? "")}
                            </div>
                            <span className="text-xs truncate text-[#1a1a2e]">{p.nombre} {p.apellido}</span>
                          </div>
                          <span className="text-[10px] text-gray-400 flex-shrink-0">{p.pct}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* Modal crear / editar engagement */}
      <EngagementForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSuccess={() => { setFormOpen(false); refresh(); }}
        engagement={engToEdit}
      />

    </div>
  );
}
