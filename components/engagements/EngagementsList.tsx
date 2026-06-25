"use client";

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import Link from "next/link";
import {
  Plus, AlertTriangle, Circle, Trash2, RotateCcw, X, Archive, Search,
  ChevronLeft, ChevronRight, ChevronDown, Minimize2, Maximize2,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { createClient } from "@/lib/supabase/client";
import { createAnyClient } from "@/lib/supabase/client";
import {
  fetchEngagementsConCobertura,
  fetchEngagementsPasados,
} from "@/lib/queries/engagements";
import { limpiarEngagementsCaducados, diasRestantesPapelera } from "@/lib/tasks/cleanupEngagements";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { EngagementForm } from "./EngagementForm";
import { CARGO_COLORS, CARGO_COLOR_DEFAULT } from "@/lib/constants";
import type { EngagementConCobertura } from "@/lib/queries/engagements";
import type { Engagement, RolSistema } from "@/lib/types/database";

interface Props { rolActual: RolSistema | null; }
interface EngEliminado extends Engagement { deleted_at: string; }
type Vista = "principal" | "papelera" | "historico";

// Columnas cuyo dato vive en tablas relacionales: el servidor no puede filtrarlas,
// se manejan solo en cliente. Pasar "" al servidor evita que borre los registros.
const COLUMNAS_ENRIQUECIDAS = new Set(["industria", "tematicas", "capacidades", "participantes"]);

interface EngExtra {
  industria: string | null;
  tematicas: string[];
  capacidades: string[];
  participantes: { nombre: string; apellido: string; cargo: string; iniciales?: string | null }[];
}

// ── Secciones multi-tabla por tipo ──────────────────────────────────
const SECCIONES_DEF = [
  { tipo: "proyecto",      titulo: "Proyectos",              color: "#4a90e2", msgVacio: "No hay proyectos que coincidan con la búsqueda." },
  { tipo: "propuesta",     titulo: "Propuestas comerciales", color: "#9b59b6", msgVacio: "No hay propuestas que coincidan con la búsqueda." },
  { tipo: "ayuda_interna", titulo: "Desarrollo interno",          color: "#27ae60", msgVacio: "No hay elementos de desarrollo interno que coincidan." },
] as const;

const COLS_TABLA = ["Código","Proyecto","Cliente","Industria","Temáticas","Participantes","Capacidades","Inicio","Término","Descripción"] as const;
const COLS_SOLO_DETALLE = new Set(["Cliente","Industria","Temáticas","Participantes","Capacidades","Inicio","Término","Descripción"]);

function SeccionesTablaEngagements({
  engagements,
  extra,
  isAdmin,
  hayBusqueda,
  onPapelera,
  rolActual,
}: {
  engagements: (EngagementConCobertura | Engagement)[];
  extra: Map<string, EngExtra>;
  isAdmin: boolean;
  hayBusqueda: boolean;
  onPapelera?: (id: string, nombre: string) => void;
  rolActual: RolSistema | null;
}) {
  // Nivel 1: secciones colapsadas (tipo → collapsed)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  // Vista compacta por sección (tipo → true = solo Código+Proyecto)
  const [isCompactView, setIsCompactView] = useState<Record<string, boolean>>({});
  // Nivel 2: filas expandidas para detalle (id → expanded)
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const fmt = (d: string | null | undefined) =>
    d ? format(new Date(d + "T00:00:00"), "d MMM yy", { locale: es }) : "—";

  const toggleSection = (tipo: string) =>
    setCollapsedSections((prev) => ({ ...prev, [tipo]: !prev[tipo] }));
  const toggleCompact = (tipo: string, ev: React.MouseEvent) => {
    ev.stopPropagation();
    setIsCompactView((prev) => ({ ...prev, [tipo]: !prev[tipo] }));
  };
  const toggleRow = (id: string) =>
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));

  if (engagements.length === 0 && !hayBusqueda) return (
    <div className="text-center py-12 text-[#888]">
      <Circle className="w-10 h-10 mx-auto mb-3 opacity-20" />
      <p className="text-sm font-medium">No hay proyectos activos.</p>
    </div>
  );

  // colSpan calculado dinámicamente por sección según modo vista
  const getColSpan = (tipo: string) => {
    const compact = !!isCompactView[tipo];
    const visibles = COLS_TABLA.filter((h) => !compact || !COLS_SOLO_DETALLE.has(h)).length;
    return visibles + (isAdmin ? 1 : 0);
  };

  return (
    <div className="space-y-8">
      {SECCIONES_DEF.map(({ tipo, titulo, color, msgVacio }) => {
        const lista = engagements.filter((e) => e.tipo === tipo);
        if (!hayBusqueda && lista.length === 0) return null;

        const collapsed = !!collapsedSections[tipo];
        const compact = !!isCompactView[tipo];
        const Chevron = collapsed ? ChevronRight : ChevronDown;
        const colSpan = getColSpan(tipo);

        return (
          <div key={tipo}>
            {/* Header de sección — clickeable para colapsar/expandir */}
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => toggleSection(tipo)}
                className="flex items-center gap-2 flex-1 text-left group min-w-0"
              >
                <Chevron className="w-3.5 h-3.5 flex-shrink-0 transition-transform" style={{ color }} />
                <div className="w-1 h-5 rounded-full flex-shrink-0" style={{ background: color }} />
                <h2 className="text-sm font-bold text-[#1a1a1a] uppercase tracking-wide group-hover:text-[#4a90e2] transition-colors">{titulo}</h2>
                <span className="text-xs text-[#aaa] font-medium">{lista.length}</span>
                <div className="flex-1 h-px rounded-full" style={{ background: color, opacity: 0.2 }} />
              </button>
              {/* Toggle vista compacta/detallada */}
              {!collapsed && (
                <button
                  onClick={(ev) => toggleCompact(tipo, ev)}
                  className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-[#e8e8e8] hover:bg-[#f5f5f5] text-[#888] hover:text-[#555] transition-colors flex-shrink-0"
                  title={compact ? "Cambiar a Vista Detallada" : "Cambiar a Vista General"}
                >
                  {compact
                    ? <><Maximize2 className="w-3 h-3" /> Vista Detallada</>
                    : <><Minimize2 className="w-3 h-3" /> Vista General</>
                  }
                </button>
              )}
            </div>

            {/* Tabla — oculta si la sección está colapsada */}
            {!collapsed && (
              <div className="overflow-x-auto rounded-xl border border-[#e8e8e8]">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#f5f5f5] border-b border-[#e8e8e8]">
                      {COLS_TABLA.map((h) => (
                        <th key={h} className={`px-3 py-2.5 text-left text-[10px] font-bold text-[#888] uppercase tracking-wide whitespace-nowrap${compact && COLS_SOLO_DETALLE.has(h) ? " hidden" : ""}`}>{h}</th>
                      ))}
                      {isAdmin && <th className="px-3 py-2.5" />}
                    </tr>
                  </thead>
                  <tbody>
                    {lista.length === 0 ? (
                      <tr>
                        <td colSpan={colSpan} className="px-3 py-6 text-center text-xs text-[#aaa] italic">
                          {msgVacio}
                        </td>
                      </tr>
                    ) : lista.map((e, idx) => {
                      const ex = extra.get(e.id);
                      const eng = e as EngagementConCobertura;
                      const fechaFin = (e as any).fecha_fin_real ?? e.fecha_fin_estimada;
                      const rowExpanded = !!expandedRows[e.id];
                      const RowChevron = rowExpanded ? ChevronDown : ChevronRight;
                      const base = idx % 2 !== 0 ? "bg-[#fafafa]/50" : "";

                      return (
                        <Fragment key={e.id}>
                          {/* ── Fila principal compacta ── */}
                          <tr className={`border-b border-[#f0f0f0] hover:bg-[#fafafa] transition-colors ${base}`}>
                            {/* Código — toggle fila */}
                            <td
                              className="px-3 py-3 font-mono text-[11px] text-[#4a90e2] whitespace-nowrap cursor-pointer select-none"
                              onClick={() => toggleRow(e.id)}
                            >
                              <div className="flex items-center gap-1">
                                <RowChevron className="w-3 h-3 flex-shrink-0 text-[#bbb]" />
                                {e.codigo || "—"}
                              </div>
                            </td>
                            {/* Proyecto */}
                            <td className="px-3 py-3 min-w-[160px]">
                              <div className="flex items-center gap-1.5">
                                <Link href={`/engagements/${e.id}`} className="font-semibold text-[#1a1a1a] hover:text-[#4a90e2] hover:underline transition-colors leading-tight">
                                  {e.nombre}
                                </Link>
                                {eng.tiene_alerta && !(rolActual === "GyD" || rolActual === "AySr" || rolActual === "planificador" || rolActual === "Desarrollo") && <span title="Sin cobertura"><AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" /></span>}
                              </div>
                            </td>
                            {/* Cliente */}
                            <td className={`px-3 py-3 text-[#555] whitespace-nowrap${compact ? " hidden" : ""}`}>{e.cliente || "—"}</td>
                            {/* Industria */}
                            <td className={`px-3 py-3 text-[#555] whitespace-nowrap${compact ? " hidden" : ""}`}>{ex?.industria || "—"}</td>
                            {/* Temáticas — compacto: solo los primeros 2 badges */}
                            <td className={`px-3 py-3 min-w-[120px]${compact ? " hidden" : ""}`}>
                              {ex?.tematicas.length ? (
                                <div className="flex flex-wrap gap-1">
                                  {(rowExpanded ? ex.tematicas : ex.tematicas.slice(0, 2)).map((t) => (
                                    <span key={t} className="px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 text-[10px] font-medium whitespace-nowrap">{t}</span>
                                  ))}
                                  {!rowExpanded && ex.tematicas.length > 2 && (
                                    <span className="text-[10px] text-[#aaa]">+{ex.tematicas.length - 2}</span>
                                  )}
                                </div>
                              ) : <span className="text-[#ccc]">—</span>}
                            </td>
                            {/* Participantes — compacto: solo iniciales */}
                            <td className={`px-3 py-3 min-w-[100px]${compact ? " hidden" : ""}`}>
                              {ex?.participantes.length ? (
                                <div className="flex flex-wrap gap-1">
                                  {(rowExpanded ? ex.participantes : ex.participantes.slice(0, 4)).map((p) => {
                                    const c = CARGO_COLORS[p.cargo] ?? CARGO_COLOR_DEFAULT;
                                    const ini = p.iniciales?.trim() ? p.iniciales.trim().toUpperCase().slice(0, 3) : `${p.nombre[0] ?? ""}${p.apellido[0] ?? ""}`.toUpperCase();
                                    return rowExpanded ? (
                                      <span key={`${p.nombre}${p.apellido}`}
                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border border-[#e8e8e8] bg-white whitespace-nowrap"
                                        title={`${p.cargo}: ${p.nombre} ${p.apellido}`}>
                                        <span className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0" style={{ background: c }}>{ini}</span>
                                        <span className="text-[#555]">{p.nombre[0]}. {p.apellido}</span>
                                      </span>
                                    ) : (
                                      <span key={`${p.nombre}${p.apellido}`}
                                        className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0"
                                        style={{ background: c }}
                                        title={`${p.cargo}: ${p.nombre} ${p.apellido}`}>{ini}</span>
                                    );
                                  })}
                                  {!rowExpanded && ex.participantes.length > 4 && (
                                    <span className="text-[10px] text-[#aaa] self-center">+{ex.participantes.length - 4}</span>
                                  )}
                                </div>
                              ) : <span className="text-[#ccc]">—</span>}
                            </td>
                            {/* Capacidades — compacto: primeros 2 */}
                            <td className={`px-3 py-3 min-w-[120px]${compact ? " hidden" : ""}`}>
                              {ex?.capacidades.length ? (
                                <div className="flex flex-wrap gap-1">
                                  {(rowExpanded ? ex.capacidades : ex.capacidades.slice(0, 2)).map((cap) => (
                                    <span key={cap} className="px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-medium whitespace-nowrap">{cap}</span>
                                  ))}
                                  {!rowExpanded && ex.capacidades.length > 2 && (
                                    <span className="text-[10px] text-[#aaa]">+{ex.capacidades.length - 2}</span>
                                  )}
                                </div>
                              ) : <span className="text-[#ccc]">—</span>}
                            </td>
                            {/* Inicio */}
                            <td className={`px-3 py-3 text-[#555] whitespace-nowrap${compact ? " hidden" : ""}`}>{fmt(e.fecha_inicio)}</td>
                            {/* Término */}
                            <td className={`px-3 py-3 text-[#555] whitespace-nowrap${compact ? " hidden" : ""}`}>{fmt(fechaFin)}</td>
                            {/* Descripción — compacto: truncada */}
                            <td className={`px-3 py-3 text-[#888] max-w-[200px]${compact ? " hidden" : ""}`}>
                              <p className={rowExpanded ? "whitespace-pre-wrap break-words" : "truncate"} title={e.descripcion ?? ""}>
                                {e.descripcion || "—"}
                              </p>
                            </td>
                            {isAdmin && (
                              <td className="px-3 py-3">
                                <button onClick={() => onPapelera?.(e.id, e.nombre)}
                                  className="p-1 rounded hover:bg-red-50 text-[#ccc] hover:text-red-400 transition-colors"
                                  title="Mover a papelera">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            )}
                          </tr>

                          {/* ── Sub-fila de detalle (solo si expandida) ── */}
                          {rowExpanded && (
                            <tr key={`${e.id}-detail`} className={`border-b border-[#e8e8e8] ${base}`}>
                              <td colSpan={colSpan} className="px-5 py-3 bg-[#f8faff]">
                                <div className="flex flex-wrap gap-6 text-xs text-[#555]">
                                  {ex?.participantes.length ? (
                                    <div>
                                      <p className="text-[10px] font-bold text-[#aaa] uppercase tracking-wide mb-1.5">Equipo</p>
                                      <div className="flex flex-col gap-1">
                                        {ex.participantes.map((p) => {
                                          const c = CARGO_COLORS[p.cargo] ?? CARGO_COLOR_DEFAULT;
                                          return (
                                            <div key={`${p.nombre}${p.apellido}`} className="flex items-center gap-2">
                                              <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0"
                                                style={{ background: c }}>
                                                {p.iniciales?.trim() ? p.iniciales.trim().toUpperCase().slice(0, 3) : `${p.nombre[0] ?? ""}${p.apellido[0] ?? ""}`.toUpperCase()}
                                              </span>
                                              <span className="font-medium">{p.nombre} {p.apellido}</span>
                                              <span className="text-[#aaa]">·</span>
                                              <span className="text-[#888]">{p.cargo || "Sin cargo"}</span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ) : null}
                                  {e.descripcion && (
                                    <div className="flex-1 min-w-[200px]">
                                      <p className="text-[10px] font-bold text-[#aaa] uppercase tracking-wide mb-1.5">Descripción</p>
                                      <p className="text-[#555] leading-relaxed">{e.descripcion}</p>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
}

function resolveInd(ex: EngExtra | undefined): string {
  const v = ex?.industria;
  if (v == null) return "";
  return typeof v === "object" ? (v as any).nombre ?? "" : v;
}
function resolveTxt(arr: unknown[] | undefined): string {
  return (arr ?? []).map((x) => (typeof x === "object" ? (x as any).nombre ?? "" : x ?? "")).join(" ");
}

function matchEngagement(e: { codigo?: string | null; nombre: string; cliente?: string | null; descripcion?: string | null }, ex: EngExtra | undefined, columna: string, q: string): boolean {
  switch (columna) {
    case "codigo":        return norm(e.codigo ?? "").includes(q);
    case "proyecto":      return norm(e.nombre).includes(q);
    case "cliente":       return norm(e.cliente ?? "").includes(q);
    case "descripcion":   return norm(e.descripcion ?? "").includes(q);
    case "industria":     return norm(resolveInd(ex)).includes(q);
    case "tematicas":     return norm(resolveTxt(ex?.tematicas)).includes(q);
    case "capacidades":   return norm(resolveTxt(ex?.capacidades)).includes(q);
    case "participantes": return (ex?.participantes ?? []).some((p) => norm(`${p.nombre} ${p.apellido}`).includes(q));
    default:
      return (
        norm(e.codigo ?? "").includes(q) ||
        norm(e.nombre).includes(q) ||
        norm(e.cliente ?? "").includes(q) ||
        norm(e.descripcion ?? "").includes(q) ||
        norm(resolveInd(ex)).includes(q) ||
        norm(resolveTxt(ex?.tematicas)).includes(q) ||
        norm(resolveTxt(ex?.capacidades)).includes(q) ||
        (ex?.participantes ?? []).some((p) => norm(`${p.nombre} ${p.apellido}`).includes(q))
      );
  }
}

// ── Componente principal ─────────────────────────────────────────────
export function EngagementsList({ rolActual }: Props) {
  const [engagements, setEngagements] = useState<EngagementConCobertura[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [vista, setVista] = useState<Vista>("principal");

  // Papelera
  const [eliminados, setEliminados] = useState<EngEliminado[]>([]);
  const [loadingPapelera, setLoadingPapelera] = useState(false);

  // Histórico
  const [historico, setHistorico] = useState<Engagement[]>([]);
  const [loadingHistorico, setLoadingHistorico] = useState(false);
  const [paginaHistorico, setPaginaHistorico] = useState(1);
  const [totalPaginasHistorico, setTotalPaginasHistorico] = useState(1);
  const [totalHistorico, setTotalHistorico] = useState(0);
  const [busqueda, setBusqueda] = useState("");
  const [busquedaInput, setBusquedaInput] = useState("");
  const [columnaFiltro, setColumnaFiltro] = useState("todas");
  const [historicoExtra, setHistoricoExtra] = useState<Map<string, EngExtra>>(new Map());

  // Búsqueda en vista principal
  const [principalBusqueda, setPrincipalBusqueda] = useState("");
  const [principalColumna, setPrincipalColumna] = useState("todas");
  const [principalExtra, setPrincipalExtra] = useState<Map<string, EngExtra>>(new Map());

  // Confirmaciones
  const [confirmPapelera, setConfirmPapelera] = useState<{ id: string; nombre: string } | null>(null);
  const [confirmDefinitivo, setConfirmDefinitivo] = useState<{ id: string; nombre: string } | null>(null);
  const [accionando, setAccionando] = useState(false);
  const [papeleraCount, setPapeleraCount] = useState(0);

  const isAdmin = rolActual === "admin";
  const sb = createAnyClient();

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await fetchEngagementsConCobertura(supabase);
    setEngagements(data);
    setLoading(false);
  }, []);

  const loadPapelera = useCallback(async () => {
    setLoadingPapelera(true);
    await limpiarEngagementsCaducados(sb);
    const { data } = await sb
      .from("engagement").select("*").eq("is_deleted", true).order("deleted_at", { ascending: false });
    const items = (data ?? []) as EngEliminado[];
    setEliminados(items);
    setPapeleraCount(items.length); // sync conteo real tras limpieza automática
    setLoadingPapelera(false);
  }, []);

  const loadHistorico = useCallback(async (pagina: number, texto: string) => {
    setLoadingHistorico(true);
    const supabase = createClient();
    const res = await fetchEngagementsPasados(supabase, pagina, texto);
    setHistorico(res.data);
    setTotalHistorico(res.total);
    setTotalPaginasHistorico(res.totalPaginas);
    setLoadingHistorico(false);
  }, []);

  useEffect(() => {
    load();
    // Conteo inicial de papelera (sin cargar datos completos)
    sb.from("engagement").select("id", { count: "exact", head: true }).eq("is_deleted", true)
      .then(({ count }: { count: number | null }) => setPapeleraCount(count ?? 0));
  }, [load]);
  useEffect(() => { if (vista === "papelera") loadPapelera(); }, [vista, loadPapelera]);
  useEffect(() => { if (vista === "historico") loadHistorico(paginaHistorico, busqueda); }, [vista, paginaHistorico, busqueda, loadHistorico]);

  // Debounce: sincroniza busquedaInput → busqueda para disparar fetch en servidor.
  // Para columnas enriquecidas (relaciones), el servidor no conoce esos datos:
  // se pasa "" para que traiga todos los registros y el filtro corra solo en cliente.
  useEffect(() => {
    const t = setTimeout(() => {
      setPaginaHistorico(1);
      setBusqueda(COLUMNAS_ENRIQUECIDAS.has(columnaFiltro) ? "" : busquedaInput);
    }, 400);
    return () => clearTimeout(t);
  }, [busquedaInput, columnaFiltro]);

  // Filtro client-side histórico: delega en matchEngagement
  const historicoFiltrado = useMemo(() => {
    const q = norm(busquedaInput.trim());
    if (!q) return historico;
    return historico.filter((e) => matchEngagement(e, historicoExtra.get(e.id), columnaFiltro, q));
  }, [busquedaInput, columnaFiltro, historico, historicoExtra]);

  // Enriquecimiento para vista principal (industria, tematicas, capacidades, participantes)
  useEffect(() => {
    if (engagements.length === 0) { setPrincipalExtra(new Map()); return; }
    const ids = engagements.map((e) => e.id);
    Promise.all([
      sb.from("cat_industria").select("id, nombre"),
      (sb as any).from("engagement_tematica").select("engagement_id, cat_tematica(nombre)").in("engagement_id", ids),
      (sb as any).from("engagement_capacidad").select("engagement_id, cat_capacidad(nombre)").in("engagement_id", ids),
      (sb as any).from("asignacion").select("engagement_id, persona:persona_id(nombre, apellido, cargo_actual, iniciales)").in("engagement_id", ids),
    ]).then(([indRes, temRes, capRes, asigRes]) => {
      const indMap = new Map<string, string>((indRes.data ?? []).map((r: any) => [r.id, r.nombre]));
      const map = new Map<string, EngExtra>();
      for (const eng of engagements) {
        map.set(eng.id, {
          industria: eng.industria_id ? (indMap.get(eng.industria_id) ?? null) : null,
          tematicas: ((temRes.data ?? []) as any[]).filter((r) => r.engagement_id === eng.id).map((r) => r.cat_tematica?.nombre).filter(Boolean),
          capacidades: ((capRes.data ?? []) as any[]).filter((r) => r.engagement_id === eng.id).map((r) => r.cat_capacidad?.nombre).filter(Boolean),
          participantes: ((asigRes.data ?? []) as any[])
            .filter((r) => r.engagement_id === eng.id && r.persona)
            .map((r) => ({ nombre: r.persona.nombre, apellido: r.persona.apellido, cargo: r.persona.cargo_actual ?? "", iniciales: r.persona.iniciales ?? null }))
            .filter((p, i, arr) => arr.findIndex((x) => x.nombre === p.nombre && x.apellido === p.apellido) === i),
        });
      }
      setPrincipalExtra(map);
    });
  }, [engagements]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtro client-side vista principal
  const engagementsFiltrados = useMemo(() => {
    const q = norm(principalBusqueda.trim());
    if (!q) return engagements;
    return engagements.filter((e) => matchEngagement(e, principalExtra.get(e.id), principalColumna, q));
  }, [principalBusqueda, principalColumna, engagements, principalExtra]);

  // Enriquecer datos del histórico (industria, tematicas, capacidades, participantes)
  useEffect(() => {
    if (historico.length === 0) { setHistoricoExtra(new Map()); return; }
    const ids = historico.map((e) => e.id);
    Promise.all([
      // industrias únicas
      sb.from("cat_industria").select("id, nombre"),
      // tematicas por engagement
      (sb as any).from("engagement_tematica").select("engagement_id, cat_tematica(nombre)").in("engagement_id", ids),
      // capacidades por engagement
      (sb as any).from("engagement_capacidad").select("engagement_id, cat_capacidad(nombre)").in("engagement_id", ids),
      // participantes (asignaciones, cualquier estado)
      (sb as any).from("asignacion").select("engagement_id, persona:persona_id(nombre, apellido, cargo_actual, iniciales)").in("engagement_id", ids),
    ]).then(([indRes, temRes, capRes, asigRes]) => {
      const indMap = new Map<string, string>((indRes.data ?? []).map((r: any) => [r.id, r.nombre]));
      const map = new Map<string, EngExtra>();
      for (const eng of historico) {
        map.set(eng.id, {
          industria: eng.industria_id ? (indMap.get(eng.industria_id) ?? null) : null,
          tematicas: ((temRes.data ?? []) as any[]).filter((r) => r.engagement_id === eng.id).map((r) => r.cat_tematica?.nombre).filter(Boolean),
          capacidades: ((capRes.data ?? []) as any[]).filter((r) => r.engagement_id === eng.id).map((r) => r.cat_capacidad?.nombre).filter(Boolean),
          participantes: ((asigRes.data ?? []) as any[])
            .filter((r) => r.engagement_id === eng.id && r.persona)
            .map((r) => ({ nombre: r.persona.nombre, apellido: r.persona.apellido, cargo: r.persona.cargo_actual ?? "", iniciales: r.persona.iniciales ?? null }))
            .filter((p, i, arr) => arr.findIndex((x) => x.nombre === p.nombre && x.apellido === p.apellido) === i),
        });
      }
      setHistoricoExtra(map);
    });
  }, [historico]); // eslint-disable-line react-hooks/exhaustive-deps

  async function moverAPapelera(id: string) {
    setAccionando(true);
    await sb.from("engagement").update({ is_deleted: true, deleted_at: new Date().toISOString() }).eq("id", id);
    setAccionando(false);
    setConfirmPapelera(null);
    // Filtro optimista en ambas listas + actualizo contador
    setEngagements((prev) => prev.filter((e) => e.id !== id));
    setHistorico((prev) => prev.filter((e) => e.id !== id));
    setTotalHistorico((prev) => Math.max(0, prev - 1));
    setPapeleraCount((prev) => prev + 1);
  }

  async function restaurar(id: string) {
    await sb.from("engagement").update({ is_deleted: false, deleted_at: null }).eq("id", id);
    setPapeleraCount((prev) => Math.max(0, prev - 1));
    // Recarga en paralelo: papelera + vista principal.
    // La vista histórica se recarga sola al navegar a ella (useEffect por vista).
    // Las relaciones de staffing (asignaciones) no se tocan — soft delete preserva todo.
    await Promise.all([loadPapelera(), load()]);
  }

  async function eliminarDefinitivo(id: string) {
    setAccionando(true);
    await sb.from("engagement").delete().eq("id", id);
    setAccionando(false);
    setConfirmDefinitivo(null);
    setPapeleraCount((prev) => Math.max(0, prev - 1));
    loadPapelera();
  }

  function handleBuscar(e: React.FormEvent) {
    e.preventDefault();
    setPaginaHistorico(1);
    setBusqueda(COLUMNAS_ENRIQUECIDAS.has(columnaFiltro) ? "" : busquedaInput);
  }

  if (loading) return <p className="text-sm text-[#888]">Cargando...</p>;

  // ── VISTA PAPELERA ──────────────────────────────────────────────────
  if (vista === "papelera") return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <button onClick={() => setVista("principal")} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
          <Trash2 className="w-4 h-4 text-[#888]" />
          <h2 className="text-sm font-bold text-[#1a1a1a]">Papelera de Reciclaje</h2>
        </div>
        <p className="text-xs text-[#aaa]">Eliminación definitiva a los 30 días.</p>
      </div>

      {loadingPapelera ? <p className="text-sm text-[#888]">Cargando...</p>
        : eliminados.length === 0 ? (
          <div className="text-center py-12 text-[#888]">
            <Trash2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">La papelera está vacía.</p>
          </div>
        ) : (
          <div className="space-y-2 max-w-4xl">
            {eliminados.map((e) => {
              const dias = diasRestantesPapelera(e.deleted_at);
              const urgente = dias <= 5;
              return (
                <div key={e.id} className="flex items-center gap-4 bg-white border border-[#e8e8e8] rounded-xl px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[15px] truncate text-[#888] line-through">{e.nombre}</p>
                    <p className="text-sm text-[#aaa] truncate">{e.cliente || "Sin cliente"}</p>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full font-semibold flex-shrink-0"
                    style={urgente ? { background: "#fef2f2", color: "#dc2626" } : { background: "#fefce8", color: "#ca8a04" }}>
                    {dias}d restantes
                  </span>
                  <button onClick={() => restaurar(e.id)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#e0e0e0] hover:bg-[#f5f5f5] text-[#555] transition-colors flex-shrink-0">
                    <RotateCcw className="w-3 h-3" /> Restaurar
                  </button>
                  {isAdmin && (
                    <button onClick={() => setConfirmDefinitivo({ id: e.id, nombre: e.nombre })}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-red-500 transition-colors flex-shrink-0">
                      <Trash2 className="w-3 h-3" /> Eliminar
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )
      }

      <ConfirmDialog open={!!confirmDefinitivo} onClose={() => setConfirmDefinitivo(null)}
        onConfirm={() => confirmDefinitivo && eliminarDefinitivo(confirmDefinitivo.id)}
        title="Eliminar definitivamente"
        message={`"${confirmDefinitivo?.nombre}" se eliminará permanentemente. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar definitivamente" loading={accionando}
      />
    </>
  );

  // ── VISTA HISTÓRICO ─────────────────────────────────────────────────
  if (vista === "historico") return (
    <>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setVista("principal")} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
          <Archive className="w-4 h-4 text-[#888]" />
          <h2 className="text-sm font-bold text-[#1a1a1a]">Archivo Histórico</h2>
          {totalHistorico > 0 && <span className="text-xs text-[#aaa]">({totalHistorico} proyectos)</span>}
        </div>
        {/* Buscador */}
        <form onSubmit={handleBuscar} className="flex items-center gap-2">
          <select
            value={columnaFiltro}
            onChange={(e) => setColumnaFiltro(e.target.value)}
            className="py-1.5 pl-2 pr-6 text-xs border border-[#e8e8e8] rounded-lg focus:outline-none focus:border-[#4a90e2] text-[#555] bg-white appearance-none cursor-pointer"
            style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23aaa'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center" }}
          >
            <option value="todas">Todas las columnas</option>
            <option value="codigo">Código</option>
            <option value="proyecto">Proyecto</option>
            <option value="cliente">Cliente</option>
            <option value="industria">Industria</option>
            <option value="tematicas">Temáticas</option>
            <option value="participantes">Participantes</option>
            <option value="capacidades">Capacidades</option>
            <option value="descripcion">Descripción</option>
          </select>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#aaa]" />
            <input
              type="text"
              value={busquedaInput}
              onChange={(e) => setBusquedaInput(e.target.value)}
              placeholder={columnaFiltro === "todas" ? "Buscar en historial..." : `Buscar por ${columnaFiltro}...`}
              className="pl-8 pr-3 py-1.5 text-xs border border-[#e8e8e8] rounded-lg focus:outline-none focus:border-[#4a90e2] w-48"
            />
          </div>
          <button type="submit" className="text-xs px-3 py-1.5 rounded-lg bg-[#f5f5f5] hover:bg-[#eee] text-[#555] transition-colors">
            Buscar
          </button>
          {busqueda && (
            <button type="button" onClick={() => { setBusquedaInput(""); setBusqueda(""); setPaginaHistorico(1); }}
              className="text-xs text-[#aaa] hover:text-[#555]">
              Limpiar
            </button>
          )}
        </form>
      </div>

      {busqueda && (
        <p className="text-xs text-[#888] mb-4">
          Buscando en historial: <span className="font-semibold text-[#1a1a1a]">"{busqueda}"</span>
        </p>
      )}

      {loadingHistorico ? (
        <p className="text-sm text-[#888]">Cargando historial...</p>
      ) : (
        <>
          {historicoFiltrado.length === 0 ? (
            <div className="text-center py-12 text-[#888]">
              <Archive className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">No hay proyectos en el historial.</p>
            </div>
          ) : (
          <div className="overflow-x-auto rounded-xl border border-[#e8e8e8]">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[#f5f5f5] border-b border-[#e8e8e8]">
                  {["Código","Proyecto","Cliente","Industria","Temáticas","Participantes","Capacidades","Inicio","Término","Descripción"].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-[#888] uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                  {isAdmin && <th className="px-3 py-2.5" />}
                </tr>
              </thead>
              <tbody>
                {historicoFiltrado.map((e, idx) => {
                  const ex = historicoExtra.get(e.id);
                  const fechaFin = e.fecha_fin_real ?? e.fecha_fin_estimada;
                  const fmt = (d: string | null) => d ? format(new Date(d + "T00:00:00"), "d MMM yy", { locale: es }) : "—";
                  return (
                    <tr key={e.id} className={`border-b border-[#f0f0f0] hover:bg-[#fafafa] transition-colors ${idx % 2 === 0 ? "" : "bg-[#fafafa]/50"}`}>
                      {/* Código */}
                      <td className="px-3 py-3 font-mono text-[11px] text-[#4a90e2] whitespace-nowrap">
                        {e.codigo || "—"}
                      </td>
                      {/* Nombre */}
                      <td className="px-3 py-3 min-w-[140px]">
                        <Link href={`/engagements/${e.id}`} className="font-semibold text-[#1a1a1a] hover:text-[#4a90e2] hover:underline transition-colors leading-tight block">
                          {e.nombre}
                        </Link>
                      </td>
                      {/* Cliente */}
                      <td className="px-3 py-3 text-[#555] whitespace-nowrap">{e.cliente || "—"}</td>
                      {/* Industria */}
                      <td className="px-3 py-3 text-[#555] whitespace-nowrap">{ex?.industria || "—"}</td>
                      {/* Temáticas */}
                      <td className="px-3 py-3 min-w-[120px]">
                        {ex?.tematicas.length ? (
                          <div className="flex flex-wrap gap-1">
                            {ex.tematicas.map((t) => (
                              <span key={t} className="px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 text-[10px] font-medium whitespace-nowrap">{t}</span>
                            ))}
                          </div>
                        ) : <span className="text-[#ccc]">—</span>}
                      </td>
                      {/* Participantes */}
                      <td className="px-3 py-3 min-w-[160px]">
                        {ex?.participantes.length ? (
                          <div className="flex flex-wrap gap-1">
                            {ex.participantes.map((p) => {
                              const color = CARGO_COLORS[p.cargo] ?? CARGO_COLOR_DEFAULT;
                              const initials = p.iniciales?.trim() ? p.iniciales.trim().toUpperCase().slice(0, 3) : `${p.nombre[0] ?? ""}${p.apellido[0] ?? ""}`.toUpperCase();
                              return (
                                <span key={`${p.nombre}${p.apellido}`}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border border-[#e8e8e8] bg-white whitespace-nowrap"
                                  title={`${p.cargo}: ${p.nombre} ${p.apellido}`}>
                                  <span className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0"
                                    style={{ background: color }}>{initials}</span>
                                  <span className="text-[#555]">{p.nombre[0]}. {p.apellido}</span>
                                </span>
                              );
                            })}
                          </div>
                        ) : <span className="text-[#ccc]">—</span>}
                      </td>
                      {/* Capacidades */}
                      <td className="px-3 py-3 min-w-[120px]">
                        {ex?.capacidades.length ? (
                          <div className="flex flex-wrap gap-1">
                            {ex.capacidades.map((c) => (
                              <span key={c} className="px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-medium whitespace-nowrap">{c}</span>
                            ))}
                          </div>
                        ) : <span className="text-[#ccc]">—</span>}
                      </td>
                      {/* Inicio */}
                      <td className="px-3 py-3 text-[#555] whitespace-nowrap">{fmt(e.fecha_inicio)}</td>
                      {/* Término */}
                      <td className="px-3 py-3 text-[#555] whitespace-nowrap">{fmt(fechaFin)}</td>
                      {/* Descripción */}
                      <td className="px-3 py-3 text-[#888] max-w-[200px]">
                        <p className="truncate" title={e.descripcion ?? ""}>{e.descripcion || "—"}</p>
                      </td>
                      {isAdmin && (
                        <td className="px-3 py-3">
                          <button onClick={() => setConfirmPapelera({ id: e.id, nombre: e.nombre })}
                            className="p-1 rounded hover:bg-red-50 text-[#ccc] hover:text-red-400 transition-colors"
                            title="Mover a papelera">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}

          {/* Paginación */}
          {totalPaginasHistorico > 1 && (
            <div className="flex items-center justify-center gap-3 mt-8">
              <button
                onClick={() => setPaginaHistorico((p) => Math.max(1, p - 1))}
                disabled={paginaHistorico === 1}
                className="p-2 rounded-lg border border-[#e8e8e8] hover:bg-[#f5f5f5] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-[#555]">
                Página <span className="font-semibold">{paginaHistorico}</span> de <span className="font-semibold">{totalPaginasHistorico}</span>
              </span>
              <button
                onClick={() => setPaginaHistorico((p) => Math.min(totalPaginasHistorico, p + 1))}
                disabled={paginaHistorico === totalPaginasHistorico}
                className="p-2 rounded-lg border border-[#e8e8e8] hover:bg-[#f5f5f5] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog open={!!confirmPapelera} onClose={() => setConfirmPapelera(null)}
        onConfirm={() => confirmPapelera && moverAPapelera(confirmPapelera.id)}
        title="Mover a la papelera"
        message={`¿Deseas mover "${confirmPapelera?.nombre}" a la papelera? Podrás recuperarlo durante los próximos 30 días.`}
        confirmLabel="Mover a papelera" loading={accionando}
      />
    </>
  );

  // ── VISTA PRINCIPAL ─────────────────────────────────────────────────
  return (
    <>
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-sm text-[#888]">
              {engagementsFiltrados.length !== engagements.length
                ? <>{engagementsFiltrados.length} <span className="text-[#bbb]">/ {engagements.length}</span></>
                : <>{engagements.length} proyecto{engagements.length !== 1 ? "s" : ""}</>
              }
            </p>
            <button onClick={() => setVista("historico")}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-[#e8e8e8] hover:bg-[#f5f5f5] text-[#888] transition-colors">
              <Archive className="w-3 h-3" />
              Archivo Histórico
            </button>
            {!(rolActual === "GyD" || rolActual === "AySr" || rolActual === "planificador" || rolActual === "Desarrollo") && (
            <button onClick={() => setVista("papelera")}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-[#e8e8e8] hover:bg-[#f5f5f5] text-[#888] transition-colors">
              <Trash2 className="w-3 h-3" />
              Papelera
              {papeleraCount > 0 && (
                <span className="ml-0.5 bg-red-100 text-red-600 rounded-full px-1.5 py-0 font-bold text-[10px] leading-4">
                  {papeleraCount}
                </span>
              )}
            </button>
            )}
          </div>
          {isAdmin && (
            <Button onClick={() => setDrawerOpen(true)} size="sm">
              <Plus className="w-3.5 h-3.5" /> Nuevo proyecto
            </Button>
          )}
        </div>

        {/* Buscador principal */}
        <div className="flex items-center gap-2">
          <select
            value={principalColumna}
            onChange={(e) => setPrincipalColumna(e.target.value)}
            className="py-1.5 pl-2 pr-6 text-xs border border-[#e8e8e8] rounded-lg focus:outline-none focus:border-[#4a90e2] text-[#555] bg-white appearance-none cursor-pointer"
            style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23aaa'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center" }}
          >
            <option value="todas">Todas las columnas</option>
            <option value="codigo">Código</option>
            <option value="proyecto">Proyecto</option>
            <option value="cliente">Cliente</option>
            <option value="industria">Industria</option>
            <option value="tematicas">Temáticas</option>
            <option value="participantes">Participantes</option>
            <option value="capacidades">Capacidades</option>
            <option value="descripcion">Descripción</option>
          </select>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#aaa]" />
            <input
              type="text"
              value={principalBusqueda}
              onChange={(e) => setPrincipalBusqueda(e.target.value)}
              placeholder={principalColumna === "todas" ? "Buscar proyectos..." : `Buscar por ${principalColumna}...`}
              className="pl-8 pr-3 py-1.5 text-xs border border-[#e8e8e8] rounded-lg focus:outline-none focus:border-[#4a90e2] w-52"
            />
          </div>
          {principalBusqueda && (
            <button type="button" onClick={() => setPrincipalBusqueda("")}
              className="text-xs text-[#aaa] hover:text-[#555]">
              Limpiar
            </button>
          )}
        </div>
      </div>

      <SeccionesTablaEngagements
        engagements={engagementsFiltrados}
        extra={principalExtra}
        isAdmin={isAdmin}
        hayBusqueda={!!principalBusqueda.trim()}
        onPapelera={(id, nombre) => setConfirmPapelera({ id, nombre })}
        rolActual={rolActual}
      />

      <EngagementForm open={drawerOpen} onClose={() => setDrawerOpen(false)} onSuccess={load} />

      <ConfirmDialog open={!!confirmPapelera} onClose={() => setConfirmPapelera(null)}
        onConfirm={() => confirmPapelera && moverAPapelera(confirmPapelera.id)}
        title="Mover a la papelera"
        message={`¿Estás seguro de que quieres mover "${confirmPapelera?.nombre}" a la papelera? Podrás recuperarlo durante los próximos 30 días.`}
        confirmLabel="Mover a papelera" loading={accionando}
      />
    </>
  );
}
