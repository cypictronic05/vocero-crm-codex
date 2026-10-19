import { and, eq } from "drizzle-orm";
import { getDb, getSql, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import {
  AssignmentError,
  ensureConversationAssignment,
  rebalanceMemberAssignments,
  setConversationAssignment,
  sweepConversationAssignments,
} from "@/server/assignments/service";
import {
  canAccessConversation,
  canAccessMediaAsset,
} from "@/server/assignments/access";

const db = getDb();
const organizationId = newId("organization");
const userA = `usr_e2e_${Date.now()}_a`;
const userB = `usr_e2e_${Date.now()}_b`;
const memberA = newId("member");
const memberB = newId("member");
const contactA = newId("contact");
const contactB = newId("contact");
const contactC = newId("contact");
const conversationA = newId("conversation");
const conversationB = newId("conversation");
const conversationC = newId("conversation");
const at = new Date("2026-10-18T17:00:00.000Z");
const schedule = Array.from({ length: 7 }, (_, day) => ({
  day,
  startMinute: 0,
  endMinute: 1439,
}));

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

try {
  await db.insert(schema.organization).values({
    id: organizationId,
    name: "E2E asignaciones",
  });
  await db.insert(schema.user).values([
    {
      id: userA,
      name: "Agente A",
      email: `${userA}@example.invalid`,
      emailVerified: true,
    },
    {
      id: userB,
      name: "Agente B",
      email: `${userB}@example.invalid`,
      emailVerified: true,
    },
  ]);
  await db.insert(schema.member).values([
    {
      id: memberA,
      organizationId,
      userId: userA,
      role: "member",
      weeklySchedule: schedule,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
    {
      id: memberB,
      organizationId,
      userId: userB,
      role: "member",
      weeklySchedule: schedule,
      createdAt: new Date("2026-01-02T00:00:00Z"),
    },
  ]);
  await db.insert(schema.contact).values([
    {
      id: contactA,
      organizationId,
      waIdentity: `e2e:${contactA}`,
      name: "Caso A",
    },
    {
      id: contactB,
      organizationId,
      waIdentity: `e2e:${contactB}`,
      name: "Caso B",
    },
    {
      id: contactC,
      organizationId,
      waIdentity: `e2e:${contactC}`,
      name: "Caso C",
    },
  ]);
  await db.insert(schema.conversation).values([
    {
      id: conversationA,
      organizationId,
      contactId: contactA,
      assignedMemberId: memberA,
      assignedAt: at,
    },
    {
      id: conversationB,
      organizationId,
      contactId: contactB,
    },
  ]);

  await Promise.all([
    ensureConversationAssignment({ organizationId, conversationId: conversationB, at }),
    ensureConversationAssignment({ organizationId, conversationId: conversationB, at }),
  ]);

  let rows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationB));
  assert(rows[0]?.assignedMemberId === memberB, "no eligió a la menor carga");

  const events = await db
    .select()
    .from(schema.conversationAssignmentEvent)
    .where(
      and(
        eq(schema.conversationAssignmentEvent.conversationId, conversationB),
        eq(schema.conversationAssignmentEvent.reason, "automatic")
      )
    );
  assert(events.length === 1, "la concurrencia produjo asignaciones dobles");

  const ownSession = {
    userId: userB,
    memberId: memberB,
    organizationId,
    role: "member",
  };
  const foreignSession = { ...ownSession, userId: userA, memberId: memberA };
  assert(
    await canAccessConversation(ownSession, conversationB),
    "la responsable no puede acceder"
  );
  assert(
    !(await canAccessConversation(foreignSession, conversationB)),
    "una trabajadora accedió a conversación ajena"
  );

  await db
    .update(schema.member)
    .set({ status: "suspended" })
    .where(eq(schema.member.id, memberB));
  await rebalanceMemberAssignments({
    organizationId,
    memberId: memberB,
    reason: "suspended",
    at,
  });
  rows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationB));
  assert(rows[0]?.assignedMemberId === memberA, "la suspensión no hizo relevo");

  let rejectedUnavailable = false;
  try {
    await setConversationAssignment({
      organizationId,
      conversationId: conversationB,
      targetMemberId: memberB,
      actorUserId: userA,
      at,
    });
  } catch (error) {
    rejectedUnavailable =
      error instanceof AssignmentError && error.code === "assignee_unavailable";
  }
  assert(rejectedUnavailable, "aceptó una asignación manual a suspendida");

  await setConversationAssignment({
    organizationId,
    conversationId: conversationB,
    targetMemberId: null,
    actorUserId: userA,
    at,
  });
  await sweepConversationAssignments(at);
  rows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationB));
  assert(
    rows[0]?.assignedMemberId === null,
    "el barrido ignoró una devolución manual a cola"
  );

  await db
    .update(schema.member)
    .set({ status: "suspended" })
    .where(eq(schema.member.id, memberA));
  await db.insert(schema.conversation).values({
    id: conversationC,
    organizationId,
    contactId: contactC,
  });
  await ensureConversationAssignment({
    organizationId,
    conversationId: conversationC,
    at,
  });
  await db
    .update(schema.member)
    .set({ status: "enabled" })
    .where(eq(schema.member.id, memberA));
  await sweepConversationAssignments(at);
  rows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationC));
  assert(
    rows[0]?.assignedMemberId === memberA,
    "un caso pendiente no salió de cola al volver la disponibilidad"
  );

  const assetId = newId("mediaAsset");
  await db.insert(schema.mediaAsset).values({
    id: assetId,
    organizationId,
    kind: "document",
  });
  await db.insert(schema.message).values({
    id: newId("message"),
    organizationId,
    conversationId: conversationC,
    direction: "in",
    mediaAssetId: assetId,
  });
  assert(
    await canAccessMediaAsset(foreignSession, assetId),
    "la responsable no puede consultar su adjunto"
  );
  assert(
    !(await canAccessMediaAsset(ownSession, assetId)),
    "una trabajadora consultó un adjunto ajeno"
  );

  console.log(
    "OK: menor carga, exclusión mutua, autorización, adjuntos, relevo y cola segura"
  );
} finally {
  await db
    .delete(schema.organization)
    .where(eq(schema.organization.id, organizationId));
  await db
    .delete(schema.user)
    .where(eq(schema.user.id, userA));
  await db
    .delete(schema.user)
    .where(eq(schema.user.id, userB));
  await getSql().end();
}
