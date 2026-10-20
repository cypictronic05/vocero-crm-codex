import { and, eq } from "drizzle-orm";
import { getDb, getSql, schema } from "@/lib/db";
import {
  AssignmentError,
  ensureConversationAssignment,
  rebalanceMemberAssignments,
  setConversationAssignment,
  sweepConversationAssignments,
} from "@/server/assignments/service";
import {
  getAssignmentMode,
  updateAssignmentMode,
} from "@/server/assignments/policy";
import { canAccessConversation } from "@/server/assignments/access";
import { canReceiveSseEvent } from "@/server/events/access";
import { publish, subscribe } from "@/server/events/bus";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const db = getDb();
const at = new Date("2026-10-20T17:00:00.000Z");
const allDay = Array.from({ length: 7 }, (_, day) => ({
  day,
  startMinute: 0,
  endMinute: 1439,
}));

const ids = {
  orgA: "org_e2e_fase3_a",
  orgB: "org_e2e_fase3_b",
  ownerUser: "usr_e2e_owner",
  supervisorUser: "usr_e2e_supervisor",
  operatorAUser: "usr_e2e_operator_a",
  operatorBUser: "usr_e2e_operator_b",
  foreignUser: "usr_e2e_foreign",
  owner: "mem_e2e_owner",
  supervisor: "mem_e2e_supervisor",
  operatorA: "mem_e2e_operator_a",
  operatorB: "mem_e2e_operator_b",
  foreign: "mem_e2e_foreign",
  contactLoad: "ct_e2e_load",
  contactAutomatic: "ct_e2e_automatic",
  contactManual: "ct_e2e_manual",
  contactForeign: "ct_e2e_foreign",
  conversationLoad: "cv_e2e_load",
  conversationAutomatic: "cv_e2e_automatic",
  conversationManual: "cv_e2e_manual",
  conversationForeign: "cv_e2e_foreign",
};

const ownerSession = {
  userId: ids.ownerUser,
  memberId: ids.owner,
  organizationId: ids.orgA,
  role: "owner" as const,
};
const supervisorSession = {
  userId: ids.supervisorUser,
  memberId: ids.supervisor,
  organizationId: ids.orgA,
  role: "supervisor" as const,
};
const operatorASession = {
  userId: ids.operatorAUser,
  memberId: ids.operatorA,
  organizationId: ids.orgA,
  role: "member" as const,
};
const operatorBSession = {
  userId: ids.operatorBUser,
  memberId: ids.operatorB,
  organizationId: ids.orgA,
  role: "member" as const,
};

async function conversation(id: string) {
  const rows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, id))
    .limit(1);
  const row = rows[0];
  assert(row, "Conversación inexistente: " + id);
  return row;
}

