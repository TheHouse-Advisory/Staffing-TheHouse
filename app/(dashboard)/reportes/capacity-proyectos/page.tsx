import { requireAuth } from "@/lib/auth";
import { CapacityProyectosClient } from "./CapacityProyectosClient";

export default async function CapacityProyectosPage() {
  await requireAuth();
  return <CapacityProyectosClient />;
}
