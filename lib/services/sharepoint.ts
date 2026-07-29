/**
 * Conector a Microsoft Graph API para subir/sobrescribir archivos en SharePoint.
 * Usa Client Credentials Flow (app-only, sin usuario interactivo) — pensado
 * para procesos automáticos como el Vercel Cron de respaldo diario.
 *
 * Variables de entorno requeridas:
 *   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
 *   SHAREPOINT_DRIVE_ID, SHAREPOINT_FOLDER_PATH
 */

interface UploadToSharePointParams {
  fileName: string;
  fileBuffer: Buffer;
}

/** Codifica cada segmento de un path (permite espacios y acentos en carpetas/archivos). */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function getGraphAccessToken(): Promise<string> {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "Faltan variables de entorno de Azure AD (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET)."
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(`No se pudo obtener el token de Azure AD (${res.status}): ${detalle}`);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Azure AD respondió sin access_token.");
  }
  return data.access_token;
}

/**
 * Sube (o sobrescribe) un archivo en la carpeta configurada de SharePoint.
 * Un PUT al mismo path reemplaza el archivo existente — no genera copias nuevas.
 */
export async function uploadToSharePoint({ fileName, fileBuffer }: UploadToSharePointParams): Promise<void> {
  const driveId = process.env.SHAREPOINT_DRIVE_ID;
  const folderPath = process.env.SHAREPOINT_FOLDER_PATH;

  if (!driveId || !folderPath) {
    throw new Error(
      "Faltan variables de entorno de SharePoint (SHAREPOINT_DRIVE_ID, SHAREPOINT_FOLDER_PATH)."
    );
  }

  const accessToken = await getGraphAccessToken();
  const rutaDestino = encodePath(`${folderPath}/${fileName}`);
  const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${rutaDestino}:/content`;

  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
    },
    body: new Uint8Array(fileBuffer),
  });

  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(`No se pudo subir "${fileName}" a SharePoint (${res.status}): ${detalle}`);
  }
}
