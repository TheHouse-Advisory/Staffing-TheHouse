"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Check, X, Trash2 } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/FormField";

interface CatalogoItem { id: string; nombre: string; activo: boolean; }

interface Props {
  tabla: "cat_industria" | "cat_capacidad" | "cat_tematica";
  titulo: string;
}

export function CatalogoTab({ tabla, titulo }: Props) {
  const [items, setItems] = useState<CatalogoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Mensaje legible: un nombre repetido es el caso más común
  const mensaje = (err: { code?: string; message: string }) =>
    err.code === "23505" ? "Ya existe un elemento con ese nombre." : err.message;

  const load = useCallback(async () => {
    const supabase = createAnyClient();
    const { data, error: err } = await supabase
      .from(tabla)
      .select("id, nombre, activo")
      .order("nombre");
    if (err) setError(`No se pudo cargar la lista: ${err.message}`);
    setItems((data ?? []) as CatalogoItem[]);
    setLoading(false);
  }, [tabla]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (item: CatalogoItem) => {
    setEditingId(item.id);
    setEditValue(item.nombre);
    setAdding(false);
    setError(null);
  };

  const cancelEdit = () => { setEditingId(null); setEditValue(""); };

  // Antes no se revisaban errores: si fallaba (nombre repetido, permisos) se borraba lo
  // escrito sin avisar. Ahora se muestra el error y se mantiene el texto para corregirlo.
  // `saving` también bloquea la tecla Enter, que antes podía crear duplicados.
  const saveEdit = async (id: string) => {
    if (!editValue.trim() || saving) return;
    setSaving(true);
    const supabase = createAnyClient();
    const { error: err } = await supabase.from(tabla).update({ nombre: editValue.trim() }).eq("id", id);
    setSaving(false);
    if (err) { setError(mensaje(err)); return; }
    setError(null);
    setEditingId(null);
    load();
  };

  const toggleActivo = async (item: CatalogoItem) => {
    if (saving) return;
    setSaving(true);
    const supabase = createAnyClient();
    const { error: err } = await supabase.from(tabla).update({ activo: !item.activo }).eq("id", item.id);
    setSaving(false);
    if (err) { setError(mensaje(err)); return; }
    setError(null);
    load();
  };

  const addItem = async () => {
    if (!newValue.trim() || saving) return;
    setSaving(true);
    const supabase = createAnyClient();
    const { error: err } = await supabase.from(tabla).insert({ nombre: newValue.trim() });
    setSaving(false);
    if (err) { setError(mensaje(err)); return; }
    setError(null);
    setNewValue("");
    setAdding(false);
    load();
  };
  const activos = items.filter((i) => i.activo);
  const inactivos = items.filter((i) => !i.activo);

  if (loading) return <p className="text-sm text-[#888]">Cargando...</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[#888]">{activos.length} {titulo.toLowerCase()} activas</p>
        <Button size="sm" onClick={() => { setAdding(true); setEditingId(null); }}>
          <Plus className="w-3.5 h-3.5" /> Agregar
        </Button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</p>}

      {/* Formulario para agregar */}
      {adding && (
        <div className="flex items-center gap-2 mb-3 p-3 bg-[#f9f9f9] rounded-xl border border-[#e8e8e8]">
          <Input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder={`Nueva ${titulo.toLowerCase().slice(0, -1)}...`}
            className="flex-1"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") addItem(); if (e.key === "Escape") setAdding(false); }}
          />
          <button onClick={addItem} disabled={saving || !newValue.trim()}
            className="p-2 rounded-lg bg-[#4a90e2] text-white hover:bg-[#3a7bd5] disabled:opacity-50 transition-colors">
            <Check className="w-4 h-4" />
          </button>
          <button onClick={() => { setAdding(false); setNewValue(""); }}
            className="p-2 rounded-lg hover:bg-[#f0f0f0] text-[#888] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Lista de activos */}
      <div className="bg-white rounded-xl border border-[#e8e8e8] overflow-hidden">
        {activos.length === 0 && (
          <p className="text-sm text-[#888] text-center py-6">Sin {titulo.toLowerCase()} activas.</p>
        )}
        {activos.map((item, idx) => (
          <div key={item.id}
            className={`flex items-center gap-3 px-4 py-3 group ${idx < activos.length - 1 ? "border-b border-[#f5f5f5]" : ""}`}>
            {editingId === item.id ? (
              <>
                <Input
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="flex-1 text-sm"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") saveEdit(item.id); if (e.key === "Escape") cancelEdit(); }}
                />
                <button onClick={() => saveEdit(item.id)} disabled={saving}
                  className="p-1.5 rounded-md bg-[#4a90e2] text-white hover:bg-[#3a7bd5] transition-colors">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={cancelEdit}
                  className="p-1.5 rounded-md hover:bg-[#f0f0f0] text-[#888] transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm">{item.nombre}</span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => startEdit(item)}
                    className="p-1.5 rounded-md hover:bg-[#f0f0f0] text-[#888] hover:text-[#1a1a1a] transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => toggleActivo(item)}
                    className="p-1.5 rounded-md hover:bg-[#f0f0f0] text-[#888] hover:text-red-500 transition-colors"
                    title="Desactivar">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Inactivos */}
      {inactivos.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold text-[#aaa] uppercase tracking-widest mb-2">
            Inactivas ({inactivos.length})
          </p>
          <div className="bg-white rounded-xl border border-[#f0f0f0] overflow-hidden opacity-60">
            {inactivos.map((item, idx) => (
              <div key={item.id}
                className={`flex items-center gap-3 px-4 py-3 group ${idx < inactivos.length - 1 ? "border-b border-[#f5f5f5]" : ""}`}>
                <span className="flex-1 text-sm line-through text-[#aaa]">{item.nombre}</span>
                <button onClick={() => toggleActivo(item)}
                  className="opacity-0 group-hover:opacity-100 text-xs text-[#4a90e2] hover:underline transition-opacity">
                  Reactivar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
