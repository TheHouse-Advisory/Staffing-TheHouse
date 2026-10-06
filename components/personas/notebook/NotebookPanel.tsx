"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  Folder, FolderOpen, FolderPlus, FilePlus, FileText, Plus, Trash2, RotateCcw, ArrowLeft,
  ChevronRight, ChevronDown, X, Loader2, Check,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { createAnyClient } from "@/lib/supabase/client";
import { RichTextEditor } from "@/components/ui/RichTextEditor";

// ── Tipos ──────────────────────────────────────────────────────
interface NFolder { id: string; nombre: string; creado_en: string; parent_id: string | null; deleted_at?: string | null; }
interface NNote   {
  id: string; folder_id: string | null;
  titulo: string; contenido: string; actualizado_en: string;
  deleted_at?: string | null; // null = activa; fecha = en papelera
}

// Papelera: días que se conserva un elemento eliminado antes del borrado definitivo
const DIAS_PAPELERA = 15;
const DIA_MS = 86_400_000;
const diasRestantes = (deletedAt: string) =>
  Math.max(0, DIAS_PAPELERA - Math.floor((Date.now() - new Date(deletedAt).getTime()) / DIA_MS));

interface Props { personaId: string; personaNombre: string; }

// ── Plantilla por defecto (notebook vacío) ─────────────────────
const DEFAULT_NOTEBOOK_FOLDERS: { nombre: string; notas: string[] }[] = [
  {
    nombre: String(new Date().getFullYear()), // año actual dinámico
    notas: [
      "Compensaciones",
      "Onboarding",
      "Staffing e intereses",
      "Proyecciones laborales",
      "Mentoring",
      "Antecedentes personales",
      "Evaluación de desempeño",
    ],
  },
];

// Crea carpetas y notas de la plantilla; quedan como registros normales (editables/eliminables)
async function sembrarPlantilla(personaId: string, defs = DEFAULT_NOTEBOOK_FOLDERS): Promise<{ folders: NFolder[]; notes: NNote[] }> {
  const sb = createAnyClient();
  const folders: NFolder[] = [];
  const notes: NNote[] = [];
  const base = Date.now();
  for (const def of defs) {
    const { data: f } = await sb.from("notebook_folder")
      .insert({ persona_id: personaId, nombre: def.nombre, parent_id: null })
      .select().single();
    if (!f) continue;
    folders.push(f as NFolder);
    // actualizado_en decreciente para conservar el orden de la plantilla (lista ordena desc)
    const { data: ns } = await sb.from("notebook_note")
      .insert(def.notas.map((titulo, i) => ({
        persona_id: personaId, folder_id: (f as NFolder).id, titulo, contenido: "",
        actualizado_en: new Date(base - i * 1000).toISOString(),
      })))
      .select();
    notes.push(...((ns ?? []) as NNote[]));
  }
  notes.sort((a, b) => b.actualizado_en.localeCompare(a.actualizado_en));
  return { folders, notes };
}

