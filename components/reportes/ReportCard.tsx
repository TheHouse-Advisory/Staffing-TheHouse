import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  titulo: string;
  categoria: string;
  href: string;
  preview?: React.ReactNode;
  /** Clases CSS custom para el área de previsualización (default: "h-40") */
  previewClassName?: string;
}

export function ReportCard({
  icon: Icon,
  iconColor = "#4a90e2",
  iconBg = "bg-[#eaf4ff]",
  titulo,
  categoria,
  href,
  preview,
  previewClassName = "h-40",
}: Props) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col gap-4 shadow-sm hover:shadow-md transition-shadow">
      {/* ── Encabezado ───────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0`}>
          <Icon className="w-5 h-5" style={{ color: iconColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[14px] text-[#1a1a2e] leading-tight">{titulo}</p>
          <span className="inline-block mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-[#4a90e2] bg-[#eaf4ff] px-2 py-0.5 rounded-full">
            {categoria}
          </span>
        </div>
      </div>

      {/* ── Área de previsualización ──────────────────────── */}
      <div className={`bg-slate-50 rounded-lg flex items-center justify-center overflow-hidden ${previewClassName}`}>
        {preview ?? (
          <p className="text-[11px] text-slate-300 font-medium">Vista previa próximamente</p>
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────── */}
      <Link
        href={href}
        className="flex items-center justify-between w-full px-4 py-2 rounded-lg bg-[#f0f6ff] hover:bg-[#dbeafe] transition-colors text-[12px] font-semibold text-[#4a90e2] group"
      >
        Explorar reporte completo
        <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}
