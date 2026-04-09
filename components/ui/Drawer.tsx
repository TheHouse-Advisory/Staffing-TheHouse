"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Ancho del panel. Default: "md" (480px) */
  width?: "sm" | "md" | "lg";
  /** Footer fijo con botones de acción */
  footer?: React.ReactNode;
}

const widthClasses = {
  sm: "w-[380px]",
  md: "w-[480px]",
  lg: "w-[600px]",
};

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = "md",
  footer,
}: DrawerProps) {
  // Bloquear scroll del body mientras el drawer está abierto
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Cerrar con Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={cn(
          "relative ml-auto h-full bg-white shadow-2xl flex flex-col",
          widthClasses[width]
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-[#e8e8e8] flex-shrink-0">
          <div>
            <h2 className="text-[16px] font-bold text-[#1a1a1a]">{title}</h2>
            {subtitle && (
              <p className="text-sm text-[#888] mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-[#f5f5f5] text-[#888] hover:text-[#1a1a1a] transition-colors mt-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Contenido scrolleable */}
        <div className="flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">
          {children}
        </div>

        {/* Footer fijo */}
        {footer && (
          <div className="flex-shrink-0 px-6 py-4 border-t border-[#e8e8e8] bg-[#fafafa] flex items-center justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
