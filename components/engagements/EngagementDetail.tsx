"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, CheckCircle, User } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { createClient } from "@/lib/supabase/client";
import { fetchCoberturaEngagement } from "@/lib/queries/engagements";
import { colorOcupacion, formatPct } from "@/lib/utils";
import type { Engagement, CoberturaEngagement } from "@/lib/types/database";

interface Props { id: string; }

// Asignación enriquecida para mostrar en cada requerimiento
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

const ESTADO_ESTILOS: Record<string, { bg: string; text: string }> = {
  propuesta: { bg: "#eaf4ff",  text: "#1a5276" },
  activo:    { bg: "#dcf5e7",  text: "#1e7e45" },
  pausado:   { bg: "#fff4d4",  text: "#8a6200" },
  terminado: { bg: "#f0f0f0",  text: "#666" },
  rechazado: { bg: "#ffd4d4",  text: "#c02020" },
};

function BarraCobertura({ pct_cubierto, pct_requerido }: { pct_cubierto: number; pct_requerido: number }) {
  const porcentaje = Math.min((pct_cubierto / pct_requerido) * 100, 100);
  const cubierto = pct_cubierto >= pct_requerido;
  return (
    <div className="mt-2">
      <div className="h-1.5 bg-[#f0f0f0] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${porcentaje}%`, background: cubierto ? "#27ae60" : "#e67e22" }}
        />
      </div>
    </div>
  );
}

