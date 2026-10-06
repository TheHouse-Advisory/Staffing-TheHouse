"use client";

import { TalentMatrix } from "./TalentMatrix";

interface Props {
  /** Posición continua en escala 1-5 (null = sin pin) */
  potencial: number | null;
  desempeno: number | null;
  onChange: (potencial: number, desempeno: number) => void;
}

// Selector 9-box por pin: clic en cualquier punto de la matriz fija la posición exacta
// (no solo el cuadrante), reutilizando la misma matriz del perfil.
export function SelectorMatriz9Box({ potencial, desempeno, onChange }: Props) {
  return (
    <div className="max-w-xl">
      <TalentMatrix potencial={potencial} desempeno={desempeno} isEditable onUpdate={onChange} />
      <p className="text-[10px] text-[#aaa] mt-1">Haz clic en la matriz para fijar la posición exacta.</p>
    </div>
  );
}
