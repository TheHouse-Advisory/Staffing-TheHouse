"use client";

import { useEffect } from "react";
import { useEditor, useEditorState, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { Bold, Italic, List, ListOrdered, type LucideIcon } from "lucide-react";
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
  return value
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/(p|li)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
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

function Toolbar({ editor }: { editor: Editor }) {
  // Estado de marcas activas, re-renderiza solo cuando cambia
  const s = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      bullet: editor.isActive("bulletList"),
      ordered: editor.isActive("orderedList"),
    }),
  });
  return (
    <div className="flex items-center gap-0.5 px-4 py-1.5 border-b border-slate-100">
      <ToolbarButton icon={Bold} title="Negrita" active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
      <ToolbarButton icon={Italic} title="Cursiva" active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <ToolbarButton icon={List} title="Viñetas" active={s.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <ToolbarButton icon={ListOrdered} title="Enumeración" active={s.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
    </div>
  );
}

export function RichTextEditor({ value, onChange, onBlur, placeholder, editable = true, className, contentClassName }: Props) {
  const editor = useEditor({
    immediatelyRender: false, // evita mismatch de hidratación (SSR)
    editable,
    onBlur: ({ editor }) => onBlur?.(editor.isEmpty ? "" : editor.getHTML()),
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: toHtml(value),
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? "" : editor.getHTML()),
    editorProps: {
      attributes: {
        class: cn(
          "h-full leading-relaxed outline-none",
          contentClassName ?? "px-5 py-3 text-[13px] text-slate-600",
          "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_p]:my-0.5",
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
