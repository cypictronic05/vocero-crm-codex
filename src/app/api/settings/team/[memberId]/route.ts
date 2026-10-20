import { z } from "zod";
import { apiError, parseBody, withPermission } from "@/lib/api";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  assignableRoleSchema,
  memberStatusSchema,
  weeklyScheduleSchema,
} from "@/lib/team";
import { TeamServiceError, updateMemberSettings } from "@/server/team/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ memberId: string }> };

const updateSchema = z.object({
  role: assignableRoleSchema,
  status: memberStatusSchema,
  weeklySchedule: weeklyScheduleSchema,
});

export const PATCH = withPermission(PERMISSIONS.TEAM_MANAGE, async (session, req: Request, ctx: Params) => {
  const body = await parseBody(req, updateSchema);
  if (!body.ok) return body.response;
  const { memberId } = await ctx.params;
  try {
    const settings = await updateMemberSettings({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      memberId,
      ...body.data,
    });
    return Response.json({ settings });
  } catch (error) {
    if (error instanceof TeamServiceError) {
      return apiError(
        error.code === "not_found" ? 404 : 409,
        error.code,
        error.message
      );
    }
    throw error;
  }
});
