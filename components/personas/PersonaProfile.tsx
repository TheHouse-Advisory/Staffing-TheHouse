"use client";

import { useState, useEffect } from "react";
import { Pencil } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { getDetailedPersonAbsences, type DetalleAusenciasPersona, COLOR_AUSENCIA } from "@/lib/queries/ausencias";
import { Button } from "@/components/ui/Button";
import { PersonaForm } from "./PersonaForm";
import { CARGO_COLORS, CARGO_COLOR_DEFAULT } from "@/lib/constants";
import type { Persona } from "@/lib/types/database";

interface Props {
  id: string;
}

interface AsignacionActiva {
  id: string;
  pct_dedicacion: number;
  fecha_inicio: string;
  fecha_fin: string | null;
  cargo_al_momento: string;
  engagement_id: string;
  engagement_nombre: string;
}

interface TagItem {
  id: string;
  nombre: string;
  nivel?: string | null;
}

const NIVEL_LABEL: Record<string, string> = {
  basico: "básico",
  intermedio: "intermedio",
  avanzado: "avanzado",
};

function colorOcupacion(pct: number) {
  if (pct === 0)   return { bg: "#f0f0f0", text: "#888" };
  if (pct <= 50)   return { bg: "#dcf5e7", text: "#1e7e45" };
  if (pct <= 80)   return { bg: "#fff4d4", text: "#8a6200" };
  if (pct <= 100)  return { bg: "#ffe4c4", text: "#c45000" };
  return { bg: "#ffd4d4", text: "#c02020" };
}

