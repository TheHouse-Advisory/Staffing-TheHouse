"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createAnyClient } from "@/lib/supabase/client";
import { deleteAnotacion } from "@/lib/queries/anotaciones";
import { highlightText } from "./highlightText";
import type { Anotacion } from "@/lib/types/database";

interface AnotacionCardProps {
  anotacion: Anotacion;
  selected: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  searchQuery?: string;
}

export function AnotacionCard({ anotacion, selected, onSelect, onDelete, searchQuery = "" }: AnotacionCardProps) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setDeleting(true);
    const supabase = createAnyClient();
    const { error } = await deleteAnotacion(supabase, anotacion.id);
    if (error) {
      setDeleting(false);
      return;
    }
    onDelete(anotacion.id);
  }

  return (
    <button
      onClick={() => onSelect(anotacion.id)}
      className={cn(
        "w-full text-left rounded-lg p-3 transition-colors",
        selected ? "bg-[#4a90e2]/10" : "hover:bg-black/[0.03]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 truncate min-w-0">
          {highlightText(anotacion.titulo || "Sin título", searchQuery)}
        </h3>
        <span
          onClick={handleDelete}
          role="button"
          title="Eliminar anotación"
          className={cn(
            "text-gray-400 hover:text-red-500 flex-shrink-0 p-0.5 rounded",
            deleting && "opacity-50 pointer-events-none"
          )}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </span>
      </div>

      {anotacion.contenido && (
        <p className="text-xs text-gray-500 mt-1 truncate">
          {highlightText(anotacion.contenido, searchQuery)}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 mt-1.5">
        <span className="text-[10px] text-gray-400 flex-shrink-0">
          {new Date(anotacion.created_at).toLocaleDateString("es-CL")}
        </span>
        <span className="text-[10px] font-medium text-gray-500 bg-black/5 px-1.5 py-0.5 rounded-full truncate">
          Creado por: {anotacion.creado_por ?? "—"}
        </span>
      </div>
    </button>
  );
}
