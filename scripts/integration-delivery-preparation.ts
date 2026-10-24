import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { archiveDelivery, previewDelivery, restoreDelivery } from "@/server/delivery/preparation";
import { ingestInboundMessage } from "@/server/inbox/ingest";

const db = getDb();
const url = process.env.DATABASE_URL!;
const mediaDir = process.env.MEDIA_DIR!;
const checks: string[] = [];

function ok(name: string, value: boolean) {
  if (!value) throw new Error(`FAIL: ${name}`);
  checks.push(name);
}

async function seed(prefix: string) {
  console.log(`seed:${prefix}`);
  const orgId = `${prefix}-org`;
  const userId = `${prefix}-user`;
  const memberId = `${prefix}-member`;
  const contactId = `${prefix}-contact`;
  const conversationId = `${prefix}-conversation`;
  const messageId = `${prefix}-message`;
  const assetId = `${prefix}-asset`;
  const assignmentId = `${prefix}-assignment`;
  await db.insert(schema.user).values({ id: userId, name: "Harness Owner", email: `${prefix}@example.test` });
  await db.insert(schema.organization).values({ id: orgId, name: `Harness ${prefix}`, slug: `${prefix}-slug`, aiScheduleStartMinute: 0, aiScheduleEndMinute: 1, aiScheduleTimeZone: "UTC" });
  await db.insert(schema.member).values({ id: memberId, organizationId: orgId, userId, role: "supervisor" });
  await db.insert(schema.contact).values({ id: contactId, organizationId: orgId, waIdentity: `${prefix}-identity`, name: "Contacto ficticio" });
  const old = new Date(Date.now() - 60_000);
  await db.insert(schema.conversation).values({ id: conversationId, organizationId: orgId, contactId, aiEnabled: true, assignedMemberId: memberId, assignedAt: old, lastInboundAt: old, lastMessageAt: old, updatedAt: old });
  await db.insert(schema.conversationAssignmentEvent).values({ id: assignmentId, organizationId: orgId, conversationId, toMemberId: memberId, reason: "manual", actorUserId: userId });
  await db.insert(schema.mediaAsset).values({ id: assetId, organizationId: orgId, kind: "document", mimeType: "text/plain", fileName: `${prefix}.txt`, fileSize: 23, storagePath: `${prefix}.txt`, fetchStatus: "available" });
  await db.insert(schema.message).values({ id: messageId, organizationId: orgId, conversationId, direction: "in", type: "document", text: "adjunto de prueba", status: "delivered", mediaAssetId: assetId, waMessageId: `${prefix}-wa-seed`, waTimestamp: old });
  return { orgId, userId, memberId, contactId, conversationId, messageId, assetId, assignmentId, identity: `${prefix}-identity` };
}

async function attachmentScenario() {
  console.log("scenario:attachments");
  const s = await seed(`attach-${Date.now()}`);
  const path = join(mediaDir, `${s.orgId}.txt`);
  const body = `fixture-${s.orgId}-contenido`;
  await writeFile(path, body, "utf8");
  await db.update(schema.mediaAsset).set({ storagePath: `${s.orgId}.txt`, fileSize: Buffer.byteLength(body) }).where(eq(schema.mediaAsset.id, s.assetId));
  const before = await readFile(path);
  const hash = createHash("sha256").update(before).digest("hex");
  const session = { userId: s.userId, memberId: s.memberId, organizationId: s.orgId, role: "owner" as const };
  const preview = await previewDelivery(s.orgId);
  ok("preview counts contacts/conversations/messages/attachments", preview.affected.contacts === 1 && preview.affected.conversations === 1 && preview.affected.messages === 1 && preview.affected.attachments === 1);
  await archiveDelivery(session);
  const archived = await db.select().from(schema.conversation).where(eq(schema.conversation.id, s.conversationId));
  ok("archive marks conversation", archived[0]?.archivedAt instanceof Date);
  ok("physical attachment survives archive", (await readFile(path, "utf8")) === body);
  await restoreDelivery(session);
  const restored = await db.select().from(schema.conversation).where(eq(schema.conversation.id, s.conversationId));
  const asset = await db.select().from(schema.mediaAsset).where(eq(schema.mediaAsset.id, s.assetId));
  ok("restore clears archive", restored[0]?.archivedAt === null);
  ok("attachment SHA/path/reference survives restore", createHash("sha256").update(await readFile(path)).digest("hex") === hash && asset[0]?.storagePath === `${s.orgId}.txt` && asset[0]?.id === s.assetId);
  await rm(path, { force: true });
}