// ── Componente ─────────────────────────────────────────────────
export function NotebookPanel({ personaId, personaNombre }: Props) {
  const [folders,        setFolders]        = useState<NFolder[]>([]);
  const [notes,          setNotes]          = useState<NNote[]>([]);
  const [loading,        setLoading]        = useState(true);
  // Editor
  const [selectedId,     setSelectedId]     = useState<string | null>(null);
  const [draftTitle,     setDraftTitle]     = useState("");
  const [draftContent,   setDraftContent]   = useState("");
  const [draftFolderId,  setDraftFolderId]  = useState<string | null>(null);
  const [saving,         setSaving]         = useState(false);
  const [saved,          setSaved]          = useState(false);
  // UI state
  const [expanded,       setExpanded]       = useState<Set<string>>(new Set());
  const [showNewFolder,  setShowNewFolder]  = useState(false);
  const [newFolderName,  setNewFolderName]  = useState("");
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null);
  // Modales
  const [deletingNote,   setDeletingNote]   = useState<string | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null);
  const [folderAction,   setFolderAction]   = useState<"move" | "cascade" | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seededFor = useRef<string | null>(null);
  // Papelera (soft delete)
  const [trashFolders, setTrashFolders] = useState<NFolder[]>([]);
  const [trashNotes,   setTrashNotes]   = useState<NNote[]>([]);
  const [verPapelera,  setVerPapelera]  = useState(false);
  const [deleteError,  setDeleteError]  = useState<string | null>(null); // error visible en modales de eliminar

  // ── Carga ──────────────────────────────────────────────────
  const load = useCallback(async () => {
    const sb = createAnyClient();
    const [fRes, nRes] = await Promise.all([
      sb.from("notebook_folder").select("*").eq("persona_id", personaId).order("creado_en"),
      sb.from("notebook_note").select("*").eq("persona_id", personaId).order("actualizado_en", { ascending: false }),
    ]);
    const todasF = (fRes.data ?? []) as NFolder[];
    const todasN = (nRes.data ?? []) as NNote[];
    // Purga automática: lo que lleva más de 15 días en la papelera se borra definitivamente
    const corte = new Date(Date.now() - DIAS_PAPELERA * DIA_MS).toISOString();
    const vencida = (x: { deleted_at?: string | null }) => !!x.deleted_at && x.deleted_at < corte;
    if (todasN.some(vencida)) await sb.from("notebook_note").delete().eq("persona_id", personaId).lt("deleted_at", corte);
    if (todasF.some(vencida)) await sb.from("notebook_folder").delete().eq("persona_id", personaId).lt("deleted_at", corte);
    setTrashFolders(todasF.filter(f => f.deleted_at && !vencida(f)));
    setTrashNotes(todasN.filter(n => n.deleted_at && !vencida(n)));
    let fs = todasF.filter(f => !f.deleted_at);
    let ns = todasN.filter(n => !n.deleted_at);
    // Falta alguna carpeta de la plantilla (raíz, mismo nombre) → se agrega, aunque ya existan otras notas/carpetas
    const faltantes = DEFAULT_NOTEBOOK_FOLDERS.filter(d => !fs.some(f => f.parent_id === null && f.nombre === d.nombre));
    if (!fRes.error && !nRes.error && faltantes.length > 0) {
      if (seededFor.current === personaId) return; // carga concurrente con la siembra en curso: no pisar su resultado
      seededFor.current = personaId; // evita doble siembra (StrictMode / recargas)
      const seed = await sembrarPlantilla(personaId, faltantes);
      fs = [...fs, ...seed.folders];
      ns = [...seed.notes, ...ns].sort((a, b) => b.actualizado_en.localeCompare(a.actualizado_en));
      setExpanded(prev => new Set([...prev, ...seed.folders.map(f => f.id)])); // carpeta del año abierta
    }
    setFolders(fs);
    setNotes(ns);
    setLoading(false);
  }, [personaId]);

  useEffect(() => { load(); }, [load]);

  // ── Selección de nota ──────────────────────────────────────
  function selectNote(id: string) {
    const n = notes.find(x => x.id === id);
    if (!n) return;
    if (saveTimer.current) clearTimeout(saveTimer.current); // flush pending save
    setSelectedId(id);
    setDraftTitle(n.titulo);
    setDraftContent(n.contenido);
    setDraftFolderId(n.folder_id);
    setSaved(false);
  }

  // ── Auto-guardado (debounce 1.5 s) ────────────────────────
  function scheduleSave(title: string, content: string, folderId: string | null) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaved(false);
    saveTimer.current = setTimeout(async () => {
      if (!selectedId) return;
      setSaving(true);
      const now = new Date().toISOString();
      const sb = createAnyClient();
      await sb.from("notebook_note").update({
        titulo: title.trim() || "Sin título",
        contenido: content,
        folder_id: folderId,
        actualizado_en: now,
      }).eq("id", selectedId);
      setNotes(prev => prev.map(n =>
        n.id === selectedId
          ? { ...n, titulo: title.trim() || "Sin título", contenido: content, folder_id: folderId, actualizado_en: now }
          : n
      ));
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }, 1500);
  }

  // ── CRUD ───────────────────────────────────────────────────
  async function createNote(folderId: string | null = null) {
    const sb = createAnyClient();
    const { data } = await sb.from("notebook_note").insert({
      persona_id: personaId, folder_id: folderId,
      titulo: "Nueva nota", contenido: "",
    }).select().single();
    if (data) {
      const n = data as NNote;
      setNotes(prev => [n, ...prev]);
      if (folderId) setExpanded(prev => new Set([...prev, folderId])); // muestra la nota recién creada
      // selectNote lee `notes` (aún sin la nota nueva): se selecciona directo
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSelectedId(n.id); setDraftTitle(n.titulo); setDraftContent(n.contenido); setDraftFolderId(n.folder_id); setSaved(false);
    }
  }

  async function createFolder() {
    if (!newFolderName.trim()) return;
    const sb = createAnyClient();
    const { data } = await sb.from("notebook_folder").insert({
      persona_id: personaId, nombre: newFolderName.trim(), parent_id: newFolderParentId,
    }).select().single();
    if (data) {
      const f = data as NFolder;
      setFolders(prev => [...prev, f]);
      setExpanded(prev => new Set([...prev, f.id, ...(newFolderParentId ? [newFolderParentId] : [])]));
    }
    setNewFolderName(""); setShowNewFolder(false); setNewFolderParentId(null);
  }

  // IDs de todas las subcarpetas anidadas bajo `id` (recursivo)
  function descendantFolderIds(id: string): string[] {
    const hijos = folders.filter(f => f.parent_id === id).map(f => f.id);
    return hijos.flatMap(h => [h, ...descendantFolderIds(h)]);
  }

  async function doDeleteNote(id: string) {
    const sb = createAnyClient();
    const deleted_at = new Date().toISOString();
    const { error } = await sb.from("notebook_note").update({ deleted_at }).eq("id", id);
    if (error) {
      console.error("[Notebook] eliminar nota:", error);
      setDeleteError(/deleted_at/.test(error.message)
        ? "Falta habilitar la papelera en la base de datos (columna deleted_at). Ejecuta la migración 20261006_notebook_papelera.sql en Supabase."
        : `No se pudo eliminar: ${error.message}`);
      return;
    }
    setDeleteError(null);
    const n = notes.find(x => x.id === id);
    if (n) setTrashNotes(prev => [{ ...n, deleted_at }, ...prev]);
    setNotes(prev => prev.filter(n => n.id !== id));
    if (selectedId === id) {
      setSelectedId(null); setDraftTitle(""); setDraftContent(""); setDraftFolderId(null);
    }
    setDeletingNote(null);
  }

  async function doDeleteFolder(id: string, action: "move" | "cascade") {
    const sb = createAnyClient();
    const deleted_at = new Date().toISOString(); // mismo sello para restaurar el lote completo
    const ids = [id, ...descendantFolderIds(id)];
    const afectadas = notes.filter(n => n.folder_id && ids.includes(n.folder_id));
    // Primero la carpeta: si falla (p.ej. falta la columna), no se toca nada más
    const { error } = await sb.from("notebook_folder").update({ deleted_at }).in("id", ids);
    if (error) {
      console.error("[Notebook] eliminar carpeta:", error);
      setDeleteError(/deleted_at/.test(error.message)
        ? "Falta habilitar la papelera en la base de datos (columna deleted_at). Ejecuta la migración 20261006_notebook_papelera.sql en Supabase."
        : `No se pudo eliminar: ${error.message}`);
      return;
    }
    setDeleteError(null);

    if (action === "cascade") {
      // Notas de la carpeta y subcarpetas van a la papelera con ella
      await sb.from("notebook_note").update({ deleted_at }).in("folder_id", ids).is("deleted_at", null);
      setTrashNotes(prev => [...afectadas.map(n => ({ ...n, deleted_at })), ...prev]);
      setNotes(prev => prev.filter(n => !afectadas.includes(n)));
      if (selectedId && afectadas.some(n => n.id === selectedId)) {
        setSelectedId(null); setDraftTitle(""); setDraftContent(""); setDraftFolderId(null);
      }
    } else {
      // Notas quedan activas, sin carpeta
      await sb.from("notebook_note").update({ folder_id: null }).in("folder_id", ids).is("deleted_at", null);
      setNotes(prev => prev.map(n => afectadas.includes(n) ? { ...n, folder_id: null } : n));
      if (draftFolderId && ids.includes(draftFolderId)) setDraftFolderId(null);
    }
    setTrashFolders(prev => [...folders.filter(f => ids.includes(f.id)).map(f => ({ ...f, deleted_at })), ...prev]);
    setFolders(prev => prev.filter(f => !ids.includes(f.id)));
    setDeletingFolder(null); setFolderAction(null);
  }

  // ── Papelera: restaurar / eliminar definitivamente ─────────
  // Subcarpetas en papelera bajo `id` (recursivo)
  function trashDescendants(id: string): string[] {
    const hijos = trashFolders.filter(f => f.parent_id === id).map(f => f.id);
    return hijos.flatMap(h => [h, ...trashDescendants(h)]);
  }

  async function restaurarNota(n: NNote) {
    const sb = createAnyClient();
    // Si su carpeta ya no está activa, vuelve a "Sin carpeta"
    const folder_id = n.folder_id && folders.some(f => f.id === n.folder_id) ? n.folder_id : null;
    const { error } = await sb.from("notebook_note").update({ deleted_at: null, folder_id }).eq("id", n.id);
    if (error) return;
    setTrashNotes(prev => prev.filter(x => x.id !== n.id));
    setNotes(prev => [{ ...n, deleted_at: null, folder_id }, ...prev].sort((a, b) => b.actualizado_en.localeCompare(a.actualizado_en)));
  }

  async function restaurarCarpeta(f: NFolder) {
    const sb = createAnyClient();
    const ids = [f.id, ...trashDescendants(f.id)];
    // Restaura el lote eliminado junto con la carpeta (mismo deleted_at)
    const notasLote = trashNotes.filter(n => n.folder_id && ids.includes(n.folder_id) && n.deleted_at === f.deleted_at);
    const parent_id = f.parent_id && folders.some(x => x.id === f.parent_id) ? f.parent_id : null;
    await sb.from("notebook_folder").update({ deleted_at: null }).in("id", ids);
    if (parent_id !== f.parent_id) await sb.from("notebook_folder").update({ parent_id }).eq("id", f.id);
    if (notasLote.length) await sb.from("notebook_note").update({ deleted_at: null }).in("id", notasLote.map(n => n.id));
    const restauradas = trashFolders.filter(x => ids.includes(x.id)).map(x => ({ ...x, deleted_at: null, parent_id: x.id === f.id ? parent_id : x.parent_id }));
    setTrashFolders(prev => prev.filter(x => !ids.includes(x.id)));
    setFolders(prev => [...prev, ...restauradas]);
    setTrashNotes(prev => prev.filter(n => !notasLote.includes(n)));
    setNotes(prev => [...notasLote.map(n => ({ ...n, deleted_at: null })), ...prev].sort((a, b) => b.actualizado_en.localeCompare(a.actualizado_en)));
    setExpanded(prev => new Set([...prev, f.id]));
  }

  async function eliminarDefinitivo(tipo: "nota" | "carpeta", id: string) {
    if (!confirm("Se eliminará de forma permanente. ¿Continuar?")) return;
    const sb = createAnyClient();
    if (tipo === "nota") {
      await sb.from("notebook_note").delete().eq("id", id);
      setTrashNotes(prev => prev.filter(n => n.id !== id));
      return;
    }
    const ids = [id, ...trashDescendants(id)];
    await sb.from("notebook_note").delete().in("folder_id", ids).not("deleted_at", "is", null);
    await sb.from("notebook_folder").delete().in("id", ids);
    setTrashNotes(prev => prev.filter(n => !(n.folder_id && ids.includes(n.folder_id))));
    setTrashFolders(prev => prev.filter(f => !ids.includes(f.id)));
  }

  // ── Helpers ────────────────────────────────────────────────
  const notesByFolder = (fid: string | null) => notes.filter(n => n.folder_id === fid);
  const selectedNote  = notes.find(n => n.id === selectedId) ?? null;
  const toggleFolder  = (id: string) =>
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  // Carpetas en orden de árbol (profundidad ilimitada) con su ruta, para el selector de ubicación
  const arbolCarpetas = (parentId: string | null = null, ruta = ""): { id: string; ruta: string; depth: number }[] =>
    folders
      .filter(f => f.parent_id === parentId)
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .flatMap(f => {
        const r = ruta ? `${ruta} / ${f.nombre}` : f.nombre;
        return [{ id: f.id, ruta: r, depth: ruta ? ruta.split(" / ").length : 0 }, ...arbolCarpetas(f.id, r)];
      });

  // Fila de carpeta + su contenido (subcarpetas y notas), recursivo — indentación sutil por nivel
  function renderFolderNode(f: NFolder, depth = 0) {
    const open = expanded.has(f.id);
    const fNotes = notesByFolder(f.id);
    const children = folders.filter(c => c.parent_id === f.id);
    return (
      <div key={f.id}>
        <div
          className="group flex items-center gap-1 px-2 py-1.5 hover:bg-slate-100 cursor-pointer rounded-md mx-1 transition-colors"
          style={depth > 0 ? { paddingLeft: `${8 + depth * 16}px` } : undefined}
          onClick={() => toggleFolder(f.id)}
        >
          {open
            ? <ChevronDown    className="w-3 h-3 text-slate-300 flex-shrink-0" />
            : <ChevronRight   className="w-3 h-3 text-slate-300 flex-shrink-0" />}
          {open
            ? <FolderOpen     className="w-3.5 h-3.5 text-[#7c5cbf] flex-shrink-0" />
            : <Folder         className="w-3.5 h-3.5 text-[#7c5cbf] flex-shrink-0" />}
          <span className="text-[11px] font-semibold text-slate-600 truncate flex-1">{f.nombre}</span>
          <button
            onClick={e => { e.stopPropagation(); createNote(f.id); }}
            title="Nueva nota en esta carpeta"
            className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-300 hover:text-[#7c5cbf] rounded transition-all flex-shrink-0"
          >
            <FilePlus className="w-3 h-3" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); setNewFolderParentId(f.id); setShowNewFolder(true); setExpanded(prev => new Set([...prev, f.id])); }}
            title="Nueva subcarpeta"
            className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-300 hover:text-[#7c5cbf] rounded transition-all flex-shrink-0"
          >
            <FolderPlus className="w-3 h-3" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); setDeletingFolder(f.id); setFolderAction(null); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-300 hover:text-red-400 rounded transition-all flex-shrink-0"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
        {open && (
          <div className="pl-4 space-y-0.5">
            {children.map(c => renderFolderNode(c, depth + 1))}
            {fNotes.length === 0 && children.length === 0 && (
              <p className="text-[9px] text-slate-300 italic px-2 py-0.5">Sin notas</p>
            )}
            {fNotes.map(n => (
              <button key={n.id} onClick={() => selectNote(n.id)}
                className={`w-full text-left flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] truncate transition-colors ${
                  selectedId === n.id ? "bg-[#eaf4ff] text-[#4a90e2] font-semibold" : "text-slate-500 hover:bg-slate-100"
                }`}>
                <FileText className="w-3 h-3 flex-shrink-0" />
                {n.titulo}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (loading) return (
    <div className="flex items-center gap-2 py-4">
      <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
      <span className="text-xs text-slate-300">Cargando notebook...</span>
    </div>
  );

  return (
    <>
      <div className="flex rounded-xl overflow-hidden border border-slate-200" style={{ height: 440 }}>

        {/* ═══ Columna izquierda: árbol ═══ */}
        <div className="flex-shrink-0 bg-slate-50 border-r border-slate-200 flex flex-col overflow-hidden" style={{ width: 210 }}>

          {/* Acciones */}
          <div className="flex gap-1 p-2 border-b border-slate-200">
            <button onClick={() => createNote()}
              className="flex-1 flex items-center justify-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-[#4a90e2] hover:bg-white px-2 py-1.5 rounded-md transition-colors">
              <Plus className="w-3 h-3" /> Nota
            </button>
            <button onClick={() => { setNewFolderParentId(null); setShowNewFolder(v => !v); }}
              className="flex-1 flex items-center justify-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-[#7c5cbf] hover:bg-white px-2 py-1.5 rounded-md transition-colors">
              <Plus className="w-3 h-3" /> Carpeta
            </button>
          </div>

          {/* Input nueva carpeta */}
          {showNewFolder && (
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-slate-200 bg-white">
              {newFolderParentId && (
                <span className="text-[9px] text-slate-400 flex-shrink-0">
                  en {folders.find(f => f.id === newFolderParentId)?.nombre ?? ""} /
                </span>
              )}
              <input
                autoFocus
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") { setShowNewFolder(false); setNewFolderParentId(null); } }}
                placeholder="Nombre…"
                className="flex-1 text-[11px] border border-slate-200 rounded px-2 py-1 outline-none focus:border-[#7c5cbf] min-w-0"
              />
              <button onClick={createFolder} className="p-1 text-[#7c5cbf] hover:bg-[#f3f0ff] rounded flex-shrink-0">
                <Check className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Papelera (reemplaza al árbol mientras está abierta) */}
          {verPapelera ? (
          <div className="flex-1 overflow-y-auto py-1">
            <button onClick={() => setVerPapelera(false)}
              className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-semibold text-slate-500 hover:text-[#4a90e2]">
              <ArrowLeft className="w-3 h-3" /> Volver a notas
            </button>
            <p className="text-[9px] text-slate-400 px-3 pb-1.5">Se eliminan definitivamente a los {DIAS_PAPELERA} días.</p>
            {(() => {
              // Solo elementos "raíz" de la papelera (su carpeta contenedora no está también en la papelera)
              const enPapelera = new Set(trashFolders.map(f => f.id));
              const raicesF = trashFolders.filter(f => !f.parent_id || !enPapelera.has(f.parent_id));
              const raicesN = trashNotes.filter(n => !n.folder_id || !enPapelera.has(n.folder_id));
              if (!raicesF.length && !raicesN.length) {
                return <p className="text-[10px] text-slate-300 italic px-3 py-4 text-center">La papelera está vacía.</p>;
              }
              const item = (key: string, icono: React.ReactNode, titulo: string, deletedAt: string, onRestaurar: () => void, onBorrar: () => void, extra?: string) => (
                <div key={key} className="group mx-1 px-2 py-1.5 rounded-md hover:bg-slate-100">
                  <div className="flex items-center gap-1.5">
                    {icono}
                    <span className="text-[10px] text-slate-500 truncate flex-1">{titulo}</span>
                    <button onClick={onRestaurar} title="Restaurar" className="p-0.5 text-slate-300 hover:text-[#4a90e2] rounded flex-shrink-0">
                      <RotateCcw className="w-3 h-3" />
                    </button>
                    <button onClick={onBorrar} title="Eliminar definitivamente" className="p-0.5 text-slate-300 hover:text-red-500 rounded flex-shrink-0">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-[9px] text-slate-400 pl-[18px]">
                    {extra ? `${extra} · ` : ""}Expira en {diasRestantes(deletedAt)} {diasRestantes(deletedAt) === 1 ? "día" : "días"}
                  </p>
                </div>
              );
              return (
                <>
                  {raicesF.map(f => {
                    const ids = [f.id, ...trashDescendants(f.id)];
                    const cant = trashNotes.filter(n => n.folder_id && ids.includes(n.folder_id)).length;
                    return item(f.id, <Folder className="w-3 h-3 text-[#7c5cbf] flex-shrink-0" />, f.nombre, f.deleted_at!,
                      () => restaurarCarpeta(f), () => eliminarDefinitivo("carpeta", f.id), `${cant} ${cant === 1 ? "nota" : "notas"}`);
                  })}
                  {raicesN.map(n => item(n.id, <FileText className="w-3 h-3 text-slate-400 flex-shrink-0" />, n.titulo, n.deleted_at!,
                    () => restaurarNota(n), () => eliminarDefinitivo("nota", n.id)))}
                </>
              );
            })()}
          </div>
          ) : (
          <div className="flex-1 overflow-y-auto py-1 space-y-0.5">
            {/* Carpetas — árbol recursivo (solo raíz visible al inicio) */}
            {folders.filter(f => f.parent_id === null).map(f => renderFolderNode(f))}

            {/* Sin carpeta */}
            {notesByFolder(null).length > 0 && (
              <div className="mt-1">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest px-3 py-1">Sin carpeta</p>
                {notesByFolder(null).map(n => (
                  <button key={n.id} onClick={() => selectNote(n.id)}
                    className={`w-full text-left flex items-center gap-1.5 px-3 py-1 text-[10px] truncate transition-colors rounded-md mx-0 ${
                      selectedId === n.id ? "bg-[#eaf4ff] text-[#4a90e2] font-semibold" : "text-slate-500 hover:bg-slate-100"
                    }`}>
                    <FileText className="w-3 h-3 flex-shrink-0" />
                    {n.titulo}
                  </button>
                ))}
              </div>
            )}

            {/* Empty state */}
            {folders.length === 0 && notes.length === 0 && (
              <div className="flex flex-col items-center justify-center h-32 px-4 text-center">
                <FileText className="w-8 h-8 text-slate-100 mb-2" />
                <p className="text-[10px] text-slate-300 leading-tight">Crea tu primera nota<br />o carpeta</p>
              </div>
            )}
          </div>
          )}

          {/* Acceso a la papelera */}
          <button onClick={() => setVerPapelera(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 border-t border-slate-200 text-[10px] font-semibold transition-colors ${
              verPapelera ? "text-[#4a90e2] bg-white" : "text-slate-400 hover:text-slate-600 hover:bg-white"
            }`}>
            <Trash2 className="w-3 h-3" /> Papelera
            {(trashFolders.length + trashNotes.length) > 0 && (
              <span className="ml-auto text-[9px] bg-slate-200 text-slate-500 rounded-full px-1.5">{trashFolders.length + trashNotes.length}</span>
            )}
          </button>
        </div>

        {/* ═══ Columna derecha: editor ═══ */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white min-w-0">
          {selectedNote ? (
            <>
              {/* Barra del editor */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 flex-shrink-0">
                {/* Ubicación de la nota: cualquier carpeta, a cualquier profundidad (ruta completa) */}
                <select
                  value={draftFolderId ?? ""}
                  onChange={e => {
                    const v = e.target.value || null;
                    setDraftFolderId(v);
                    scheduleSave(draftTitle, draftContent, v);
                  }}
                  className="max-w-[60%] truncate text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-[#7c5cbf] cursor-pointer"
                >
                  <option value="">Sin carpeta</option>
                  {arbolCarpetas().map(c => (
                    <option key={c.id} value={c.id}>{"\u00A0\u00A0".repeat(c.depth)}{c.ruta}</option>
                  ))}
                </select>

                <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
                  {saving && <><Loader2 className="w-3 h-3 animate-spin text-slate-300" /><span className="text-[9px] text-slate-300">Guardando…</span></>}
                  {saved  && <span className="text-[9px] text-green-500 font-semibold">✓ Guardado</span>}
                  {!saving && !saved && (
                    <span className="text-[9px] text-slate-300">
                      {format(new Date(selectedNote.actualizado_en), "d MMM · HH:mm", { locale: es })}
                    </span>
                  )}
                </div>

                <button onClick={() => setDeletingNote(selectedNote.id)}
                  className="p-1.5 rounded-md text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors flex-shrink-0"
                  title="Eliminar nota">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Título */}
              <input
                value={draftTitle}
                onChange={e => { setDraftTitle(e.target.value); scheduleSave(e.target.value, draftContent, draftFolderId); }}
                placeholder="Título de la nota…"
                className="px-5 pt-4 pb-2 text-[15px] font-bold text-[#1a1a2e] outline-none placeholder:text-slate-200 w-full border-none bg-transparent"
              />

              {/* Separador sutil */}
              <div className="mx-5 border-b border-slate-100" />

              {/* Contenido */}
              <RichTextEditor
                value={draftContent}
                onChange={html => { setDraftContent(html); scheduleSave(draftTitle, html, draftFolderId); }}
                placeholder="Escribe tus anotaciones aquí…"
                className="flex-1"
              />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mb-3">
                <FileText className="w-5 h-5 text-slate-200" />
              </div>
              <p className="text-[13px] font-semibold text-slate-300">Selecciona una nota</p>
              <p className="text-[11px] text-slate-200 mt-1">o crea una nueva con "+ Nota"</p>
            </div>
          )}
        </div>
      </div>

      {/* ═══ Modal: eliminar nota ═══ */}
      {deletingNote && (() => {
        const n = notes.find(x => x.id === deletingNote);
        return (
          <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
              <p className="text-[14px] font-semibold text-[#1a1a2e] mb-2">¿Eliminar nota?</p>
              <p className="text-[12px] text-slate-500 mb-5">
                <span className="font-semibold text-slate-700">"{n?.titulo}"</span> se moverá a la papelera. Podrás restaurarla durante {DIAS_PAPELERA} días.
              </p>
              {deleteError && <p className="text-[11px] text-red-500 mb-3">{deleteError}</p>}
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setDeletingNote(null); setDeleteError(null); }}
                  className="px-4 py-2 text-[12px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
                  Cancelar
                </button>
                <button onClick={() => doDeleteNote(deletingNote)}
                  className="px-4 py-2 text-[12px] font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors">
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ Modal: eliminar carpeta ═══ */}
      {deletingFolder && (() => {
        const f = folders.find(x => x.id === deletingFolder);
        const count = notesByFolder(deletingFolder).length;
        return (
          <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50">
            <div className="relative bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
              <button onClick={() => { setDeletingFolder(null); setFolderAction(null); }}
                className="absolute top-3 right-3 text-slate-300 hover:text-slate-500">
                <X className="w-4 h-4" />
              </button>
              <p className="text-[14px] font-semibold text-[#1a1a2e] mb-1 pr-6">
                Eliminar carpeta "{f?.nombre}"
              </p>
              {deleteError && <p className="text-[11px] text-red-500 mb-3">{deleteError}</p>}

              {count > 0 ? (
                <>
                  <p className="text-[12px] text-slate-500 mb-4">
                    Contiene <span className="font-semibold">{count} {count === 1 ? "nota" : "notas"}</span>. ¿Qué deseas hacer con ellas?
                  </p>
                  <div className="space-y-2 mb-5">
                    {(["move", "cascade"] as const).map(action => (
                      <label key={action}
                        className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                          folderAction === action
                            ? action === "move" ? "border-[#4a90e2] bg-[#eaf4ff]" : "border-red-300 bg-red-50"
                            : "border-slate-200 hover:border-slate-300"
                        }`}>
                        <input type="radio" name="folderAction" checked={folderAction === action}
                          onChange={() => setFolderAction(action)}
                          className="mt-0.5 flex-shrink-0"
                          style={{ accentColor: action === "move" ? "#4a90e2" : "#ef4444" }}
                        />
                        <div>
                          <p className="text-[12px] font-semibold text-slate-700">
                            {action === "move" ? "Mover notas a raíz" : "Eliminar notas en cascada"}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {action === "move"
                              ? "Las notas quedan sin carpeta asignada."
                              : `La carpeta y todas sus notas irán a la papelera (${DIAS_PAPELERA} días para restaurar).`}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setDeletingFolder(null); setFolderAction(null); }}
                      className="px-4 py-2 text-[12px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
                      Cancelar
                    </button>
                    <button
                      disabled={!folderAction}
                      onClick={() => folderAction && doDeleteFolder(deletingFolder, folderAction)}
                      className={`px-4 py-2 text-[12px] font-bold text-white rounded-lg transition-colors ${
                        folderAction ? "bg-red-500 hover:bg-red-600" : "bg-slate-200 text-slate-400 cursor-not-allowed"
                      }`}>
                      Confirmar
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[12px] text-slate-500 mb-5">La carpeta irá a la papelera. Podrás restaurarla durante {DIAS_PAPELERA} días.</p>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setDeletingFolder(null)}
                      className="px-4 py-2 text-[12px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
                      Cancelar
                    </button>
                    <button onClick={() => doDeleteFolder(deletingFolder, "move")}
                      className="px-4 py-2 text-[12px] font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors">
                      Eliminar carpeta
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}
    </>
  );
}
