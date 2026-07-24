"use client";

import { useState } from "react";
import { Folder, FolderPlus, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnotacionFolder } from "@/lib/types/database";

interface AnotacionFolderTreeProps {
  folders: AnotacionFolder[];
  selectedFolderId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (parentId: string | null, nombre: string) => void;
  onDelete: (id: string) => void;
}

export function AnotacionFolderTree({
  folders,
  selectedFolderId,
  onSelect,
  onCreate,
  onDelete,
}: AnotacionFolderTreeProps) {
  const [addingParentId, setAddingParentId] = useState<string | null | undefined>(undefined);
  const [nombre, setNombre] = useState("");

  function startAdding(parentId: string | null) {
    setAddingParentId(parentId);
    setNombre("");
  }

  function confirmarAdding() {
    const trimmed = nombre.trim();
    if (trimmed) onCreate(addingParentId ?? null, trimmed);
    setAddingParentId(undefined);
    setNombre("");
  }

  function renderInput(depth: number) {
    return (
      <div style={{ paddingLeft: `${8 + depth * 14}px` }} className="flex items-center gap-1 py-1 pr-2">
        <input
          autoFocus
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirmarAdding();
            if (e.key === "Escape") setAddingParentId(undefined);
          }}
          onBlur={confirmarAdding}
          placeholder="Nombre de la carpeta"
          className="flex-1 min-w-0 text-xs px-1.5 py-1 rounded border border-[#4a90e2]/40 outline-none"
        />
      </div>
    );
  }

  function renderNivel(parentId: string | null, depth: number) {
    const hijos = folders.filter((f) => f.parent_id === parentId);
    return (
      <>
        {hijos.map((folder) => (
          <div key={folder.id}>
            <div
              className={cn(
                "group flex items-center gap-1.5 rounded-md pr-2 py-1 text-xs cursor-pointer",
                selectedFolderId === folder.id
                  ? "bg-[#4a90e2]/10 text-[#4a90e2] font-medium"
                  : "text-gray-600 hover:bg-black/[0.03]"
              )}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              onClick={() => onSelect(folder.id)}
            >
              <Folder className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate flex-1 min-w-0">{folder.nombre}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  startAdding(folder.id);
                }}
                title="Nueva subcarpeta"
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-700 flex-shrink-0"
              >
                <Plus className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(folder.id);
                }}
                title="Eliminar carpeta"
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 flex-shrink-0"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>

            {addingParentId === folder.id && renderInput(depth + 1)}

            {renderNivel(folder.id, depth + 1)}
          </div>
        ))}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 py-2">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Carpetas</span>
        <button
          onClick={() => startAdding(null)}
          title="Nueva carpeta"
          className="text-gray-400 hover:text-gray-700"
        >
          <FolderPlus className="w-3.5 h-3.5" />
        </button>
      </div>

      <button
        onClick={() => onSelect(null)}
        className={cn(
          "text-left rounded-md mx-2 px-2 py-1 text-xs",
          selectedFolderId === null
            ? "bg-[#4a90e2]/10 text-[#4a90e2] font-medium"
            : "text-gray-600 hover:bg-black/[0.03]"
        )}
      >
        Todas las notas
      </button>

      {addingParentId === null && renderInput(0)}

      {renderNivel(null, 0)}
    </div>
  );
}
