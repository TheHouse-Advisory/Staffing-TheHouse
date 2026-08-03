"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { format, isSameDay, parseISO } from "date-fns";
import { createAnyClient } from "@/lib/supabase/client";
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
  BarChart2,
  ShieldCheck,
  Notebook,
  Plus,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EngagementForm } from "@/components/engagements/EngagementForm";
import type { RolSistema } from "@/lib/types/database";

interface SidebarProps {
  nombreCompleto: string;
  cargo: string | null;
  rol: RolSistema | null;
  /** Última fecha (YYYY-MM-DD) en que ESTE usuario vio la vista de Alertas. Oculta su badge rojo si es hoy. */
  alertasVistaEn: string | null;
  onSignOut: () => void;
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Roles que pueden ver este ítem. Si se omite, visible para todos. */
  allowedRoles?: RolSistema[];
}

const navItems: { section: string; items: NavItem[] }[] = [
  {
    section: "Principal",
    items: [
      { href: "/inicio",      label: "Inicio",    icon: Home,            allowedRoles: ["admin", "GyD", "AySr", "proposer", "planificador"] },
      { href: "/tablero",     label: "Tablero",   icon: LayoutDashboard, allowedRoles: ["admin", "GyD", "AySr", "Desarrollo", "proposer", "planificador"] },
      { href: "/engagements", label: "Proyectos", icon: Briefcase,       allowedRoles: ["admin", "AySr", "proposer", "planificador", "GyD"] },
      { href: "/personas",    label: "Personas",  icon: Users,           allowedRoles: ["admin", "GyD", "AySr", "proposer", "planificador"] },
      { href: "/ausencias",   label: "Ausencias", icon: CalendarOff,     allowedRoles: ["admin", "GyD", "AySr", "Desarrollo", "proposer", "planificador"] },
      { href: "/alertas",     label: "Alertas",   icon: Bell,            allowedRoles: ["admin", "proposer"] },
      { href: "/anotaciones", label: "Anotaciones", icon: Notebook,      allowedRoles: ["admin"] },
      { href: "/reportes",    label: "Reportes",  icon: BarChart2,       allowedRoles: ["admin", "proposer"] },
    ],
  },
  {
    section: "Gestión",
    items: [
      { href: "/planificacion", label: "Planificación", icon: Kanban,      allowedRoles: ["admin", "planificador"] },
      { href: "/capacity",      label: "Capacity",       icon: BarChart3,   allowedRoles: ["admin"] },
      { href: "/accesos",       label: "Accesos",        icon: ShieldCheck, allowedRoles: ["admin"] },
      { href: "/configuracion", label: "Configuración",  icon: Settings,    allowedRoles: ["admin"] },
    ],
  },
];

