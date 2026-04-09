"use client";

import { useState } from "react";
import { X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Option {
  value: string;
  label: string;
}

interface MultiSelectProps {
  options: Option[];
  value: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Seleccionar...",
  disabled = false,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);

  const toggle = (optValue: string) => {
    if (value.includes(optValue)) {
      onChange(value.filter((v) => v !== optValue));
    } else {
      onChange([...value, optValue]);
    }
  };

  const remove = (optValue: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(value.filter((v) => v !== optValue));
  };

  const selectedLabels = options.filter((o) => value.includes(o.value));
  const availableOptions = options.filter((o) => !value.includes(o.value));

  return (
    <div className="relative">
      {/* Trigger */}
      <div
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(
          "min-h-[42px] px-3 py-2 rounded-lg border border-[#e0e0e0] cursor-pointer",
          "flex flex-wrap gap-1.5 items-center",
          "focus-within:border-[#4a90e2] focus-within:ring-2 focus-within:ring-[#4a90e2]/20",
          "transition-colors bg-white",
          disabled && "bg-[#f5f5f5] cursor-not-allowed opacity-60"
        )}
      >
        {selectedLabels.length === 0 && (
          <span className="text-sm text-[#aaa]">{placeholder}</span>
        )}
        {selectedLabels.map((opt) => (
          <span
            key={opt.value}
            className="flex items-center gap-1 text-xs bg-[#eaf4ff] text-[#1a5276] px-2 py-0.5 rounded-full font-medium"
          >
            {opt.label}
            {!disabled && (
              <button
                type="button"
                onClick={(e) => remove(opt.value, e)}
                className="hover:text-[#c02020] transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
        <ChevronDown className="w-3.5 h-3.5 text-[#888] ml-auto flex-shrink-0" />
      </div>

      {/* Dropdown */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute z-20 mt-1 w-full bg-white rounded-lg border border-[#e0e0e0] shadow-lg max-h-48 overflow-y-auto scrollbar-thin">
            {availableOptions.length === 0 && (
              <p className="px-3 py-2 text-sm text-[#888]">
                {options.length === 0 ? "Sin opciones" : "Todas seleccionadas"}
              </p>
            )}
            {availableOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[#f5f5f5] transition-colors"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
