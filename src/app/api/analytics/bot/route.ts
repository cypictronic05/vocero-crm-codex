import { apiError, withPermission } from "@/lib/api";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PeriodError, periodFromRequest } from "@/server/analytics/period";
import { botBlock } from "@/server/analytics/bot";

export const dynamic = "force-dynamic";

/** 019 — El trabajo del agente. Las citas, solo con la bandera AGENDA. */
export const GET = withPermission(PERMISSIONS.RESULTS_VIEW, async (session, req: Request) => {
  try {
    const period = await periodFromRequest(session.organizationId, new URL(req.url));
    return Response.json(await botBlock(session.organizationId, period));
  } catch (err) {
    if (err instanceof PeriodError) {
      return apiError(422, "invalid_period", err.message);
    }
    throw err;
  }
});
