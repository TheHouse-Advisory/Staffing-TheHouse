"use client";

import { useEffect, useState } from "react";
import { useEditor, useEditorState, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { TextStyle, FontSize } from "@tiptap/extension-text-style";
import { FontFamily } from "@tiptap/extension-font-family";
import { Highlight } from "@tiptap/extension-highlight";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { TextAlign } from "@tiptap/extension-text-align";
import {
  Bold, Italic, Underline, Highlighter, List, ListOrdered, ListTodo,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, Minus, Plus, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (html: string) => void;
  onBlur?: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  className?: string;
  /** Clases del área de texto (tamaño/color de fuente) */
  contentClassName?: string;
}

// HTML → texto plano (búsqueda, vistas previas). Sin DOM: seguro en SSR
export function htmlToText(value: string): string {
  if (!value || !value.trimStart().startsWith("<")) return value ?? "";
  let text = value
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/(p|li|h[1-6])>|<br\s*\/?>/gi, "\n");
  // Elimina etiquetas hasta que no quede ninguna (evita reconstrucciones tipo "<<b>script>")
  let prev: string;
  do {
    prev = text;
    text = text.replace(/<[^>]*>/g, "");
  } while (text !== prev);
  // Restos de "<" o ">" sueltos no son etiquetas válidas: se descartan
  text = text.replace(/[<>]/g, "");
  // Decodificar entidades al final; &amp; último para no generar entidades nuevas
  return text
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n+$/, "");
}

