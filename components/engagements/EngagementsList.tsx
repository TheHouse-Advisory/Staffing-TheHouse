"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Plus, AlertTriangle, CheckCircle, Circle, ChevronRight,
  Trash2, RotateCcw, X, Archive, Search, ChevronLeft,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { fLocal } from "@/lib/utils";
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
import { ESTADO_ENGAGEMENT } from "@/lib/constants";
import type { EngagementConCobertura } from "@/lib/queries/engagements";
import type { Engagement, RolSistema } from "@/lib/types/database";

interface Props { rolActual: RolSistema | null; }
interface EngEliminado extends Engagement { deleted_at: string; }
type Vista = "principal" | "papelera" | "historico";

// ── Tarjeta de engagement reutilizable ──────────────────────────────
function EngCard({
  e,
  isAdmin,
  onPapelera,
}: {
  e: EngagementConCobertura | Engagement;
  isAdmin: boolean;
  onPapelera?: (id: string, nombre: string) => void;
}) {
  const eng = e as EngagementConCobertura;
  const estilos = ESTADO_ENGAGEMENT[(e as Engagement).estado] ?? ESTADO_ENGAGEMENT.activo;
  return (
    <div className="group flex items-center gap-4 bg-white border border-[#e8e8e8] rounded-xl px-5 py-4 hover:shadow-sm hover:border-[#d0d0d0] transition-all">
      <Link href={`/engagements/${e.id}`} className="flex items-center gap-4 flex-1 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="font-semibold text-[15px] truncate">{e.nombre}</p>
            {eng.tiene_alerta && <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
          </div>
          <p className="text-sm text-[#888] truncate">
            {e.cliente || <span className="italic text-[#bbb]">Sin cliente</span>}
          </p>
        </div>

        {e.fecha_inicio && (
          <p className="text-xs text-[#aaa] flex-shrink-0 hidden sm:block">
            {format(fLocal(e.fecha_inicio), "d MMM", { locale: es })}
            {e.fecha_fin_estimada && <> → {format(fLocal(e.fecha_fin_estimada), "d MMM yy", { locale: es })}</>}
          </p>
        )}

        {eng.requerimientos_total > 0 && (
          <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
            eng.tiene_alerta ? "bg-amber-50 text-amber-700" : "bg-[#dcf5e7] text-[#1e7e45]"
          }`}>
            {eng.tiene_alerta ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
            {eng.tiene_alerta ? "Sin cubrir" : "Cubierto"}
          </span>
        )}

        <span className="text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0"
          style={{ background: estilos.bg, color: estilos.text }}>
          {estilos.label}
        </span>
        <ChevronRight className="w-4 h-4 text-[#ccc] group-hover:text-[#888] transition-colors flex-shrink-0" />
      </Link>

      {isAdmin && onPapelera && (
        <button
          onClick={(ev) => { ev.preventDefault(); onPapelera(e.id, e.nombre); }}
          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-50 text-[#ccc] hover:text-red-400 transition-all flex-shrink-0"
          title="Mover a la papelera"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// ── Secciones por tipo ───────────────────────────────────────────────
function SeccionesEngagements({
  engagements,
  isAdmin,
  onPapelera,
}: {
  engagements: (EngagementConCobertura | Engagement)[];
  isAdmin: boolean;
  onPapelera?: (id: string, nombre: string) => void;
}) {
  const proyectos    = engagements.filter((e) => e.tipo === "proyecto");
  const propuestas   = engagements.filter((e) => e.tipo === "propuesta");
  const ayudaInterna = engagements.filter((e) => e.tipo === "ayuda_interna");
  const secciones = [
    { titulo: "Proyectos",              lista: proyectos,    color: "#4a90e2" },
    { titulo: "Propuestas comerciales", lista: propuestas,   color: "#9b59b6" },
    { titulo: "Ayuda interna",          lista: ayudaInterna, color: "#27ae60" },
  ];
  if (engagements.length === 0) return (
    <div className="text-center py-12 text-[#888]">
      <Circle className="w-10 h-10 mx-auto mb-3 opacity-20" />
      <p className="text-sm font-medium">No hay engagements en esta sección.</p>
    </div>
  );
  return (
    <div className="space-y-8 max-w-4xl">
      {secciones.map(({ titulo, lista, color }) => {
        if (lista.length === 0) return null;
        return (
          <div key={titulo}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-5 rounded-full flex-shrink-0" style={{ background: color }} />
              <h2 className="text-sm font-bold text-[#1a1a1a] uppercase tracking-wide">{titulo}</h2>
              <span className="text-xs text-[#aaa] font-medium">{lista.length}</span>
            </div>
            <div className="space-y-2">
              {lista.map((e) => (
                <EngCard key={e.id} e={e} isAdmin={isAdmin} onPapelera={onPapelera} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
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
    setBusqueda(busquedaInput);
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
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#aaa]" />
            <input
              type="text"
              value={busquedaInput}
              onChange={(e) => setBusquedaInput(e.target.value)}
              placeholder="Buscar en historial..."
              className="pl-8 pr-3 py-1.5 text-xs border border-[#e8e8e8] rounded-lg focus:outline-none focus:border-[#4a90e2] w-52"
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
          <SeccionesEngagements
            engagements={historico}
            isAdmin={isAdmin}
            onPapelera={isAdmin ? (id, nombre) => setConfirmPapelera({ id, nombre }) : undefined}
          />

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
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm text-[#888]">
            {engagements.length} engagement{engagements.length !== 1 ? "s" : ""}
          </p>
          <button onClick={() => setVista("historico")}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-[#e8e8e8] hover:bg-[#f5f5f5] text-[#888] transition-colors">
            <Archive className="w-3 h-3" />
            Archivo Histórico
          </button>
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
        </div>
        {isAdmin && (
          <Button onClick={() => setDrawerOpen(true)} size="sm">
            <Plus className="w-3.5 h-3.5" /> Nuevo engagement
          </Button>
        )}
      </div>

      <SeccionesEngagements
        engagements={engagements}
        isAdmin={isAdmin}
        onPapelera={(id, nombre) => setConfirmPapelera({ id, nombre })}
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
