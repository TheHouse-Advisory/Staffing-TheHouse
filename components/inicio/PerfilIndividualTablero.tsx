"use client";

import { useEffect, useState } from "react";
import { addDays, format, startOfISOWeek } from "date-fns";
import { es } from "date-fns/locale";
import { createAnyClient } from "@/lib/supabase/client";

const JERARQUIA: Record<string, number> = {
  "Socio": 1, "Director de Proyectos": 2, "Director": 2,
  "Gerente de Proyectos": 3, "Gerente": 3, "Asociado": 4,
  "Consultor Senior": 5, "Consultor de Proyectos": 6, "Consultor Proyecto": 6,
  "Consultor": 6, "Consultor Analista": 7, "Analista Senior": 7,
  "Consultor Trainee": 8, "Analista": 8, "Practicante": 9,
};

interface PersonaFila {
  id: string;
  nombre: string;
  apellido: string;
  cargo: string;
  proyectos: { id: string; nombre: string; cliente: string; inicio: string; fin: string; pct: number }[];
  ausencias: { inicio: string; fin: string; tipo: string }[];
}

interface Props {
  semanaInicio: Date;
}

const DIAS_SEMANA = 7;

function estaActivo(inicio: string, fin: string, dia: Date): boolean {
  const d = dia.toISOString().split("T")[0];
  return inicio <= d && d <= fin;
}

const TIPO_LABEL: Record<string, string> = {
  vacaciones: "Vacaciones",
  licencia_medica: "Licencia médica",
  capacitacion: "Capacitación",
  permiso: "Permiso",
};

