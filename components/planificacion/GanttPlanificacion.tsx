"use client";

import { useState, useEffect } from "react";
import { format, startOfISOWeek, addWeeks, addDays } from "date-fns";
import { es } from "date-fns/locale";
import { Plus, X, Loader2, FlaskConical, Save, AlertTriangle, RotateCcw } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { SandboxInicioView } from "@/components/planificacion/SandboxInicioView";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

// ─── Tipos ────────────────────────────────────────────────────

interface PersonaAsig {
  id: string;
  nombre: string;
  apellido: string;
  iniciales: string | null;
  cargo: string;
  pct: number;
  fecha_inicio: string;
  fecha_fin: string;
}

interface EngSnap {
  id: string;
  codigo: string | null;
  nombre: string;
  cliente: string | null;
  tipo: string;
  fecha_inicio: string;
  fecha_fin: string;
  personas: PersonaAsig[];
}

interface PlanSimulacion {
  id: string;
  nombre: string;
  creadoEn: string;
  estado: "Borrador" | "Aceptado" | "Rechazado";
  snapshot: EngSnap[];
  mutaciones: Record<string, number | null>;
  /** true si ya tiene un snapshot de data_real_previa en Supabase (plan aprobado) */
  tieneRealPrevia?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────


const ESTADO_STYLE: Record<PlanSimulacion["estado"], string> = {
  Borrador:  "bg-slate-100 text-slate-600",
  Aceptado:  "bg-green-100 text-green-700",
  Rechazado: "bg-red-100 text-red-600",
};

// ─── Persistencia Supabase + localStorage (fallback) ─────────

const LS_KEY = "planificacion_sandbox_v1";

/** @deprecated usar persistirPlan. Alias para compatibilidad. */
function guardarPlanes(planes: PlanSimulacion[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(planes)); } catch {}
}

/** Carga planes desde Supabase. Fallback a localStorage si falla. */
async function cargarPlanesRemoto(): Promise<PlanSimulacion[]> {
  try {
    const sb = createAnyClient();
    const { data, error } = await sb
      .from("plan_simulacion")
      .select("id, nombre, estado, creado_en, data_simulada, data_real_previa")
      .order("creado_en", { ascending: false });
    if (error || !data) throw error;
    return (data as any[]).map((row) => ({
      id: row.id,
      nombre: row.nombre,
      estado: row.estado as PlanSimulacion["estado"],
      creadoEn: row.creado_en,
      snapshot: (row.data_simulada ?? []) as EngSnap[],
      mutaciones: {},
      tieneRealPrevia: row.data_real_previa != null,
    }));
  } catch {
    // Fallback: localStorage mientras la tabla no exista
    try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]"); } catch { return []; }
  }
}

/** Upsert del plan en Supabase + localStorage como caché. */
async function persistirPlan(plan: PlanSimulacion): Promise<void> {
  // Siempre guardar en localStorage (cache inmediato)
  try {
    const local = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as PlanSimulacion[];
    const actualizado = local.some((p) => p.id === plan.id)
      ? local.map((p) => p.id === plan.id ? plan : p)
      : [plan, ...local];
    localStorage.setItem(LS_KEY, JSON.stringify(actualizado));
  } catch {}

  // Persistir en Supabase
  const sb = createAnyClient();
  await (sb as any).from("plan_simulacion").upsert({
    id:            plan.id,
    nombre:        plan.nombre,
    estado:        plan.estado,
    creado_en:     plan.creadoEn,
    data_simulada: plan.snapshot,
  }, { onConflict: "id" });
}

/** Elimina el plan de Supabase + localStorage. */
async function eliminarPlanRemoto(id: string): Promise<void> {
  try {
    const local = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as PlanSimulacion[];
    localStorage.setItem(LS_KEY, JSON.stringify(local.filter((p) => p.id !== id)));
  } catch {}
  const sb = createAnyClient();
  await (sb as any).from("plan_simulacion").delete().eq("id", id);
}

