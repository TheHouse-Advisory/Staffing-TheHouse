"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, AlertTriangle, CheckCircle, User,
  Pencil, Trash2, Plus, X, Users, Archive,
  Plane, Diamond,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { createClient } from "@/lib/supabase/client";
import { createAnyClient } from "@/lib/supabase/client";
import {
  fetchCoberturaEngagement, cambiarEstadoEngagement, cambiarTipoEngagement,
  grupoDeCargo, compararGrupoCargo, construirTimelinePersona, type TramoTimeline,
} from "@/lib/queries/engagements";
import { colorOcupacion, formatPct, fLocal } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { Drawer } from "@/components/ui/Drawer";
import { FieldWrapper, Input, Select } from "@/components/ui/FormField";
import { EngagementForm } from "./EngagementForm";
import { PanelFitAsignacion } from "./PanelFitAsignacion";
import { ESTADO_ENGAGEMENT, CARGOS } from "@/lib/constants";
import type { Engagement, CoberturaEngagement } from "@/lib/types/database";

interface Props { id: string; }

interface AsignacionReq {
  id: string;
  persona_id: string;
  persona_nombre: string;
  cargo_al_momento: string | null;
  pct_dedicacion: number;
  fecha_inicio: string;
  fecha_fin: string | null;
  requerimiento_id: string | null;
}

// ── Equipo consolidado: una tarjeta por persona, agrupado por cargo ──
interface PersonaEquipo {
  persona_id: string;
  persona_nombre: string;
  cargo: string | null;
  pct_dedicacion: number;
  grupo: string;
  tramos: TramoTimeline[];
}

// ── Formulario de requerimiento ────────────────────────────────
interface ReqForm {
  id: string | null;        // null = nuevo
  fase_nombre: string;      // nombre obligatorio del requerimiento
  cargo_requerido: string;  // "" = cualquier cargo
  pct_dedicacion: string;
  fecha_inicio: string;
  fecha_fin: string;
  descripcion: string;
}

const REQ_EMPTY: ReqForm = {
  id: null,
  fase_nombre: "",
  cargo_requerido: "",
  pct_dedicacion: "100",
  fecha_inicio: "",
  fecha_fin: "",
  descripcion: "",
};

const CARGO_OPTIONS = [
  { value: "", label: "Cualquier cargo" },
  ...CARGOS.map((c) => ({ value: c, label: c })),
];

