"use client";

import { cn } from "@/lib/utils";
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

interface FieldWrapperProps {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

export function FieldWrapper({ label, required, error, hint, children, className }: FieldWrapperProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label className="text-sm font-medium text-[#333]">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-[#888]">{hint}</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ── Estilos base compartidos ──────────────────────────────────
const inputBase =
  "w-full px-3.5 py-2.5 rounded-lg border text-sm transition-colors outline-none " +
  "border-[#e0e0e0] focus:border-[#4a90e2] focus:ring-2 focus:ring-[#4a90e2]/20 " +
  "disabled:bg-[#f5f5f5] disabled:cursor-not-allowed";

// ── Input ────────────────────────────────────────────────────
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export function Input({ error, className, ...props }: InputProps) {
  return (
    <input
      {...props}
      className={cn(
        inputBase,
        error && "border-red-400 focus:border-red-400 focus:ring-red-200",
        className
      )}
    />
  );
}

// ── Textarea ─────────────────────────────────────────────────
interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export function Textarea({ error, className, ...props }: TextareaProps) {
  return (
    <textarea
      {...props}
      rows={props.rows ?? 3}
      className={cn(
        inputBase,
        "resize-none",
        error && "border-red-400 focus:border-red-400 focus:ring-red-200",
        className
      )}
    />
  );
}

// ── Select ───────────────────────────────────────────────────
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  /** Si true, el placeholder se puede seleccionar (para restablecer a vacío/null) */
  allowEmpty?: boolean;
}

export function Select({ error, options, placeholder, allowEmpty, className, ...props }: SelectProps) {
  return (
    <select
      {...props}
      className={cn(
        inputBase,
        "bg-white cursor-pointer",
        error && "border-red-400 focus:border-red-400 focus:ring-red-200",
        className
      )}
    >
      {placeholder && (
        <option value="" disabled={!allowEmpty}>
          {placeholder}
        </option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
