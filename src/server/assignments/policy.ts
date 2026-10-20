import { eq, sql } from "drizzle-orm";
import {
  assignmentModeSchema,
  type AssignmentMode,
} from "@/lib/assignment-mode";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export class AssignmentPolicyError extends Error {
  constructor(
    public readonly code: "not_found",
    message: string
  ) {
    super(message);
    this.name = "AssignmentPolicyError";
  }
}

export async function getAssignmentMode(
  organizationId: string
): Promise<AssignmentMode> {
  const rows = await getDb()
    .select({ assignmentMode: schema.organization.assignmentMode })
    .from(schema.organization)
    .where(scoped(schema.organization.id, organizationId))
    .limit(1);
  const organization = rows[0];
  if (!organization) {
    throw new AssignmentPolicyError(
      "not_found",
      "Organización no encontrada"
    );
  }
  return assignmentModeSchema.parse(organization.assignmentMode);
}

/**
 * Comparte el lock de organización con selección y relevos. Al terminar el
 * commit, ningún cálculo iniciado bajo la política anterior sigue pendiente.
 * No toca conversaciones ni mensajes.
 */
export async function updateAssignmentMode(input: {
  organizationId: string;
  mode: AssignmentMode;
}): Promise<AssignmentMode> {
  const mode = assignmentModeSchema.parse(input.mode);
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`assignment-org:${input.organizationId}`}))`
    );
    const updated = await tx
      .update(schema.organization)
      .set({ assignmentMode: mode })
      .where(eq(schema.organization.id, input.organizationId))
      .returning({ assignmentMode: schema.organization.assignmentMode });
    const organization = updated[0];
    if (!organization) {
      throw new AssignmentPolicyError(
        "not_found",
        "Organización no encontrada"
      );
    }
    return assignmentModeSchema.parse(organization.assignmentMode);
  });
}