export function EngagementDetail({ id }: Props) {
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [cobertura, setCobertura] = useState<CoberturaEngagement[]>([]);
  // Mapa: requerimiento_id → asignaciones activas para ese requerimiento
  const [asignacionesPorReq, setAsignacionesPorReq] = useState<Map<string, AsignacionReq[]>>(new Map());
  // Asignaciones del engagement sin requerimiento vinculado
  const [asignacionesSinReq, setAsignacionesSinReq] = useState<AsignacionReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      // Tipo para el resultado raw de la consulta con join
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

    const [{ data: eng, error: engErr }, cobResult, asigResult] = await Promise.all([
        supabase.from("engagement").select("*").eq("id", id).single(),
        fetchCoberturaEngagement(supabase, id),
        // Cargar asignaciones activas del engagement con datos de persona
        supabase
          .from("asignacion")
          .select("id, persona_id, cargo_al_momento, pct_dedicacion, fecha_inicio, fecha_fin, requerimiento_id, persona:persona_id(nombre, apellido)")
          .eq("engagement_id", id)
          .eq("estado", "activa")
          .order("fecha_inicio"),
      ]);

      if (engErr || !eng) {
        setError(engErr?.message ?? "No encontrado");
      } else {
        setEngagement(eng);
        setCobertura(cobResult.data);
        if (cobResult.error) setError(cobResult.error);
      }

      const asigData = (asigResult.data ?? []) as unknown as AsignacionRaw[];

      // Enriquecer y agrupar asignaciones por requerimiento_id
      const asigs: AsignacionReq[] = asigData.map((a) => ({
        id: a.id,
        persona_id: a.persona_id,
        persona_nombre: a.persona
          ? `${a.persona.nombre} ${a.persona.apellido}`
          : "—",
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
      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) return <p className="text-sm text-[#888]">Cargando...</p>;
  if (error && !engagement) return <p className="text-sm text-red-500">{error}</p>;
  if (!engagement) return null;

  const estilos = ESTADO_ESTILOS[engagement.estado] ?? ESTADO_ESTILOS.propuesta;

  const porFase = cobertura.reduce<Record<number, CoberturaEngagement[]>>(
    (acc, r) => {
      const fase = r.fase_numero;
      if (!acc[fase]) acc[fase] = [];
      acc[fase].push(r);
      return acc;
    },
    {}
  );

  const tieneAlerta = cobertura.some((r) => r.pct_descubierto > 0);

  return (
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
              <h2 className="text-xl font-bold truncate">{engagement.nombre}</h2>
              {tieneAlerta && <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />}
            </div>
            <p className="text-[#888]">{engagement.cliente}</p>
          </div>
          <span
            className="text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0"
            style={{ background: estilos.bg, color: estilos.text }}
          >
            {engagement.estado}
          </span>
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
                {format(new Date(engagement.fecha_inicio), "d MMM yyyy", { locale: es })}
              </p>
            </div>
          )}
          {engagement.fecha_fin_estimada && (
            <div>
              <span className="text-[#888] text-xs">Fin estimado</span>
              <p className="font-medium mt-0.5">
                {format(new Date(engagement.fecha_fin_estimada), "d MMM yyyy", { locale: es })}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Requerimientos + asignaciones */}
      {Object.keys(porFase).length > 0 ? (
        <div className="space-y-3">
          <h3 className="font-semibold text-[15px]">Requerimientos y asignaciones</h3>
          {Object.entries(porFase)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([faseNum, reqs]) => (
              <div
                key={faseNum}
                className="bg-white rounded-xl border border-[#e8e8e8] overflow-hidden"
              >
                {/* Header de fase */}
                <div className="px-5 py-3 bg-[#f9f9f9] border-b border-[#e8e8e8]">
                  <p className="font-semibold text-sm">
                    Fase {faseNum}
                    {reqs[0].fase_nombre && (
                      <span className="font-normal text-[#888] ml-2">— {reqs[0].fase_nombre}</span>
                    )}
                  </p>
                </div>

                {/* Requerimientos */}
                <div className="divide-y divide-[#f0f0f0]">
                  {reqs.map((r) => {
                    const cubierto = r.pct_descubierto <= 0;
                    const { bg, text } = colorOcupacion(
                      Math.min((r.pct_cubierto / r.pct_requerido) * 100, 100)
                    );
                    const asigs = asignacionesPorReq.get(r.requerimiento_id) ?? [];

                    return (
                      <div key={r.requerimiento_id} className="px-5 py-4">
                        {/* Fila de requerimiento */}
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              {cubierto
                                ? <CheckCircle className="w-4 h-4 text-[#27ae60] flex-shrink-0" />
                                : <AlertTriangle className="w-4 h-4 text-[#e67e22] flex-shrink-0" />
                              }
                              <span className="font-medium text-sm">
                                {r.cargo_requerido ?? "Cualquier cargo"}
                              </span>
                            </div>
                            <p className="text-xs text-[#888] mt-0.5 ml-6">
                              {format(new Date(r.req_fecha_inicio), "d MMM", { locale: es })}
                              {" → "}
                              {format(new Date(r.req_fecha_fin), "d MMM yyyy", { locale: es })}
                            </p>
                          </div>

                          <div className="text-right flex-shrink-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-[#888]">
                                {formatPct(r.pct_cubierto)} / {formatPct(r.pct_requerido)}
                              </span>
                              <span
                                className="text-xs px-2 py-0.5 rounded-full font-semibold"
                                style={{ background: bg, color: text }}
                              >
                                {cubierto ? "Cubierto" : `Falta ${formatPct(r.pct_descubierto)}`}
                              </span>
                            </div>
                            <BarraCobertura pct_cubierto={r.pct_cubierto} pct_requerido={r.pct_requerido} />
                          </div>
                        </div>

                        {/* Asignaciones de este requerimiento */}
                        {asigs.length > 0 && (
                          <div className="mt-3 ml-6 space-y-2">
                            {asigs.map((a) => {
                              const { bg: abg, text: atext } = colorOcupacion(a.pct_dedicacion);
                              return (
                                <div
                                  key={a.id}
                                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#f9f9f9] border border-[#f0f0f0]"
                                >
                                  <User className="w-3.5 h-3.5 text-[#aaa] flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-[#1a1a1a]">
                                      {a.persona_nombre}
                                    </p>
                                    {a.cargo_al_momento && (
                                      <p className="text-[10px] text-[#888]">{a.cargo_al_momento}</p>
                                    )}
                                  </div>
                                  <span
                                    className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                                    style={{ background: abg, color: atext }}
                                  >
                                    {formatPct(a.pct_dedicacion)}
                                  </span>
                                  <span className="text-[10px] text-[#aaa] flex-shrink-0">
                                    {format(new Date(a.fecha_inicio), "d MMM", { locale: es })}
                                    {a.fecha_fin
                                      ? ` → ${format(new Date(a.fecha_fin), "d MMM yy", { locale: es })}`
                                      : " →"}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Sin asignaciones */}
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
            ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#e8e8e8] p-6 text-center text-[#888]">
          <p className="text-sm">Este engagement no tiene requerimientos definidos aún.</p>
        </div>
      )}

      {/* Asignaciones sin requerimiento vinculado */}
      {asignacionesSinReq.length > 0 && (
        <div className="bg-white rounded-xl border border-[#e8e8e8] overflow-hidden">
          <div className="px-5 py-3 bg-[#f9f9f9] border-b border-[#e8e8e8]">
            <p className="font-semibold text-sm text-[#888]">
              Asignaciones sin requerimiento vinculado
            </p>
          </div>
          <div className="divide-y divide-[#f5f5f5]">
            {asignacionesSinReq.map((a) => {
              const { bg, text } = colorOcupacion(a.pct_dedicacion);
              return (
                <div key={a.id} className="flex items-center gap-3 px-5 py-3">
                  <User className="w-3.5 h-3.5 text-[#aaa] flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{a.persona_nombre}</p>
                    {a.cargo_al_momento && (
                      <p className="text-xs text-[#888]">{a.cargo_al_momento}</p>
                    )}
                  </div>
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: bg, color: text }}
                  >
                    {formatPct(a.pct_dedicacion)}
                  </span>
                  <span className="text-xs text-[#aaa] flex-shrink-0">
                    {format(new Date(a.fecha_inicio), "d MMM", { locale: es })}
                    {a.fecha_fin
                      ? ` → ${format(new Date(a.fecha_fin), "d MMM yy", { locale: es })}`
                      : " →"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
