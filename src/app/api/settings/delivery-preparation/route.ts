import { z } from "zod";
import { apiError, parseBody, withPermission } from "@/lib/api";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { archiveDelivery, previewDelivery, restoreDelivery } from "@/server/delivery/preparation";
import { createHash } from "node:crypto";
import { getDb, schema } from "@/lib/db";
import { and, eq, inArray, isNull } from "drizzle-orm";

export const dynamic = "force-dynamic";

export const GET = withPermission(PERMISSIONS.ORGANIZATION_CONFIGURE, async (session) => Response.json(await previewDelivery(session.organizationId)));

export const PUT = withPermission(PERMISSIONS.ORGANIZATION_CONFIGURE, async (session) => {
  const db = getDb();
  const contacts = await db.select({ id: schema.contact.id, name: schema.contact.name, channel: schema.contact.channel, archivedAt: schema.contact.archivedAt }).from(schema.contact).where(and(eq(schema.contact.organizationId, session.organizationId), isNull(schema.contact.archivedAt)));
  const contactIds = contacts.map((x) => x.id);
  const conversations = contactIds.length ? await db.select({ id: schema.conversation.id, contactId: schema.conversation.contactId, channel: schema.conversation.channel, archivedAt: schema.conversation.archivedAt }).from(schema.conversation).where(and(eq(schema.conversation.organizationId, session.organizationId), inArray(schema.conversation.contactId, contactIds), isNull(schema.conversation.archivedAt))) : [];
  const conversationIds = conversations.map((x) => x.id);
  const messages = conversationIds.length ? await db.select({ id: schema.message.id, conversationId: schema.message.conversationId, direction: schema.message.direction, type: schema.message.type, status: schema.message.status, createdAt: schema.message.createdAt }).from(schema.message).where(and(eq(schema.message.organizationId, session.organizationId), inArray(schema.message.conversationId, conversationIds))) : [];
  const leads = contactIds.length ? await db.select({ id: schema.lead.id, contactId: schema.lead.contactId, stageId: schema.lead.stageId, archivedAt: schema.lead.archivedAt }).from(schema.lead).where(and(eq(schema.lead.organizationId, session.organizationId), inArray(schema.lead.contactId, contactIds), isNull(schema.lead.archivedAt))) : [];
  const payload = { manifest: { format: "cocuyo-delivery-backup", version: 1, organizationId: session.organizationId, generatedAt: new Date().toISOString(), counts: { contacts: contacts.length, conversations: conversations.length, messages: messages.length, leads: leads.length }, excludes: ["passwords", "tokens", "credentials", "message text", "attachment binaries"] }, contacts, conversations, messages, leads };
  const canonical = JSON.stringify(payload);
  const integrity = createHash("sha256").update(canonical).digest("hex");
  const body = JSON.stringify({ ...payload, manifest: { ...payload.manifest, sha256: integrity } }, null, 2);
  return new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="cocuyo-delivery-${session.organizationId}.json"`, "x-backup-sha256": integrity } });
});

const actionSchema = z.object({ action: z.enum(["archive", "restore"]), confirm: z.literal(true) });

export const POST = withPermission(PERMISSIONS.ORGANIZATION_CONFIGURE, async (session, request) => {
  const body = await parseBody(request as Request, actionSchema);
  if (!body.ok) return body.response;
  try {
    return Response.json(body.data.action === "archive" ? await archiveDelivery(session) : await restoreDelivery(session));
  } catch (error) {
    return apiError(409, "delivery_preparation_failed", error instanceof Error ? error.message : "No se pudo preparar la entrega");
  }
});
