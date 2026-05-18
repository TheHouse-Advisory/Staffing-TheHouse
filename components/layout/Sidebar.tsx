"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Briefcase,
  Users,
  Settings,
  LogOut,
  Kanban,
  CalendarOff,
  Home,
  Bell,
  BarChart3,
  ShieldCheck,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EngagementForm } from "@/components/engagements/EngagementForm";
import type { RolSistema } from "@/lib/types/database";

interface SidebarProps {
  nombreCompleto: string;
  cargo: string | null;
  rol: RolSistema | null;
  onSignOut: () => void;
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Solo visible para personas con rol admin. */
  adminOnly?: boolean;
}

const navItems: { section: string; items: NavItem[] }[] = [
  {
    section: "Principal",
    items: [
      { href: "/inicio",    label: "Inicio",    icon: Home },
      { href: "/tablero",   label: "Tablero",   icon: LayoutDashboard },
      { href: "/engagements", label: "Engagements", icon: Briefcase },
      { href: "/personas",  label: "Personas",  icon: Users },
      { href: "/ausencias", label: "Ausencias", icon: CalendarOff },
      { href: "/alertas",   label: "Alertas",   icon: Bell },
    ],
  },
  {
    section: "Gestión",
    items: [
      { href: "/planificacion",  label: "Planificación",  icon: Kanban },
      { href: "/capacity",       label: "Capacity",       icon: BarChart3 },
      { href: "/accesos",        label: "Accesos",        icon: ShieldCheck, adminOnly: true },
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
  const router = useRouter();
  const [engDrawerOpen, setEngDrawerOpen] = useState(false);

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
      <nav className="flex-1 overflow-y-auto py-2 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
        {navItems.map((group) => (
          <div key={group.section}>
            <p className="px-3 pt-4 pb-1.5 text-[10px] font-bold text-white/30 uppercase tracking-widest">
              {group.section}
            </p>
            {group.items
              .filter((item) => !item.adminOnly || rol === "admin")
              .map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/tablero" && pathname.startsWith(item.href));
              const Icon = item.icon;
              const showPlus = item.href === "/engagements" && rol === "admin";

              return (
                <div
                  key={item.href}
                  className={cn(
                    "group flex items-center mx-2 my-px rounded-[7px]",
                    "text-[13px] transition-all duration-150",
                    isActive
                      ? "bg-[#4a90e2]/20 text-white"
                      : "text-[#a0a8c0] hover:bg-white/[0.07] hover:text-white"
                  )}
                >
                  <Link
                    href={item.href}
                    className="flex items-center gap-2.5 px-4 py-2.5 flex-1 min-w-0"
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                  {showPlus && (
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEngDrawerOpen(true); }}
                      title="Nuevo engagement"
                      className="opacity-0 group-hover:opacity-100 transition-opacity pr-3 py-2.5 hover:text-white"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
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

      <EngagementForm
        open={engDrawerOpen}
        onClose={() => setEngDrawerOpen(false)}
        onSuccess={() => { router.refresh(); }}
      />
    </aside>
  );
}