// ─── Query snapshot ───────────────────────────────────────────

async function fetchSnapshot(): Promise<EngSnap[]> {
  const sb = createAnyClient();
  const hoy = format(new Date(), "yyyy-MM-dd");
  const fin  = format(addDays(new Date(), 90), "yyyy-MM-dd");

  const [engsRes, asigRes] = await Promise.all([
    sb.from("engagement")
      .select("id, codigo, nombre, cliente, tipo, fecha_inicio, fecha_fin_estimada, fecha_fin_real")
      .eq("estado", "activo")
      .lte("fecha_inicio", fin)
      .or(`fecha_fin_real.gte.${hoy},fecha_fin_estimada.gte.${hoy},fecha_fin_real.is.null`),
    sb.from("asignacion")
      .select("id, persona_id, engagement_id, pct_dedicacion, fecha_inicio, fecha_fin, persona:persona_id(nombre, apellido, iniciales, cargo_actual)")
      .eq("estado", "activa")
      .lte("fecha_inicio", fin)
      .gte("fecha_fin", hoy) as any,
  ]);

  const engs = (engsRes.data ?? []) as any[];
  const asigs = (asigRes.data ?? []) as any[];

  return engs.map((e) => {
    const personas: PersonaAsig[] = asigs
      .filter((a) => a.engagement_id === e.id)
      .map((a) => {
        const p = Array.isArray(a.persona) ? a.persona[0] : a.persona;
        return {
          id: a.persona_id,
          nombre: p?.nombre ?? "",
          apellido: p?.apellido ?? "",
          iniciales: p?.iniciales ?? null,
          cargo: p?.cargo_actual ?? "",
          pct: a.pct_dedicacion,
          fecha_inicio: a.fecha_inicio,
          fecha_fin: a.fecha_fin,
        };
      });
    return {
      id: e.id,
      codigo: e.codigo ?? null,
      nombre: e.nombre,
      cliente: e.cliente ?? null,
      tipo: e.tipo ?? "proyecto",
      fecha_inicio: e.fecha_inicio,
      fecha_fin: e.fecha_fin_real ?? e.fecha_fin_estimada ?? fin,
      personas,
    };
  });
}

// ─── Componente principal ─────────────────────────────────────

