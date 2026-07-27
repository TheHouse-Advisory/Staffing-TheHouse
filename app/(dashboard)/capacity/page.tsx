import { requireAuth } from "@/lib/auth";
import { CapacityClient } from "./CapacityClient";

export default async function CapacityPage() {
  await requireAuth();
  return <CapacityClient />;
}