export function PersonaProfile({ id }: Props) {
  const [persona, setPersona] = useState<Persona | null>(null);
  const [industrias, setIndustrias] = useState<TagItem[]>([]);
  const [capacidades, setCapacidades] = useState<TagItem[]>([]);
  const [tematicas, setTematicas] = useState<TagItem[]>([]);
  const [asignaciones, setAsignaciones] = useState<AsignacionActiva[]>([]);
  const [mentor, setMentor] = useState<Persona | null>(null);
  const [mentoreados, setMentoreados] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState(false);
  const [ausenciasDetalle, setAusenciasDetalle] = useState<DetalleAusenciasPersona | null>(null);

  const load = async () => {
    const supabase = createAnyClient();

    const [pRes, indRes, capRes, temRes, asigRes, mentoreRes] = await Promise.all([
      supabase.from("persona").select("*").eq("id", id).single(),

      supabase
        .from("persona_industria")
        .select("industria_id, cat_industria(id, nombre)")
        .eq("persona_id", id),

      supabase
        .from("persona_capacidad")
        .select("capacidad_id, nivel, cat_capacidad(id, nombre)")
        .eq("persona_id", id),

      supabase
        .from("persona_tematica")
        .select("tematica_id, cat_tematica(id, nombre)")
        .eq("persona_id", id),

      supabase
        .from("asignacion")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .select("id, pct_dedicacion, fecha_inicio, fecha_fin, cargo_al_momento, engagement:engagement_id(id, nombre)" as any)
        .eq("persona_id", id)
        .eq("estado", "activa")
        .order("fecha_inicio"),

      // Personas a las que esta persona hace de mentor
      supabase
        .from("persona")
        .select("id, nombre, apellido, cargo_actual")
        .eq("mentor_id", id)
        .eq("activo", true)
        .order("apellido"),
    ]);

    if (pRes.data) {
      const p = pRes.data as Persona;
      setPersona(p);
      // Cargar mentor si tiene uno asignado
      if (p.mentor_id) {
        const { data: mentorData } = await supabase
          .from("persona")
          .select("id, nombre, apellido, cargo_actual")
          .eq("id", p.mentor_id)
          .single();
        setMentor(mentorData as Persona ?? null);
      } else {
        setMentor(null);
      }
    }

    setIndustrias(
      (indRes.data ?? []).map((r: any) => ({
        id: r.industria_id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        nombre: (r.cat_industria as any)?.nombre ?? r.industria_id,
      }))
    );

    setCapacidades(
      (capRes.data ?? []).map((r: any) => ({
        id: r.capacidad_id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        nombre: (r.cat_capacidad as any)?.nombre ?? r.capacidad_id,
        nivel: r.nivel,
      }))
    );

    setTematicas(
      (temRes.data ?? []).map((r: any) => ({
        id: r.tematica_id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        nombre: (r.cat_tematica as any)?.nombre ?? r.tematica_id,
      }))
    );

    setAsignaciones(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (asigRes.data ?? []).map((r: any) => ({
        id: r.id,
        pct_dedicacion: Number(r.pct_dedicacion),
        fecha_inicio: r.fecha_inicio,
        fecha_fin: r.fecha_fin,
        cargo_al_momento: r.cargo_al_momento,
        engagement_id: r.engagement?.id ?? "",
        engagement_nombre: r.engagement?.nombre ?? "—",
      }))
    );

    setMentoreados((mentoreRes.data ?? []) as Persona[]);
    const ausencias = await getDetailedPersonAbsences(supabase, id);
    setAusenciasDetalle(ausencias);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [id]);

  if (loading) return <p className="text-sm text-[#888] p-6">Cargando...</p>;
  if (!persona) return <p className="text-sm text-red-500 p-6">Persona no encontrada.</p>;

  const initials = `${persona.nombre[0]}${persona.apellido[0]}`.toUpperCase();
  const pctTotal = asignaciones.reduce((sum, a) => sum + a.pct_dedicacion, 0);
  const { bg: bgOcp, text: textOcp } = colorOcupacion(pctTotal);
  const cargoColor = CARGO_COLORS[persona.cargo_actual ?? ""] ?? CARGO_COLOR_DEFAULT;

  return (
    <>
      <div className="max-w-2xl space-y-5">
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-[#e8e8e8] p-6 flex items-start justify-between gap-5">
          <div className="flex items-center gap-5">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold flex-shrink-0"
              style={{ backgroundColor: cargoColor }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold">
                  {persona.nombre} {persona.apellido}
                </h2>
                {!persona.activo && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[#f0f0f0] text-[#888]">
                    Inactivo
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <p className="font-semibold text-sm" style={{ color: cargoColor }}>{persona.cargo_actual ?? "Sin cargo"}</p>
                {persona.talento && (
                  <span
                    className="text-xs px-2.5 py-0.5 rounded-full font-semibold"
                    style={
                      persona.talento === "talento"
                        ? { background: "#f0fdf4", color: "#16a34a" }
                        : persona.talento === "en_desarrollo"
                        ? { background: "#fefce8", color: "#ca8a04" }
                        : { background: "#fef2f2", color: "#dc2626" }
                    }
                  >
                    {persona.talento === "talento" ? "Talento" : persona.talento === "en_desarrollo" ? "En desarrollo" : "No talento"}
                  </span>
                )}
              </div>
              <div className="flex gap-2 mt-1.5 flex-wrap">
                {persona.rol_sistema && (
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#eaf4ff] text-[#1a5276] font-medium">
                    {persona.rol_sistema}
                  </span>
                )}
                <span
                  className="text-xs px-2.5 py-0.5 rounded-full font-medium"
                  style={{ background: bgOcp, color: textOcp }}
                >
                  {pctTotal}% ocupado actualmente
                </span>
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditando(true)}
            className="text-[#888] hover:text-[#1a1a1a]"
            title="Editar"
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* ── Info ───────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-[#e8e8e8] p-6">
          <h3 className="font-semibold mb-4">Información</h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div>
              <dt className="text-[#888]">Email</dt>
              <dd className="font-medium mt-0.5">{persona.email}</dd>
            </div>
            {persona.fecha_ingreso && (
              <div>
                <dt className="text-[#888]">Fecha de ingreso</dt>
                <dd className="font-medium mt-0.5">
                  {format(new Date(persona.fecha_ingreso + "T00:00:00"), "d 'de' MMMM yyyy", { locale: es })}
                </dd>
              </div>
            )}
            {persona.fecha_nacimiento && (
              <div>
                <dt className="text-[#888]">Fecha de nacimiento</dt>
                <dd className="font-medium mt-0.5">
                  {format(new Date(persona.fecha_nacimiento + "T00:00:00"), "d 'de' MMMM yyyy", { locale: es })}
                </dd>
              </div>
            )}
            {mentor && (
              <div>
                <dt className="text-[#888]">Mentor</dt>
                <dd className="font-medium mt-0.5 flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-[#4a90e2] flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                    {mentor.nombre[0]}{mentor.apellido[0]}
                  </div>
                  {mentor.nombre} {mentor.apellido}
                </dd>
              </div>
            )}
            {mentoreados.length > 0 && (
              <div className="col-span-2">
                <dt className="text-[#888] mb-1.5">Es mentor de</dt>
                <dd className="flex flex-wrap gap-2">
                  {mentoreados.map((m) => (
                    <span
                      key={m.id}
                      className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[#f0f9f4] text-[#1e7e45] font-medium"
                    >
                      <div className="w-4 h-4 rounded-full bg-[#4ab89a] flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
                        {m.nombre[0]}{m.apellido[0]}
                      </div>
                      {m.nombre} {m.apellido}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </div>

        {/* ── Asignaciones activas ───────────────────────────── */}
        <div className="bg-white rounded-xl border border-[#e8e8e8] p-6">
          <h3 className="font-semibold mb-4">Asignaciones activas</h3>
          {asignaciones.length === 0 ? (
            <p className="text-sm text-[#888]">Sin asignaciones activas.</p>
          ) : (
            <div className="space-y-2">
              {asignaciones.map((a) => {
                const { bg, text } = colorOcupacion(a.pct_dedicacion);
                return (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-4 p-3 rounded-lg bg-[#f9f9f9] border border-[#f0f0f0]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{a.engagement_nombre}</p>
                      <p className="text-xs text-[#888] mt-0.5">
                        {format(new Date(a.fecha_inicio + "T00:00:00"), "d MMM yy", { locale: es })}
                        {" → "}
                        {a.fecha_fin
                          ? format(new Date(a.fecha_fin + "T00:00:00"), "d MMM yy", { locale: es })
                          : "indefinido"}
                      </p>
                    </div>
                    <span
                      className="flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full"
                      style={{ background: bg, color: text }}
                    >
                      {a.pct_dedicacion}%
                    </span>
                  </div>
                );
              })}
              {asignaciones.length > 1 && (
                <p className="text-xs text-[#aaa] text-right pt-1">
                  Total: {pctTotal}% de capacidad comprometida
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Historial de Ausencias ───────────────────────── */}
        {ausenciasDetalle && (
          <div className="bg-white rounded-xl border border-[#e8e8e8] p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold">Ausencias</h3>
              <div className="text-right">
                <span className="text-3xl font-bold text-[#1a1a2e]">{ausenciasDetalle.totalDiasAnioActual}</span>
                <p className="text-xs text-[#888] mt-0.5">días utilizados {new Date().getFullYear()}</p>
              </div>
            </div>

            {ausenciasDetalle.ausenciasFuturas.length === 0 && ausenciasDetalle.ausenciasPasadasAnioActual.length === 0 ? (
              <p className="text-sm text-[#ccc] italic">Sin ausencias registradas este año.</p>
            ) : (
              <div className="space-y-5">
                {/* Próximas ausencias */}
                {ausenciasDetalle.ausenciasFuturas.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-[#888] uppercase tracking-widest mb-2">
                      Próximas ausencias
                    </p>
                    <div className="space-y-2">
                      {ausenciasDetalle.ausenciasFuturas.map((a) => {
                        const color = COLOR_AUSENCIA[a.tipo]?.bg ?? "#9ca3af";
                        return (
                          <div key={a.id}
                            className="flex items-center justify-between p-3 rounded-lg border"
                            style={{ background: color + "18", borderColor: color + "44" }}
                          >
                            <div>
                              <p className="text-sm font-medium text-[#1a1a2e]">{a.tipoLabel}</p>
                              <p className="text-xs text-[#888] mt-0.5">
                                {format(new Date(a.fechaInicio + "T00:00:00"), "d MMM", { locale: es })}
                                {" → "}
                                {format(new Date(a.fechaFin + "T00:00:00"), "d MMM yyyy", { locale: es })}
                              </p>
                              {a.descripcion && (
                                <p className="text-xs text-[#aaa] mt-0.5 italic">{a.descripcion}</p>
                              )}
                            </div>
                            <span
                              className="flex-shrink-0 text-xs font-bold px-2.5 py-1 rounded-full text-white ml-3"
                              style={{ background: color }}
                            >
                              {a.numDias}d
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Registro histórico del año */}
                {ausenciasDetalle.ausenciasPasadasAnioActual.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-[#888] uppercase tracking-widest mb-2">
                      Registro histórico {new Date().getFullYear()}
                    </p>
                    <div className="space-y-1.5">
                      {ausenciasDetalle.ausenciasPasadasAnioActual.map((a) => (
                        <div key={a.id}
                          className="flex items-center justify-between p-2.5 rounded-lg bg-[#f9f9f9] border border-[#f0f0f0]"
                        >
                          <div>
                            <p className="text-sm text-[#555] font-medium">{a.tipoLabel}</p>
                            <p className="text-xs text-[#888] mt-0.5">
                              {format(new Date(a.fechaInicio + "T00:00:00"), "d MMM", { locale: es })}
                              {" → "}
                              {format(new Date(a.fechaFin + "T00:00:00"), "d MMM", { locale: es })}
                            </p>
                          </div>
                          <span className="text-xs text-[#888] flex-shrink-0 ml-3">{a.numDias} días</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Preferencias y experiencia ─────────────────────── */}
        <div className="bg-white rounded-xl border border-[#e8e8e8] p-6">
          <h3 className="font-semibold mb-4">Preferencias y experiencia</h3>
          <div className="space-y-5">

            <div>
              <p className="text-xs font-semibold text-[#888] uppercase tracking-widest mb-2">
                Industrias
              </p>
              {industrias.length === 0 ? (
                <p className="text-sm text-[#ccc] italic">Sin industrias definidas</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {industrias.map((t) => (
                    <span
                      key={t.id}
                      className="text-xs px-2.5 py-1 rounded-full bg-[#eaf4ff] text-[#1a5276] font-medium"
                    >
                      {t.nombre}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-[#888] uppercase tracking-widest mb-2">
                Capacidades
              </p>
              {capacidades.length === 0 ? (
                <p className="text-sm text-[#ccc] italic">Sin capacidades definidas</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {capacidades.map((t) => (
                    <span
                      key={t.id}
                      className="text-xs px-2.5 py-1 rounded-full bg-[#f0f9f4] text-[#1e7e45] font-medium"
                    >
                      {t.nombre}
                      {t.nivel && (
                        <span className="ml-1 opacity-60">
                          · {NIVEL_LABEL[t.nivel] ?? t.nivel}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-[#888] uppercase tracking-widest mb-2">
                Temáticas
              </p>
              {tematicas.length === 0 ? (
                <p className="text-sm text-[#ccc] italic">Sin temáticas definidas</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {tematicas.map((t) => (
                    <span
                      key={t.id}
                      className="text-xs px-2.5 py-1 rounded-full bg-[#fdf4ff] text-[#6b21a8] font-medium"
                    >
                      {t.nombre}
                    </span>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* Formulario de edición */}
      {persona && (
        <PersonaForm
          open={editando}
          onClose={() => setEditando(false)}
          onSuccess={() => {
            setEditando(false);
            load();
          }}
          persona={persona}
        />
      )}
    </>
  );
}