// Contenido legado en texto plano → HTML (cada línea un párrafo)
function toHtml(value: string): string {
  if (!value || value.trimStart().startsWith("<")) return value;
  return value
    .split("\n")
    .map(l => `<p>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
    .join("");
}

function ToolbarButton({ icon: Icon, active, onClick, title }: { icon: LucideIcon; active: boolean; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={e => e.preventDefault()} // no robar el foco al editor
      onClick={onClick}
      className={cn(
        "p-1.5 rounded hover:bg-slate-100 text-slate-400 transition-colors",
        active && "bg-slate-100 text-[#1a1a2e]"
      )}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

// Opciones de fuente ("" = fuente por defecto del editor)
const FUENTES = [
  { label: "Predeterminada", value: "" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Inter", value: "Inter, sans-serif" },
  { label: "Serif", value: "Georgia, serif" },
  { label: "Monospace", value: "ui-monospace, monospace" },
];

// Rango del control de tamaño (px)
const FONT_MIN = 8;
const FONT_MAX = 72;

const FONT_BASE_FALLBACK = 16;

// Tamaño base del editor (sin fontSize explícito), según las clases del contenedor
function tamanoBase(editor: Editor): number {
  try {
    const px = parseFloat(getComputedStyle(editor.view.dom).fontSize);
    return Number.isFinite(px) && px > 0 ? Math.round(px) : FONT_BASE_FALLBACK;
  } catch {
    return FONT_BASE_FALLBACK; // vista aún no montada
  }
}

// Tamaño (px entero) de la selección: atributo textStyle.fontSize ("40px", "12pt", "0.85em") o el base
function tamanoEnCursor(editor: Editor): number {
  const base = tamanoBase(editor);
  const raw = editor.getAttributes("textStyle").fontSize as string | undefined;
  if (!raw) return base;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return base;
  if (/em$/i.test(raw)) return Math.round(n * base); // em/rem relativos al base
  if (/pt$/i.test(raw)) return Math.round(n * (4 / 3)); // 1pt = 1.333px
  return Math.round(n);
}

// Control numérico estilo Google Docs: [-] [n] [+]
function FontSizeControl({ value, onChange }: { value: number; onChange: (px: number) => void }) {
  const [texto, setTexto] = useState(String(value));
  useEffect(() => setTexto(String(value)), [value]);

  const aplicar = (n: number) => onChange(Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(n))));
  const confirmar = () => {
    const n = Number(texto);
    if (Number.isFinite(n) && n > 0) aplicar(n); else setTexto(String(value));
  };
  const btn = "p-1 text-slate-400 hover:bg-slate-100 hover:text-[#1a1a2e] disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div className="ml-1 flex items-center h-7 border border-slate-200 rounded overflow-hidden" title="Tamaño de texto">
      <button type="button" className={btn} disabled={value <= FONT_MIN}
        onMouseDown={(e) => e.preventDefault()} onClick={() => aplicar(value - 1)} title="Disminuir tamaño">
        <Minus className="w-3 h-3" />
      </button>
      <input
        value={texto}
        inputMode="numeric"
        onChange={(e) => setTexto(e.target.value.replace(/\D/g, ""))}
        onBlur={confirmar}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmar(); } }}
        className="w-8 h-full text-center text-[11px] text-slate-600 border-x border-slate-200 outline-none bg-transparent"
      />
      <button type="button" className={btn} disabled={value >= FONT_MAX}
        onMouseDown={(e) => e.preventDefault()} onClick={() => aplicar(value + 1)} title="Aumentar tamaño">
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
}

const selectCls = "h-7 text-[11px] text-slate-500 bg-transparent border border-slate-200 rounded px-1.5 outline-none hover:bg-slate-50 cursor-pointer";

function Separador() {
  return <span className="w-px h-4 bg-slate-200 mx-1" />;
}

function Toolbar({ editor }: { editor: Editor }) {
  // Estado de formato activo, re-renderiza solo cuando cambia
  const s = useEditorState({
    editor,
    selector: ({ editor }) => {
      return {
        bold: editor.isActive("bold"),
        italic: editor.isActive("italic"),
        underline: editor.isActive("underline"),
        highlight: editor.isActive("highlight"),
        bullet: editor.isActive("bulletList"),
        ordered: editor.isActive("orderedList"),
        task: editor.isActive("taskList"),
        align: (["left", "center", "right", "justify"] as const).find((a) => editor.isActive({ textAlign: a })) ?? "left",
        fuente: (editor.getAttributes("textStyle").fontFamily as string | undefined) ?? "",
        tamano: tamanoEnCursor(editor),
      };
    },
  });

  const aplicarTamano = (px: number) => editor.chain().focus().setFontSize(`${px}px`).run();

  function aplicarFuente(f: string) {
    if (f) editor.chain().focus().setFontFamily(f).run();
    else editor.chain().focus().unsetFontFamily().run();
  }

  const alinear = (a: "left" | "center" | "right" | "justify") => () => editor.chain().focus().setTextAlign(a).run();

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-4 py-1.5 border-b border-slate-100">
      <select title="Tipo de fuente" value={s.fuente} onChange={(e) => aplicarFuente(e.target.value)} className={selectCls}>
        {FUENTES.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
      </select>
      <FontSizeControl value={s.tamano} onChange={aplicarTamano} />
      <Separador />
      <ToolbarButton icon={Bold} title="Negrita" active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
      <ToolbarButton icon={Italic} title="Cursiva" active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <ToolbarButton icon={Underline} title="Subrayado" active={s.underline} onClick={() => editor.chain().focus().toggleUnderline().run()} />
      <ToolbarButton icon={Highlighter} title="Resaltar" active={s.highlight} onClick={() => editor.chain().focus().toggleHighlight({ color: "#fef08a" }).run()} />
      <Separador />
      <ToolbarButton icon={List} title="Viñetas" active={s.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <ToolbarButton icon={ListOrdered} title="Enumeración" active={s.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
      <ToolbarButton icon={ListTodo} title="Lista de tareas" active={s.task} onClick={() => editor.chain().focus().toggleTaskList().run()} />
      <Separador />
      <ToolbarButton icon={AlignLeft} title="Alinear a la izquierda" active={s.align === "left"} onClick={alinear("left")} />
      <ToolbarButton icon={AlignCenter} title="Centrar" active={s.align === "center"} onClick={alinear("center")} />
      <ToolbarButton icon={AlignRight} title="Alinear a la derecha" active={s.align === "right"} onClick={alinear("right")} />
      <ToolbarButton icon={AlignJustify} title="Justificar" active={s.align === "justify"} onClick={alinear("justify")} />
    </div>
  );
}

export function RichTextEditor({ value, onChange, onBlur, placeholder, editable = true, className, contentClassName }: Props) {
  const editor = useEditor({
    immediatelyRender: false, // evita mismatch de hidratación (SSR)
    editable,
    onBlur: ({ editor }) => onBlur?.(editor.isEmpty ? "" : editor.getHTML()),
    extensions: [
      // StarterKit v3 ya incluye Underline
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, blockquote: false, horizontalRule: false }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      TextStyle,
      FontFamily,
      FontSize,
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: toHtml(value),
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? "" : editor.getHTML()),
    editorProps: {
      attributes: {
        class: cn(
          "h-full leading-relaxed outline-none",
          contentClassName ?? "px-5 py-3 text-[13px] text-slate-600",
          "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_p]:my-0.5",
          "[&_h1]:text-xl [&_h1]:font-bold [&_h1]:my-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:my-1.5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:my-1 [&_mark]:rounded-sm [&_mark]:px-0.5",
          // Listas de tareas: layout en globals.css; aquí solo checkbox y tachado al completar
          "[&_ul[data-type=taskList]_input]:cursor-pointer [&_ul[data-type=taskList]_input]:accent-[#1a1a2e]",
          "[&_li[data-checked=true]>div]:line-through [&_li[data-checked=true]>div]:text-slate-400",
          // placeholder de Tiptap
          "[&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)] [&_p.is-editor-empty:first-child]:before:text-slate-200 [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:pointer-events-none"
        ),
      },
    },
  });

  // Sincroniza cambios externos de value (p.ej. al cambiar de nota)
  useEffect(() => {
    if (!editor) return;
    const html = toHtml(value);
    const current = editor.isEmpty ? "" : editor.getHTML();
    if (html !== current) editor.commands.setContent(html, { emitUpdate: false });
  }, [value, editor]);

  // Permisos pueden cambiar sin desmontar
  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
  }, [editable, editor]);

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      {editor && editable && <Toolbar editor={editor} />}
      <EditorContent editor={editor} className="flex-1 overflow-y-auto [&>div]:h-full" />
    </div>
  );
}