export function PerfilIndividualTablero({ semanaInicio }: Props) {
  const [filas, setFilas] = useState<PersonaFila[]>([]);
  const [loading, setLoading] = useState(true);

  const dias = Array.from({ length: DIAS_SEMANA }, (_, i) => addDays(semanaInicio, i));
  const fechaInicio = format(semanaInicio, "yyyy-MM-dd");
  const fechaFin = format(addDays(semanaInicio, DIAS_SEMANA - 1), "yyyy-MM-dd");

  useEffect(() => {
    async function load() {
      setLoading(true);
      const sb = createAnyClient();

      const [persRes, asigRes, ausenRes] = await Promise.all([
        sb.from("persona").select("id, nombre, apellido, cargo_actual").eq("activo", true),

        sb.from("asignacion")
          .select("persona_id, pct_dedicacion, fecha_inicio, fecha_fin, engagement:engagement_id(id, nombre, cliente)" as any)
          .eq("estado", "activa")
          .lte("fecha_inicio", fechaFin)
          .gte("fecha_fin", fechaInicio),

        sb.from("ausencia")
          .select("persona_id, fecha_inicio, fecha_fin, tipo")
          .lte("fecha_inicio", fechaFin)
          .gte("fecha_fin", fechaInicio),
      ]);

      const personas: PersonaFila[] = ((persRes.data ?? []) as any[])
        .sort((a, b) => {
          const ia = JERARQUIA[a.cargo_actual ?? ""] ?? 99;
          const ib = JERARQUIA[b.cargo_actual ?? ""] ?? 99;
          return ia !== ib ? ia - ib : a.apellido.localeCompare(b.apellido);
        })
        .map((p) => {
          const asigs = ((asigRes.data ?? []) as any[])
            .filter((a) => a.persona_id === p.id)
            .map((a) => ({
              id: a.engagement?.id ?? "",
              nombre: a.engagement?.nombre ?? "—",
              cliente: a.engagement?.cliente ?? "",
              inicio: a.fecha_inicio,
              fin: a.fecha_fin,
              pct: a.pct_dedicacion,
            }));

          const ausencias = ((ausenRes.data ?? []) as any[])
            .filter((a) => a.persona_id === p.id)
            .map((a) => ({ inicio: a.fecha_inicio, fin: a.fecha_fin, tipo: a.tipo }));

          return {
            id: p.id,
            nombre: p.nombre,
            apellido: p.apellido,
            cargo: p.cargo_actual ?? "Sin cargo",
            proyectos: asigs,
            ausencias,
          };
        })
        // Solo mostrar personas con al menos algo esta semana
        .filter((p) => p.proyectos.length > 0 || p.ausencias.length > 0);

      setFilas(personas);
      setLoading(false);
    }
    load();
  }, [fechaInicio, fechaFin]);

  if (loading) return <p className="text-sm text-gray-300 p-2">Cargando...</p>;
  if (filas.length === 0) return <p className="text-sm text-gray-300 italic p-2">Sin actividad esta semana.</p>;

  const hoy = format(new Date(), "yyyy-MM-dd");

  return (
    <div className="overflow-auto h-full">
      <table className="w-full text-xs border-collapse" style={{ minWidth: 520 }}>
        <thead>
          <tr>
            {/* Columna persona */}
            <th className="text-left pr-3 pb-2 text-gray-400 font-semibold w-36 sticky left-0 bg-white z-10">
              Persona
            </th>
            {dias.map((d) => {
              const key = format(d, "yyyy-MM-dd");
              const esHoy = key === hoy;
              return (
                <th
                  key={key}
                  className="text-center pb-2 font-semibold"
                  style={{ color: esHoy ? "#4a90e2" : "#aaa", minWidth: 48 }}
                >
                  <div className="capitalize">{format(d, "EEE", { locale: es })}</div>
                  <div className="font-normal text-[10px]">{format(d, "d MMM", { locale: es })}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {filas.map((persona, pi) => (
            <>
              {/* Separador entre personas */}
              {pi > 0 && (
                <tr key={`sep-${persona.id}`}>
                  <td colSpan={DIAS_SEMANA + 1} className="py-1">
                    <div className="border-t border-gray-100" />
                  </td>
                </tr>
              )}

              {/* Nombre y cargo */}
              <tr key={`hdr-${persona.id}`}>
                <td className="pr-3 pt-2 pb-1 sticky left-0 bg-white z-10">
                  <p className="font-semibold text-[#1a1a2e] truncate max-w-[130px]">
                    {persona.nombre} {persona.apellido}
                  </p>
                  <p className="text-[10px] text-gray-400 truncate max-w-[130px]">{persona.cargo}</p>
                </td>
                {/* Celdas vacías del header */}
                {dias.map((d) => (
                  <td key={format(d, "yyyy-MM-dd")} />
                ))}
              </tr>

              {/* Fila por proyecto */}
              {persona.proyectos.map((proy) => (
                <tr key={`proy-${persona.id}-${proy.id}`}>
                  <td className="pr-3 py-0.5 sticky left-0 bg-white z-10">
                    <p className="text-gray-500 truncate max-w-[130px] pl-2">
                      {proy.nombre}
                      {proy.cliente && (
                        <span className="text-gray-300 ml-1">· {proy.cliente}</span>
                      )}
                    </p>
                  </td>
                  {dias.map((d) => {
                    const key = format(d, "yyyy-MM-dd");
                    const activo = estaActivo(proy.inicio, proy.fin, d);
                    return (
                      <td key={key} className="py-0.5 px-0.5">
                        {activo ? (
                          <div
                            className="h-5 rounded text-center leading-5 font-semibold text-[10px]"
                            style={{
                              background: key === hoy ? "#bfdbfe" : "#dbeafe",
                              color: "#1d4ed8",
                            }}
                          >
                            {proy.pct}%
                          </div>
                        ) : (
                          <div className="h-5 rounded bg-gray-50" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Fila de ausencias */}
              {persona.ausencias.length > 0 && (
                <tr key={`aus-${persona.id}`}>
                  <td className="pr-3 py-0.5 sticky left-0 bg-white z-10">
                    <p className="text-orange-400 pl-2 truncate max-w-[130px]">Ausencia</p>
                  </td>
                  {dias.map((d) => {
                    const key = format(d, "yyyy-MM-dd");
                    const ausenciaActiva = persona.ausencias.find((a) =>
                      estaActivo(a.inicio, a.fin, d)
                    );
                    return (
                      <td key={key} className="py-0.5 px-0.5">
                        {ausenciaActiva ? (
                          <div
                            title={TIPO_LABEL[ausenciaActiva.tipo] ?? ausenciaActiva.tipo}
                            className="h-5 rounded"
                            style={{ background: "#fed7aa" }}
                          />
                        ) : (
                          <div className="h-5 rounded bg-gray-50" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
