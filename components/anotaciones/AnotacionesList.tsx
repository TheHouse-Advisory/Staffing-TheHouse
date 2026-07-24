"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { createAnyClient } from "@/lib/supabase/client";
import {
  getAnotaciones,
  createAnotacion,
  getNombreUsuarioActual,
  getAnotacionFolders,
  createAnotacionFolder,
  deleteAnotacionFolder,
} from "@/lib/queries/anotaciones";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/FormField";
import { AnotacionCard } from "./AnotacionCard";
import { AnotacionEditor } from "./AnotacionEditor";
import { AnotacionFolderTree } from "./AnotacionFolderTree";
import type { Anotacion, AnotacionFolder } from "@/lib/types/database";

const TODOS = "todos";

export function AnotacionesList() {
  const [anotaciones, setAnotaciones] = useState<Anotacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [currentUserNombre, setCurrentUserNombre] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCreator, setSelectedCreator] = useState(TODOS);
  const [folders, setFolders] = useState<AnotacionFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    const supabase = createAnyClient();
    const [data, nombre, folderData] = await Promise.all([
      getAnotaciones(supabase),
      getNombreUsuarioActual(supabase),
      getAnotacionFolders(supabase),
    ]);
    setAnotaciones(data);
    setCurrentUserNombre(nombre);
    setFolders(folderData);
    setLoading(false);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function handleNueva() {
    setCreating(true);
    setError(null);
    const supabase = createAnyClient();
    const { data, error: err } = await createAnotacion(supabase, {
      titulo: "Sin título",
      contenido: "",
      categoria: null,
      autor_id: null,
      folder_id: selectedFolderId,
    });
    setCreating(false);
    if (err || !data) {
      setError(err ?? "No se pudo crear la anotación.");
      return;
    }
    setAnotaciones((prev) => [data, ...prev]);
    setSelectedId(data.id);
  }

  function handleDelete(id: string) {
    setAnotaciones((prev) => prev.filter((a) => a.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  }

  function handleSaved(id: string, cambios: Partial<Anotacion>) {
    setAnotaciones((prev) => prev.map((a) => (a.id === id ? { ...a, ...cambios } : a)));
  }

  async function handleCrearCarpeta(parentId: string | null, nombre: string) {
    const supabase = createAnyClient();
    const { data, error: err } = await createAnotacionFolder(supabase, { nombre, parent_id: parentId });
    if (err || !data) {
      setError(err ?? "No se pudo crear la carpeta.");
      return;
    }
    setFolders((prev) => [...prev, data]);
  }

  function descendientesDe(id: string, lista: AnotacionFolder[]): string[] {
    const hijos = lista.filter((f) => f.parent_id === id).map((f) => f.id);
    return hijos.reduce((acc, hijoId) => [...acc, ...descendientesDe(hijoId, lista)], hijos);
  }

  async function handleEliminarCarpeta(id: string) {
    const supabase = createAnyClient();
    const { error: err } = await deleteAnotacionFolder(supabase, id);
    if (err) {
      setError(err);
      return;
    }
    const aEliminar = new Set([id, ...descendientesDe(id, folders)]);
    setFolders((prev) => prev.filter((f) => !aEliminar.has(f.id)));
    if (selectedFolderId && aEliminar.has(selectedFolderId)) {
      setSelectedFolderId(null);
    }
  }

  const creadores = useMemo(() => {
    const nombres = anotaciones
      .map((a) => a.creado_por)
      .filter((n): n is string => !!n);
    return Array.from(new Set(nombres)).sort();
  }, [anotaciones]);

  const anotacionesFiltradas = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return anotaciones.filter((a) => {
      const coincideQuery =
        !q ||
        a.titulo.toLowerCase().includes(q) ||
        a.contenido.toLowerCase().includes(q);
      const coincideCreador =
        selectedCreator === TODOS || a.creado_por === selectedCreator;
      const coincideCarpeta =
        selectedFolderId === null || a.folder_id === selectedFolderId;
      return coincideQuery && coincideCreador && coincideCarpeta;
    });
  }, [anotaciones, searchQuery, selectedCreator, selectedFolderId]);

  const seleccionada = anotaciones.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Panel izquierdo: lista */}
      <div className={cn(
        "w-80 flex-shrink-0 border-r border-gray-200 flex flex-col overflow-hidden",
        isExpanded && "hidden"
      )}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0">
          <h1 className="text-base font-bold text-gray-900">Anotaciones</h1>
          <Button size="sm" onClick={handleNueva} loading={creating}>
            <Plus className="w-3.5 h-3.5" />
            Nueva
          </Button>
        </div>
        {error && (
          <p className="text-xs text-red-500 px-4 py-2 border-b border-gray-200 flex-shrink-0">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-2 p-3 border-b border-gray-200 flex-shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar en título o contenido..."
              className="w-full pl-8 pr-3 py-1.5 rounded-md border border-[#e0e0e0] text-xs outline-none focus:border-[#4a90e2] focus:ring-2 focus:ring-[#4a90e2]/20"
            />
          </div>
          {creadores.length > 0 && (
            <Select
              value={selectedCreator}
              onChange={(e) => setSelectedCreator(e.target.value)}
              options={[
                { value: TODOS, label: "Todos los creadores" },
                ...creadores.map((c) => ({ value: c, label: c })),
              ]}
              className="text-xs py-1.5"
            />
          )}
        </div>
        <div className="border-b border-gray-200 flex-shrink-0 max-h-48 overflow-y-auto">
          <AnotacionFolderTree
            folders={folders}
            selectedFolderId={selectedFolderId}
            onSelect={setSelectedFolderId}
            onCreate={handleCrearCarpeta}
            onDelete={handleEliminarCarpeta}
          />
        </div>
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
          {!loading && anotaciones.length === 0 && (
            <p className="text-xs text-gray-400 text-center p-4">Aún no hay anotaciones.</p>
          )}
          {!loading && anotaciones.length > 0 && anotacionesFiltradas.length === 0 && (
            <p className="text-xs text-gray-400 text-center p-4">Sin resultados para el filtro actual.</p>
          )}
          {anotacionesFiltradas.map((a) => (
            <AnotacionCard
              key={a.id}
              anotacion={a}
              selected={a.id === selectedId}
              onSelect={setSelectedId}
              onDelete={handleDelete}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      </div>

      {/* Panel derecho: editor */}
      <div className="flex-1 overflow-y-auto">
        {seleccionada ? (
          <AnotacionEditor
            key={seleccionada.id}
            anotacion={seleccionada}
            currentUserNombre={currentUserNombre}
            onSaved={handleSaved}
            isExpanded={isExpanded}
            onToggleExpand={() => setIsExpanded((v) => !v)}
            searchQuery={searchQuery}
            onClearSearch={() => setSearchQuery("")}
            folders={folders}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">
            Selecciona o crea una nota
          </div>
        )}
      </div>
    </div>
  );
}
