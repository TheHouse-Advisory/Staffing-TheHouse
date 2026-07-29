/**
 * Vercel Cron: genera "Info personas [año].xlsx" y "Respaldo staffing [año].xlsx"
 * en memoria y los sobrescribe en SharePoint (Microsoft Graph). Protegido con
 * CRON_SECRET — solo Vercel Cron (o alguien con el secreto) puede invocarlo.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPersonasResguardoInfo } from "@/lib/queries/personas";
import { getAnotaciones, getAnotacionFolders } from "@/lib/queries/anotaciones";
import { buildExcelPersonasResguardo } from "@/lib/utils/excel-resguardo-personas";
import { syncExcelResumenProyectos } from "@/lib/utils/excel-sync";
import { uploadToSharePoint } from "@/lib/services/sharepoint";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ success: false, error: "No autorizado." }, { status: 401 });
  }

  try {
    const anio = new Date().getFullYear();
    const sb = createServiceClient();

    const [personas, anotaciones, folders] = await Promise.all([
      getPersonasResguardoInfo(sb),
      getAnotaciones(sb as any), // eslint-disable-line @typescript-eslint/no-explicit-any
      getAnotacionFolders(sb as any), // eslint-disable-line @typescript-eslint/no-explicit-any
    ]);
    const infoPersonasBuffer = await buildExcelPersonasResguardo(personas, anotaciones, folders);
    const { buffer: respaldoStaffingBuffer } = await syncExcelResumenProyectos(sb);

    const infoPersonasFileName = `Info personas ${anio}.xlsx`;
    const respaldoStaffingFileName = `Respaldo staffing ${anio}.xlsx`;

    await uploadToSharePoint({ fileName: infoPersonasFileName, fileBuffer: infoPersonasBuffer });
    await uploadToSharePoint({ fileName: respaldoStaffingFileName, fileBuffer: respaldoStaffingBuffer });

    return NextResponse.json({
      success: true,
      updatedFiles: [infoPersonasFileName, respaldoStaffingFileName],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
