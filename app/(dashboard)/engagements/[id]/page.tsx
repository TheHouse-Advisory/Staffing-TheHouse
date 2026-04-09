import type { Metadata } from "next";
import { Topbar } from "@/components/layout/Topbar";
import { EngagementDetail } from "@/components/engagements/EngagementDetail";

interface Props {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = {
  title: "Detalle Engagement",
};

export default async function EngagementDetailPage({ params }: Props) {
  const { id } = await params;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar titulo="Engagement" />
      <div className="flex-1 overflow-auto scrollbar-thin p-6">
        <EngagementDetail id={id} />
      </div>
    </div>
  );
}