export function GanttPlanificacion() {
  const [planes, setPlanes]           = useState<PlanSimulacion[]>([]);
  const [planActivo, setPlanActivo]   = useState<string | null>(null);
  const [modalOpen, setModalOpen]     = useState(false);
  const [nombreInput, setNombreInput] = useState("");
  const [cargando, setCargando]       = useState(false);
  const [loadingPlanes, setLoadingPlanes] = useState(true);

  // Semana de navegación para la grilla
  const [semana, setSemana] = useState(() => startOfISOWeek(new Date()));
  const COLS = 6; // semanas visibles
  const columnas = Array.from({ length: COLS }, (_, i) => addWeeks(semana, i));

  // Carga inicial: Supabase con fallback localStorage
  useEffect(() => {
    cargarPlanesRemoto().then((data) => {
      setPlanes(data);
      setLoadingPlanes(false);
    });
  }, []);

  const plan = planes.find((p) => p.id === planActivo) ?? null;

  // ── Crear plan ──────────────────────────────────────────────
  async function handleCrear() {
    if (!nombreInput.trim()) return;
    setCargando(true);
    try {
      const snapshot = await fetchSnapshot();
      const nuevo: PlanSimulacion = {
        id: `plan_${Date.now()}`,
        nombre: nombreInput.trim(),
        creadoEn: new Date().toISOString(),
        estado: "Borrador",
        snapshot,
        mutaciones: {},
      };
      setPlanes([nuevo, ...planes]);
      await persistirPlan(nuevo); // guarda en Supabase + localStorage
      setPlanActivo(nuevo.id);
      setModalOpen(false);
      setNombreInput("");
    } finally {
      setCargando(false);
    }
  }

  // ── Cambiar estado del plan ─────────────────────────────────
  async function cambiarEstado(id: string, estado: PlanSimulacion["estado"]) {
    // "Aceptado" NUNCA puede aplicarse silenciosamente — siempre requiere modal
    if (estado === "Aceptado") {
      console.warn("[Planificación] cambiarEstado('Aceptado') bloqueado. Usar aprobarPlan() con modal.");
      return;
    }
    const actualizado = planes.find((p) => p.id === id);
    if (!actualizado) return;
    const nuevo = { ...actualizado, estado };
    setPlanes(planes.map((p) => p.id === id ? nuevo : p));
    await persistirPlan(nuevo);
  }

  // ── Mutaciones del snapshot (drag&drop, pct, eliminación) ──────────────
  function handleSnapshotChange(nextSnapshot: EngSnap[]) {
    if (!planActivo) return;
    const planActualizado = planes.find((p) => p.id === planActivo);
    if (!planActualizado) return;
    const nuevo = { ...planActualizado, snapshot: nextSnapshot };
    setPlanes(planes.map((p) => p.id !== planActivo ? p : nuevo));
    // Persistencia inmediata en localStorage (sin esperar Supabase)
    try {
      const local = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as PlanSimulacion[];
      const upd = local.some((p) => p.id === planActivo)
        ? local.map((p) => p.id === planActivo ? nuevo : p)
        : [nuevo, ...local];
      localStorage.setItem(LS_KEY, JSON.stringify(upd));
    } catch {}
  }

  // ── Guardar cambios del plan (persiste en localStorage; no toca tablas reales) ──
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState(false);
  async function guardarPlan() {
    if (!plan) return;
    setGuardando(true);
    try {
      // Persiste snapshot actual en Supabase (columna data_simulada) + localStorage
      await persistirPlan(plan);
      setGuardadoOk(true);
      setTimeout(() => setGuardadoOk(false), 2500);
    } finally {
      setGuardando(false);
    }
  }

  // ── Modales de confirmación ────────────────────────────────────────────────
  const [modalAprobar,   setModalAprobar]   = useState(false);
  const [modalDeshacer,  setModalDeshacer]  = useState(false);
  const [aprobando,      setAprobando]      = useState(false);
  const [deshaciendo,    setDeshaciendo]    = useState(false);
  const [errorModal,     setErrorModal]     = useState<string | null>(null);
  const [exitoMsg,       setExitoMsg]       = useState<string | null>(null);

  // ── Aprobar plan: snapshot real → aplica simulado → Aceptado ──────────────
  async function ejecutarAprobacion() {
    if (!plan) return;
    setAprobando(true);
    setErrorModal(null);
    try {
      // 0. Guarda el snapshot simulado más reciente en plan_simulacion
      await persistirPlan(plan);
      const sb = createAnyClient();

      // A. Snapshot de asignaciones reales actuales → data_real_previa
      const { data: asigActuales, error: fetchErr } = await sb
        .from("asignacion")
        .select("*")
        .eq("estado", "activa");
      if (fetchErr) throw fetchErr;

      const { error: backupErr } = await (sb as any)
        .from("plan_simulacion")
        .update({ data_real_previa: asigActuales ?? [] })
        .eq("id", plan.id);
      if (backupErr) throw backupErr;

      // B. Borrar asignaciones reales activas actuales
      const { error: deleteErr } = await sb
        .from("asignacion")
        .delete()
        .eq("estado", "activa");
      if (deleteErr) throw deleteErr;

      // C. Insertar asignaciones del plan simulado en la tabla real
      const nuevasAsig = plan.snapshot.flatMap((eng) =>
        eng.personas.map((p) => ({
          engagement_id:   eng.id,
          persona_id:      p.id,
          cargo_al_momento: p.cargo || null,
          pct_dedicacion:  p.pct,
          fecha_inicio:    p.fecha_inicio,
          fecha_fin:       p.fecha_fin,
          estado:          "activa",
          estado_staffing: "CONFIRMADO",
          requerimiento_id: null,
        }))
      );

      if (nuevasAsig.length > 0) {
        // Insertar en lotes de 100 para evitar límites
        for (let i = 0; i < nuevasAsig.length; i += 100) {
          const lote = nuevasAsig.slice(i, i + 100);
          const { error: insertErr } = await (sb as any)
            .from("asignacion")
            .insert(lote);
          if (insertErr) throw insertErr;
        }
      }

      // D. Marcar plan como Aceptado en plan_simulacion
      const { error: updatePlanErr } = await (sb as any)
        .from("plan_simulacion")
        .update({ estado: "Aceptado" })
        .eq("id", plan.id);
      if (updatePlanErr) throw updatePlanErr;

      console.log(`[Planificación] Fusión real completada: ${nuevasAsig.length} asignaciones aplicadas desde el escenario "${plan.nombre}"`);

      // E. Actualiza estado local + refresca todos los componentes del dashboard
      const actualizado = { ...plan, estado: "Aceptado" as const, tieneRealPrevia: true };
      setPlanes((prev) => prev.map((p) => p.id === plan.id ? actualizado : p));
      window.dispatchEvent(new CustomEvent("asignacionChanged"));
      setModalAprobar(false);
      setExitoMsg(`✅ Escenario "${plan.nombre}" publicado. ${nuevasAsig.length} asignaciones aplicadas al Tablero real de la empresa.`);
      setTimeout(() => setExitoMsg(null), 8000);
    } catch (err: any) {
      console.error("[Planificación] Error en aprobación:", err);
      setErrorModal(err?.message ?? "Error desconocido al aprobar el plan.");
    } finally {
      setAprobando(false);
    }
  }

  // ── Deshacer aprobación: restaura snapshot real previo → Borrador ──────────
  async function ejecutarDeshacer() {
    if (!plan) return;
    setDeshaciendo(true);
    setErrorModal(null);
    try {
      const sb = createAnyClient();

      // A. Leer data_real_previa del plan
      const { data: planRow, error: fetchErr } = await (sb as any)
        .from("plan_simulacion")
        .select("data_real_previa")
        .eq("id", plan.id)
        .single();
      if (fetchErr) throw fetchErr;
      const realPrevia = planRow?.data_real_previa as any[] | null;
      if (!realPrevia) throw new Error("No hay respaldo previo para restaurar.");

      // B. Borrar asignaciones actuales (las del plan aprobado)
      const { error: deleteErr } = await sb
        .from("asignacion")
        .delete()
        .eq("estado", "activa");
      if (deleteErr) throw deleteErr;

      // C. Restaurar asignaciones reales previas en lotes de 100
      if (realPrevia.length > 0) {
        // Campos seguros para re-insertar (excluye created_at y campos auto)
        const filas = realPrevia.map(({ id: _id, created_at: _ca, ...rest }: any) => rest);
        for (let i = 0; i < filas.length; i += 100) {
          const lote = filas.slice(i, i + 100);
          const { error: insertErr } = await (sb as any)
            .from("asignacion")
            .insert(lote);
          if (insertErr) throw insertErr;
        }
      }

      // D. Regresar estado del plan a Borrador y limpiar respaldo
      const { error: updateErr } = await (sb as any)
        .from("plan_simulacion")
        .update({ estado: "Borrador", data_real_previa: null })
        .eq("id", plan.id);
      if (updateErr) throw updateErr;

      console.log(`[Planificación] Reversión completada: ${realPrevia.length} asignaciones restauradas.`);

      const actualizado = { ...plan, estado: "Borrador" as const, tieneRealPrevia: false };
      setPlanes((prev) => prev.map((p) => p.id === plan.id ? actualizado : p));
      window.dispatchEvent(new CustomEvent("asignacionChanged"));
      setModalDeshacer(false);
      setExitoMsg(`↩ Aprobación revertida. ${realPrevia.length} asignaciones originales restauradas.`);
      setTimeout(() => setExitoMsg(null), 8000);
    } catch (err: any) {
      console.error("[Planificación] Error en reversión:", err);
      setErrorModal(err?.message ?? "Error desconocido al deshacer la aprobación.");
    } finally {
      setDeshaciendo(false);
    }
  }

  // ── Eliminar plan ───────────────────────────────────────────
  async function eliminarPlan(id: string) {
    setPlanes(planes.filter((p) => p.id !== id));
    if (planActivo === id) setPlanActivo(null);
    await eliminarPlanRemoto(id);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#fafafa]">

      {/* ── Galería de planes — barra compacta ────────────────── */}
      <div className="flex-shrink-0 bg-white border-b border-[#e8e8e8] px-4 py-1.5 flex items-center gap-3">
        {/* Título + contador */}
        <FlaskConical className="w-3.5 h-3.5 text-[#4a90e2] flex-shrink-0" />
        <span className="text-[11px] font-semibold text-[#1a1a2e] flex-shrink-0">Escenarios</span>
        <span className="text-[10px] text-[#aaa] flex-shrink-0">({planes.length})</span>

        {/* Tarjetas inline */}
        <div className="flex gap-2 overflow-x-auto flex-1 min-w-0">
          {loadingPlanes && (
            <span className="text-[11px] text-[#ccc] italic flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />Cargando...
            </span>
          )}
          {!loadingPlanes && planes.length === 0 && (
            <span className="text-[11px] text-[#ccc] italic">Sin escenarios.</span>
          )}
          {planes.map((p) => (
            <div
              key={p.id}
              onClick={() => setPlanActivo(planActivo === p.id ? null : p.id)}
              className={`flex-shrink-0 flex items-center gap-2 border rounded-lg px-2.5 py-1 cursor-pointer transition-all ${
                planActivo === p.id
                  ? "border-[#4a90e2] bg-blue-50"
                  : "border-[#e8e8e8] bg-white hover:border-[#4a90e2]/40"
              }`}>
              <span className="text-[11px] font-semibold text-[#1a1a2e] max-w-[120px] truncate">{p.nombre}</span>
              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${ESTADO_STYLE[p.estado]}`}>{p.estado}</span>
              {/* Cambio rápido de estado — "Aceptado" siempre abre el modal */}
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                {(["Borrador", "Aceptado", "Rechazado"] as const).map((est) => (
                  <button key={est}
                    onClick={() => {
                      if (est === "Aceptado") {
                        // Selecciona este plan y abre el modal de confirmación
                        setPlanActivo(p.id);
                        setErrorModal(null);
                        setModalAprobar(true);
                      } else {
                        cambiarEstado(p.id, est);
                      }
                    }}
                    className={`text-[8px] px-1 py-0.5 rounded border transition-colors ${
                      p.estado === est ? "border-current font-bold " + ESTADO_STYLE[est] : "border-[#e8e8e8] text-[#bbb] hover:text-[#4a90e2] hover:border-[#4a90e2]"
                    }`}>{est}</button>
                ))}
              </div>
              <button onClick={(e) => { e.stopPropagation(); eliminarPlan(p.id); }}
                className="text-[#ddd] hover:text-red-400 transition-colors flex-shrink-0">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>

        {/* Botón crear */}
        <button onClick={() => setModalOpen(true)}
          className="flex-shrink-0 flex items-center gap-1 bg-[#1a1a2e] text-white text-[11px] font-semibold px-2.5 py-1 rounded-lg hover:bg-[#2d2d4a] transition-colors">
          <Plus className="w-3 h-3" />Crear
        </button>
      </div>

      {/* ── Barra de acciones del plan activo — compacta ── */}
      {plan && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-1 bg-amber-50 border-b border-amber-200">
          <FlaskConical className="w-3 h-3 text-amber-500 flex-shrink-0" />
          <span className="text-[11px] font-semibold text-[#1a1a2e] truncate max-w-[200px]">{plan.nombre}</span>
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${ESTADO_STYLE[plan.estado]}`}>{plan.estado}</span>
          <span className="text-[10px] text-amber-600 flex-shrink-0">🔒 Solo simulación</span>
          <div className="flex-1" />

          {/* Guardar */}
          <button onClick={guardarPlan} disabled={guardando}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-[#1a1a2e] text-white rounded-lg hover:bg-[#2d2d4a] disabled:opacity-50 transition-colors">
            {guardando ? <Loader2 className="w-3 h-3 animate-spin" /> : guardadoOk ? "✓ Guardado" : <><Save className="w-3 h-3" />Guardar</>}
          </button>

          {/* Aprobar — solo si está en Borrador o Rechazado */}
          {plan.estado !== "Aceptado" && (
            <button onClick={() => { setErrorModal(null); setModalAprobar(true); }}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              title="Publica este escenario y aplica sus asignaciones a la empresa">
              ✅ Aprobar escenario
            </button>
          )}

          {/* Deshacer aprobación — solo si está Aceptado y tiene snapshot previo */}
          {plan.estado === "Aceptado" && plan.tieneRealPrevia && (
            <button onClick={() => { setErrorModal(null); setModalDeshacer(true); }}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              title="Revierte las asignaciones reales al estado anterior a la aprobación">
              <RotateCcw className="w-3 h-3" />Deshacer Aprobación
            </button>
          )}
        </div>
      )}

      {/* ── Vista del plan activo: layout Inicio, datos aislados del snapshot ── */}
      {plan ? (
        <div className="flex-1 overflow-hidden">
          <SandboxInicioView
            key={plan.id}
            planId={plan.id}
            planNombre={plan.nombre}
            snapshot={plan.snapshot}
            onSnapshotChange={(engRows: any[]) => {
              // Convierte EngRow[] → EngSnap[] y actualiza el plan en memoria
              const nextSnapshot: EngSnap[] = engRows.map((eg) => ({
                id: eg.id,
                codigo: eg.codigo ?? null,
                nombre: eg.nombre,
                cliente: eg.cliente ?? null,
                tipo: eg.tipo ?? "proyecto",
                fecha_inicio: eg.fecha_inicio,
                fecha_fin: eg.fecha_fin ?? eg.fecha_inicio,
                personas: (eg.personas ?? []).map((p: any) => ({
                  id: p.id,
                  nombre: p.nombre,
                  apellido: p.apellido,
                  iniciales: p.iniciales ?? null,
                  cargo: p.cargo ?? "",
                  pct: p.pct ?? 100,
                  fecha_inicio: p.fecha_inicio,
                  fecha_fin: p.fecha_fin,
                })),
              }));
              handleSnapshotChange(nextSnapshot);
            }}
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[#ccc] text-[13px]">
          {planes.length > 0 ? "Selecciona un escenario para visualizarlo" : ""}
        </div>
      )}

      {/* ── Modal crear plan ────────────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-xl border border-[#e8e8e8] w-full max-w-sm mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-bold text-[#1a1a2e]">Nuevo escenario de simulación</h3>
              <button onClick={() => setModalOpen(false)} className="text-[#aaa] hover:text-[#555]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <label className="block text-[11px] font-semibold text-[#888] uppercase tracking-wide mb-1">
              Nombre del escenario
            </label>
            <input
              type="text"
              autoFocus
              value={nombreInput}
              onChange={(e) => setNombreInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCrear()}
              placeholder="Ej: Escenario Q3 - Propuesta BHP"
              className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-[#4a90e2] mb-4"
            />
            <p className="text-[11px] text-[#aaa] mb-4">
              Se tomará una foto del estado actual de asignaciones. Los cambios aquí no afectarán los datos reales.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-[12px] text-[#888] hover:text-[#555] border border-[#e8e8e8] rounded-lg">
                Cancelar
              </button>
              <button onClick={handleCrear} disabled={cargando || !nombreInput.trim()}
                className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold bg-[#4a90e2] text-white rounded-lg hover:bg-[#357abd] disabled:opacity-50 transition-colors">
                {cargando ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Cargando...</> : "Crear escenario"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Modal: Confirmar Aprobación ──────────────────────── */}
      <Modal
        open={modalAprobar}
        onClose={() => !aprobando && setModalAprobar(false)}
        title="¿Confirmar publicación del Plan?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalAprobar(false)} disabled={aprobando}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={ejecutarAprobacion} loading={aprobando}>
              {aprobando ? "Publicando..." : "Confirmar y Publicar"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-[13px] text-amber-800 leading-snug">
              Al confirmar, este escenario <strong>reemplazará de forma definitiva</strong> la
              data real de asignaciones de la empresa.
            </p>
          </div>
          <p className="text-[13px] text-[#555] leading-relaxed">
            Se guardará un <strong>respaldo automático</strong> del estado actual antes de aplicar
            los cambios, permitiendo revertir si es necesario.
          </p>
          <p className="text-[13px] text-[#555]">
            El Tablero principal (sidebar Inicio y Tablero) se actualizará automáticamente al
            completar la operación.
          </p>
          {plan && (
            <div className="p-2 bg-[#f8f8f8] rounded-lg">
              <p className="text-[11px] text-[#888]">Escenario a publicar:</p>
              <p className="text-[13px] font-bold text-[#1a1a2e]">{plan.nombre}</p>
              <p className="text-[11px] text-[#aaa]">{plan.snapshot.length} proyectos · {plan.snapshot.reduce((acc, e) => acc + e.personas.length, 0)} asignaciones simuladas</p>
            </div>
          )}
          {errorModal && (
            <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded p-2">{errorModal}</p>
          )}
        </div>
      </Modal>

      {/* ── Modal: Confirmar Deshacer Aprobación ─────────────── */}
      <Modal
        open={modalDeshacer}
        onClose={() => !deshaciendo && setModalDeshacer(false)}
        title="Deshacer Aprobación — Volver Atrás"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalDeshacer(false)} disabled={deshaciendo}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={ejecutarDeshacer} loading={deshaciendo}>
              {deshaciendo ? "Revirtiendo..." : "Confirmar Reversión"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <RotateCcw className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-[13px] text-red-800 leading-snug">
              Esto <strong>restaurará las asignaciones reales</strong> al estado exacto anterior
              a la aprobación de este escenario.
            </p>
          </div>
          <p className="text-[13px] text-[#555] leading-relaxed">
            Las asignaciones actuales (aplicadas por este plan) serán eliminadas y reemplazadas
            por el respaldo guardado automáticamente.
          </p>
          <p className="text-[13px] text-[#555]">
            El estado del escenario volverá a <strong>Borrador</strong> y podrás editarlo nuevamente.
          </p>
          {errorModal && (
            <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded p-2">{errorModal}</p>
          )}
        </div>
      </Modal>

      {/* ── Banner de éxito flotante ──────────────────────────── */}
      {exitoMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] max-w-lg w-full px-4">
          <div className="flex items-start gap-3 bg-green-50 border border-green-300 text-green-900 rounded-xl shadow-lg px-4 py-3 text-[13px]">
            <span className="text-green-500 text-base leading-none mt-0.5">✅</span>
            <span className="flex-1">{exitoMsg}</span>
            <button onClick={() => setExitoMsg(null)} className="text-green-400 hover:text-green-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