export function Sidebar({
  nombreCompleto,
  cargo,
  rol,
  alertasVistaEn,
  onSignOut,
  isCollapsed,
  setIsCollapsed,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [engDrawerOpen, setEngDrawerOpen] = useState(false);

  // "Vista hoy" para este usuario: ya lo dice la BD (alertasVistaEn), o está en este momento
  // navegando /alertas (feedback optimista sin esperar el round-trip de la escritura).
  const hoyStr = format(new Date(), "yyyy-MM-dd");
  const alertasVistasPorMi = alertasVistaEn === hoyStr || pathname.startsWith("/alertas");

  // Badge "Alertas": aniversarios, cumpleaños y EPP (fin de proyecto) que caen HOY
  const [alertasHoy, setAlertasHoy] = useState(0);
  useEffect(() => {
    async function cargarAlertasHoy() {
      const sb = createAnyClient();
      const hoy = new Date();
      const hoyStr = format(hoy, "yyyy-MM-dd");

      const [personasRes, engRes] = await Promise.all([
        sb.from("persona").select("id, fecha_ingreso, fecha_nacimiento").eq("activo", true),
        sb.from("engagement").select("id, fecha_fin_estimada, fecha_fin_real, estado"),
      ]);

      let count = 0;
      for (const p of (personasRes.data ?? []) as { fecha_ingreso: string | null; fecha_nacimiento: string | null }[]) {
        if (p.fecha_ingreso) {
          const ingreso = parseISO(p.fecha_ingreso);
          const aniv = new Date(hoy.getFullYear(), ingreso.getMonth(), ingreso.getDate());
          // Incluye años=0 (ingresó hoy mismo) como alerta de bienvenida
          if (isSameDay(aniv, hoy)) count++;
        }
        if (p.fecha_nacimiento) {
          const nac = parseISO(p.fecha_nacimiento);
          const cumple = new Date(hoy.getFullYear(), nac.getMonth(), nac.getDate());
          if (isSameDay(cumple, hoy)) count++;
        }
      }
      for (const e of (engRes.data ?? []) as { fecha_fin_estimada: string | null; fecha_fin_real: string | null; estado: string }[]) {
        if (e.fecha_fin_real === hoyStr) count++;
        else if (e.estado === "activo" && e.fecha_fin_estimada === hoyStr) count++;
      }
      setAlertasHoy(count);
    }
    cargarAlertasHoy();
  }, []);

  const initiales = nombreCompleto
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <aside className={cn(
      "bg-[#1a1a2e] flex flex-col flex-shrink-0 h-screen transition-all duration-150",
      isCollapsed ? "w-16" : "w-[200px]"
    )}>
      {/* Logo + toggle */}
      <div className="px-3 py-[18px] border-b border-white/[0.07] flex items-center justify-between">
        {!isCollapsed && (
          <span className="text-[15px] font-extrabold text-white tracking-tight truncate">
            Staffing<span className="text-[#4a90e2]">Hub</span>
          </span>
        )}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          title={isCollapsed ? "Expandir menú" : "Colapsar menú"}
          className="text-[#a0a8c0] hover:text-white p-1 rounded-md hover:bg-white/[0.07] flex-shrink-0"
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navegación */}
      <nav className="flex-1 overflow-y-auto py-2 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
        {navItems.map((group) => {
          const visibles = group.items.filter(
            (item) => !item.allowedRoles || item.allowedRoles.includes(rol as RolSistema)
          );
          if (visibles.length === 0) return null;
          return (
          <div key={group.section}>
            {!isCollapsed && (
              <p className="px-3 pt-4 pb-1.5 text-[10px] font-bold text-white/30 uppercase tracking-widest">
                {group.section}
              </p>
            )}
            {visibles
              .map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/tablero" && pathname.startsWith(item.href));
              const Icon = item.icon;
              const showPlus = !isCollapsed && item.href === "/engagements" && rol === "admin";

              return (
                <div
                  key={item.href}
                  title={isCollapsed ? item.label : undefined}
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
                    className={cn(
                      "flex items-center gap-2.5 px-4 py-2.5 flex-1 min-w-0",
                      isCollapsed && "justify-center px-0"
                    )}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {!isCollapsed && (
                      <span className="flex justify-between items-center w-full min-w-0">
                        <span className="truncate">{item.label}</span>
                        {item.href === "/alertas" && alertasHoy > 0 && !alertasVistasPorMi && (
                          <span className="ml-2 flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                            {alertasHoy}
                          </span>
                        )}
                      </span>
                    )}
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
          );
        })}
      </nav>

      {/* Usuario */}
      <div className="p-3 border-t border-white/[0.07]">
        <div className={cn("flex items-center gap-2.5 p-2 rounded-[7px] group", isCollapsed && "justify-center")}>
          {/* Avatar */}
          <div className="w-8 h-8 rounded-full bg-[#4a90e2] flex items-center justify-center text-[13px] font-bold text-white flex-shrink-0">
            {initiales}
          </div>
          {!isCollapsed && (
            <>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-white truncate">
                  {nombreCompleto}
                </p>
                <p className="text-[10px] text-[#a0a8c0] truncate">
                  {rol === "admin" ? "Admin" : rol === "GyD" ? "G&D" : rol === "AySr" ? "A&Sr" : rol === "Desarrollo" ? "Desarrollo" : cargo ?? "Equipo"}
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
            </>
          )}
        </div>
        {isCollapsed && (
          <button
            onClick={onSignOut}
            title="Cerrar sesión"
            className="w-full flex items-center justify-center py-2 text-[#a0a8c0] hover:text-white"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <EngagementForm
        open={engDrawerOpen}
        onClose={() => setEngDrawerOpen(false)}
        onSuccess={() => { router.refresh(); }}
      />
    </aside>
  );
}
