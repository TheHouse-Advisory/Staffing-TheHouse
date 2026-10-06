"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Search, Trash2, RotateCcw, ArrowLeft, Folder, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { createAnyClient } from "@/lib/supabase/client";
import {
  getAnotaciones,
  createAnotacion,
  getNombreUsuarioActual,
  getPersonaIdActual,
  getAnotacionFolders,
  createAnotacionFolder,
  deleteAnotacionFolder,
  restoreAnotacion,
  purgeAnotacion,
  restoreAnotacionFolders,
  purgeAnotacionFolder,
  purgeAnotacionesVencidas,
} from "@/lib/queries/anotaciones";
import { Button } from "@/components/ui/Button";
import { htmlToText } from "@/components/ui/RichTextEditor";
import { Select } from "@/components/ui/FormField";
import { AnotacionCard } from "./AnotacionCard";
import { AnotacionEditor } from "./AnotacionEditor";
import { AnotacionFolderTree } from "./AnotacionFolderTree";
import type { Anotacion, AnotacionFolder } from "@/lib/types/database";

const TODOS = "todos";

// Papelera: días que se conserva un elemento eliminado antes del borrado definitivo
const DIAS_PAPELERA = 15;
const DIA_MS = 86_400_000;
const diasRestantes = (deletedAt: string) =>
  Math.max(0, DIAS_PAPELERA - Math.floor((Date.now() - new Date(deletedAt).getTime()) / DIA_MS));

// Filtro de visibilidad
const VISIBILIDAD_OPTIONS = [
  { value: TODOS, label: "Todas las notas" },
  { value: "privadas", label: "Solo privadas" },
  { value: "compartidas", label: "Solo compartidas" },
];

