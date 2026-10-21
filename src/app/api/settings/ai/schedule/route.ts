import { apiError, parseBody, withPermission } from "@/lib/api";
import { aiScheduleSchema } from "@/lib/ai-schedule";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { updateOrganizationAiSchedule } from "@/server/ai/schedule";

export const dynamic = "force-dynamic";

export const PUT = withPermission(
  PERMISSIONS.AI_CONFIGURE,
  async (session, req: Request) => {
    const body = await parseBody(req, aiScheduleSchema);
    if (!body.ok) return body.response;
    const horario = await updateOrganizationAiSchedule({
      organizationId: session.organizationId,
      schedule: body.data,
    });
    return horario
      ? Response.json({ horario })
      : apiError(404, "not_found", "Organización no encontrada");
  }
);
