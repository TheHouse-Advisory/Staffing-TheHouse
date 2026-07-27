import { requireAuth } from "@/lib/auth";
import { ResumenProyectosClient } from "./ResumenProyectosClient";

export default async function ResumenProyectosPage() {
  await requireAuth();
  return <ResumenProyectosClient />;
}
