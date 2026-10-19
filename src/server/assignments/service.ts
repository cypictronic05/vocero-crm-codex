import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import {
  evaluateOperatorAvailability,
  memberStatusSchema,
  weeklyScheduleSchema,
} from "@/lib/team";
import { publish } from "@/server/events/bus";
import { pickLeastLoadedMember } from "@/lib/assignment";

export type AssignmentReason =
  | "automatic"
  | "manual"
  | "suspended"
  | "shift_ended"
  | "queued_no_available";

export type AssignmentChange = {
  conversationId: string;
  fromMemberId: string | null;
  toMemberId: string | null;
  assignmentVersion: number;
  reason: AssignmentReason;
};

export class AssignmentError extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "invalid_assignee"
      | "assignee_unavailable",
    message: string
  ) {
    super(message);
    this.name = "AssignmentError";
  }
}

type AssignmentInput = {
  organizationId: string;
  conversationId: string;
  reason: AssignmentReason;
  actorUserId?: string;
  targetMemberId?: string | null;
  excludeMemberId?: string;
  at?: Date;
};

function announce(organizationId: string, change: AssignmentChange | null) {
  if (!change) return;
  publish(organizationId, {
    type: "conversation.assignment",
    data: change,
  });
}

/**
 * Única puerta de escritura para el responsable. El lock de organización
 * serializa el cálculo de carga y el de conversación coordina relevos/envíos.
 */
async function assign(input: AssignmentInput): Promise<AssignmentChange | null> {
  const at = input.at ?? new Date();
  const change = await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`assignment-org:${input.organizationId}`}))`
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`conversation:${input.conversationId}`}))`
    );

    const conversations = await tx
      .select({
        id: schema.conversation.id,
        assignedMemberId: schema.conversation.assignedMemberId,
        assignmentVersion: schema.conversation.assignmentVersion,
        isTest: schema.conversation.isTest,
      })
      .from(schema.conversation)
      .where(
        and(
          eq(schema.conversation.organizationId, input.organizationId),
          eq(schema.conversation.id, input.conversationId)
        )
      )
      .limit(1);
    const conversation = conversations[0];
    if (!conversation) {
      throw new AssignmentError("not_found", "Conversación no encontrada");
    }
    if (conversation.isTest) return null;

    const memberRows = await tx
      .select({
        id: schema.member.id,
        role: schema.member.role,
        status: schema.member.status,
        weeklySchedule: schema.member.weeklySchedule,
        createdAt: schema.member.createdAt,
      })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, input.organizationId),
          eq(schema.member.role, "member")
        )
      )
      .orderBy(asc(schema.member.createdAt), asc(schema.member.id));

    const available = memberRows.filter((member) => {
      if (member.id === input.excludeMemberId) return false;
      return evaluateOperatorAvailability({
        role: member.role,
        status: memberStatusSchema.parse(member.status),
        schedule: weeklyScheduleSchema.parse(member.weeklySchedule),
        at,
      }).canSend;
    });

    let targetMemberId: string | null;
    if (input.targetMemberId !== undefined) {
      targetMemberId = input.targetMemberId;
      if (targetMemberId !== null) {
        const target = memberRows.find((member) => member.id === targetMemberId);
        if (!target) {
          throw new AssignmentError(
            "invalid_assignee",
            "La trabajadora no pertenece a esta organización"
          );
        }
        if (!available.some((member) => member.id === targetMemberId)) {
          throw new AssignmentError(
            "assignee_unavailable",
            "La trabajadora está suspendida o fuera de turno"
          );
        }
      }
    } else {
      // Si el responsable actual sigue disponible no se mueve: esto evita
      // relevar una conversación cada vez que entra un mensaje.
      if (
        conversation.assignedMemberId &&
        available.some((member) => member.id === conversation.assignedMemberId)
      ) {
        return null;
      }

      const availableIds = available.map((member) => member.id);
      const loads = new Map<string, number>();
      if (availableIds.length > 0) {
        const loadRows = await tx
          .select({
            memberId: schema.conversation.assignedMemberId,
            amount: sql<number>`count(*)::int`,
          })
          .from(schema.conversation)
          .leftJoin(
            schema.lead,
            eq(schema.lead.contactId, schema.conversation.contactId)
          )
          .leftJoin(
            schema.pipelineStage,
            eq(schema.pipelineStage.id, schema.lead.stageId)
          )
          .where(
            and(
              eq(schema.conversation.organizationId, input.organizationId),
              eq(schema.conversation.isTest, false),
              inArray(schema.conversation.assignedMemberId, availableIds),
              or(
                isNull(schema.lead.id),
                eq(schema.pipelineStage.kind, "open")
              )
            )
          )
          .groupBy(schema.conversation.assignedMemberId);
        for (const row of loadRows) {
          if (row.memberId) loads.set(row.memberId, row.amount);
        }
      }
      targetMemberId = pickLeastLoadedMember(available, loads);
    }

    const fromMemberId = conversation.assignedMemberId;
    const effectiveReason: AssignmentReason = targetMemberId
      ? input.reason
      : input.reason === "manual"
        ? "manual"
        : "queued_no_available";

    if (fromMemberId === targetMemberId) {
      if (targetMemberId !== null) return null;
      const previous = await tx
        .select({ reason: schema.conversationAssignmentEvent.reason })
        .from(schema.conversationAssignmentEvent)
        .where(
          and(
            eq(
              schema.conversationAssignmentEvent.organizationId,
              input.organizationId
            ),
            eq(
              schema.conversationAssignmentEvent.conversationId,
              input.conversationId
            )
          )
        )
        .orderBy(desc(schema.conversationAssignmentEvent.createdAt))
        .limit(1);
      if (previous[0]?.reason === "queued_no_available") return null;
    }

    const assignmentVersion = conversation.assignmentVersion + 1;
    await tx
      .update(schema.conversation)
      .set({
        assignedMemberId: targetMemberId,
        assignedAt: at,
        assignmentVersion,
        updatedAt: at,
      })
      .where(
        and(
          eq(schema.conversation.organizationId, input.organizationId),
          eq(schema.conversation.id, input.conversationId)
        )
      );
    await tx.insert(schema.conversationAssignmentEvent).values({
      id: newId("conversationAssignmentEvent"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      fromMemberId,
      toMemberId: targetMemberId,
      reason: effectiveReason,
      actorUserId: input.actorUserId ?? null,
    });
    return {
      conversationId: input.conversationId,
      fromMemberId,
      toMemberId: targetMemberId,
      assignmentVersion,
      reason: effectiveReason,
    };
  });
  announce(input.organizationId, change);
  return change;
}

