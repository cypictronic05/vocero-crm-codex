import { after } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { canAccessMediaAsset } from "@/server/assignments/access";
import {
  ensureAssetAvailable,
  serializeMediaAsset,
} from "@/server/whatsapp/media";

export const dynamic = "force-dynamic";

const ASSET_ID = /^[\w.-]{1,64}$/;
const MAX_ASSETS = 50;

/**
 * Fallback acotado del SSE: la Bandeja manda únicamente los asset IDs que aún
 * ve pendientes. La respuesta trae solo esas burbujas, nunca el hilo entero.
 */
export const GET = withAuth(async (session, req: Request) => {
  const raw = new URL(req.url).searchParams.get("ids") ?? "";
  const ids = [...new Set(raw.split(",").filter(Boolean))];
  if (!ids.length || ids.length > MAX_ASSETS || ids.some((id) => !ASSET_ID.test(id))) {
    return apiError(422, "invalid", "ids de adjuntos inválidos");
  }

  const allowed = (
    await Promise.all(
      ids.map(async (id) => ((await canAccessMediaAsset(session, id)) ? id : null))
    )
  ).filter((id): id is string => id !== null);
  if (!allowed.length) return Response.json({ updates: [] });

  const rows = await getDb()
    .select({ message: schema.message, media: schema.mediaAsset })
    .from(schema.message)
    .innerJoin(schema.mediaAsset, eq(schema.message.mediaAssetId, schema.mediaAsset.id))
    .where(
      and(
        eq(schema.message.organizationId, session.organizationId),
        inArray(schema.mediaAsset.id, allowed)
      )
    );

  const pending = rows.filter((row) => row.media.fetchStatus === "pending");
  if (pending.length) {
    // También recupera descargas que quedaron pendientes tras un reinicio.
    after(() =>
      Promise.all(
        pending.map((row) =>
          ensureAssetAvailable(session.organizationId, row.media.id)
        )
      ).then(() => undefined)
    );
  }

  return Response.json({
    updates: rows.map((row) => ({
      conversationId: row.message.conversationId,
      messageId: row.message.id,
      media: serializeMediaAsset(row.media),
    })),
  });
});
