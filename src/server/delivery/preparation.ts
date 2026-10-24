import { and, count, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { SessionContext } from "@/lib/auth/session";

export type DeliveryPreview = {
  organizationId: string;
  generatedAt: string;
  affected: { contacts: number; conversations: number; messages: number; attachments: number; leads: number; assignments: number; bookings: number };
  preserved: string[];
  warning: string;
};

const PRESERVED = ["usuarios, roles y credenciales", "organización y configuración", "WhatsApp, webhooks y tokens", "tasas y cotizaciones", "auditorías e historial de asignaciones", "archivos físicos y configuración de almacenamiento"];

export async function previewDelivery(organizationId: string): Promise<DeliveryPreview> {
  const db = getDb();
  const contacts = await db.select({ id: schema.contact.id }).from(schema.contact).where(and(eq(schema.contact.organizationId, organizationId), isNull(schema.contact.archivedAt)));
  const contactIds = contacts.map((x) => x.id);
  const conversations = contactIds.length ? await db.select({ id: schema.conversation.id }).from(schema.conversation).where(and(eq(schema.conversation.organizationId, organizationId), inArray(schema.conversation.contactId, contactIds), isNull(schema.conversation.archivedAt))) : [];
  const conversationIds = conversations.map((x) => x.id);
  const [messages, attachments, leads, assignments, bookings] = await Promise.all([
    conversationIds.length ? db.select({ n: count() }).from(schema.message).where(and(eq(schema.message.organizationId, organizationId), inArray(schema.message.conversationId, conversationIds))) : [{ n: 0 }],
    conversationIds.length ? db.select({ n: count() }).from(schema.message).where(and(eq(schema.message.organizationId, organizationId), inArray(schema.message.conversationId, conversationIds), sql`${schema.message.mediaAssetId} is not null`)) : [{ n: 0 }],
    contactIds.length ? db.select({ n: count() }).from(schema.lead).where(and(eq(schema.lead.organizationId, organizationId), inArray(schema.lead.contactId, contactIds), isNull(schema.lead.archivedAt))) : [{ n: 0 }],
    conversationIds.length ? db.select({ n: count() }).from(schema.conversationAssignmentEvent).where(and(eq(schema.conversationAssignmentEvent.organizationId, organizationId), inArray(schema.conversationAssignmentEvent.conversationId, conversationIds))) : [{ n: 0 }],
    conversationIds.length ? db.select({ n: count() }).from(schema.booking).where(and(eq(schema.booking.organizationId, organizationId), inArray(schema.booking.conversationId, conversationIds))) : [{ n: 0 }],
  ]);
  return { organizationId, generatedAt: new Date().toISOString(), affected: { contacts: contactIds.length, conversations: conversationIds.length, messages: Number(messages[0]?.n ?? 0), attachments: Number(attachments[0]?.n ?? 0), leads: Number(leads[0]?.n ?? 0), assignments: Number(assignments[0]?.n ?? 0), bookings: Number(bookings[0]?.n ?? 0) }, preserved: PRESERVED, warning: "La ejecución archiva solo filas sin actividad posterior al instante de la vista previa; no elimina datos." };
}

export async function archiveDelivery(session: SessionContext) {
  const db = getDb();
  const archivedAt = new Date();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`delivery:${session.organizationId}`}))`);
    const active = await tx.select({ id: schema.conversation.id }).from(schema.conversation).where(and(eq(schema.conversation.organizationId, session.organizationId), isNull(schema.conversation.archivedAt), lte(schema.conversation.lastMessageAt, archivedAt)));
    const ids = active.map((x) => x.id);
    if (ids.length) await tx.update(schema.conversation).set({ archivedAt, updatedAt: archivedAt }).where(and(eq(schema.conversation.organizationId, session.organizationId), inArray(schema.conversation.id, ids), isNull(schema.conversation.archivedAt), lte(schema.conversation.lastMessageAt, archivedAt)));
    const contacts = await tx.select({ id: schema.contact.id }).from(schema.contact).where(and(eq(schema.contact.organizationId, session.organizationId), isNull(schema.contact.archivedAt), sql`not exists (select 1 from conversation c where c.contact_id = ${schema.contact.id} and c.organization_id = ${session.organizationId} and c.archived_at is null)`));
    if (contacts.length) await tx.update(schema.contact).set({ archivedAt, updatedAt: archivedAt }).where(and(eq(schema.contact.organizationId, session.organizationId), inArray(schema.contact.id, contacts.map((x) => x.id)), isNull(schema.contact.archivedAt)));
    await tx.update(schema.lead).set({ archivedAt, updatedAt: archivedAt }).where(and(eq(schema.lead.organizationId, session.organizationId), isNull(schema.lead.archivedAt), sql`not exists (select 1 from contact c where c.id = ${schema.lead.contactId} and c.archived_at is null)`));
    await tx.insert(schema.deliveryPreparationEvent).values({ id: newId("deliveryPreparationEvent"), organizationId: session.organizationId, actorUserId: session.userId, action: "archived", details: { archivedAt: archivedAt.toISOString(), conversations: ids.length, contacts: contacts.length } });
    return { archivedAt: archivedAt.toISOString(), conversations: ids.length, contacts: contacts.length };
  });
}

export async function restoreDelivery(session: SessionContext) {
  const db = getDb();
  const now = new Date();
  const conversations = await db.update(schema.conversation).set({ archivedAt: null, updatedAt: now }).where(and(eq(schema.conversation.organizationId, session.organizationId), sql`${schema.conversation.archivedAt} is not null`)).returning({ id: schema.conversation.id });
  const contacts = await db.update(schema.contact).set({ archivedAt: null, updatedAt: now }).where(and(eq(schema.contact.organizationId, session.organizationId), sql`${schema.contact.archivedAt} is not null`)).returning({ id: schema.contact.id });
  await db.update(schema.lead).set({ archivedAt: null, updatedAt: now }).where(and(eq(schema.lead.organizationId, session.organizationId), sql`${schema.lead.archivedAt} is not null`));
  await db.insert(schema.deliveryPreparationEvent).values({ id: newId("deliveryPreparationEvent"), organizationId: session.organizationId, actorUserId: session.userId, action: "restored", details: { restoredAt: now.toISOString(), conversations: conversations.length, contacts: contacts.length } });
  return { conversations: conversations.length, contacts: contacts.length };
}
