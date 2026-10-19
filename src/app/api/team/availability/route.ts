import { withAuth } from "@/lib/api";
import { getOperatorAvailability } from "@/server/team/availability";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  return Response.json(await getOperatorAvailability(session), {
    headers: { "Cache-Control": "no-store" },
  });
});
