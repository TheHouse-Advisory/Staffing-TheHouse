"use client";

import Link from "next/link";
import { ArrowLeft, Layers } from "lucide-react";
import { CapacitySnapshotReport } from "@/components/reportes/CapacitySnapshotReport";

export default function CapacitySnapshotPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="h-14 bg-white border-b border-[#e8e8e8] flex items-center px-6 gap-3 flex-shrink-0">
        <Link href="/reportes" className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <Layers className="w-4 h-4 text-[#0ea5e9]" />
        <h1 className="text-[16px] font-bold flex-1 text-[#1a1a2e]">Dotación por Mes (Snapshot)</h1>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <CapacitySnapshotReport />
      </div>
    </div>
  );
}
