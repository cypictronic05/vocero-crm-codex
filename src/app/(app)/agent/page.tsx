import { redirect } from "next/navigation";
import { AgentClient } from "@/components/agent/agent-client";
import { canConfigure } from "@/lib/auth/roles";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const session = await requireSession();
  if (!canConfigure(session.role)) redirect("/inbox");
  return <AgentClient />;
}