try {
  await db.insert(schema.organization).values([
    { id: ids.orgA, name: "Nexora E2E aislada" },
    { id: ids.orgB, name: "Otra organización E2E" },
  ]);
  assert(
    (await getAssignmentMode(ids.orgA)) === "automatic",
    "0020 no aplicó el default automatic"
  );

  await db.insert(schema.user).values([
    {
      id: ids.ownerUser,
      name: "Propietario E2E",
      email: "owner-fase3@example.invalid",
      emailVerified: true,
    },
    {
      id: ids.supervisorUser,
      name: "Supervisora E2E",
      email: "supervisor-fase3@example.invalid",
      emailVerified: true,
    },
    {
      id: ids.operatorAUser,
      name: "Operadora A E2E",
      email: "operator-a-fase3@example.invalid",
      emailVerified: true,
    },
    {
      id: ids.operatorBUser,
      name: "Operadora B E2E",
      email: "operator-b-fase3@example.invalid",
      emailVerified: true,
    },
    {
      id: ids.foreignUser,
      name: "Usuario externo E2E",
      email: "foreign-fase3@example.invalid",
      emailVerified: true,
    },
  ]);
  await db.insert(schema.member).values([
    {
      id: ids.owner,
      organizationId: ids.orgA,
      userId: ids.ownerUser,
      role: "owner",
      weeklySchedule: allDay,
    },
    {
      id: ids.supervisor,
      organizationId: ids.orgA,
      userId: ids.supervisorUser,
      role: "supervisor",
      weeklySchedule: allDay,
    },
    {
      id: ids.operatorA,
      organizationId: ids.orgA,
      userId: ids.operatorAUser,
      role: "member",
      weeklySchedule: allDay,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
    {
      id: ids.operatorB,
      organizationId: ids.orgA,
      userId: ids.operatorBUser,
      role: "member",
      weeklySchedule: allDay,
      createdAt: new Date("2026-01-02T00:00:00Z"),
    },
    {
      id: ids.foreign,
      organizationId: ids.orgB,
      userId: ids.foreignUser,
      role: "member",
      weeklySchedule: allDay,
    },
  ]);
  await db.insert(schema.contact).values([
    {
      id: ids.contactLoad,
      organizationId: ids.orgA,
      waIdentity: "e2e:fase3:load",
      name: "Carga previa",
    },
    {
      id: ids.contactAutomatic,
      organizationId: ids.orgA,
      waIdentity: "e2e:fase3:auto",
      name: "Caso automático",
    },
    {
      id: ids.contactManual,
      organizationId: ids.orgA,
      waIdentity: "e2e:fase3:manual",
      name: "Caso manual",
    },
    {
      id: ids.contactForeign,
      organizationId: ids.orgB,
      waIdentity: "e2e:fase3:foreign",
      name: "Caso externo",
    },
  ]);
  await db.insert(schema.conversation).values([
    {
      id: ids.conversationLoad,
      organizationId: ids.orgA,
      contactId: ids.contactLoad,
      assignedMemberId: ids.operatorA,
      assignedAt: at,
    },
    {
      id: ids.conversationAutomatic,
      organizationId: ids.orgA,
      contactId: ids.contactAutomatic,
    },
    {
      id: ids.conversationForeign,
      organizationId: ids.orgB,
      contactId: ids.contactForeign,
      assignedMemberId: ids.foreign,
      assignedAt: at,
    },
  ]);

  const automaticResults = await Promise.all([
    ensureConversationAssignment({
      organizationId: ids.orgA,
      conversationId: ids.conversationAutomatic,
      at,
    }),
    ensureConversationAssignment({
      organizationId: ids.orgA,
      conversationId: ids.conversationAutomatic,
      at,
    }),
  ]);
  assert(
    (await conversation(ids.conversationAutomatic)).assignedMemberId ===
      ids.operatorB,
    "automatic no eligió la menor carga"
  );
  assert(
    automaticResults.filter(Boolean).length === 1,
    "la asignación automática concurrente produjo más de un cambio"
  );

  await updateAssignmentMode({ organizationId: ids.orgA, mode: "manual" });
  await db.insert(schema.conversation).values({
    id: ids.conversationManual,
    organizationId: ids.orgA,
    contactId: ids.contactManual,
  });
  await db.insert(schema.message).values({
    id: "msg_e2e_historico",
    organizationId: ids.orgA,
    conversationId: ids.conversationManual,
    waMessageId: "wamid.e2e.historico",
    direction: "in",
    text: "mensaje histórico intacto",
    status: "delivered",
  });
  await ensureConversationAssignment({
    organizationId: ids.orgA,
    conversationId: ids.conversationManual,
    at,
  });
  assert(
    (await conversation(ids.conversationManual)).assignedMemberId === null,
    "manual asignó una conversación nueva"
  );
  await db.insert(schema.message).values({
    id: "msg_e2e_segundo",
    organizationId: ids.orgA,
    conversationId: ids.conversationManual,
    waMessageId: "wamid.e2e.segundo",
    direction: "in",
    text: "segundo mensaje",
    status: "delivered",
  });
  await ensureConversationAssignment({
    organizationId: ids.orgA,
    conversationId: ids.conversationManual,
    at,
  });
  assert(
    (await conversation(ids.conversationManual)).assignedMemberId === null,
    "un mensaje nuevo sacó una conversación de la cola manual"
  );
  const preserved = await ensureConversationAssignment({
    organizationId: ids.orgA,
    conversationId: ids.conversationAutomatic,
    at,
  });
  assert(
    preserved === null &&
      (await conversation(ids.conversationAutomatic)).assignedMemberId ===
        ids.operatorB,
    "manual no conservó un responsable válido"
  );

  await setConversationAssignment({
    organizationId: ids.orgA,
    conversationId: ids.conversationManual,
    targetMemberId: ids.operatorA,
    actorUserId: ids.supervisorUser,
    at,
  });
  await setConversationAssignment({
    organizationId: ids.orgA,
    conversationId: ids.conversationManual,
    targetMemberId: ids.operatorB,
    actorUserId: ids.supervisorUser,
    at,
  });
  await setConversationAssignment({
    organizationId: ids.orgA,
    conversationId: ids.conversationManual,
    targetMemberId: null,
    actorUserId: ids.supervisorUser,
    at,
  });
  assert(
    (await conversation(ids.conversationManual)).assignedMemberId === null,
    "la supervisora no pudo devolver a cola"
  );
  assert(
    await canAccessConversation(supervisorSession, ids.conversationManual),
    "la supervisora no puede ver la cola"
  );
  assert(
    !(await canAccessConversation(operatorASession, ids.conversationManual)) &&
      !(await canAccessConversation(operatorBSession, ids.conversationManual)),
    "una operadora puede ver la cola"
  );
  assert(
    await canAccessConversation(ownerSession, ids.conversationManual),
    "el propietario no puede ver la cola"
  );

  let crossTenantRejected = false;
  try {
    await setConversationAssignment({
      organizationId: ids.orgA,
      conversationId: ids.conversationForeign,
      targetMemberId: ids.operatorA,
      actorUserId: ids.supervisorUser,
      at,
    });
  } catch (error) {
    crossTenantRejected =
      error instanceof AssignmentError && error.code === "not_found";
  }
  assert(crossTenantRejected, "una organización modificó una conversación ajena");
  assert(
    !(await canAccessConversation(supervisorSession, ids.conversationForeign)),
    "una supervisora leyó otra organización"
  );

  await setConversationAssignment({
    organizationId: ids.orgA,
    conversationId: ids.conversationManual,
    targetMemberId: ids.operatorA,
    actorUserId: ids.supervisorUser,
    at,
  });
  await db
    .update(schema.member)
    .set({ status: "suspended" })
    .where(eq(schema.member.id, ids.operatorA));
  await rebalanceMemberAssignments({
    organizationId: ids.orgA,
    memberId: ids.operatorA,
    reason: "suspended",
    at,
  });
  assert(
    (await conversation(ids.conversationManual)).assignedMemberId === null,
    "la suspensión manual reasignó en vez de devolver a cola"
  );

  await db
    .update(schema.member)
    .set({ status: "enabled", weeklySchedule: allDay })
    .where(eq(schema.member.id, ids.operatorA));
  await setConversationAssignment({
    organizationId: ids.orgA,
    conversationId: ids.conversationManual,
    targetMemberId: ids.operatorA,
    actorUserId: ids.supervisorUser,
    at,
  });
  await db
    .update(schema.member)
    .set({ weeklySchedule: [] })
    .where(eq(schema.member.id, ids.operatorA));
  await rebalanceMemberAssignments({
    organizationId: ids.orgA,
    memberId: ids.operatorA,
    reason: "shift_ended",
    at,
  });
  assert(
    (await conversation(ids.conversationManual)).assignedMemberId === null,
    "el fin de turno manual no devolvió a cola"
  );
  await db
    .update(schema.member)
    .set({ weeklySchedule: allDay })
    .where(eq(schema.member.id, ids.operatorA));

  const beforeConcurrent = await conversation(ids.conversationManual);
  const concurrent = await Promise.all([
    setConversationAssignment({
      organizationId: ids.orgA,
      conversationId: ids.conversationManual,
      targetMemberId: ids.operatorA,
      actorUserId: ids.supervisorUser,
      at,
    }),
    setConversationAssignment({
      organizationId: ids.orgA,
      conversationId: ids.conversationManual,
      targetMemberId: ids.operatorB,
      actorUserId: ids.supervisorUser,
      at,
    }),
  ]);
  const afterConcurrent = await conversation(ids.conversationManual);
  const changes = concurrent.filter(
    (change): change is NonNullable<typeof change> => change !== null
  );
  assert(changes.length === 2, "se perdió una reasignación concurrente");
  const latest = changes.sort(
    (left, right) => right.assignmentVersion - left.assignmentVersion
  )[0]!;
  assert(
    afterConcurrent.assignmentVersion ===
      beforeConcurrent.assignmentVersion + 2 &&
      afterConcurrent.assignedMemberId === latest.toMemberId,
    "la versión final no coincide con la asignación serializada"
  );

  const finalSession =
    afterConcurrent.assignedMemberId === ids.operatorA
      ? operatorASession
      : operatorBSession;
  const otherSession =
    afterConcurrent.assignedMemberId === ids.operatorA
      ? operatorBSession
      : operatorASession;
  assert(
    await canReceiveSseEvent(finalSession, {
      type: "message.new",
      data: { conversationId: ids.conversationManual, message: {} },
    }),
    "SSE no entregó el hilo a su responsable"
  );
  assert(
    !(await canReceiveSseEvent(otherSession, {
      type: "message.new",
      data: { conversationId: ids.conversationManual, message: {} },
    })),
    "SSE filtró un mensaje a una operadora ajena"
  );
  assert(
    await canReceiveSseEvent(supervisorSession, {
      type: "message.new",
      data: { conversationId: ids.conversationManual, message: {} },
    }),
    "SSE no entregó el evento global a supervisora"
  );

  const orgAEvents: string[] = [];
  const orgBEvents: string[] = [];
  const stopA = subscribe(ids.orgA, (event) => orgAEvents.push(event.type));
  const stopB = subscribe(ids.orgB, (event) => orgBEvents.push(event.type));
  publish(ids.orgB, {
    type: "conversation.updated",
    data: { conversation: { id: ids.conversationForeign } },
  });
  stopA();
  stopB();
  assert(
    orgAEvents.length === 0 &&
      orgBEvents.join(",") === "conversation.updated",
    "el bus SSE cruzó organizaciones"
  );

  const historicalBefore = await db
    .select({ id: schema.message.id, text: schema.message.text })
    .from(schema.message)
    .where(eq(schema.message.conversationId, ids.conversationManual));
  await setConversationAssignment({
    organizationId: ids.orgA,
    conversationId: ids.conversationManual,
    targetMemberId: null,
    actorUserId: ids.supervisorUser,
    at,
  });
  await updateAssignmentMode({ organizationId: ids.orgA, mode: "automatic" });
  await sweepConversationAssignments(at, ids.orgA, true);
  assert(
    (await conversation(ids.conversationManual)).assignedMemberId !== null,
    "al volver a automático no se retomó la cola manual"
  );
  const historicalAfter = await db
    .select({ id: schema.message.id, text: schema.message.text })
    .from(schema.message)
    .where(eq(schema.message.conversationId, ids.conversationManual));
  assert(
    JSON.stringify(historicalAfter) === JSON.stringify(historicalBefore),
    "cambiar modalidad alteró el historial de mensajes"
  );

  const assignmentEvents = await db
    .select()
    .from(schema.conversationAssignmentEvent)
    .where(
      and(
        eq(
          schema.conversationAssignmentEvent.organizationId,
          ids.orgA
        ),
        eq(
          schema.conversationAssignmentEvent.conversationId,
          ids.conversationManual
        )
      )
    );
  assert(
    assignmentEvents.some((event) => event.reason === "suspended") &&
      assignmentEvents.some((event) => event.reason === "shift_ended") &&
      assignmentEvents.some((event) => event.reason === "manual"),
    "faltan registros de auditoría de asignaciones"
  );

  console.log(
    JSON.stringify({
      ok: true,
      automaticLeastLoad: true,
      manualQueue: true,
      supervisorAssignments: true,
      memberIsolation: true,
      organizationIsolation: true,
      suspensionAndShiftEnd: true,
      concurrentAssignments: true,
      sseIsolation: true,
      historyPreserved: true,
      automaticResume: true,
      assignmentEvents: assignmentEvents.length,
    })
  );
} finally {
  await getSql().end();
}
