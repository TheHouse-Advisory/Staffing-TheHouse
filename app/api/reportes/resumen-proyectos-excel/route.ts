/**
 * Sincroniza el Excel único de "Resumen de Proyectos" (Supabase Storage)
 * y devuelve el archivo actualizado para descarga directa.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { syncExcelResumenProyectos } from "@/lib/utils/excel-sync";

export async function POST() {
  const authUser = await requireAuth();
  if (authUser.rol !== "admin" && authUser.rol !== "planificador") {
    return NextResponse.json({ error: "Sin permisos para sincronizar el Excel." }, { status: 403 });
  }

  try {
    const sb = createServiceClient();
    const { buffer } = await syncExcelResumenProyectos(sb);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="Resumen-Proyectos-Staffing.xlsx"',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
