"use client";

import { useState, useEffect } from "react";
import { Maximize2, Minimize2, ChevronUp, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { createAnyClient } from "@/lib/supabase/client";
import { updateAnotacion } from "@/lib/queries/anotaciones";
import { highlightText, countMatches } from "./highlightText";
import { Select } from "@/components/ui/FormField";
import type { Anotacion, AnotacionFolder } from "@/lib/types/database";

interface AnotacionEditorProps {
  anotacion: Anotacion;
  currentUserNombre: string | null;
  onSaved: (id: string, cambios: Partial<Anotacion>) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  searchQuery?: string;
  onClearSearch?: () => void;
  folders: AnotacionFolder[];
}

export function AnotacionEditor({
  anotacion,
  currentUserNombre,
  onSaved,
  isExpanded,
  onToggleExpand,
  searchQuery = "",
  onClearSearch,
  folders,
}: AnotacionEditorProps) {
  const [titulo, setTitulo] = useState(anotacion.titulo);
  const [contenido, setContenido] = useState(anotacion.contenido);
  const [editadoPor, setEditadoPor] = useState(anotacion.editado_por ?? null);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    const el = document.getElementById(`search-match-${currentMatchIndex}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [currentMatchIndex, searchQuery, anotacion.id]);

  async function guardar(cambios: Partial<Pick<Anotacion, "titulo" | "contenido">>) {
    const supabase = createAnyClient();
    const { error } = await updateAnotacion(supabase, anotacion.id, cambios);
    if (!error) {
      onSaved(anotacion.id, { ...cambios, editado_por: currentUserNombre });
      setEditadoPor(currentUserNombre);
    }
  }

  async function moverACarpeta(folderId: string) {
    const supabase = createAnyClient();
    const nuevoFolderId = folderId || null;
    const { error } = await updateAnotacion(supabase, anotacion.id, { folder_id: nuevoFolderId });
    if (!error) onSaved(anotacion.id, { folder_id: nuevoFolderId });
  }

  const mostrarEditadoPor = !!editadoPor && editadoPor !== anotacion.creado_por;
  const buscando = searchQuery.trim().length > 0;

  const tituloParaResaltar = titulo || "Sin título";
  const matchesEnTitulo = countMatches(tituloParaResaltar, searchQuery);
  const matchesEnContenido = countMatches(contenido, searchQuery);
  const totalMatches = matchesEnTitulo + matchesEnContenido;

  function irAMatch(delta: number) {
    if (totalMatches === 0) return;
    setCurrentMatchIndex((prev) => (prev + delta + totalMatches) % totalMatches);
  }

  return (
    <div className={cn("relative h-full flex flex-col p-8", !isExpanded && "max-w-3xl mx-auto")}>
      {buscando && totalMatches > 0 && (
        <div className="absolute top-4 right-4 z-10 flex items-center gap-1 bg-white border border-gray-200 shadow-md rounded-full px-2 py-1">
          <span className="text-xs text-gray-600 px-1.5 tabular-nums">
            {currentMatchIndex + 1} / {totalMatches}
          </span>
          <button
            onClick={() => irAMatch(-1)}
            title="Coincidencia anterior"
            className="p-1 rounded-full hover:bg-black/5 text-gray-500"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => irAMatch(1)}
            title="Siguiente coincidencia"
            className="p-1 rounded-full hover:bg-black/5 text-gray-500"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClearSearch}
            title="Limpiar búsqueda"
            className="p-1 rounded-full hover:bg-black/5 text-gray-500"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <span className="text-[11px] font-medium text-gray-500 bg-black/5 px-2 py-0.5 rounded-full">
          Creado por: {anotacion.creado_por ?? "—"}
        </span>
        {mostrarEditadoPor && (
          <span className="text-[11px] font-medium text-gray-500 bg-black/5 px-2 py-0.5 rounded-full">
            Última edición por: {editadoPor}
          </span>
        )}
        {folders.length > 0 && (
          <Select
            value={anotacion.folder_id ?? ""}
            onChange={(e) => moverACarpeta(e.target.value)}
            options={[
              { value: "", label: "Sin carpeta" },
              ...folders.map((f) => ({ value: f.id, label: f.nombre })),
            ]}
            className="text-xs py-1 w-auto"
          />
        )}
        <button
          onClick={onToggleExpand}
          title={isExpanded ? "Volver a vista dividida" : "Expandir nota a pantalla completa"}
          className="ml-auto text-gray-400 hover:text-gray-700 p-1 rounded-md hover:bg-black/5"
        >
          {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      {buscando ? (
        <h2 className="w-full text-2xl font-bold text-gray-900 mb-4">
          {highlightText(tituloParaResaltar, searchQuery, currentMatchIndex, 0)}
        </h2>
      ) : (
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          onBlur={() => {
            if (titulo !== anotacion.titulo) guardar({ titulo });
          }}
          placeholder="Sin título"
          className="w-full bg-transparent border-none outline-none text-2xl font-bold text-gray-900 placeholder:text-gray-300 mb-4"
        />
      )}

      {buscando ? (
        <div className="flex-1 w-full overflow-y-auto text-[15px] leading-relaxed text-gray-700 whitespace-pre-wrap">
          {highlightText(contenido, searchQuery, currentMatchIndex, matchesEnTitulo)}
        </div>
      ) : (
        <textarea
          value={contenido}
          onChange={(e) => setContenido(e.target.value)}
          onBlur={() => {
            if (contenido !== anotacion.contenido) guardar({ contenido });
          }}
          placeholder="Escribe aquí..."
          className="flex-1 w-full bg-transparent border-none outline-none resize-none text-[15px] leading-relaxed text-gray-700 placeholder:text-gray-300"
        />
      )}
    </div>
  );
}
