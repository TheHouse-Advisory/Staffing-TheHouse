"use client";

import { useState, useEffect, useRef } from "react";
import { Maximize2, Minimize2, ChevronUp, ChevronDown, X, Lock, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { createAnyClient } from "@/lib/supabase/client";
import { updateAnotacion } from "@/lib/queries/anotaciones";
import { highlightText, countMatches } from "./highlightText";
import { Select } from "@/components/ui/FormField";
import { RichTextEditor, htmlToText } from "@/components/ui/RichTextEditor";
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
  /** false → nota de solo lectura (no es el autor) */
  puedeEditar?: boolean;
  /** Solo el autor puede cambiar la visibilidad */
  esAutor?: boolean;
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
  puedeEditar = true,
  esAutor = false,
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

  // ── Guardado ───────────────────────────────────────────────
  // Antes solo se guardaba al salir del campo: si se cerraba la pestaña sin salir, se perdía
  // el texto, y si fallaba no se avisaba. Ahora se guarda a los 1,5 s sin escribir, al salir
  // del campo, al cambiar de nota y al cerrar la pestaña, y se muestra el estado.
  const [estadoGuardado, setEstadoGuardado] = useState<"guardando" | "guardado" | null>(null);
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  const pendiente = useRef<Partial<Pick<Anotacion, "titulo" | "contenido">>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Nota a la que pertenecen los cambios pendientes (al cambiar de nota se guardan en la anterior)
  const pendienteId = useRef<string | null>(null);

  async function guardarPendiente() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const cambios = pendiente.current;
    const id = pendienteId.current;
    if (!id || Object.keys(cambios).length === 0) return;
    pendiente.current = {};
    setEstadoGuardado("guardando");
    const { error } = await updateAnotacion(createAnyClient(), id, cambios);
    if (error) {
      // Se reintenta en la próxima edición (si sigue en la misma nota)
      if (pendienteId.current === id) pendiente.current = { ...cambios, ...pendiente.current };
      setEstadoGuardado(null);
      setErrorGuardado(`No se guardó: ${error}`);
      return;
    }
    setErrorGuardado(null);
    setEstadoGuardado("guardado");
    setTimeout(() => setEstadoGuardado((e) => (e === "guardado" ? null : e)), 2500);
    onSaved(id, { ...cambios, editado_por: currentUserNombre });
    setEditadoPor(currentUserNombre);
  }

  function programarGuardado(cambios: Partial<Pick<Anotacion, "titulo" | "contenido">>) {
    if (!puedeEditar) return;
    if (pendienteId.current !== anotacion.id) { void guardarPendiente(); pendienteId.current = anotacion.id; }
    pendiente.current = { ...pendiente.current, ...cambios };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void guardarPendiente(); }, 1500);
  }

  // Al cambiar de nota o salir de la página se guarda lo pendiente de esta nota
  useEffect(() => {
    const antesDeSalir = () => { void guardarPendiente(); };
    window.addEventListener("beforeunload", antesDeSalir);
    return () => { window.removeEventListener("beforeunload", antesDeSalir); void guardarPendiente(); };
  }, [anotacion.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function moverACarpeta(folderId: string) {
    const supabase = createAnyClient();
    const nuevoFolderId = folderId || null;
    const { error } = await updateAnotacion(supabase, anotacion.id, { folder_id: nuevoFolderId });
    if (error) { setErrorGuardado(`No se pudo mover de carpeta: ${error}`); return; }
    onSaved(anotacion.id, { folder_id: nuevoFolderId });
  }

  // Alterna privada ↔ compartida (solo autor)
  async function toggleVisibilidad() {
    const es_privada = !anotacion.es_privada;
    const supabase = createAnyClient();
    const { error } = await updateAnotacion(supabase, anotacion.id, { es_privada });
    if (error) { setErrorGuardado(`No se pudo cambiar la visibilidad: ${error}`); return; }
    onSaved(anotacion.id, { es_privada });
  }

  // Si la carpeta de la nota fue eliminada, el selector muestra "Sin carpeta"
  const folderValido = anotacion.folder_id && folders.some((f) => f.id === anotacion.folder_id) ? anotacion.folder_id : "";

  const mostrarEditadoPor = !!editadoPor && editadoPor !== anotacion.creado_por;
  const buscando = searchQuery.trim().length > 0;

  const tituloParaResaltar = titulo || "Sin título";
  const matchesEnTitulo = countMatches(tituloParaResaltar, searchQuery);
  const contenidoTexto = htmlToText(contenido);
  const matchesEnContenido = countMatches(contenidoTexto, searchQuery);
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
        {esAutor ? (
          <button
            onClick={toggleVisibilidad}
            title={anotacion.es_privada ? "Solo tú puedes verla. Clic para compartir" : "Visible para el equipo. Clic para hacerla privada"}
            className={cn(
              "flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full transition-colors",
              anotacion.es_privada
                ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
                : "bg-[#4a90e2]/10 text-[#2f6fb8] hover:bg-[#4a90e2]/20"
            )}
          >
            {anotacion.es_privada ? <Lock className="w-3 h-3" /> : <Users className="w-3 h-3" />}
            {anotacion.es_privada ? "Privada" : "Compartida"}
          </button>
        ) : !puedeEditar && (
          <span className="text-[11px] font-medium text-gray-500 bg-black/5 px-2 py-0.5 rounded-full">
            Solo lectura
          </span>
        )}
        {folders.length > 0 && (
          <Select
            disabled={!puedeEditar}
            value={folderValido}
            onChange={(e) => moverACarpeta(e.target.value)}
            options={[
              { value: "", label: "Sin carpeta" },
              ...folders.map((f) => ({ value: f.id, label: f.nombre })),
            ]}
            className="text-xs py-1 w-auto"
          />
        )}
        {estadoGuardado === "guardando" && <span className="text-[11px] text-gray-400">Guardando…</span>}
        {estadoGuardado === "guardado" && <span className="text-[11px] text-green-600 font-medium">✓ Guardado</span>}
        {errorGuardado && <span className="text-[11px] text-red-500 font-medium">{errorGuardado}</span>}
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
          onChange={(e) => { setTitulo(e.target.value); programarGuardado({ titulo: e.target.value }); }}
          onBlur={() => { void guardarPendiente(); }}
          placeholder="Sin título"
          readOnly={!puedeEditar}
          className="w-full bg-transparent border-none outline-none text-2xl font-bold text-gray-900 placeholder:text-gray-300 mb-4"
        />
      )}

      {buscando ? (
        // En búsqueda se muestra texto plano para poder resaltar coincidencias
        <div className="flex-1 w-full overflow-y-auto text-[15px] leading-relaxed text-gray-700 whitespace-pre-wrap">
          {highlightText(contenidoTexto, searchQuery, currentMatchIndex, matchesEnTitulo)}
        </div>
      ) : (
        <RichTextEditor
          value={contenido}
          onChange={(html) => {
            setContenido(html);
            if (html !== anotacion.contenido) programarGuardado({ contenido: html });
          }}
          onBlur={() => { void guardarPendiente(); }}
          placeholder="Escribe aquí..."
          editable={puedeEditar}
          className="flex-1 -mx-4"
          contentClassName="px-4 py-2 text-[15px] text-gray-700"
        />
      )}
    </div>
  );
}
