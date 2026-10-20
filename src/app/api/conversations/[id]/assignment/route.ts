import { z } from "zod";
import { apiError, parseBody, withPermission } from "@/lib/api";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  AssignmentError,
  setConversationAssignment,
} from "@/server/assignments/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ memberId: z.string().min(1).nullable() });

export const PATCH = withPermission(PERMISSIONS.CONVERSATIONS_ASSIGN, async (session, req: Request, ctx: Params) => {
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const { id } = await ctx.params;
  try {
    const assignment = await setConversationAssignment({
      organizationId: session.organizationId,
      conversationId: id,
      targetMemberId: body.data.memberId,
      actorUserId: session.userId,
    });
    return Response.json({ assignment });
  } catch (error) {
    if (error instanceof AssignmentError) {
      const status =
        error.code === "not_found"
          ? 404
          : error.code === "assignee_unavailable"
            ? 409
            : 422;
      return apiError(status, error.code, error.message);
    }
    throw error;
  }
});
