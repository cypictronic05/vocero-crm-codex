import { z } from "zod";
import { apiError, parseBody, withPermission } from "@/lib/api";
import { getAuth, runInternalSignup } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/auth/permissions";
import { assignableRoleSchema } from "@/lib/team";
import { createTeamMembership, listTeamMembers } from "@/server/team/service";

export const dynamic = "force-dynamic";

export const GET = withPermission(PERMISSIONS.TEAM_VIEW, async (session) => {
  const canManage = hasPermission(session.role, PERMISSIONS.TEAM_MANAGE);
  const members = await listTeamMembers(session.organizationId);
  return Response.json({
    members: canManage
      ? members
      : members.map(({ id, role, status, name, availability }) => ({
          id,
          role,
          status,
          name,
          availability,
        })),
    canManage,
  });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  role: assignableRoleSchema.default("member"),
});

/** Alta de cuenta de equipo (owner only): email + contraseña temporal (FR-061). */
export const POST = withPermission(PERMISSIONS.TEAM_MANAGE, async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const auth = getAuth();
  let newUserId: string;
  try {
    const result = await runInternalSignup(() =>
      auth.api.signUpEmail({
        body: {
          name: body.data.name,
          email: body.data.email,
          password: body.data.password,
        },
      })
    );
    newUserId = result.user.id;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "No se pudo crear la cuenta";
    if (/exist/i.test(message)) {
      return apiError(409, "duplicate", "Ya existe una cuenta con ese correo");
    }
    return apiError(422, "invalid", message);
  }

  await createTeamMembership({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    userId: newUserId,
    role: body.data.role ?? "member",
  });

  return Response.json({ ok: true }, { status: 201 });
});
