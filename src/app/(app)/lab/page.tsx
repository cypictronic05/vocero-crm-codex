import { redirect } from "next/navigation";
import { LabClient } from "@/components/lab/lab-client";
import { canConfigure } from "@/lib/auth/roles";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  const session = await requireSession();
  if (!canConfigure(session.role)) redirect("/inbox");
  return <LabClient />;
}
