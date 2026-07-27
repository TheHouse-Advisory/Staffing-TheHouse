import { requireAuth } from "@/lib/auth";
import { CapacitySnapshotClient } from "./CapacitySnapshotClient";

export default async function CapacitySnapshotPage() {
  await requireAuth();
  return <CapacitySnapshotClient />;
}
