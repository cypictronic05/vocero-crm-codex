import { and, eq, exists, isNull, or } from "drizzle-orm";
import type { SessionContext } from "@/lib/auth/session";
import { getDb, getSql, schema } from "@/lib/db";
import { assertOperatorCanSend } from "@/server/team/availability";

export class ConversationAccessError extends Error {
  constructor(message = "Conversación no encontrada") {
    super(message);
    this.name = "ConversationAccessError";
  }
}

export function canAccessAssignedConversation(
  session: Pick<SessionContext, "role" | "memberId">,
  assignedMemberId: string | null
): boolean {
  return session.role === "owner" || assignedMemberId === session.memberId;
}

export function conversationScope(session: SessionContext) {
  return session.role === "owner"
    ? undefined
    : eq(schema.conversation.assignedMemberId, session.memberId);
}

/** Contactos visibles para un miembro: solo los de una conversación propia. */
export function contactScope(session: SessionContext) {
  if (session.role === "owner") return undefined;
  return exists(
    getDb()
      .select({ id: schema.conversation.id })
      .from(schema.conversation)
      .where(
        and(
          eq(schema.conversation.organizationId, session.organizationId),
          eq(schema.conversation.contactId, schema.contact.id),
          eq(schema.conversation.isTest, false),
          eq(schema.conversation.assignedMemberId, session.memberId)
        )
      )
  );
}

/** Leads visibles/editables para un miembro: los del contacto de su hilo. */
export function leadScope(session: SessionContext) {
  if (session.role === "owner") return undefined;
  return exists(
    getDb()
      .select({ id: schema.conversation.id })
      .from(schema.conversation)
      .where(
        and(
          eq(schema.conversation.organizationId, session.organizationId),
          eq(schema.conversation.contactId, schema.lead.contactId),
          eq(schema.conversation.isTest, false),
          eq(schema.conversation.assignedMemberId, session.memberId)
        )
      )
  );
}

/**
 * La agenda comparte los bloqueos operativos, pero una cita de cliente solo
 * pertenece a quien tiene asignada su conversación (o, para datos antiguos
 * sin conversationId, una conversación del mismo contacto).
 */
export function bookingScope(session: SessionContext) {
  if (session.role === "owner") return undefined;
  return or(
    eq(schema.booking.kind, "block"),
    exists(
      getDb()
        .select({ id: schema.conversation.id })
        .from(schema.conversation)
        .where(
          and(
            eq(schema.conversation.organizationId, session.organizationId),
            eq(schema.conversation.isTest, false),
            eq(schema.conversation.assignedMemberId, session.memberId),
            or(
              eq(schema.conversation.id, schema.booking.conversationId),
              and(
                isNull(schema.booking.conversationId),
                eq(schema.conversation.contactId, schema.booking.contactId)
              )
            )
          )
        )
    )
  );
}

export async function canAccessConversation(
  session: SessionContext,
  conversationId: string
): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, session.organizationId),
        eq(schema.conversation.id, conversationId),
        conversationScope(session)
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function assertConversationAccess(
  session: SessionContext,
  conversationId: string
): Promise<void> {
  if (!(await canAccessConversation(session, conversationId))) {
    // 404 evita confirmar que el identificador de otra trabajadora existe.
    throw new ConversationAccessError();
  }
}

export async function canAccessContact(
  session: SessionContext,
  contactId: string
): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, session.organizationId),
        eq(schema.contact.id, contactId),
        contactScope(session)
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function canAccessLead(
  session: SessionContext,
  leadId: string
): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(
      and(
        eq(schema.lead.organizationId, session.organizationId),
        eq(schema.lead.id, leadId),
        leadScope(session)
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function canAccessBooking(
  session: SessionContext,
  bookingId: string
): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.booking.id })
    .from(schema.booking)
    .where(
      and(
        eq(schema.booking.organizationId, session.organizationId),
        eq(schema.booking.id, bookingId),
        bookingScope(session)
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function canAccessMediaAsset(
  session: SessionContext,
  assetId: string
): Promise<boolean> {
  if (session.role === "owner") {
    const rows = await getDb()
      .select({ id: schema.mediaAsset.id })
      .from(schema.mediaAsset)
      .where(
        and(
          eq(schema.mediaAsset.organizationId, session.organizationId),
          eq(schema.mediaAsset.id, assetId)
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  const rows = await getDb()
    .select({ id: schema.mediaAsset.id })
    .from(schema.mediaAsset)
    .where(
      and(
        eq(schema.mediaAsset.organizationId, session.organizationId),
        eq(schema.mediaAsset.id, assetId),
        or(
          exists(
            getDb()
              .select({ id: schema.message.id })
              .from(schema.message)
              .innerJoin(
                schema.conversation,
                eq(schema.conversation.id, schema.message.conversationId)
              )
              .where(
                and(
                  eq(schema.message.mediaAssetId, schema.mediaAsset.id),
                  eq(
                    schema.conversation.organizationId,
                    session.organizationId
                  ),
                  eq(schema.conversation.assignedMemberId, session.memberId)
                )
              )
          ),
          exists(
            getDb()
              .select({ id: schema.adAttribution.id })
              .from(schema.adAttribution)
              .innerJoin(
                schema.conversation,
                eq(
                  schema.conversation.id,
                  schema.adAttribution.conversationId
                )
              )
              .where(
                and(
                  eq(
                    schema.adAttribution.imageAssetId,
                    schema.mediaAsset.id
                  ),
                  eq(
                    schema.conversation.organizationId,
                    session.organizationId
                  ),
                  eq(schema.conversation.assignedMemberId, session.memberId)
                )
              )
          )
        )
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Conserva el mismo advisory lock durante la autorización y el envío externo.
 * Un relevo espera a que termine el envío; una operadora anterior no puede
 * pasar la comprobación y responder después de perder la conversación.
 */
export async function withConversationSendLock<T>(
  session: SessionContext,
  conversationId: string,
  action: () => Promise<T>
): Promise<T> {
  const client = await getSql().reserve();
  const key = `conversation:${conversationId}`;
  try {
    await client`select pg_advisory_lock(hashtext(${key}))`;
    // Revalidación dentro del mismo lock: una suspensión o fin de turno que
    // compita con el request no puede dejar pasar un último mensaje.
    await assertOperatorCanSend(session);
    await assertConversationAccess(session, conversationId);
    return await action();
  } finally {
    await client`select pg_advisory_unlock(hashtext(${key}))`;
    client.release();
  }
}