async function concurrencyScenario() {
  console.log("scenario:concurrency");
  const a = await seed(`race-a-${Date.now()}`);
  const b = await seed(`race-b-${Date.now()}`);
  const session = { userId: a.userId, memberId: a.memberId, organizationId: a.orgId, role: "owner" as const };
  const before = await db.select({ assignedMemberId: schema.conversation.assignedMemberId, aiEnabled: schema.conversation.aiEnabled }).from(schema.conversation).where(eq(schema.conversation.id, a.conversationId));
  const lock = postgres(url, { max: 1, connection: { TimeZone: "UTC" } });
  const lockKey = `delivery:${a.orgId}`;
  console.log("race:lock");
  await lock.unsafe(`select pg_advisory_lock(hashtext('${lockKey.replaceAll("'", "''")}'))`);
  console.log("race:archive-start");
  const archivePromise = archiveDelivery(session);
  console.log("race:ingest-1");
  try { await ingestInboundMessage({ organizationId: a.orgId, identity: { channel: "whatsapp", identity: a.identity, phone: "+573001234567", waUserId: null, profileName: null }, waMessageId: `${a.orgId}-inbound`, type: "text", text: "mensaje entrante", timestamp: String(Math.floor(Date.now() / 1000)), media: null, threadRef: null, anuncio: null }); } catch (error) { console.error("race:ingest-error", error); throw error; }
  console.log("race:ingest-2");
  await ingestInboundMessage({ organizationId: a.orgId, identity: { channel: "whatsapp", identity: a.identity, phone: "+573001234567", waUserId: null, profileName: null }, waMessageId: `${a.orgId}-inbound`, type: "text", text: "mensaje entrante", timestamp: String(Math.floor(Date.now() / 1000)), media: null, threadRef: null, anuncio: null });
  await lock.unsafe(`select pg_advisory_unlock(hashtext('${lockKey.replaceAll("'", "''")}'))`);
  await archivePromise;
  await lock.end({ timeout: 5 });
  const rows = await db.select().from(schema.conversation).where(eq(schema.conversation.id, a.conversationId));
  const messages = await db.select().from(schema.message).where(eq(schema.message.organizationId, a.orgId));
  ok("concurrent inbound preserved and reopens conversation", rows[0]?.archivedAt === null && messages.some((m) => m.waMessageId === `${a.orgId}-inbound`));
  ok("waMessageId deduplication", messages.filter((m) => m.waMessageId === `${a.orgId}-inbound`).length === 1);
  ok("assignment and AI state preserved", rows[0]?.assignedMemberId === before[0]?.assignedMemberId && rows[0]?.aiEnabled === before[0]?.aiEnabled);
  const other = await db.select().from(schema.conversation).where(eq(schema.conversation.organizationId, b.orgId));
  ok("organization isolation", other[0]?.archivedAt === null);
  const reverseSession = { userId: b.userId, memberId: b.memberId, organizationId: b.orgId, role: "owner" as const };
  await archiveDelivery(reverseSession);
  await ingestInboundMessage({ organizationId: b.orgId, identity: { channel: "whatsapp", identity: b.identity, phone: "+573009876543", waUserId: null, profileName: null }, waMessageId: `${b.orgId}-inbound`, type: "text", text: "mensaje posterior", timestamp: String(Math.floor(Date.now() / 1000)), media: null, threadRef: null, anuncio: null });
  const reverseRows = await db.select().from(schema.conversation).where(eq(schema.conversation.id, b.conversationId));
  const reverseMessages = await db.select().from(schema.message).where(eq(schema.message.organizationId, b.orgId));
  ok("archive-first then inbound reopens", reverseRows[0]?.archivedAt === null && reverseMessages.some((m) => m.waMessageId === `${b.orgId}-inbound`));
  await db.delete(schema.organization).where(and(eq(schema.organization.id, a.orgId)));
  await db.delete(schema.organization).where(and(eq(schema.organization.id, b.orgId)));
}

await mkdir(mediaDir, { recursive: true });
await attachmentScenario();
await concurrencyScenario();
console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
