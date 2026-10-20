import { z } from "zod";
import { apiError, parseBody, withPermission } from "@/lib/api";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { assignmentModeSchema } from "@/lib/assignment-mode";
import {
  AssignmentPolicyError,
  updateAssignmentMode,
} from "@/server/assignments/policy";
import { sweepConversationAssignments } from "@/server/assignments/service";

export const dynamic = "force-dynamic";

const updateSchema = z.object({ mode: assignmentModeSchema });

export const PUT = withPermission(
  PERMISSIONS.TEAM_MANAGE,
  async (session, req: Request) => {
    const body = await parseBody(req, updateSchema);
    if (!body.ok) return body.response;
    try {
      const assignmentMode = await updateAssignmentMode({
        organizationId: session.organizationId,
        mode: body.data.mode,
      });
      // Al volver a automático, la cola se retoma inmediatamente. Cada
      // asignación revalida el modo dentro del mismo lock, por lo que cambiar
      // otra vez a manual mientras corre este barrido es seguro.
      if (assignmentMode === "automatic") {
        await sweepConversationAssignments(
          new Date(),
          session.organizationId,
          true
        );
      }
      return Response.json({ assignmentMode });
    } catch (error) {
      if (error instanceof AssignmentPolicyError) {
        return apiError(404, error.code, error.message);
      }
      throw error;
    }
  }
);
