"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Wrench } from "lucide-react";
import { feriadosChile, type Feriado } from "@/lib/constants/holidays";

/**
 * Soporte técnico: la última semana de diciembre recuerda revisar los feriados del año
 * siguiente. Se calculan solos, pero un feriado decretado puntualmente por ley (p.ej. un
 * "interferiado") no se puede calcular y hay que pedir que se agregue.
 * Se calcula en el navegador para usar la fecha local (Chile), no la del servidor.
 */
export function RecordatorioFeriados() {
  const [datos, setDatos] = useState<{ anio: number; feriados: Feriado[] } | null>(null);

  useEffect(() => {
    const hoy = new Date();
    if (hoy.getMonth() === 11 && hoy.getDate() >= 24) {
      const anio = hoy.getFullYear() + 1;
      setDatos({ anio, feriados: feriadosChile(anio) });
    }
  }, []);

  if (!datos) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center gap-2 mb-1">
        <Wrench className="w-4 h-4 text-amber-600" />
        <p className="text-sm font-bold text-amber-800">Soporte técnico · Feriados {datos.anio}</p>
      </div>
      <p className="text-xs text-amber-800 mb-3">
        Los feriados legales de {datos.anio} ya están cargados automáticamente. Compáralos con el
        calendario oficial (feriados.cl o gob.cl). Si se decretó algún feriado adicional, pide a
        soporte técnico que lo agregue.
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
        {datos.feriados.map((f) => (
          <li key={f.fecha} className="text-xs text-amber-900">
            <span className="font-semibold">{format(parseISO(f.fecha), "EEE d MMM", { locale: es })}</span> · {f.nombre}
          </li>
        ))}
      </ul>
    </div>
  );
}
