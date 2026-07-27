import { requireAuth } from "@/lib/auth";
import { InicioClient } from "./InicioClient";

export default async function InicioPage() {
  await requireAuth();
  return <InicioClient />;
}