export function EngagementDetail({ id }: Props) {
  const router = useRouter();
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [cobertura, setCobertura] = useState<CoberturaEngagement[]>([]);
  const [asignacionesPorReq, setAsignacionesPorReq] = useState<Map<string, AsignacionReq[]>>(new Map());
  const [equipoPorGrupo, setEquipoPorGrupo] = useState<Map<string, PersonaEquipo[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [caracteristicas, setCaracteristicas] = useState<{
    industria: string | null;
    capacidades: string[];
    tematicas: string[];
  }>({ industria: null, capacidades: [], tematicas: [] });

  // Engagement edit / delete
  const [editando, setEditando] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [eliminandoError, setEliminandoError] = useState<string | null>(null);

  // Archivar (estado → 'terminado')
  const [archivando, setArchivando] = useState(false);
  const [toastArchivo, setToastArchivo] = useState<string | null>(null);

  // Confirmar proyecto real (tipo 'posibles_proyectos' → 'proyecto')
  const [confirmandoProyecto, setConfirmandoProyecto] = useState(false);

  // Requerimiento CRUD
  const [reqForm, setReqForm] = useState<ReqForm | null>(null);
  const [reqLoading, setReqLoading] = useState(false);
  const [reqError, setReqError] = useState<string | null>(null);
  const [reqDeleteId, setReqDeleteId] = useState<string | null>(null);
  const [reqDeleteLoading, setReqDeleteLoading] = useState(false);

  // Asignación con panel de fit
  const [reqFitOpen, setReqFitOpen] = useState<CoberturaEngagement | null>(null);
  const [quitarAsigId, setQuitarAsigId] = useState<string | null>(null);
  const [quitarAsigLoading, setQuitarAsigLoading] = useState(false);

  // Talleres y Viajes (actividades planificadas del engagement)
  type ActividadDetalle = { id: string; tipo: "Viajes" | "Taller"; titulo: string; descripcion: string | null; fecha_inicio: string; fecha_fin: string };
  const [actividades, setActividades] = useState<ActividadDetalle[]>([]);

  // Control de acceso
  const [rolActual, setRolActual] = useState<string | null>(null);
  const isReadOnly = rolActual === "planificador" || rolActual === "GyD" || rolActual === "AySr" || rolActual === "Desarrollo";

  // ── Carga de datos ─────────────────────────────────────────────
  const load = async () => {
    const supabase = createClient();
    const sb = createAnyClient();

    interface AsignacionRaw {
      id: string;
      persona_id: string;
      cargo_al_momento: string | null;
      pct_dedicacion: number;
      fecha_inicio: string;
      fecha_fin: string | null;
      requerimiento_id: string | null;
      persona: { nombre: string; apellido: string } | null;
    }

    const [{ data: eng, error: engErr }, cobResult, asigResult, capResult, temResult, actResult] = await Promise.all([
      sb.from("engagement").select("*, cat_industria(nombre)").eq("id", id).single(),
      fetchCoberturaEngagement(supabase, id),
      sb
        .from("asignacion")
        .select("id, persona_id, cargo_al_momento, pct_dedicacion, fecha_inicio, fecha_fin, requerimiento_id, persona:persona_id(nombre, apellido)")
        .eq("engagement_id", id)
        .eq("estado", "activa")
        .order("fecha_inicio"),
      (sb as any).from("engagement_capacidad").select("cat_capacidad(nombre)").eq("engagement_id", id),
      (sb as any).from("engagement_tematica").select("cat_tematica(nombre)").eq("engagement_id", id),
      (sb as any).from("engagement_actividades").select("id, tipo, titulo, descripcion, fecha_inicio, fecha_fin").eq("engagement_id", id),
    ]);

    if (engErr || !eng) {
      setError(engErr?.message ?? "No encontrado");
    } else {
      setEngagement(eng as Engagement);
      setCobertura(cobResult.data);
      if (cobResult.error) setError(cobResult.error);
      setCaracteristicas({
        industria: (eng as any).cat_industria?.nombre ?? null,
        capacidades: ((capResult.data ?? []) as any[]).map((r: any) => r.cat_capacidad?.nombre).filter(Boolean),
        tematicas:   ((temResult.data ?? []) as any[]).map((r: any) => r.cat_tematica?.nombre).filter(Boolean),
      });
    }

    const asigData = (asigResult.data ?? []) as unknown as AsignacionRaw[];

    const asigs: AsignacionReq[] = asigData.map((a) => ({
      id: a.id,
      persona_id: a.persona_id,
      persona_nombre: a.persona ? `${a.persona.nombre} ${a.persona.apellido}` : "—",
      cargo_al_momento: a.cargo_al_momento,
      pct_dedicacion: Number(a.pct_dedicacion),
      fecha_inicio: a.fecha_inicio,
      fecha_fin: a.fecha_fin,
      requerimiento_id: a.requerimiento_id,
    }));

    const porReq = new Map<string, AsignacionReq[]>();
    // Deduplica registros de asignación idénticos (misma persona + mismo requerimiento +
    // mismo rango de fechas, pero con id distinto) — pueden existir en la BD por una
    // asignación doble; se muestra una sola vez, quedándose con el primer id encontrado.
    const vistos = new Set<string>();
    const asigsDedup: AsignacionReq[] = [];
    for (const a of asigs) {
      const dedupeKey = `${a.requerimiento_id ?? "sin_req"}|${a.persona_id}|${a.fecha_inicio}|${a.fecha_fin}`;
      if (vistos.has(dedupeKey)) continue;
      vistos.add(dedupeKey);
      asigsDedup.push(a);

      if (a.requerimiento_id) {
        const arr = porReq.get(a.requerimiento_id) ?? [];
        arr.push(a);
        porReq.set(a.requerimiento_id, arr);
      }
    }
    setAsignacionesPorReq(porReq);

    // ── Equipo consolidado: una tarjeta por persona (con o sin requerimiento), ──
    // agrupada por cargo, con sus tramos de asignación intercalados con ausencias.
    const porPersona = new Map<string, AsignacionReq[]>();
    for (const a of asigsDedup) {
      const arr = porPersona.get(a.persona_id) ?? [];
      arr.push(a);
      porPersona.set(a.persona_id, arr);
    }

    const personaIds = [...porPersona.keys()];
    const ausenciasPorPersona = new Map<string, { inicio: string; fin: string; tipo: string }[]>();
    if (personaIds.length > 0) {
      const { data: ausData } = await sb
        .from("ausencia")
        .select("persona_id, fecha_inicio, fecha_fin, tipo")
        .in("persona_id", personaIds);
      for (const row of (ausData ?? []) as { persona_id: string; fecha_inicio: string; fecha_fin: string; tipo: string }[]) {
        const arr = ausenciasPorPersona.get(row.persona_id) ?? [];
        arr.push({ inicio: row.fecha_inicio, fin: row.fecha_fin, tipo: row.tipo });
        ausenciasPorPersona.set(row.persona_id, arr);
      }
    }

    const equipoPorGrupoNuevo = new Map<string, PersonaEquipo[]>();
    for (const [personaId, filas] of porPersona) {
      const ordenadas = [...filas].sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));
      const ultima = ordenadas[ordenadas.length - 1];
      const segmentos = ordenadas.map((f) => ({ inicio: f.fecha_inicio, fin: f.fecha_fin }));
      const tramos = construirTimelinePersona(segmentos, ausenciasPorPersona.get(personaId) ?? []);
      const grupo = grupoDeCargo(ultima.cargo_al_momento);
      const entrada: PersonaEquipo = {
        persona_id: personaId,
        persona_nombre: ultima.persona_nombre,
        cargo: ultima.cargo_al_momento,
        pct_dedicacion: ultima.pct_dedicacion,
        grupo,
        tramos,
      };
      const arr = equipoPorGrupoNuevo.get(grupo) ?? [];
      arr.push(entrada);
      equipoPorGrupoNuevo.set(grupo, arr);
    }
    setEquipoPorGrupo(equipoPorGrupoNuevo);

    setActividades((actResult.data ?? []) as ActividadDetalle[]);

    setLoading(false);
  };

  useEffect(() => {
    load();
    (async () => {
      const sb = createAnyClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data } = await sb.from("persona").select("rol_sistema").eq("auth_user_id", user.id).single();
      setRolActual((data as any)?.rol_sistema ?? null);
    })();
  }, [id]);

  // ── Eliminar engagement ────────────────────────────────────────
  const handleEliminar = async () => {
    if (!engagement) return;
    setEliminando(true);
    setEliminandoError(null);
    const sb = createAnyClient();
    const { error } = await sb.from("engagement").delete().eq("id", engagement.id);
    if (error) { setEliminandoError(error.message); setEliminando(false); return; }
    router.push("/engagements");
  };

  // ── Archivar engagement (estado → 'terminado') ────────────────
  const handleArchivar = async () => {
    if (!engagement) return;
    setArchivando(true);
    const sb = createAnyClient();
    const { error } = await cambiarEstadoEngagement(sb, engagement.id, "terminado");
    setArchivando(false);
    if (error) { setEliminandoError(error); return; }
    setToastArchivo("Proyecto archivado correctamente.");
    setTimeout(() => router.push("/engagements"), 1200);
  };

  // ── Confirmar proyecto real (tipo → 'proyecto') ────────────────
  const handleConfirmarProyecto = async () => {
    if (!engagement) return;
    setConfirmandoProyecto(true);
    const sb = createAnyClient();
    const { error } = await cambiarTipoEngagement(sb, engagement.id, "proyecto");
    setConfirmandoProyecto(false);
    if (error) { setEliminandoError(error); return; }
    setEngagement((prev) => (prev ? { ...prev, tipo: "proyecto" } : prev));
    setToastArchivo("¡Proyecto confirmado de forma exitosa!");
  };

  // ── CRUD Requerimientos ────────────────────────────────────────
  const abrirNuevoReq = () => {
    setReqForm({
      ...REQ_EMPTY,
      fecha_inicio: engagement?.fecha_inicio ?? "",
      fecha_fin: engagement?.fecha_fin_estimada ?? "",
    });
    setReqError(null);
  };

  const abrirEditarReq = async (reqId: string) => {
    const sb = createAnyClient();
    const { data } = await sb
      .from("requerimiento_engagement")
      .select("*")
      .eq("id", reqId)
      .single();
    if (data) {
      setReqForm({
        id: data.id,
        fase_nombre: data.fase_nombre ?? "",
        cargo_requerido: data.cargo_requerido ?? "",
        pct_dedicacion: String(data.pct_dedicacion),
        fecha_inicio: data.fecha_inicio,
        fecha_fin: data.fecha_fin,
        descripcion: data.descripcion ?? "",
      });
      setReqError(null);
    }
  };

  const guardarReq = async () => {
    if (!reqForm || !engagement) return;
    if (!reqForm.fase_nombre.trim()) {
      setReqError("El nombre del requerimiento es obligatorio.");
      return;
    }
    if (!reqForm.fecha_inicio || !reqForm.fecha_fin) {
      setReqError("Las fechas son obligatorias.");
      return;
    }
    if (reqForm.fecha_fin < reqForm.fecha_inicio) {
      setReqError("La fecha de fin debe ser posterior a la de inicio.");
      return;
    }

    setReqLoading(true);
    setReqError(null);
    const sb = createAnyClient();

    const payload = {
      engagement_id: engagement.id,
      fase_nombre: reqForm.fase_nombre.trim(),
      cargo_requerido: reqForm.cargo_requerido || null,
      pct_dedicacion: Math.min(100, Math.max(1, Number(reqForm.pct_dedicacion) || 100)),
      fecha_inicio: reqForm.fecha_inicio,
      fecha_fin: reqForm.fecha_fin,
      descripcion: reqForm.descripcion.trim() || null,
    };

    const { error } = reqForm.id
      ? await sb.from("requerimiento_engagement").update(payload).eq("id", reqForm.id)
      : await sb.from("requerimiento_engagement").insert(payload);

    if (error) { setReqError(error.message); setReqLoading(false); return; }

    // Cascada: sincroniza pct_dedicacion en asignaciones activas del req editado
    if (reqForm.id) {
      await sb
        .from("asignacion")
        .update({ pct_dedicacion: payload.pct_dedicacion })
        .eq("requerimiento_id", reqForm.id)
        .eq("estado", "activa");
    }

    setReqForm(null);
    setReqLoading(false);
    load();
  };

  const confirmarEliminarReq = async () => {
    if (!reqDeleteId) return;
    setReqDeleteLoading(true);
    const sb = createAnyClient();
    await sb.from("requerimiento_engagement").delete().eq("id", reqDeleteId);
    setReqDeleteId(null);
    setReqDeleteLoading(false);
    load();
  };

  const confirmarQuitarAsignacion = async () => {
    if (!quitarAsigId) return;
    setQuitarAsigLoading(true);
    const sb = createAnyClient();
    await sb.from("asignacion").delete().eq("id", quitarAsigId);
    setQuitarAsigId(null);
    setQuitarAsigLoading(false);
    load();
  };

  // ── Render ─────────────────────────────────────────────────────
  if (loading) return <p className="text-sm text-[#888]">Cargando...</p>;
  if (error && !engagement) return <p className="text-sm text-red-500">{error}</p>;
  if (!engagement) return null;

  const estilos = ESTADO_ENGAGEMENT[engagement.estado] ?? ESTADO_ENGAGEMENT.activo;

  const porNombre = cobertura.reduce<Record<string, CoberturaEngagement[]>>(
    (acc, r) => {
      const key = r.fase_nombre?.trim() || "Sin nombre";
      if (!acc[key]) acc[key] = [];
      acc[key].push(r);
      return acc;
    },
    {}
  );

  const tieneAlerta = cobertura.some((r) => r.pct_descubierto > 0);
  const tieneRequerimientos = Object.keys(porNombre).length > 0;
  const minDate = engagement.fecha_inicio ?? undefined;
  const maxDate = engagement.fecha_fin_estimada ?? undefined;

  return (
    <>
      {/* Toast archivado */}
      {toastArchivo && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-xl shadow-lg px-4 py-2.5 text-sm font-medium">
          {toastArchivo}
        </div>
      )}
      <div className="max-w-3xl space-y-5">

        {/* Volver */}
        <Link
          href="/engagements"
          className="inline-flex items-center gap-1.5 text-sm text-[#888] hover:text-[#1a1a1a] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Volver a Engagements
        </Link>

        {/* Encabezado */}
        <div className="bg-white rounded-xl border border-[#e8e8e8] p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-xl font-bold truncate">{engagement.codigo ? `${engagement.codigo}: ${engagement.nombre}` : engagement.nombre}</h2>
                {tieneAlerta && <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />}
              </div>
              <p className="text-[#888]">{engagement.cliente}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {!isReadOnly && engagement.tipo === "posibles_proyectos" && (
                <Button variant="primary" size="sm" onClick={handleConfirmarProyecto} loading={confirmandoProyecto}
                  title="Confirmar como proyecto real">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span className="text-xs">Confirmar Proyecto Real</span>
                </Button>
              )}
              {!isReadOnly && engagement.estado === "activo" && (
                <Button variant="ghost" size="sm" onClick={handleArchivar} loading={archivando}
                  className="text-[#888] hover:text-[#1a1a1a]" title="Finalizar/Archivar Proyecto">
                  <Archive className="w-3.5 h-3.5" />
                  <span className="text-xs">Finalizar/Archivar Proyecto</span>
                </Button>
              )}
              {!isReadOnly && (
                <Button variant="ghost" size="sm" onClick={() => setEditando(true)}
                  className="text-[#888] hover:text-[#1a1a1a]" title="Editar engagement">
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
              )}
              {!isReadOnly && (
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}
                  className="text-[#888] hover:text-red-500" title="Eliminar engagement">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
              <span className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={{ background: estilos.bg, color: estilos.text }}>
                {estilos.label}
              </span>
            </div>
          </div>

          {engagement.descripcion && (
            <p className="mt-4 text-sm text-[#555] border-t border-[#f0f0f0] pt-4">
              {engagement.descripcion}
            </p>
          )}

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm border-t border-[#f0f0f0] pt-4">
            <div>
              <span className="text-[#888] text-xs">Tipo</span>
              <p className="font-medium mt-0.5 capitalize">{engagement.tipo}</p>
            </div>
            {engagement.fecha_inicio && (
              <div>
                <span className="text-[#888] text-xs">Inicio</span>
                <p className="font-medium mt-0.5">
                  {format(fLocal(engagement.fecha_inicio), "d MMM yyyy", { locale: es })}
                </p>
              </div>
            )}
            {engagement.fecha_fin_estimada && (
              <div>
                <span className="text-[#888] text-xs">Fin estimado</span>
                <p className="font-medium mt-0.5">
                  {format(fLocal(engagement.fecha_fin_estimada), "d MMM yyyy", { locale: es })}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Características del proyecto ────────────────────── */}
        {(caracteristicas.industria || caracteristicas.tematicas.length > 0) && (
          <div className="bg-white rounded-xl border border-[#e8e8e8] p-5 space-y-4">
            <h3 className="font-semibold text-[15px]">Características del proyecto</h3>
            <div className="space-y-3">
              {caracteristicas.industria && (
                <div>
                  <p className="text-[#888] text-xs mb-1.5">Industria</p>
                  <span className="text-[11px] px-2.5 py-1 rounded-full bg-[#eaf4ff] text-[#1a5276] font-medium">
                    {caracteristicas.industria}
                  </span>
                </div>
              )}
              {caracteristicas.tematicas.length > 0 && (
                <div>
                  <p className="text-[#888] text-xs mb-1.5">Temáticas</p>
                  <div className="flex flex-wrap gap-1.5">
                    {caracteristicas.tematicas.map((t) => (
                      <span key={t} className="text-[11px] px-2.5 py-1 rounded-full bg-[#fdf4ff] text-[#6b21a8] font-medium">{t}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Talleres y Viajes ──────────────────────────────────── */}
        {actividades.length > 0 && (
          <div className="bg-white rounded-xl border border-[#e8e8e8] overflow-hidden">
            <div className="px-5 py-3 bg-[#f0f9ff] border-b border-[#dbeafe] flex items-center gap-2">
              <Plane className="w-4 h-4 text-[#4a90e2] flex-shrink-0" />
              <p className="font-semibold text-sm text-[#1a1a1a]">Talleres y Viajes</p>
              <span className="ml-auto text-xs text-[#888]">{actividades.length}</span>
            </div>
            <div className="divide-y divide-[#f0f0f0]">
              {[...actividades]
                .sort((a, b) => new Date(b.fecha_inicio).getTime() - new Date(a.fecha_inicio).getTime())
                .map((a) => (
                  <div key={a.id} className="flex items-start gap-3 px-5 py-3">
                    {a.tipo === "Viajes"
                      ? <Plane className="w-4 h-4 text-[#92400e] flex-shrink-0 mt-0.5" />
                      : <Diamond className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                          a.tipo === "Viajes" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                        }`}>
                          {a.tipo}
                        </span>
                        <span className="text-sm font-medium">{a.titulo}</span>
                      </div>
                      {a.descripcion && <p className="text-xs text-[#888] mt-1">{a.descripcion}</p>}
                    </div>
                    <span className="text-xs text-[#aaa] flex-shrink-0">
                      {format(fLocal(a.fecha_inicio), "d MMM", { locale: es })}
                      {a.fecha_fin && a.fecha_fin !== a.fecha_inicio
                        ? ` → ${format(fLocal(a.fecha_fin), "d MMM yyyy", { locale: es })}`
                        : ""}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Equipo del proyecto — consolidado por persona, agrupado jerárquicamente por cargo */}
        {equipoPorGrupo.size > 0 && (
          <div className="bg-white rounded-xl border border-[#e8e8e8] overflow-hidden">
            <div className="px-5 py-3 bg-[#f9f9f9] border-b border-[#e8e8e8]">
              <p className="font-semibold text-sm text-[#888]">Equipo del proyecto</p>
            </div>
            <div className="divide-y divide-[#f5f5f5]">
              {[...equipoPorGrupo.entries()]
                .sort(([a], [b]) => compararGrupoCargo(a, b))
                .map(([grupo, personas]) => (
                  <div key={grupo} className="px-5 py-3">
                    <p className="text-[10px] font-bold text-[#aaa] uppercase tracking-wide mb-2">{grupo}</p>
                    <div className="space-y-2">
                      {[...personas]
                        .sort((a, b) => a.persona_nombre.localeCompare(b.persona_nombre, "es"))
                        .map((p) => {
                          const { bg, text } = colorOcupacion(p.pct_dedicacion);
                          return (
                            <div key={p.persona_id} className="rounded-lg bg-[#f9f9f9] border border-[#f0f0f0] px-3 py-2">
                              <div className="flex items-center gap-2">
                                <User className="w-3.5 h-3.5 text-[#aaa] flex-shrink-0" />
                                <span className="text-sm font-medium flex-1 min-w-0 truncate">{p.persona_nombre}</span>
                                {!(rolActual === "GyD" || rolActual === "AySr" || rolActual === "planificador" || rolActual === "Desarrollo") && (
                                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                                    style={{ background: bg, color: text }}>
                                    {formatPct(p.pct_dedicacion)}
                                  </span>
                                )}
                              </div>
                              {/* Timeline: tramos activos intercalados cronológicamente con ausencias */}
                              <div className="mt-1.5 ml-5 flex flex-wrap items-center gap-1.5">
                                {p.tramos.map((t, i) => (
                                  <span key={i}
                                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${
                                      t.tipo === "ausencia" ? "bg-amber-100 text-amber-700" : "bg-[#eaf4ff] text-[#1a5276]"
                                    }`}>
                                    {t.tipo === "ausencia" && "(ausencia) "}
                                    {format(fLocal(t.inicio), "d MMM", { locale: es })}
                                    {" → "}
                                    {t.fin ? format(fLocal(t.fin), "d MMM", { locale: es }) : "hoy"}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Drawer: crear / editar requerimiento ─────────────── */}
      <Drawer
        open={!!reqForm}
        onClose={() => setReqForm(null)}
        title={reqForm?.id ? "Editar requerimiento" : "Nuevo requerimiento"}
        subtitle={engagement.nombre}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReqForm(null)} disabled={reqLoading}>
              Cancelar
            </Button>
            <Button onClick={guardarReq} loading={reqLoading}>
              {reqForm?.id ? "Guardar cambios" : "Crear requerimiento"}
            </Button>
          </>
        }
      >
        {reqForm && (
          <div className="space-y-5">
            {reqError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                {reqError}
              </div>
            )}

            <FieldWrapper label="Nombre del requerimiento" required>
              <Input
                value={reqForm.fase_nombre}
                onChange={(e) => setReqForm({ ...reqForm, fase_nombre: e.target.value })}
                placeholder="ej. Gerente de Proyectos Fase 1"
                autoFocus
              />
            </FieldWrapper>

            <div className="grid grid-cols-2 gap-4">
              <FieldWrapper label="Cargo requerido">
                <Select
                  value={reqForm.cargo_requerido}
                  onChange={(e) => setReqForm({ ...reqForm, cargo_requerido: e.target.value })}
                  options={CARGO_OPTIONS}
                />
              </FieldWrapper>
              <FieldWrapper label="% Dedicación" required>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  step={0.5}
                  value={reqForm.pct_dedicacion}
                  onChange={(e) => setReqForm({ ...reqForm, pct_dedicacion: e.target.value })}
                />
              </FieldWrapper>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FieldWrapper
                label="Fecha inicio"
                required
                hint={minDate ? `Mín: ${format(fLocal(minDate), "d MMM yyyy", { locale: es })}` : undefined}
              >
                <Input
                  type="date"
                  value={reqForm.fecha_inicio}
                  min={minDate}
                  max={maxDate}
                  onChange={(e) => setReqForm({ ...reqForm, fecha_inicio: e.target.value })}
                />
              </FieldWrapper>
              <FieldWrapper
                label="Fecha fin"
                required
                hint={maxDate ? `Máx: ${format(fLocal(maxDate), "d MMM yyyy", { locale: es })}` : undefined}
              >
                <Input
                  type="date"
                  value={reqForm.fecha_fin}
                  min={reqForm.fecha_inicio || minDate}
                  max={maxDate}
                  onChange={(e) => setReqForm({ ...reqForm, fecha_fin: e.target.value })}
                />
              </FieldWrapper>
            </div>

            <FieldWrapper label="Descripción" hint="Opcional">
              <textarea
                value={reqForm.descripcion}
                onChange={(e) => setReqForm({ ...reqForm, descripcion: e.target.value })}
                rows={3}
                placeholder="Describe las responsabilidades o habilidades esperadas..."
                className="w-full px-3.5 py-2.5 rounded-lg border border-[#e0e0e0] text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#4a90e2]/40 focus:border-[#4a90e2] transition-colors"
              />
            </FieldWrapper>
          </div>
        )}
      </Drawer>

      {/* ── Confirmación eliminar requerimiento ──────────────── */}
      <ConfirmDialog
        open={!!reqDeleteId}
        onClose={() => setReqDeleteId(null)}
        onConfirm={confirmarEliminarReq}
        loading={reqDeleteLoading}
        title="Eliminar requerimiento"
        message="¿Eliminar este requerimiento? Las asignaciones vinculadas a él quedarán sin requerimiento asociado."
        confirmLabel="Eliminar"
      />

      {/* ── Panel fit: asignar persona a requerimiento ───────── */}
      {reqFitOpen && (
        <PanelFitAsignacion
          reqId={reqFitOpen.requerimiento_id}
          engagementId={id}
          engagementNombre={engagement.nombre}
          engagementCliente={engagement.cliente}
          onClose={() => setReqFitOpen(null)}
          onAsignado={() => { setReqFitOpen(null); load(); }}
        />
      )}

      {/* ── Confirmación quitar asignación ───────────────────── */}
      <ConfirmDialog
        open={!!quitarAsigId}
        onClose={() => setQuitarAsigId(null)}
        onConfirm={confirmarQuitarAsignacion}
        loading={quitarAsigLoading}
        title="Quitar asignación"
        message="¿Quitar esta asignación del requerimiento?"
        confirmLabel="Quitar"
      />

      {/* ── Formulario de edición del engagement ─────────────── */}
      {engagement && (
        <EngagementForm
          open={editando}
          onClose={() => setEditando(false)}
          onSuccess={() => { setEditando(false); load(); }}
          engagement={engagement}
        />
      )}

      {/* ── Confirmación eliminar engagement ─────────────────── */}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => { setConfirmDelete(false); setEliminandoError(null); }}
        onConfirm={handleEliminar}
        loading={eliminando}
        title="Eliminar engagement"
        message={`¿Eliminar el engagement "${engagement?.nombre}"? Esta acción no se puede deshacer y eliminará todas las asignaciones asociadas.`}
        confirmLabel="Eliminar"
      />

      {eliminandoError && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
          <div className="bg-white rounded-xl p-6 max-w-sm">
            <p className="text-sm text-red-600 mb-4">{eliminandoError}</p>
            <Button onClick={() => setEliminandoError(null)} size="sm">Cerrar</Button>
          </div>
        </div>
      )}
    </>
  );
}
