"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, AlertTriangle, CheckCircle, User,
  Pencil, Trash2, Plus, X, Flame, Users,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { createClient } from "@/lib/supabase/client";
import { createAnyClient } from "@/lib/supabase/client";
import { fetchCoberturaEngagement } from "@/lib/queries/engagements";
import { colorOcupacion, formatPct, fLocal } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { Drawer } from "@/components/ui/Drawer";
import { FieldWrapper, Input, Select } from "@/components/ui/FormField";
import { EngagementForm } from "./EngagementForm";
import { ExtenderProyecto } from "./ExtenderProyecto";
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
  const [asignacionesSinReq, setAsignacionesSinReq] = useState<AsignacionReq[]>([]);
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

  // Días críticos
  type DiaCritico = { id: string; fecha: string; fecha_fin: string | null; intensidad: string; descripcion: string | null };
  const INTENSIDAD_COLOR: Record<string, string> = { rojo: "#ef4444", amarillo: "#f59e0b", verde: "#22c55e" };
  const [diasCriticos, setDiasCriticos] = useState<DiaCritico[]>([]);
  const [nuevoDia, setNuevoDia] = useState("");
  const [nuevoDiaFin, setNuevoDiaFin] = useState("");
  const [nuevoDiaIntensidad, setNuevoDiaIntensidad] = useState<"rojo" | "amarillo" | "verde">("rojo");
  const [nuevoDiaDesc, setNuevoDiaDesc] = useState("");
  const [diasCriticosGuardando, setDiasCriticosGuardando] = useState(false);

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

    const [{ data: eng, error: engErr }, cobResult, asigResult, dcResult, capResult, temResult] = await Promise.all([
      sb.from("engagement").select("*, cat_industria(nombre)").eq("id", id).single(),
      fetchCoberturaEngagement(supabase, id),
      sb
        .from("asignacion")
        .select("id, persona_id, cargo_al_momento, pct_dedicacion, fecha_inicio, fecha_fin, requerimiento_id, persona:persona_id(nombre, apellido)")
        .eq("engagement_id", id)
        .eq("estado", "activa")
        .order("fecha_inicio"),
      sb.from("dia_critico").select("id, fecha, fecha_fin, intensidad, descripcion").eq("engagement_id", id).order("fecha"),
      (sb as any).from("engagement_capacidad").select("cat_capacidad(nombre)").eq("engagement_id", id),
      (sb as any).from("engagement_tematica").select("cat_tematica(nombre)").eq("engagement_id", id),
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
    const sinReq: AsignacionReq[] = [];
    for (const a of asigs) {
      if (a.requerimiento_id) {
        const arr = porReq.get(a.requerimiento_id) ?? [];
        arr.push(a);
        porReq.set(a.requerimiento_id, arr);
      } else {
        sinReq.push(a);
      }
    }

    setAsignacionesPorReq(porReq);
    setAsignacionesSinReq(sinReq);
    setDiasCriticos((dcResult.data ?? []) as DiaCritico[]);

    setLoading(false);
  };

  // ── Días críticos ──────────────────────────────────────────────
  const agregarDiaCritico = async () => {
    if (!nuevoDia) return;
    setDiasCriticosGuardando(true);
    const sb = createAnyClient();
    await sb.from("dia_critico").insert({
      engagement_id: id,
      fecha: nuevoDia,
      fecha_fin: nuevoDiaFin || null,
      intensidad: nuevoDiaIntensidad,
      descripcion: nuevoDiaDesc.trim() || null,
    });
    const { data } = await sb.from("dia_critico").select("id, fecha, fecha_fin, intensidad, descripcion").eq("engagement_id", id).order("fecha");
    setDiasCriticos((data ?? []) as DiaCritico[]);
    setNuevoDia("");
    setNuevoDiaFin("");
    setNuevoDiaIntensidad("rojo");
    setNuevoDiaDesc("");
    setDiasCriticosGuardando(false);
  };

  const eliminarDiaCritico = async (dcId: string) => {
    const sb = createAnyClient();
    await sb.from("dia_critico").delete().eq("id", dcId);
    setDiasCriticos((prev) => prev.filter((d) => d.id !== dcId));
  };

  useEffect(() => { load(); }, [id]);

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
              <Button variant="ghost" size="sm" onClick={() => setEditando(true)}
                className="text-[#888] hover:text-[#1a1a1a]" title="Editar engagement">
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}
                className="text-[#888] hover:text-red-500" title="Eliminar engagement">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
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
        {(caracteristicas.industria || caracteristicas.capacidades.length > 0 || caracteristicas.tematicas.length > 0) && (
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
              {caracteristicas.capacidades.length > 0 && (
                <div>
                  <p className="text-[#888] text-xs mb-1.5">Capacidades</p>
                  <div className="flex flex-wrap gap-1.5">
                    {caracteristicas.capacidades.map((c) => (
                      <span key={c} className="text-[11px] px-2.5 py-1 rounded-full bg-[#f0f9f4] text-[#1e7e45] font-medium">{c}</span>
                    ))}
                  </div>
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

        {/* ── Requerimientos + asignaciones ──────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-[15px]">Requerimientos y asignaciones</h3>
            <Button size="sm" onClick={abrirNuevoReq}>
              <Plus className="w-3.5 h-3.5" />
              Nuevo requerimiento
            </Button>
          </div>

          {tieneRequerimientos ? (
            Object.entries(porNombre)
              .sort(([a], [b]) => a.localeCompare(b, "es"))
              .map(([nombre, reqs]) => (
                <div key={nombre} className="bg-white rounded-xl border border-[#e8e8e8] overflow-hidden">
                  {/* Header de grupo */}
                  <div className="px-5 py-3 bg-[#f9f9f9] border-b border-[#e8e8e8]">
                    <p className="font-semibold text-sm">{nombre}</p>
                  </div>

                  <div className="divide-y divide-[#f0f0f0]">
                    {reqs.map((r) => {
                      const cubierto = r.pct_descubierto <= 0;
                      const asigs = asignacionesPorReq.get(r.requerimiento_id) ?? [];
                      return (
                        <div key={r.requerimiento_id} className="px-5 py-4">
                          {/* Fila de requerimiento */}
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                {cubierto
                                  ? <CheckCircle className="w-4 h-4 text-[#27ae60] flex-shrink-0" />
                                  : <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />}
                                <span className="font-medium text-sm">
                                  {r.cargo_requerido ?? "Cualquier cargo"}
                                  <span className="ml-2 text-xs font-normal text-[#aaa]">
                                    {r.pct_requerido}%
                                  </span>
                                </span>
                              </div>
                              <p className="text-xs text-[#888] mt-0.5 ml-6">
                                {format(fLocal(r.req_fecha_inicio), "d MMM", { locale: es })}
                                {" → "}
                                {format(fLocal(r.req_fecha_fin), "d MMM yyyy", { locale: es })}
                              </p>
                            </div>

                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <span
                                className="text-xs px-2 py-0.5 rounded-full font-semibold"
                                style={{
                                  background: cubierto ? "#dcf5e7" : "#fef08a",
                                  color: cubierto ? "#1e7e45" : "#a16207",
                                }}
                              >
                                {cubierto ? "Cubierto" : "Sin cubrir"}
                              </span>
                              {/* Editar y eliminar requerimiento */}
                              <button
                                onClick={() => abrirEditarReq(r.requerimiento_id)}
                                className="p-1 rounded hover:bg-[#f0f0f0] text-[#aaa] hover:text-[#555] transition-colors"
                                title="Editar requerimiento"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setReqDeleteId(r.requerimiento_id)}
                                className="p-1 rounded hover:bg-red-50 text-[#aaa] hover:text-red-500 transition-colors"
                                title="Eliminar requerimiento"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setReqFitOpen(r)}
                                className="p-1 rounded hover:bg-blue-50 text-[#aaa] hover:text-blue-500 transition-colors"
                                title="Asignar persona"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Asignaciones del requerimiento */}
                          {asigs.length > 0 && (
                            <div className="mt-3 ml-6 space-y-2">
                              {asigs.map((a) => {
                                const { bg: abg, text: atext } = colorOcupacion(a.pct_dedicacion);
                                return (
                                  <div key={a.id}
                                    className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#f9f9f9] border border-[#f0f0f0]">
                                    <User className="w-3.5 h-3.5 text-[#aaa] flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-medium text-[#1a1a1a]">{a.persona_nombre}</p>
                                      {a.cargo_al_momento && (
                                        <p className="text-[10px] text-[#888]">{a.cargo_al_momento}</p>
                                      )}
                                    </div>
                                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                                      style={{ background: abg, color: atext }}>
                                      {formatPct(a.pct_dedicacion)}
                                    </span>
                                    <span className="text-[10px] text-[#aaa] flex-shrink-0">
                                      {format(fLocal(a.fecha_inicio), "d MMM", { locale: es })}
                                      {a.fecha_fin
                                        ? ` → ${format(fLocal(a.fecha_fin), "d MMM yy", { locale: es })}`
                                        : " →"}
                                    </span>
                                    <button
                                      onClick={() => setQuitarAsigId(a.id)}
                                      className="p-1 rounded hover:bg-red-50 text-[#ccc] hover:text-red-400 transition-colors flex-shrink-0"
                                      title="Quitar asignación"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {asigs.length === 0 && !cubierto && (
                            <p className="mt-2 ml-6 text-xs text-[#aaa] italic">
                              Sin asignaciones activas para este requerimiento.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
          ) : (
            <div className="bg-white rounded-xl border border-[#e8e8e8] p-8 text-center">
              <p className="text-sm text-[#888] mb-3">
                Este engagement no tiene requerimientos definidos aún.
              </p>
              <Button size="sm" onClick={abrirNuevoReq}>
                <Plus className="w-3.5 h-3.5" />
                Agregar primer requerimiento
              </Button>
            </div>
          )}
        </div>

        {/* ── Días críticos ─────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-[#e8e8e8] overflow-hidden">
          <div className="px-5 py-3 bg-[#fffbf0] border-b border-[#f5e8c0] flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-500 flex-shrink-0" />
            <p className="font-semibold text-sm text-[#1a1a1a]">Días críticos</p>
            <span className="ml-auto text-xs text-[#888]">
              Fechas de alta intensidad para este engagement
            </span>
          </div>

          <div className="p-5 space-y-4">
            {/* Lista de días marcados */}
            {diasCriticos.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {diasCriticos.map((dc) => {
                  const color = INTENSIDAD_COLOR[dc.intensidad] ?? "#ef4444";
                  const fechaLabel = dc.fecha_fin && dc.fecha_fin !== dc.fecha
                    ? `${format(fLocal(dc.fecha), "d MMM", { locale: es })} → ${format(fLocal(dc.fecha_fin), "d MMM yyyy", { locale: es })}`
                    : format(fLocal(dc.fecha), "d MMM yyyy", { locale: es });
                  return (
                    <div key={dc.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm"
                      style={{ background: `${color}15`, borderColor: `${color}40` }}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                      <span className="font-medium text-[#1a1a1a]">{fechaLabel}</span>
                      {dc.descripcion && <span className="text-[#888] text-xs">· {dc.descripcion}</span>}
                      <button type="button" onClick={() => eliminarDiaCritico(dc.id)}
                        className="ml-1 text-[#ccc] hover:text-red-400 transition-colors" title="Quitar">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-[#aaa] italic">Sin días críticos marcados.</p>
            )}

            {/* Agregar nuevo período de intensidad */}
            <div className="pt-2 border-t border-[#f5f5f5] space-y-2">
              <div className="flex items-end gap-2 flex-wrap">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-[#888] font-medium">Fecha inicio</label>
                  <input type="date" value={nuevoDia} min={engagement?.fecha_inicio ?? undefined}
                    onChange={(e) => setNuevoDia(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-[#e0e0e0] text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 transition-colors" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-[#888] font-medium">Fecha fin (opcional)</label>
                  <input type="date" value={nuevoDiaFin} min={nuevoDia || engagement?.fecha_inicio || undefined}
                    onChange={(e) => setNuevoDiaFin(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-[#e0e0e0] text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 transition-colors" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-[#888] font-medium">Intensidad</label>
                  <div className="flex gap-1.5 h-[38px] items-center">
                    {(["rojo", "amarillo", "verde"] as const).map((int) => (
                      <button key={int} type="button" onClick={() => setNuevoDiaIntensidad(int)}
                        className="w-7 h-7 rounded-full transition-all border-2"
                        style={{
                          background: INTENSIDAD_COLOR[int],
                          borderColor: nuevoDiaIntensidad === int ? "#1a1a1a" : "transparent",
                          transform: nuevoDiaIntensidad === int ? "scale(1.2)" : "scale(1)",
                        }}
                        title={int.charAt(0).toUpperCase() + int.slice(1)}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs text-[#888] font-medium">Descripción (opcional)</label>
                  <input type="text" value={nuevoDiaDesc} onChange={(e) => setNuevoDiaDesc(e.target.value)}
                    placeholder="ej. Presentación cliente, Cierre de hito..."
                    className="px-3 py-2 rounded-lg border border-[#e0e0e0] text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 transition-colors" />
                </div>
                <button type="button" onClick={agregarDiaCritico} disabled={!nuevoDia || diasCriticosGuardando}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-[#e0e0e0] disabled:text-[#aaa] text-white text-sm font-medium transition-colors">
                  <Plus className="w-3.5 h-3.5" />
                  Agregar
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Asignaciones sin requerimiento */}
        {asignacionesSinReq.length > 0 && (
          <div className="bg-white rounded-xl border border-[#e8e8e8] overflow-hidden">
            <div className="px-5 py-3 bg-[#f9f9f9] border-b border-[#e8e8e8]">
              <p className="font-semibold text-sm text-[#888]">Asignaciones sin requerimiento vinculado</p>
            </div>
            <div className="divide-y divide-[#f5f5f5]">
              {asignacionesSinReq.map((a) => {
                const { bg, text } = colorOcupacion(a.pct_dedicacion);
                return (
                  <div key={a.id} className="flex items-center gap-3 px-5 py-3">
                    <User className="w-3.5 h-3.5 text-[#aaa] flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{a.persona_nombre}</p>
                      {a.cargo_al_momento && <p className="text-xs text-[#888]">{a.cargo_al_momento}</p>}
                    </div>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: bg, color: text }}>
                      {formatPct(a.pct_dedicacion)}
                    </span>
                    <span className="text-xs text-[#aaa] flex-shrink-0">
                      {format(fLocal(a.fecha_inicio), "d MMM", { locale: es })}
                      {a.fecha_fin
                        ? ` → ${format(fLocal(a.fecha_fin), "d MMM yy", { locale: es })}`
                        : " →"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* ── Extender Proyecto ─────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-[#e8e8e8] overflow-hidden">
          <div className="px-5 py-3 bg-[#f0f9ff] border-b border-[#dbeafe] flex items-center gap-2">
            <Users className="w-4 h-4 text-[#4a90e2] flex-shrink-0" />
            <p className="font-semibold text-sm text-[#1a1a1a]">Extender Proyecto</p>
          </div>
          <div className="p-5">
            <ExtenderProyecto engagementId={id} engagementTipo={engagement?.tipo} onExtended={load} />
          </div>
        </div>
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
