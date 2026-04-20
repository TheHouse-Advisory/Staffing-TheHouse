import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EngagementDetailRedirect({ params }: Props) {
  const { id } = await params;
  redirect(`/proyectos/${id}`);
}
