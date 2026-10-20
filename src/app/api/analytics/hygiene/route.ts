import { withPermission } from "@/lib/api";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getBranding } from "@/server/branding";
import { hygieneBlock } from "@/server/analytics/hygiene";

export const dynamic = "force-dynamic";

/** 019 — Higiene. Sin rango: describe el AHORA, no un periodo. */
export const GET = withPermission(PERMISSIONS.RESULTS_VIEW, async (session) => {
  const branding = await getBranding(session.organizationId);
  return Response.json(await hygieneBlock(session.organizationId, branding.currency));
});
