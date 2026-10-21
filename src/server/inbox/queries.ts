import { and, desc, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isWindowOpen, windowRemainingMs } from "@/server/inbox/window";
import type { ConversationDto } from "@/lib/types";
import type { SessionContext } from "@/lib/auth/session";
import { calcularActividadBandeja } from "@/lib/conversation-order";
import { conversationScope } from "@/server/assignments/access";
import {
  DEFAULT_AI_SCHEDULE,
  isAiScheduleActive,
  type AiSchedule,
} from "@/lib/ai-schedule";
import { humanAttentionState } from "@/lib/human-attention";
import { getOrganizationAiSchedule } from "@/server/ai/schedule";

/**
 * 018 — El anuncio de origen viaja con la conversación. La llave única
 * (organización, conversación) garantiza a lo más una fila por renglón, así
 * que el LEFT JOIN no multiplica la lista.
 */
const anuncioDeLaConversacion = and(
  eq(schema.adAttribution.organizationId, schema.conversation.organizationId),
  eq(schema.adAttribution.conversationId, schema.conversation.id)
);

const anuncioDeLista = {
  id: schema.adAttribution.id,
  headline: schema.adAttribution.headline,
  sourceId: schema.adAttribution.sourceId,
  sourceType: schema.adAttribution.sourceType,
};

function aAnuncioDeLista(
  fila: {
    id: string | null;
    headline: string | null;
    sourceId: string | null;
    sourceType: string | null;
  } | null
): ConversationDto["anuncio"] {
  // Sin fila, drizzle devuelve el objeto con todo en null (o null a secas).
  if (!fila?.id) return null;
  return {
    headline: fila.headline,
    sourceId: fila.sourceId,
    sourceType: fila.sourceType,
  };
}

export async function listConversations(
  session: SessionContext,
  since?: Date
): Promise<ConversationDto[]> {
  const { organizationId } = session;
  const db = getDb();
  const aiSchedule = await getOrganizationAiSchedule(organizationId);
  const previewSql = sql<string | null>`(
    select coalesce(m.text, m.type)
    from message m
    where m.conversation_id = ${schema.conversation.id}
    order by m.created_at desc
    limit 1
  )`;
  const stageSql = sql<string | null>`(
    select s.name from lead l
    join pipeline_stage s on s.id = l.stage_id
    where l.contact_id = ${schema.contact.id}
    limit 1
  )`;
  // Una reasignación vigente compite con el último mensaje. Al volver a cola,
  // assigned_at se ignora para conservar el orden histórico de la cola general.
  const inboxOrderSql = sql<Date>`(
    case
      when ${schema.conversation.assignedMemberId} is not null then greatest(
        coalesce(
          ${schema.conversation.lastMessageAt},
          ${schema.conversation.createdAt}
        ),
        coalesce(${schema.conversation.assignedAt}, ${schema.conversation.createdAt})
      )
      else coalesce(${schema.conversation.lastMessageAt}, ${schema.conversation.createdAt})
    end
  )`;

  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
      preview: previewSql,
      stageName: stageSql,
      anuncio: anuncioDeLista,
      assigneeId: schema.member.id,
      assigneeName: schema.user.name,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .leftJoin(schema.adAttribution, anuncioDeLaConversacion)
    .leftJoin(
      schema.member,
      eq(schema.member.id, schema.conversation.assignedMemberId)
    )
    .leftJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.isTest, false),
        conversationScope(session),
        since ? gt(schema.conversation.updatedAt, since) : undefined
      )
    )
    .orderBy(desc(inboxOrderSql), desc(schema.conversation.id));

  return rows.map((r) =>
    serializeConversation(
      r.conversation,
      r.contact,
      r.preview,
      r.stageName,
      aAnuncioDeLista(r.anuncio),
      r.assigneeId && r.assigneeName
        ? { id: r.assigneeId, name: r.assigneeName }
        : null,
      aiSchedule
    )
  );
}

export async function getConversation(
  session: SessionContext,
  conversationId: string
) {
  const { organizationId } = session;
  const db = getDb();
  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
      anuncio: anuncioDeLista,
      assigneeId: schema.member.id,
      assigneeName: schema.user.name,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .leftJoin(schema.adAttribution, anuncioDeLaConversacion)
    .leftJoin(
      schema.member,
      eq(schema.member.id, schema.conversation.assignedMemberId)
    )
    .leftJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
        ,conversationScope(session)
      )
    )
    .limit(1);
  const row = rows[0];
  return row ? { ...row, anuncio: aAnuncioDeLista(row.anuncio) } : null;
}

export async function listMessages(
  session: SessionContext,
  conversationId: string,
  since?: Date
) {
  const { organizationId } = session;
  const db = getDb();
  return db
    .select({ message: schema.message, media: schema.mediaAsset })
    .from(schema.message)
    .leftJoin(
      schema.mediaAsset,
      eq(schema.message.mediaAssetId, schema.mediaAsset.id)
    )
    .innerJoin(
      schema.conversation,
      eq(schema.conversation.id, schema.message.conversationId)
    )
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, conversationId),
        conversationScope(session),
        since ? gt(schema.message.createdAt, since) : undefined
      )
    )
    .orderBy(schema.message.createdAt);
}

export function serializeConversation(
  c: typeof schema.conversation.$inferSelect,
  contact: typeof schema.contact.$inferSelect,
  preview: string | null = null,
  stageName: string | null = null,
  anuncio: ConversationDto["anuncio"] = null,
  assignee: ConversationDto["assignee"] = null,
  aiSchedule: AiSchedule = DEFAULT_AI_SCHEDULE
): ConversationDto {
  return {
    id: c.id,
    channel: c.channel,
    contact: { id: contact.id, name: contact.name, phone: contact.phone },
    assignee,
    assignmentVersion: c.assignmentVersion,
    assignedAt: c.assignedAt?.toISOString() ?? null,
    inboxOrderAt: calcularActividadBandeja({
      assignedMemberId: c.assignedMemberId,
      assignedAt: c.assignedAt,
      lastMessageAt: c.lastMessageAt,
      createdAt: c.createdAt,
    }).toISOString(),
    stageName,
    aiEnabled: c.aiEnabled,
    handoffAt: c.handoffAt?.toISOString() ?? null,
    handoffReason: c.handoffReason,
    humanInterventionAt: c.humanInterventionAt?.toISOString() ?? null,
    humanAttention: humanAttentionState(c),
    aiSchedule: {
      ...aiSchedule,
      active: isAiScheduleActive(aiSchedule),
    },
    lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    unreadCount: c.unreadCount,
    windowOpen: isWindowOpen(c.lastInboundAt),
    windowRemainingMs: windowRemainingMs(c.lastInboundAt),
    preview,
    anuncio,
  };
}

export async function updateConversation(
  session: SessionContext,
  conversationId: string,
  patch: { aiEnabled?: boolean; reactivate?: boolean; markRead?: boolean }
) {
  const db = getDb();
  const { organizationId } = session;
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.aiEnabled !== undefined) set.aiEnabled = patch.aiEnabled;
  if (patch.reactivate) {
    set.handoffAt = null;
    set.handoffReason = null;
    set.aiEnabled = patch.aiEnabled ?? true;
    set.humanInterventionAt = null;
    set.humanInterventionByMemberId = null;
  }
  if (patch.markRead) set.unreadCount = 0;

  const updated = await db
    .update(schema.conversation)
    .set(set)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, conversationId)
        ,conversationScope(session)
      )
    )
    .returning();
  return updated[0] ?? null;
}
