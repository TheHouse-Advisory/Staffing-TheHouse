"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Plus, UserX, UserCheck, ChevronRight, Archive, Trash2, X,
  RotateCcw, ChevronLeft, Circle, Lock,
} from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import { PersonaForm } from "./PersonaForm";
import { CARGOS, CARGO_COLORS, CARGO_COLOR_DEFAULT, CARGOS_OCULTOS_GYD } from "@/lib/constants";
import { diasRestantesPapelera, limpiarPersonasCaducadas } from "@/lib/tasks/cleanupEngagements";
import type { Persona, RolSistema } from "@/lib/types/database";
import { getIniciales } from "@/lib/utils/iniciales";

interface PersonasListProps { rolActual: RolSistema | null; }
type Vista = "principal" | "ex_housers" | "papelera";
interface PersonaEliminada extends Persona { deleted_at: string; }

const EX_PAGE = 20;

// ── Tarjeta de persona ───────────────────────────────────────────────
function PersonaCard({
  persona,
  isAdmin,
  canView = true,
  blockedView = false,
  onDesactivar,
  cargoColor,
  dimmed = false,
}: {
  persona: Persona;
  isAdmin: boolean;
  canView?: boolean;
  blockedView?: boolean;
  onDesactivar?: (p: Persona) => void;
  cargoColor?: string;
  dimmed?: boolean;
}) {
  const initials = getIniciales(persona.nombre, persona.apellido, persona.iniciales);
  const avatarColor = cargoColor ?? CARGO_COLORS[persona.cargo_actual ?? ""] ?? CARGO_COLOR_DEFAULT;

  return (
    <div className={`bg-white border rounded-xl p-4 flex items-center gap-3 group transition-all ${
      dimmed
        ? "border-[#f0f0f0] opacity-60"
        : "border-[#e8e8e8] hover:shadow-sm hover:border-[#d0d0d0]"
    }`}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
        style={{ backgroundColor: avatarColor }}>
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[14px] truncate">{persona.nombre} {persona.apellido}</p>
        <p className="text-xs truncate font-medium" style={{ color: avatarColor }}>
          {persona.cargo_actual ?? "Sin cargo"}
        </p>
        {persona.rol_sistema && (
          <span className="text-[10px] px-1.5 py-0.5 bg-[#eaf4ff] text-[#1a5276] rounded-full font-medium">
            {persona.rol_sistema}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {isAdmin && onDesactivar && (
          <button
            onClick={(e) => { e.preventDefault(); onDesactivar(persona); }}
            className="p-1.5 rounded-md hover:bg-[#f0f0f0] text-[#ccc] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
            title="Desactivar"
          >
            <UserX className="w-3.5 h-3.5" />
          </button>
        )}
        {canView && !blockedView && (
          <Link
            href={`/personas/${persona.id}`}
            className="flex items-center gap-1 text-[11px] text-[#888] hover:text-[#1a1a1a] px-2 py-1 rounded-md hover:bg-[#f5f5f5] transition-colors font-medium"
          >
            Ver <ChevronRight className="w-3 h-3" />
          </Link>
        )}
        {blockedView && (
          <span className="flex items-center gap-1 text-[11px] text-[#ccc] px-2 py-1 cursor-not-allowed opacity-50 font-medium select-none">
            <Lock className="w-3 h-3" /> Ver
          </span>
        )}
      </div>
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────
export function PersonasList({ rolActual }: PersonasListProps) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [vista, setVista] = useState<Vista>("principal");

  // Ex-Housers (paginado)
  const [exHousers, setExHousers] = useState<Persona[]>([]);
  const [loadingEx, setLoadingEx] = useState(false);
  const [paginaEx, setPaginaEx] = useState(1);
  const [totalEx, setTotalEx] = useState(0);
  const [totalPaginasEx, setTotalPaginasEx] = useState(1);
  const [exCount, setExCount] = useState(0);

  // Papelera
  const [eliminados, setEliminados] = useState<PersonaEliminada[]>([]);
  const [loadingPapelera, setLoadingPapelera] = useState(false);
  const [papeleraCount, setPapeleraCount] = useState(0);

  // Modal desactivar (dos opciones)
  const [desactivando, setDesactivando] = useState<Persona | null>(null);
  const [accionando, setAccionando] = useState(false);

  // Confirm eliminación definitiva
  const [confirmDefinitivo, setConfirmDefinitivo] = useState<{ id: string; nombre: string } | null>(null);

  // Diálogo de destino al restaurar desde papelera
  const [restaurando, setRestaurando] = useState<PersonaEliminada | null>(null);

  const isAdmin         = rolActual === "admin";
  const isGyD           = rolActual === "GyD";
  const isAySr          = rolActual === "AySr";
  const isDesarrollo    = rolActual === "Desarrollo";
  const isPlanificador  = rolActual === "planificador" || rolActual === "GyD";
  const sb = createAnyClient();

  // Cargos visibles para AySr
  const CARGOS_AYSR = ["Consultor de Proyectos", "Consultor Analista", "Consultor Trainee"];

  const load = useCallback(async () => {
    const { data } = await sb
      .from("persona")
      .select("*")
      .eq("activo", true)
      .eq("is_deleted", false)
      .eq("is_ex_houser", false)
      .order("apellido");
    const all = (data ?? []) as Persona[];
    let filtradas = all;
    if (isGyD)  filtradas = all.filter((p) => !CARGOS_OCULTOS_GYD.includes(p.cargo_actual ?? ""));
    if (isAySr) filtradas = all.filter((p) =>  CARGOS_AYSR.includes(p.cargo_actual ?? ""));
    setPersonas(filtradas);
    setLoading(false);
  }, [isGyD, isAySr]);

  const loadExHousers = useCallback(async (pagina: number) => {
    setLoadingEx(true);
    const desde = (pagina - 1) * EX_PAGE;
    const { data, count } = await sb
      .from("persona")
      .select("*", { count: "exact" })
      .eq("is_ex_houser", true)
      .eq("is_deleted", false)
      .order("apellido")
      .range(desde, desde + EX_PAGE - 1);
    setExHousers((data ?? []) as Persona[]);
    setTotalEx(count ?? 0);
    setTotalPaginasEx(Math.ceil((count ?? 0) / EX_PAGE) || 1);
    setLoadingEx(false);
  }, []);

  const loadPapelera = useCallback(async () => {
    setLoadingPapelera(true);
    await limpiarPersonasCaducadas(sb);
    const { data } = await sb
      .from("persona")
      .select("*")
      .eq("is_deleted", true)
      .order("deleted_at", { ascending: false });
    const items = (data ?? []) as PersonaEliminada[];
    setEliminados(items);
    setPapeleraCount(items.length);
    setLoadingPapelera(false);
  }, []);

  useEffect(() => {
    load();
    // Conteos iniciales sin cargar datos completos
    sb.from("persona").select("id", { count: "exact", head: true }).eq("is_ex_houser", true).eq("is_deleted", false)
      .then(({ count }: { count: number | null }) => setExCount(count ?? 0));
    sb.from("persona").select("id", { count: "exact", head: true }).eq("is_deleted", true)
      .then(({ count }: { count: number | null }) => setPapeleraCount(count ?? 0));
  }, [load]);

  useEffect(() => {
    if (vista === "ex_housers") loadExHousers(paginaEx);
  }, [vista, paginaEx, loadExHousers]);

  useEffect(() => {
    if (vista === "papelera") loadPapelera();
  }, [vista, loadPapelera]);

  async function reactivarExHouser(id: string) {
    setAccionando(true);
    await sb.from("persona").update({ activo: true, is_ex_houser: false }).eq("id", id);
    setAccionando(false);
    setDesactivando(null);
    setExHousers((prev) => prev.filter((p) => p.id !== id));
    setTotalEx((prev) => Math.max(0, prev - 1));
    setExCount((prev) => Math.max(0, prev - 1));
    load(); // recarga lista de activos
  }

  async function marcarExHouser(id: string) {
    setAccionando(true);
    await sb.from("persona").update({ activo: false, is_ex_houser: true }).eq("id", id);
    setAccionando(false);
    setDesactivando(null);
    setPersonas((prev) => prev.filter((p) => p.id !== id));
    setExCount((prev) => prev + 1);
  }

  async function moverAPapelera(id: string) {
    setAccionando(true);
    await sb.from("persona").update({
      activo: false,
      is_deleted: true,
      deleted_at: new Date().toISOString(),
    }).eq("id", id);
    setAccionando(false);
    setDesactivando(null);
    setPersonas((prev) => prev.filter((p) => p.id !== id));
    setExHousers((prev) => prev.filter((p) => p.id !== id));
    setTotalEx((prev) => Math.max(0, prev - 1));
    setPapeleraCount((prev) => prev + 1);
  }

  async function restaurarComoActivo(id: string) {
    await sb.from("persona").update({
      activo: true, is_deleted: false, deleted_at: null, is_ex_houser: false,
    }).eq("id", id);
    setPapeleraCount((prev) => Math.max(0, prev - 1));
    setRestaurando(null);
    load();       // recarga lista de activos
    loadPapelera();
  }

  async function restaurarComoExHouser(id: string) {
    await sb.from("persona").update({
      activo: false, is_deleted: false, deleted_at: null, is_ex_houser: true,
    }).eq("id", id);
    setPapeleraCount((prev) => Math.max(0, prev - 1));
    setExCount((prev) => prev + 1);
    setRestaurando(null);
    loadPapelera();
  }

  async function eliminarDefinitivo(id: string) {
    setAccionando(true);
    await sb.from("persona").delete().eq("id", id);
    setAccionando(false);
    setConfirmDefinitivo(null);
    setPapeleraCount((prev) => Math.max(0, prev - 1));
    loadPapelera();
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
          <h2 className="text-sm font-bold text-[#1a1a1a]">Papelera de Personas</h2>
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
          <div className="space-y-2 max-w-3xl">
            {eliminados.map((p) => {
              const dias = diasRestantesPapelera(p.deleted_at);
              const urgente = dias <= 5;
              const initials = getIniciales(p.nombre, p.apellido, p.iniciales);
              return (
                <div key={p.id} className="flex items-center gap-4 bg-white border border-[#e8e8e8] rounded-xl px-5 py-4">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0"
                    style={{ backgroundColor: CARGO_COLORS[p.cargo_actual ?? ""] ?? CARGO_COLOR_DEFAULT }}>
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[14px] truncate text-[#888] line-through">{p.nombre} {p.apellido}</p>
                    <p className="text-xs text-[#aaa]">{p.cargo_actual ?? "Sin cargo"}</p>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full font-semibold flex-shrink-0"
                    style={urgente ? { background: "#fef2f2", color: "#dc2626" } : { background: "#fefce8", color: "#ca8a04" }}>
                    {dias}d restantes
                  </span>
                  <button onClick={() => setRestaurando(p)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#e0e0e0] hover:bg-[#f5f5f5] text-[#555] transition-colors flex-shrink-0">
                    <RotateCcw className="w-3 h-3" /> Restaurar
                  </button>
                  {isAdmin && (
                    <button onClick={() => setConfirmDefinitivo({ id: p.id, nombre: `${p.nombre} ${p.apellido}` })}
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

      {/* Modal destino al restaurar */}
      <Modal open={!!restaurando} onClose={() => setRestaurando(null)} title="¿Dónde deseas restaurar a esta persona?">
        {restaurando && (
          <>
            <p className="text-sm text-[#555] mb-5">
              Elige el destino para <span className="font-semibold text-[#1a1a1a]">{restaurando.nombre} {restaurando.apellido}</span>:
            </p>
            <div className="space-y-3">
              <button
                onClick={() => restaurarComoActivo(restaurando.id)}
                className="w-full text-left p-4 rounded-xl border-2 border-[#e8e8e8] hover:border-[#22c55e] hover:bg-[#f0fdf4] transition-all group"
              >
                <div className="flex items-start gap-3">
                  <UserCheck className="w-4 h-4 text-[#22c55e] mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-[#1a1a1a] group-hover:text-[#16a34a]">Volver a Personal Activo</p>
                    <p className="text-xs text-[#888] mt-0.5">
                      Reaparece en el equipo, el tablero y estará disponible para nuevas asignaciones.
                    </p>
                  </div>
                </div>
              </button>
              <button
                onClick={() => restaurarComoExHouser(restaurando.id)}
                className="w-full text-left p-4 rounded-xl border-2 border-[#e8e8e8] hover:border-[#4a90e2] hover:bg-[#f5f9ff] transition-all group"
              >
                <div className="flex items-start gap-3">
                  <Archive className="w-4 h-4 text-[#4a90e2] mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-[#1a1a1a] group-hover:text-[#4a90e2]">Mover a Archivo Ex-Housers</p>
                    <p className="text-xs text-[#888] mt-0.5">
                      El perfil queda archivado históricamente, sin acceso activo al equipo.
                    </p>
                  </div>
                </div>
              </button>
            </div>
            <div className="flex justify-end mt-5">
              <button onClick={() => setRestaurando(null)}
                className="text-sm text-[#888] hover:text-[#1a1a1a] px-4 py-2 rounded-lg hover:bg-[#f5f5f5] transition-colors">
                Cancelar
              </button>
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog open={!!confirmDefinitivo} onClose={() => setConfirmDefinitivo(null)}
        onConfirm={() => confirmDefinitivo && eliminarDefinitivo(confirmDefinitivo.id)}
        title="Eliminar definitivamente"
        message={`"${confirmDefinitivo?.nombre}" se eliminará permanentemente. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar definitivamente" loading={accionando}
      />
    </>
  );

  // ── VISTA EX-HOUSERS ────────────────────────────────────────────────
  if (vista === "ex_housers") return (
    <>
      <div className="flex items-center gap-2 mb-6">
        <button onClick={() => setVista("principal")} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
          <X className="w-4 h-4" />
        </button>
        <Archive className="w-4 h-4 text-[#888]" />
        <h2 className="text-sm font-bold text-[#1a1a1a]">Ex-Housers</h2>
        {totalEx > 0 && <span className="text-xs text-[#aaa]">({totalEx} personas)</span>}
      </div>

      {loadingEx ? <p className="text-sm text-[#888]">Cargando...</p>
        : exHousers.length === 0 ? (
          <div className="text-center py-12 text-[#888]">
            <Circle className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">No hay ex-housers registrados.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-5xl">
              {exHousers.map((p) => (
                <PersonaCard key={p.id} persona={p} isAdmin={isAdmin} dimmed
                  onDesactivar={isAdmin ? (per) => setDesactivando(per) : undefined}
                />
              ))}
            </div>

            {totalPaginasEx > 1 && (
              <div className="flex items-center justify-center gap-3 mt-8">
                <button onClick={() => setPaginaEx((p) => Math.max(1, p - 1))} disabled={paginaEx === 1}
                  className="p-2 rounded-lg border border-[#e8e8e8] hover:bg-[#f5f5f5] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-[#555]">
                  Página <span className="font-semibold">{paginaEx}</span> de <span className="font-semibold">{totalPaginasEx}</span>
                </span>
                <button onClick={() => setPaginaEx((p) => Math.min(totalPaginasEx, p + 1))} disabled={paginaEx === totalPaginasEx}
                  className="p-2 rounded-lg border border-[#e8e8e8] hover:bg-[#f5f5f5] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )
      }

      {/* Desde ex-housers: reactivar o mover a papelera */}
      <DesactivarModal
        persona={desactivando}
        accionando={accionando}
        onClose={() => setDesactivando(null)}
        onExHouser={null}
        onReactivar={(id) => reactivarExHouser(id)}
        onPapelera={(id) => moverAPapelera(id)}
        modoExHouser
      />
    </>
  );

  // ── VISTA PRINCIPAL ─────────────────────────────────────────────────
  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm text-[#888]">
            {personas.length} persona{personas.length !== 1 ? "s" : ""} activa{personas.length !== 1 ? "s" : ""}
          </p>
          <button onClick={() => setVista("ex_housers")}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-[#e8e8e8] hover:bg-[#f5f5f5] text-[#888] transition-colors">
            <Archive className="w-3 h-3" />
            Ex-Housers
            {exCount > 0 && (
              <span className="ml-0.5 bg-gray-100 text-gray-500 rounded-full px-1.5 font-bold text-[10px] leading-4">
                {exCount}
              </span>
            )}
          </button>
          {!(isGyD || rolActual === "AySr" || rolActual === "planificador" || rolActual === "Desarrollo") && (
          <button onClick={() => setVista("papelera")}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-[#e8e8e8] hover:bg-[#f5f5f5] text-[#888] transition-colors">
            <Trash2 className="w-3 h-3" />
            Papelera
            {papeleraCount > 0 && (
              <span className="ml-0.5 bg-red-100 text-red-600 rounded-full px-1.5 font-bold text-[10px] leading-4">
                {papeleraCount}
              </span>
            )}
          </button>
          )}
        </div>
        {isAdmin && (
          <Button onClick={() => setDrawerOpen(true)} size="sm">
            <Plus className="w-3.5 h-3.5" />
            Nueva persona
          </Button>
        )}
      </div>

      {/* Grupos por cargo */}
      <div className="space-y-6">
        {(() => {
          const cargoOrden = [...CARGOS];
          const sinCargo = personas.filter(
            (p) => !cargoOrden.includes((p.cargo_actual ?? "") as typeof CARGOS[number])
          );
          const grupos = [
            ...cargoOrden.map((c) => ({ cargo: c, lista: personas.filter((p) => p.cargo_actual === c) })),
            ...(sinCargo.length > 0 ? [{ cargo: "Sin cargo", lista: sinCargo }] : []),
          ].filter((g) => g.lista.length > 0);

          return grupos.map(({ cargo, lista }) => {
            const color = CARGO_COLORS[cargo] ?? CARGO_COLOR_DEFAULT;
            return (
              <div key={cargo}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color }}>{cargo}</span>
                  <span className="text-[11px] text-[#ccc]">{lista.length}</span>
                  <div className="flex-1 h-0.5 rounded-full" style={{ background: color, opacity: 0.3 }} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {lista.map((p) => (
                    <PersonaCard
                      key={p.id} persona={p} isAdmin={isAdmin} cargoColor={color}
                      canView={!isDesarrollo}
                      blockedView={isPlanificador && CARGOS_OCULTOS_GYD.includes(p.cargo_actual ?? "")}
                      onDesactivar={isAdmin ? setDesactivando : undefined}
                    />
                  ))}
                </div>
              </div>
            );
          });
        })()}
      </div>

      <PersonaForm open={drawerOpen} onClose={() => setDrawerOpen(false)} onSuccess={load} />

      <DesactivarModal
        persona={desactivando}
        accionando={accionando}
        onClose={() => setDesactivando(null)}
        onExHouser={(id) => marcarExHouser(id)}
        onPapelera={(id) => moverAPapelera(id)}
        modoExHouser={false}
      />
    </>
  );
}

// ── Modal de dos opciones al desactivar ──────────────────────────────
function DesactivarModal({
  persona,
  accionando,
  onClose,
  onExHouser,
  onReactivar,
  onPapelera,
  modoExHouser,
}: {
  persona: Persona | null;
  accionando: boolean;
  onClose: () => void;
  onExHouser: ((id: string) => void) | null;
  onReactivar?: ((id: string) => void) | null;
  onPapelera: (id: string) => void;
  modoExHouser: boolean;
}) {
  if (!persona) return null;
  const nombre = `${persona.nombre} ${persona.apellido}`;

  return (
    <Modal
      open={!!persona}
      onClose={onClose}
      title={modoExHouser ? "Gestionar perfil Ex-Houser" : "Desactivar persona"}
    >
      <p className="text-sm text-[#555] mb-5">
        {modoExHouser
          ? "¿Qué deseas hacer con este perfil? Puedes reintegrarlo al equipo activo o enviarlo a la papelera para su eliminación definitiva."
          : <>¿Qué deseas hacer con <span className="font-semibold text-[#1a1a1a]">{nombre}</span>?</>
        }
      </p>

      <div className="space-y-3">
        {/* Reactivar (solo en modo ex-houser) */}
        {modoExHouser && onReactivar && (
          <button
            onClick={() => onReactivar(persona.id)}
            disabled={accionando}
            className="w-full text-left p-4 rounded-xl border-2 border-[#e8e8e8] hover:border-[#22c55e] hover:bg-[#f0fdf4] transition-all group disabled:opacity-50"
          >
            <div className="flex items-start gap-3">
              <UserCheck className="w-4 h-4 text-[#22c55e] mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-[#1a1a1a] group-hover:text-[#16a34a]">Reactivar Persona</p>
                <p className="text-xs text-[#888] mt-0.5">
                  Vuelve al staff activo, aparece en el equipo y queda disponible para nuevas asignaciones.
                </p>
              </div>
            </div>
          </button>
        )}

        {/* Marcar Ex-Houser (solo desde vista principal) */}
        {!modoExHouser && onExHouser && (
          <button
            onClick={() => onExHouser(persona.id)}
            disabled={accionando}
            className="w-full text-left p-4 rounded-xl border-2 border-[#e8e8e8] hover:border-[#4a90e2] hover:bg-[#f5f9ff] transition-all group disabled:opacity-50"
          >
            <div className="flex items-start gap-3">
              <Archive className="w-4 h-4 text-[#4a90e2] mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-[#1a1a1a] group-hover:text-[#4a90e2]">Marcar como Ex-Houser</p>
                <p className="text-xs text-[#888] mt-0.5">
                  Su perfil se archiva históricamente. Seguirá apareciendo en proyectos y asignaciones pasadas.
                </p>
              </div>
            </div>
          </button>
        )}

        {/* Papelera (siempre visible) */}
        <button
          onClick={() => onPapelera(persona.id)}
          disabled={accionando}
          className="w-full text-left p-4 rounded-xl border-2 border-[#e8e8e8] hover:border-red-300 hover:bg-red-50 transition-all group disabled:opacity-50"
        >
          <div className="flex items-start gap-3">
            <Trash2 className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-[#1a1a1a] group-hover:text-red-600">Mover a la Papelera</p>
              <p className="text-xs text-[#888] mt-0.5">
                {modoExHouser
                  ? "El perfil se eliminará definitivamente en 30 días."
                  : "Para perfiles cargados por error. Se eliminará definitivamente en 30 días."}
              </p>
            </div>
          </div>
        </button>
      </div>

      <div className="flex justify-end mt-5">
        <button onClick={onClose}
          className="text-sm text-[#888] hover:text-[#1a1a1a] px-4 py-2 rounded-lg hover:bg-[#f5f5f5] transition-colors">
          Cancelar
        </button>
      </div>
    </Modal>
  );
}