export function AnotacionesList() {
  const [anotaciones, setAnotaciones] = useState<Anotacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [currentUserNombre, setCurrentUserNombre] = useState<string | null>(null);
  const [currentPersonaId, setCurrentPersonaId] = useState<string | null>(null);
  const [selectedVisibilidad, setSelectedVisibilidad] = useState(TODOS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCreator, setSelectedCreator] = useState(TODOS);
  const [folders, setFolders] = useState<AnotacionFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [verPapelera, setVerPapelera] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    const supabase = createAnyClient();
    // Purga automática: lo que lleva más de 15 días en la papelera se borra definitivamente
    await purgeAnotacionesVencidas(supabase, new Date(Date.now() - DIAS_PAPELERA * DIA_MS).toISOString());
    const [data, nombre, personaId, folderData] = await Promise.all([
      getAnotaciones(supabase),
      getNombreUsuarioActual(supabase),
      getPersonaIdActual(supabase),
      getAnotacionFolders(supabase),
    ]);
    setAnotaciones(data);
    setCurrentUserNombre(nombre);
    setCurrentPersonaId(personaId);
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
      es_privada: false, // nace compartida
    });
    setCreating(false);
    if (err || !data) {
      setError(err ?? "No se pudo crear la anotación.");
      return;
    }
    setAnotaciones((prev) => [data, ...prev]);
    setSelectedId(data.id);
  }

  function handleDelete(id: string, deletedAt: string) {
    setAnotaciones((prev) => prev.map((a) => (a.id === id ? { ...a, deleted_at: deletedAt } : a)));
    setSelectedId((prev) => (prev === id ? null : prev));
    setError(null);
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
    // Carpeta + subcarpetas activas van a la papelera (sus anotaciones conservan folder_id para restaurar)
    const aEliminar = new Set([id, ...descendientesDe(id, foldersActivas)]);
    const { error: err, deleted_at } = await deleteAnotacionFolder(supabase, [...aEliminar]);
    if (err) {
      setError(/deleted_at/.test(err) ? "Falta habilitar la papelera en la base de datos (columna deleted_at). Ejecuta la migración 20261006_anotaciones_papelera.sql en Supabase." : err);
      return;
    }
    setError(null);
    setFolders((prev) => prev.map((f) => (aEliminar.has(f.id) ? { ...f, deleted_at } : f)));
    if (selectedFolderId && aEliminar.has(selectedFolderId)) {
      setSelectedFolderId(null);
    }
  }

  // Activas (fuera de la papelera)
  const activas = useMemo(() => anotaciones.filter((a) => !a.deleted_at), [anotaciones]);
  const foldersActivas = useMemo(() => folders.filter((f) => !f.deleted_at), [folders]);

  // Papelera: anotaciones propias (solo el autor puede eliminarlas) y carpetas "raíz" eliminadas
  const papeleraNotas = anotaciones.filter((a) => a.deleted_at && (!a.autor_id || a.autor_id === currentPersonaId));
  const idsCarpetasPapelera = new Set(folders.filter((f) => f.deleted_at).map((f) => f.id));
  const papeleraCarpetas = folders.filter((f) => f.deleted_at && (!f.parent_id || !idsCarpetasPapelera.has(f.parent_id)));
  const totalPapelera = papeleraNotas.length + papeleraCarpetas.length;

  async function restaurarNota(a: Anotacion) {
    const supabase = createAnyClient();
    const folder_id = a.folder_id && foldersActivas.some((f) => f.id === a.folder_id) ? a.folder_id : null;
    const { error: err } = await restoreAnotacion(supabase, a.id, folder_id);
    if (err) { setError(err); return; }
    setAnotaciones((prev) => prev.map((x) => (x.id === a.id ? { ...x, deleted_at: null, folder_id } : x)));
  }

  async function restaurarCarpeta(f: AnotacionFolder) {
    const supabase = createAnyClient();
    // La carpeta vuelve con sus subcarpetas eliminadas; a raíz si su padre ya no está activo
    const ids = [f.id, ...descendientesDe(f.id, folders).filter((id) => idsCarpetasPapelera.has(id))];
    const parent = f.parent_id && foldersActivas.some((x) => x.id === f.parent_id) ? f.parent_id : null;
    const { error: err } = await restoreAnotacionFolders(supabase, ids, f.id, parent);
    if (err) { setError(err); return; }
    setFolders((prev) => prev.map((x) => (ids.includes(x.id) ? { ...x, deleted_at: null, parent_id: x.id === f.id ? parent : x.parent_id } : x)));
  }

  async function eliminarDefinitivo(tipo: "nota" | "carpeta", id: string) {
    if (!confirm("Se eliminará de forma permanente. ¿Continuar?")) return;
    const supabase = createAnyClient();
    if (tipo === "nota") {
      const { error: err } = await purgeAnotacion(supabase, id);
      if (err) { setError(err); return; }
      setAnotaciones((prev) => prev.filter((a) => a.id !== id));
      return;
    }
    const { error: err } = await purgeAnotacionFolder(supabase, id);
    if (err) { setError(err); return; }
    // Subcarpetas se borran en cascada; las anotaciones quedan sin carpeta (FK ON DELETE SET NULL)
    const ids = new Set([id, ...descendientesDe(id, folders)]);
    setFolders((prev) => prev.filter((x) => !ids.has(x.id)));
    setAnotaciones((prev) => prev.map((a) => (a.folder_id && ids.has(a.folder_id) ? { ...a, folder_id: null } : a)));
  }

  const creadores = useMemo(() => {
    const nombres = activas
      .map((a) => a.creado_por)
      .filter((n): n is string => !!n);
    return Array.from(new Set(nombres)).sort();
  }, [activas]);

  const anotacionesFiltradas = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return activas.filter((a) => {
      const coincideQuery =
        !q ||
        a.titulo.toLowerCase().includes(q) ||
        htmlToText(a.contenido).toLowerCase().includes(q); // ignora etiquetas HTML
      const coincideCreador =
        selectedCreator === TODOS || a.creado_por === selectedCreator;
      const coincideCarpeta =
        selectedFolderId === null || a.folder_id === selectedFolderId;
      const coincideVisibilidad =
        selectedVisibilidad === TODOS ||
        (selectedVisibilidad === "privadas") === !!a.es_privada;
      return coincideQuery && coincideCreador && coincideCarpeta && coincideVisibilidad;
    });
  }, [activas, searchQuery, selectedCreator, selectedFolderId, selectedVisibilidad]);

  // Solo el autor edita/elimina; notas antiguas sin autor quedan abiertas a todos
  const puedeEditar = (a: Anotacion) => !a.autor_id || a.autor_id === currentPersonaId;

  const seleccionada = activas.find((a) => a.id === selectedId) ?? null;

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
          <Select
            value={selectedVisibilidad}
            onChange={(e) => setSelectedVisibilidad(e.target.value)}
            options={VISIBILIDAD_OPTIONS}
            className="text-xs py-1.5"
          />
        </div>
        <div className="border-b border-gray-200 flex-shrink-0 max-h-48 overflow-y-auto">
          <AnotacionFolderTree
            folders={foldersActivas}
            selectedFolderId={selectedFolderId}
            onSelect={setSelectedFolderId}
            onCreate={handleCrearCarpeta}
            onDelete={handleEliminarCarpeta}
          />
        </div>
        {verPapelera ? (
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
          <button onClick={() => setVerPapelera(false)} className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-500 hover:text-[#4a90e2]">
            <ArrowLeft className="w-3.5 h-3.5" /> Volver a anotaciones
          </button>
          <p className="text-[11px] text-gray-400 px-2 pb-1">Se eliminan definitivamente a los {DIAS_PAPELERA} días.</p>
          {totalPapelera === 0 && <p className="text-xs text-gray-400 text-center p-4">La papelera está vacía.</p>}
          {[
            ...papeleraCarpetas.map((f) => ({ key: f.id, carpeta: true, titulo: f.nombre, deletedAt: f.deleted_at!, restaurar: () => restaurarCarpeta(f), borrar: () => eliminarDefinitivo("carpeta", f.id) })),
            ...papeleraNotas.map((a) => ({ key: a.id, carpeta: false, titulo: a.titulo || "Sin título", deletedAt: a.deleted_at!, restaurar: () => restaurarNota(a), borrar: () => eliminarDefinitivo("nota", a.id) })),
          ].map((it) => (
            <div key={it.key} className="flex items-center gap-2 px-2.5 py-2 rounded-md border border-gray-100 hover:bg-gray-50">
              {it.carpeta ? <Folder className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" /> : <FileText className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-700 truncate">{it.titulo}</p>
                <p className="text-[10px] text-gray-400">
                  Expira en {diasRestantes(it.deletedAt)} {diasRestantes(it.deletedAt) === 1 ? "día" : "días"}
                </p>
              </div>
              <button onClick={it.restaurar} title="Restaurar" className="p-1 rounded text-gray-400 hover:text-[#4a90e2] hover:bg-white">
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button onClick={it.borrar} title="Eliminar definitivamente" className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-white">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
        ) : (
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
          {!loading && activas.length === 0 && (
            <p className="text-xs text-gray-400 text-center p-4">Aún no hay anotaciones.</p>
          )}
          {!loading && activas.length > 0 && anotacionesFiltradas.length === 0 && (
            <p className="text-xs text-gray-400 text-center p-4">Sin resultados para el filtro actual.</p>
          )}
          {anotacionesFiltradas.map((a) => (
            <AnotacionCard
              key={a.id}
              anotacion={a}
              selected={a.id === selectedId}
              onSelect={setSelectedId}
              onDelete={handleDelete}
              onError={setError}
              searchQuery={searchQuery}
              puedeEditar={puedeEditar(a)}
            />
          ))}
        </div>
        )}

        {/* Acceso a la papelera */}
        <button
          onClick={() => setVerPapelera((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2.5 border-t border-gray-200 text-xs font-medium transition-colors flex-shrink-0",
            verPapelera ? "text-[#4a90e2] bg-gray-50" : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
          )}
        >
          <Trash2 className="w-3.5 h-3.5" /> Papelera
          {totalPapelera > 0 && <span className="ml-auto text-[10px] bg-gray-200 text-gray-500 rounded-full px-1.5">{totalPapelera}</span>}
        </button>
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
            folders={foldersActivas}
            puedeEditar={puedeEditar(seleccionada)}
            esAutor={!!currentPersonaId && seleccionada.autor_id === currentPersonaId}
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
