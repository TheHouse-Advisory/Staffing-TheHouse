/**
 * Genera y descarga el Excel de respaldo "Info personas [año]" con la
 * información consolidada de personas (Reportes > Descargables).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getPersonasResguardoInfo } from "@/lib/queries/personas";
import { getAnotaciones, getAnotacionFolders } from "@/lib/queries/anotaciones";
import { buildExcelPersonasResguardo } from "@/lib/utils/excel-resguardo-personas";

export async function POST() {
  // Datos de personas: exclusivo rol "personas" (usa service client, sin RLS)
  const authUser = await requireAuth();
  if (authUser.rol !== "personas") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  try {
    const sb = createServiceClient();
    const [personas, anotaciones, folders] = await Promise.all([
      getPersonasResguardoInfo(sb),
      getAnotaciones(sb as any), // eslint-disable-line @typescript-eslint/no-explicit-any
      getAnotacionFolders(sb as any), // eslint-disable-line @typescript-eslint/no-explicit-any
    ]);
    const buffer = await buildExcelPersonasResguardo(personas, anotaciones, folders);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="Info personas.xlsx"',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
