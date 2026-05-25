"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  Folder, FolderOpen, FileText, Plus, Trash2,
  ChevronRight, ChevronDown, X, Loader2, Check,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { createAnyClient } from "@/lib/supabase/client";

// ── Tipos ──────────────────────────────────────────────────────
interface NFolder { id: string; nombre: string; creado_en: string; }
interface NNote   {
  id: string; folder_id: string | null;
  titulo: string; contenido: string; actualizado_en: string;
}

interface Props { personaId: string; personaNombre: string; }

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
  // Modales
  const [deletingNote,   setDeletingNote]   = useState<string | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null);
  const [folderAction,   setFolderAction]   = useState<"move" | "cascade" | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Carga ──────────────────────────────────────────────────
  const load = useCallback(async () => {
    const sb = createAnyClient();
    const [fRes, nRes] = await Promise.all([
      sb.from("notebook_folder").select("*").eq("persona_id", personaId).order("creado_en"),
      sb.from("notebook_note").select("*").eq("persona_id", personaId).order("actualizado_en", { ascending: false }),
    ]);
    setFolders((fRes.data ?? []) as NFolder[]);
    setNotes((nRes.data ?? []) as NNote[]);
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
  async function createNote() {
    const sb = createAnyClient();
    const { data } = await sb.from("notebook_note").insert({
      persona_id: personaId, folder_id: null,
      titulo: "Nueva nota", contenido: "",
    }).select().single();
    if (data) {
      const n = data as NNote;
      setNotes(prev => [n, ...prev]);
      selectNote(n.id);
    }
  }

  async function createFolder() {
    if (!newFolderName.trim()) return;
    const sb = createAnyClient();
    const { data } = await sb.from("notebook_folder").insert({
      persona_id: personaId, nombre: newFolderName.trim(),
    }).select().single();
    if (data) {
      const f = data as NFolder;
      setFolders(prev => [...prev, f]);
      setExpanded(prev => new Set([...prev, f.id]));
    }
    setNewFolderName(""); setShowNewFolder(false);
  }

  async function doDeleteNote(id: string) {
    const sb = createAnyClient();
    await sb.from("notebook_note").delete().eq("id", id);
    setNotes(prev => prev.filter(n => n.id !== id));
    if (selectedId === id) {
      setSelectedId(null); setDraftTitle(""); setDraftContent(""); setDraftFolderId(null);
    }
    setDeletingNote(null);
  }

  async function doDeleteFolder(id: string, action: "move" | "cascade") {
    const sb = createAnyClient();
    if (action === "cascade") {
      await sb.from("notebook_note").delete().eq("folder_id", id);
      setNotes(prev => prev.filter(n => n.folder_id !== id));
      if (selectedId && notes.find(n => n.id === selectedId)?.folder_id === id) {
        setSelectedId(null); setDraftTitle(""); setDraftContent(""); setDraftFolderId(null);
      }
    } else {
      await sb.from("notebook_note").update({ folder_id: null }).eq("folder_id", id);
      setNotes(prev => prev.map(n => n.folder_id === id ? { ...n, folder_id: null } : n));
    }
    await sb.from("notebook_folder").delete().eq("id", id);
    setFolders(prev => prev.filter(f => f.id !== id));
    setDeletingFolder(null); setFolderAction(null);
  }

  // ── Helpers ────────────────────────────────────────────────
  const notesByFolder = (fid: string | null) => notes.filter(n => n.folder_id === fid);
  const selectedNote  = notes.find(n => n.id === selectedId) ?? null;
  const toggleFolder  = (id: string) =>
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

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
            <button onClick={createNote}
              className="flex-1 flex items-center justify-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-[#4a90e2] hover:bg-white px-2 py-1.5 rounded-md transition-colors">
              <Plus className="w-3 h-3" /> Nota
            </button>
            <button onClick={() => setShowNewFolder(v => !v)}
              className="flex-1 flex items-center justify-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-[#7c5cbf] hover:bg-white px-2 py-1.5 rounded-md transition-colors">
              <Plus className="w-3 h-3" /> Carpeta
            </button>
          </div>

          {/* Input nueva carpeta */}
          {showNewFolder && (
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-slate-200 bg-white">
              <input
                autoFocus
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") setShowNewFolder(false); }}
                placeholder="Nombre…"
                className="flex-1 text-[11px] border border-slate-200 rounded px-2 py-1 outline-none focus:border-[#7c5cbf] min-w-0"
              />
              <button onClick={createFolder} className="p-1 text-[#7c5cbf] hover:bg-[#f3f0ff] rounded flex-shrink-0">
                <Check className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Árbol */}
          <div className="flex-1 overflow-y-auto py-1 space-y-0.5">
            {/* Carpetas */}
            {folders.map(f => {
              const open = expanded.has(f.id);
              const fNotes = notesByFolder(f.id);
              return (
                <div key={f.id}>
                  <div
                    className="group flex items-center gap-1 px-2 py-1.5 hover:bg-slate-100 cursor-pointer rounded-md mx-1 transition-colors"
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
                      onClick={e => { e.stopPropagation(); setDeletingFolder(f.id); setFolderAction(null); }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-300 hover:text-red-400 rounded transition-all flex-shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  {open && (
                    <div className="pl-5 space-y-0.5">
                      {fNotes.length === 0
                        ? <p className="text-[9px] text-slate-300 italic px-2 py-0.5">Sin notas</p>
                        : fNotes.map(n => (
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
            })}

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
        </div>

        {/* ═══ Columna derecha: editor ═══ */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white min-w-0">
          {selectedNote ? (
            <>
              {/* Barra del editor */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 flex-shrink-0">
                <select
                  value={draftFolderId ?? ""}
                  onChange={e => {
                    const v = e.target.value || null;
                    setDraftFolderId(v);
                    scheduleSave(draftTitle, draftContent, v);
                  }}
                  className="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-[#7c5cbf] cursor-pointer"
                >
                  <option value="">Sin carpeta</option>
                  {folders.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
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
              <textarea
                value={draftContent}
                onChange={e => { setDraftContent(e.target.value); scheduleSave(draftTitle, e.target.value, draftFolderId); }}
                placeholder="Escribe tus anotaciones aquí…"
                className="flex-1 px-5 py-3 text-[13px] text-slate-600 leading-relaxed outline-none resize-none placeholder:text-slate-200 border-none bg-transparent"
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
                Se eliminará <span className="font-semibold text-slate-700">"{n?.titulo}"</span> de forma permanente.
              </p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setDeletingNote(null)}
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
                              : "Se eliminarán la carpeta y todas sus notas. Irreversible."}
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
                  <p className="text-[12px] text-slate-500 mb-5">La carpeta está vacía. Esta acción no se puede deshacer.</p>
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
