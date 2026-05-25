"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { format } from "date-fns";
import { calculateBusinessDays } from "@/lib/utils/date-utils";
import { es } from "date-fns/locale";
import { createAnyClient } from "@/lib/supabase/client";

const JERARQUIA: Record<string, number> = {
  "Socio": 1, "Director de Proyectos": 2, "Director": 2,
  "Gerente de Proyectos": 3, "Gerente": 3, "Asociado": 4,
  "Consultor Senior": 5, "Consultor de Proyectos": 6, "Consultor Proyecto": 6,
  "Consultor": 6, "Consultor Analista": 7, "Analista Senior": 7,
  "Consultor Trainee": 8, "Analista": 8, "Practicante": 9,
};

interface PersonaVac {
  id: string;
  nombre: string;
  apellido: string;
  cargo: string;
  dias: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
}


export function ResumenVacaciones({ open, onClose }: Props) {
  const [hasta, setHasta] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [desde, setDesde] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [personas, setPersonas] = useState<PersonaVac[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;

    async function load() {
      setLoading(true);
      const sb = createAnyClient();

      const [persRes, vacRes] = await Promise.all([
        sb.from("persona").select("id, nombre, apellido, cargo_actual").eq("activo", true),
        sb.from("ausencia")
          .select("persona_id, fecha_inicio, fecha_fin")
          .in("tipo", ["vacaciones_confirmadas", "vacaciones_por_confirmar", "dia_administrativo", "permiso_sin_goce"])
          .lte("fecha_inicio", hasta)
          .gte("fecha_fin", desde),
      ]);

      const pers = (persRes.data ?? []) as { id: string; nombre: string; apellido: string; cargo_actual: string | null }[];
      const vacs = (vacRes.data ?? []) as { persona_id: string; fecha_inicio: string; fecha_fin: string }[];

      // Sumar días por persona dentro del rango seleccionado
      const diasMap: Record<string, number> = {};
      for (const v of vacs) {
        const inicioEfectivo = v.fecha_inicio < desde ? desde : v.fecha_inicio;
        const finEfectivo    = v.fecha_fin    > hasta ? hasta  : v.fecha_fin;
        const dias = calculateBusinessDays(inicioEfectivo, finEfectivo);
        if (dias > 0) diasMap[v.persona_id] = (diasMap[v.persona_id] ?? 0) + dias;
      }

      const result: PersonaVac[] = pers
        .map((p) => ({
          id: p.id,
          nombre: p.nombre,
          apellido: p.apellido,
          cargo: p.cargo_actual ?? "Sin cargo",
          dias: diasMap[p.id] ?? 0,
        }))
        .sort((a, b) => {
          const ia = JERARQUIA[a.cargo] ?? 99;
          const ib = JERARQUIA[b.cargo] ?? 99;
          if (ia !== ib) return ia - ib;
          return b.dias - a.dias; // dentro del cargo, más días arriba
        });

      setPersonas(result);
      setLoading(false);
    }
    load();
  }, [open, desde, hasta]);

  // Agrupar por cargo
  const grupos: Record<string, PersonaVac[]> = {};
  for (const p of personas) {
    if (!grupos[p.cargo]) grupos[p.cargo] = [];
    grupos[p.cargo].push(p);
  }
  const cargosOrdenados = Object.keys(grupos).sort((a, b) => {
    const ia = JERARQUIA[a] ?? 99;
    const ib = JERARQUIA[b] ?? 99;
    return ia - ib;
  });

  if (!open) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/20 z-30"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-[420px] bg-white shadow-2xl z-40 flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e8e8e8] flex-shrink-0">
          <div>
            <h2 className="font-bold text-[#1a1a2e] text-[15px]">Resumen vacaciones</h2>
            <p className="text-xs text-gray-400 mt-0.5">Días acumulados por persona</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Selector de rango */}
        <div className="px-6 py-4 border-b border-[#f0f0f0] flex-shrink-0 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">
                Desde
              </label>
              <input
                type="date"
                value={desde}
                max={hasta}
                onChange={(e) => setDesde(e.target.value)}
                className="px-3 py-2 rounded-lg border border-[#e0e0e0] text-sm focus:outline-none focus:ring-2 focus:ring-[#4a90e2]/40 focus:border-[#4a90e2] transition-colors w-full"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">
                Hasta
              </label>
              <input
                type="date"
                value={hasta}
                min={desde}
                onChange={(e) => setHasta(e.target.value)}
                className="px-3 py-2 rounded-lg border border-[#e0e0e0] text-sm focus:outline-none focus:ring-2 focus:ring-[#4a90e2]/40 focus:border-[#4a90e2] transition-colors w-full"
              />
            </div>
          </div>
          <p className="text-[11px] text-gray-400">
            Contabiliza: vacaciones confirmadas, por confirmar, día administrativo y permiso sin goce
          </p>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-orange-400 bg-orange-50 my-1">
            <span className="text-[11px] text-orange-700 font-medium leading-tight">
              Días consumidos acumulados en el rango seleccionado
            </span>
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-10">Cargando...</p>
          ) : (
            <div className="py-2">
              {cargosOrdenados.map((cargo) => {
                const equipo = grupos[cargo];
                const maxDias = Math.max(...equipo.map((p) => p.dias), 1);

                return (
                  <div key={cargo}>
                    {/* Cabecera cargo */}
                    <div className="px-6 py-2 bg-gray-50 border-y border-[#f0f0f0]">
                      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
                        {cargo}
                        <span className="ml-2 font-normal normal-case text-gray-300">
                          {equipo.length} {equipo.length === 1 ? "persona" : "personas"}
                        </span>
                      </p>
                    </div>

                    {/* Personas del cargo */}
                    <div className="divide-y divide-[#f8f8f8]">
                      {equipo.map((p) => {
                        const pct = maxDias > 0 ? (p.dias / maxDias) * 100 : 0;
                        const color =
                          p.dias === 0 ? "#e5e7eb"
                          : p.dias === maxDias && equipo.length > 1 ? "#f97316"
                          : "#3b82f6";

                        return (
                          <div key={p.id} className="px-6 py-3">
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <div
                                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                                  style={{ backgroundColor: p.dias === 0 ? "#d1d5db" : "#3b82f6" }}
                                >
                                  {p.nombre[0]}{p.apellido[0]}
                                </div>
                                <p className="text-sm font-medium text-[#1a1a2e] truncate">
                                  {p.nombre} {p.apellido}
                                </p>
                              </div>
                              <span
                                className="text-xs font-bold ml-3 flex-shrink-0 px-2 py-0.5 rounded-full"
                                style={{
                                  background: p.dias === 0 ? "#f3f4f6" : p.dias === maxDias && equipo.length > 1 ? "#fff7ed" : "#eff6ff",
                                  color: p.dias === 0 ? "#9ca3af" : p.dias === maxDias && equipo.length > 1 ? "#ea580c" : "#2563eb",
                                }}
                              >
                                {p.dias === 1 ? "1 día ya tomado" : `${p.dias} días ya tomados`}
                              </span>
                            </div>
                            {/* Barra comparativa */}
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden ml-9">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${pct}%`, backgroundColor: color }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