export function ensureConversationAssignment(input: {
  organizationId: string;
  conversationId: string;
  at?: Date;
}) {
  return assign({ ...input, reason: "automatic" });
}

export function setConversationAssignment(input: {
  organizationId: string;
  conversationId: string;
  targetMemberId: string | null;
  actorUserId: string;
  at?: Date;
}) {
  return assign({ ...input, reason: "manual" });
}

export async function rebalanceMemberAssignments(input: {
  organizationId: string;
  memberId: string;
  reason: "suspended" | "shift_ended";
  at?: Date;
}): Promise<number> {
  const rows = await getDb()
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .leftJoin(schema.lead, eq(schema.lead.contactId, schema.conversation.contactId))
    .leftJoin(
      schema.pipelineStage,
      eq(schema.pipelineStage.id, schema.lead.stageId)
    )
    .where(
      and(
        eq(schema.conversation.organizationId, input.organizationId),
        eq(schema.conversation.assignedMemberId, input.memberId),
        eq(schema.conversation.isTest, false),
        or(isNull(schema.lead.id), eq(schema.pipelineStage.kind, "open"))
      )
    );
  let changed = 0;
  for (const row of rows) {
    const result = await assign({
      organizationId: input.organizationId,
      conversationId: row.id,
      reason: input.reason,
      excludeMemberId: input.memberId,
      at: input.at,
    });
    if (result) changed += 1;
  }
  return changed;
}

export async function sweepConversationAssignments(at = new Date()) {
  const rows = await getDb()
    .select({
      id: schema.conversation.id,
      organizationId: schema.conversation.organizationId,
    })
    .from(schema.conversation)
    .leftJoin(schema.lead, eq(schema.lead.contactId, schema.conversation.contactId))
    .leftJoin(
      schema.pipelineStage,
      eq(schema.pipelineStage.id, schema.lead.stageId)
    )
    .where(
      and(
        eq(schema.conversation.isTest, false),
        or(isNull(schema.lead.id), eq(schema.pipelineStage.kind, "open")),
        or(
          isNotNull(schema.conversation.assignedMemberId),
          sql`(
            select cae.reason
            from conversation_assignment_event cae
            where cae.conversation_id = ${schema.conversation.id}
              and cae.organization_id = ${schema.conversation.organizationId}
            order by cae.created_at desc
            limit 1
          ) = 'queued_no_available'`
        )
      )
    );
  let changed = 0;
  for (const row of rows) {
    const result = await ensureConversationAssignment({
      organizationId: row.organizationId,
      conversationId: row.id,
      at,
    });
    if (result) changed += 1;
  }
  return changed;
}
