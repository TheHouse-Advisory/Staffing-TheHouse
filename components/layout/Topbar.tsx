"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { format, addWeeks, subWeeks, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";

interface TopbarProps {
  titulo: string;
  /** Si se pasa semanaActual se muestra el navegador de semana */
  semanaActual?: Date;
  onSemanaChange?: (nuevaSemana: Date) => void;
  /** Slot derecho para acciones adicionales (botones, filtros) */
  actions?: React.ReactNode;
}

export function Topbar({
  titulo,
  semanaActual,
  onSemanaChange,
  actions,
}: TopbarProps) {
  const semanaLabel = semanaActual
    ? (() => {
        const inicio = startOfWeek(semanaActual, { weekStartsOn: 1 });
        const fin = addWeeks(inicio, 1);
        return `${format(inicio, "d MMM", { locale: es })} – ${format(fin, "d MMM yyyy", { locale: es })}`;
      })()
    : null;

  return (
    <header className="h-14 bg-white border-b border-[#e8e8e8] flex items-center px-6 gap-4 flex-shrink-0">
      <h1 className="text-[16px] font-bold flex-1">{titulo}</h1>

      {semanaActual && onSemanaChange && (
        <div className="flex items-center gap-2 text-[13px] text-[#555]">
          <button
            onClick={() => onSemanaChange(subWeeks(semanaActual, 1))}
            className="w-7 h-7 rounded-md border border-[#e0e0e0] bg-white flex items-center justify-center hover:bg-[#f5f5f5] transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="font-semibold text-[#1a1a1a] min-w-[160px] text-center">
            {semanaLabel}
          </span>
          <button
            onClick={() => onSemanaChange(addWeeks(semanaActual, 1))}
            className="w-7 h-7 rounded-md border border-[#e0e0e0] bg-white flex items-center justify-center hover:bg-[#f5f5f5] transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
