"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Briefcase,
  Users,
  Settings,
  LogOut,
  Kanban,
  CalendarOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RolSistema } from "@/lib/types/database";

interface SidebarProps {
  nombreCompleto: string;
  cargo: string | null;
  rol: RolSistema | null;
  onSignOut: () => void;
}

const navItems = [
  {
    section: "Principal",
    items: [
      { href: "/tablero",   label: "Tablero",   icon: LayoutDashboard },
      { href: "/engagements", label: "Engagements", icon: Briefcase },
      { href: "/personas",  label: "Personas",  icon: Users },
      { href: "/ausencias", label: "Ausencias", icon: CalendarOff },
    ],
  },
  {
    section: "Gestión",
    items: [
      { href: "/planificacion",  label: "Planificación",  icon: Kanban },
      { href: "/configuracion",  label: "Configuración",  icon: Settings },
    ],
  },
];

export function Sidebar({
  nombreCompleto,
  cargo,
  rol,
  onSignOut,
}: SidebarProps) {
  const pathname = usePathname();

  const initiales = nombreCompleto
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <aside className="w-[200px] bg-[#1a1a2e] flex flex-col flex-shrink-0 h-screen">
      {/* Logo */}
      <div className="px-5 py-[18px] border-b border-white/[0.07]">
        <span className="text-[15px] font-extrabold text-white tracking-tight">
          Staffing<span className="text-[#4a90e2]">Hub</span>
        </span>
      </div>

      {/* Navegación */}
      <nav className="flex-1 overflow-y-auto py-2">
        {navItems.map((group) => (
          <div key={group.section}>
            <p className="px-3 pt-4 pb-1.5 text-[10px] font-bold text-white/30 uppercase tracking-widest">
              {group.section}
            </p>
            {group.items.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/tablero" && pathname.startsWith(item.href));
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 px-4 py-2.5 mx-2 my-px rounded-[7px]",
                    "text-[13px] transition-all duration-150",
                    isActive
                      ? "bg-[#4a90e2]/20 text-white"
                      : "text-[#a0a8c0] hover:bg-white/[0.07] hover:text-white"
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Usuario */}
      <div className="p-3 border-t border-white/[0.07]">
        <div className="flex items-center gap-2.5 p-2 rounded-[7px] group">
          {/* Avatar */}
          <div className="w-8 h-8 rounded-full bg-[#4a90e2] flex items-center justify-center text-[13px] font-bold text-white flex-shrink-0">
            {initiales}
          </div>
          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-white truncate">
              {nombreCompleto}
            </p>
            <p className="text-[10px] text-[#a0a8c0] truncate">
              {rol === "admin" ? "Admin" : cargo ?? "Equipo"}
            </p>
          </div>
          {/* Logout */}
          <button
            onClick={onSignOut}
            title="Cerrar sesión"
            className="text-[#a0a8c0] hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
