"use client";

import type { ReactNode } from "react";
import { Wallet } from "lucide-react";
import { PersonaRemuneracionesTimeline, type PeriodoCargo } from "./PersonaRemuneracionesTimeline";

interface Props {
  personaId: string;
  colapsada: boolean;
  /** Botón de colapsar del perfil (mantiene consistencia visual) */
  botonColapsar: ReactNode;
  cargoActual?: string | null;
  cargosSugeridos?: readonly string[];
  historialCargos?: PeriodoCargo[];
  /** Dentro de otra tarjeta (Desarrollo de carrera): sin borde propio y título de subsección */
  embebido?: boolean;
}

// Card de la sección Remuneraciones: contiene solo la línea temporal de hitos
export function PersonaRemuneraciones({ personaId, colapsada, botonColapsar, cargoActual, cargosSugeridos, historialCargos, embebido = false }: Props) {
  return (
    <div className={embebido ? "" : "bg-white rounded-xl border border-[#e8e8e8] p-6"}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-[#888]" />
          <div>
            {embebido
              ? <h4 className="text-sm font-semibold text-gray-700 tracking-wide uppercase">Remuneraciones</h4>
              : <h3 className="font-semibold">Remuneraciones</h3>}
            <p className="text-xs text-[#aaa] mt-0.5">Información confidencial</p>
          </div>
        </div>
        {botonColapsar}
      </div>

      {!colapsada && (
        <PersonaRemuneracionesTimeline
          personaId={personaId}
          monedaDefault="CLP"
          cargoActual={cargoActual}
          cargosSugeridos={cargosSugeridos}
          historialCargos={historialCargos}
        />
      )}
    </div>
  );
}
