import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { graphRequest, MetaApiError } from "@/lib/meta/client";
import {
  getCredentialsByOrg,
  type Credentials,
} from "@/server/whatsapp/credentials";
import { isForbiddenUploadMime } from "@/server/whatsapp/media-headers";
import { publish } from "@/server/events/bus";
import type { MessageMediaDto } from "@/lib/types";

/**
 * 008 — Única frontera de media con la Graph API (constitución II: todo el
 * tráfico a Meta pasa por adaptadores dedicados) + persistencia en el volumen
 * local `MEDIA_DIR`. Meta expira sus archivos (~30 días, URLs de minutos):
 * el disco propio es la copia durable que la UI previsualiza.
 */

export type MediaKind = (typeof schema.mediaAsset.$inferSelect)["kind"];

/** Límites de la Cloud API por tipo (validados ANTES de tocar red, FR-007). */
export const MEDIA_LIMITS: Record<
  Exclude<MediaKind, "location" | "contacts">,
  { maxBytes: number; mimes: RegExp; label: string }
> = {
  image: {
    maxBytes: 5 * 1024 * 1024,
    mimes: /^image\/(jpeg|png|webp)$/,
    label: "imagen (jpeg/png/webp, máx. 5 MB)",
  },
  sticker: {
    maxBytes: 100 * 1024,
    mimes: /^image\/webp$/,
    label: "sticker (webp, máx. 100 KB)",
  },
  audio: {
    maxBytes: 16 * 1024 * 1024,
    mimes: /^audio\/(aac|mp4|mpeg|amr|ogg|opus)/,
    label: "audio (aac/mp4/mpeg/amr/ogg, máx. 16 MB)",
  },
  video: {
    maxBytes: 16 * 1024 * 1024,
    mimes: /^video\/(mp4|3gpp)$/,
    label: "video (mp4/3gpp, máx. 16 MB)",
  },
  document: {
    maxBytes: 100 * 1024 * 1024,
    mimes: /^[\w.-]+\/[\w.+-]+$/,
    label: "documento (máx. 100 MB)",
  },
};

/** Clasifica un MIME de archivo saliente al tipo de mensaje de la Cloud API. */
export function kindFromMime(mime: string): "image" | "audio" | "video" | "document" {
  if (MEDIA_LIMITS.image.mimes.test(mime)) return "image";
  if (MEDIA_LIMITS.audio.mimes.test(mime)) return "audio";
  if (MEDIA_LIMITS.video.mimes.test(mime)) return "video";
  return "document";
}

export class MediaValidationError extends Error {
  code: "too_large" | "unsupported_type";
  constructor(code: MediaValidationError["code"], message: string) {
    super(message);
    this.name = "MediaValidationError";
    this.code = code;
  }
}

/**
 * Valida MIME y tamaño para envío; devuelve el kind resuelto. Los formatos
 * que WhatsApp no acepta como su tipo nativo (p. ej. image/bmp) van como
 * documento — igual que hace la app de WhatsApp. HTML y SVG no van ni como
 * documento (#78): el navegador de quien los abra los trataría como una
 * página, y se servirían desde el origen del CRM.
 */
export function validateOutgoing(mime: string, sizeBytes: number) {
  if (!/^[\w.-]+\/[\w.+-]+$/.test(mime)) {
    throw new MediaValidationError("unsupported_type", "Tipo de archivo no reconocido");
  }
  if (isForbiddenUploadMime(mime)) {
    throw new MediaValidationError(
      "unsupported_type",
      "Los archivos HTML y SVG no se pueden enviar como adjunto: un navegador los abriría como página. Conviértelo a PDF o a imagen"
    );
  }
  const kind = kindFromMime(mime);
  const limit = MEDIA_LIMITS[kind];
  if (sizeBytes > limit.maxBytes) {
    throw new MediaValidationError(
      "too_large",
      `El archivo excede el límite de ${limit.label}`
    );
  }
  return kind;
}

/* ---------- Disco local ---------- */

function assertSafeSegment(s: string): void {
  if (!/^[\w.-]+$/.test(s)) throw new Error(`segmento de ruta inválido: ${s}`);
}

/** Ruta absoluta del archivo de un asset dentro de MEDIA_DIR. */
export function mediaFilePath(organizationId: string, assetId: string): string {
  assertSafeSegment(organizationId);
  assertSafeSegment(assetId);
  return path.join(getEnv().MEDIA_DIR, organizationId, assetId);
}

export async function saveMediaFile(
  organizationId: string,
  assetId: string,
  data: Buffer | Uint8Array
): Promise<string> {
  const file = mediaFilePath(organizationId, assetId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
  return path.join(organizationId, assetId); // ruta relativa persistida en BD
}

export async function readMediaFile(
  organizationId: string,
  assetId: string
): Promise<Buffer> {
  return readFile(mediaFilePath(organizationId, assetId));
}

/**
 * 018 — Borra el archivo de un asset. Sin error si ya no estaba: quien lo
 * llama está deshaciendo una copia que sobró, y un archivo que no existe es
 * justo el estado al que quiere llegar.
 */
export async function deleteMediaFile(
  organizationId: string,
  assetId: string
): Promise<void> {
  await rm(mediaFilePath(organizationId, assetId), { force: true });
}

/* ---------- Descarga desde Graph (entrantes y echoes) ---------- */

type GraphMediaMeta = { url?: string; mime_type?: string; file_size?: number };

export class MediaFetchError extends Error {
  /** true si Meta ya no tiene el archivo (expirado/borrado) — no reintentar. */
  gone: boolean;
  constructor(message: string, gone = false) {
    super(message);
    this.name = "MediaFetchError";
    this.gone = gone;
  }
}

export function serializeMediaAsset(
  media: typeof schema.mediaAsset.$inferSelect
): MessageMediaDto {
  return {
    assetId: media.id,
    kind: media.kind,
    mimeType: media.mimeType,
    fileName: media.fileName,
    fileSize: media.fileSize,
    caption: media.caption,
    fetchStatus: media.fetchStatus,
    fetchError: media.fetchError,
    payload: media.payload,
  };
}

/** Avisa solo a la conversación/burbuja dueña del asset ya confirmado en BD. */
async function publishMediaUpdate(
  organizationId: string,
  asset: typeof schema.mediaAsset.$inferSelect
): Promise<void> {
  try {
    const rows = await getDb()
      .select({ id: schema.message.id, conversationId: schema.message.conversationId })
      .from(schema.message)
      .where(
        and(
          eq(schema.message.organizationId, organizationId),
          eq(schema.message.mediaAssetId, asset.id)
        )
      )
      .limit(1);
    const message = rows[0];
    if (!message) return;
    publish(organizationId, {
      type: "message.media",
      data: {
        conversationId: message.conversationId,
        messageId: message.id,
        media: serializeMediaAsset(asset),
      },
    });
  } catch (err) {
    // El archivo ya quedó confirmado en BD: un fallo del canal en vivo no
    // debe degradarlo a `failed`; el polling acotado hará el catch-up.
    console.warn(
      `[media] no se pudo publicar el estado del asset ${asset.id}:`,
      err instanceof Error ? err.message : err
    );
  }
}

const downloads = new Map<
  string,
  Promise<typeof schema.mediaAsset.$inferSelect | null>
>();

/**
 * Descarga un media de Graph: GET {mediaId} → url efímera → GET con Bearer.
 * El token JAMÁS sale del servidor.
 */
export async function downloadGraphMedia(
  token: string,
  waMediaId: string,
  maxBytes: number = MEDIA_LIMITS.document.maxBytes
): Promise<{ data: Buffer; mimeType: string | null; fileSize: number }> {
  let meta: GraphMediaMeta;
  try {
    meta = await graphRequest<GraphMediaMeta>(waMediaId, { token });
  } catch (err) {
    const gone = err instanceof MetaApiError && err.status === 404;
    throw new MediaFetchError("Meta no entregó la metadata del adjunto", gone);
  }
  if (!meta.url) throw new MediaFetchError("Meta no entregó URL del adjunto");
  if (meta.file_size && meta.file_size > maxBytes) {
    throw new MediaFetchError("El adjunto excede el límite de tamaño", true);
  }

  let res: Response;
  try {
    res = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new MediaFetchError("No se pudo descargar el adjunto");
  }
  if (!res.ok) {
    throw new MediaFetchError(
      `La descarga devolvió ${res.status}`,
      res.status === 404 || res.status === 410
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new MediaFetchError("El adjunto excede el límite de tamaño", true);
  }
  return {
    data: buf,
    mimeType: meta.mime_type ?? res.headers.get("content-type"),
    fileSize: buf.byteLength,
  };
}

/**
 * Garantiza que el asset esté en disco (`fetchStatus=available`).
 * Se usa en la descarga in-process post-ingesta Y on-demand desde la ruta de
 * media. Nunca lanza hacia el webhook: el que llama decide qué hacer con el
 * resultado. Devuelve el asset actualizado o null si no se pudo.
 */
async function ensureAssetAvailableOnce(
  organizationId: string,
  assetId: string
): Promise<typeof schema.mediaAsset.$inferSelect | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.mediaAsset)
    .where(eq(schema.mediaAsset.id, assetId))
    .limit(1);
  const asset = rows[0];
  if (!asset || asset.organizationId !== organizationId) return null;
  if (asset.fetchStatus === "available") return asset;
  if (!asset.waMediaId) return null; // location/contacts no tienen binario

  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) {
    const failed = await db
      .update(schema.mediaAsset)
      .set({
        fetchStatus: "failed",
        fetchError: "WhatsApp no está conectado",
        updatedAt: new Date(),
      })
      .where(eq(schema.mediaAsset.id, assetId))
      .returning();
    if (failed[0]) await publishMediaUpdate(organizationId, failed[0]);
    return null;
  }

  try {
    const { data, mimeType, fileSize } = await downloadGraphMedia(
      creds.token,
      asset.waMediaId
    );
    const storagePath = await saveMediaFile(organizationId, assetId, data);
    const updated = await db
      .update(schema.mediaAsset)
      .set({
        storagePath,
        mimeType: asset.mimeType ?? mimeType,
        fileSize,
        fetchStatus: "available",
        fetchError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.mediaAsset.id, assetId))
      .returning();
    if (updated[0]) await publishMediaUpdate(organizationId, updated[0]);
    return updated[0] ?? null;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Un error de filesystem puede contener la ruta absoluta de /data; el
    // operador necesita una acción clara, no detalles internos del servidor.
    const message =
      err instanceof MediaFetchError
        ? err.message
        : "No se pudo descargar o guardar el adjunto";
    const failed = await db
      .update(schema.mediaAsset)
      .set({ fetchStatus: "failed", fetchError: message, updatedAt: new Date() })
      .where(eq(schema.mediaAsset.id, assetId))
      .returning();
    if (failed[0]) await publishMediaUpdate(organizationId, failed[0]);
    console.warn(`[media] descarga del asset ${assetId} falló: ${detail}`);
    return null;
  }
}

/**
 * Deduplica descargas simultáneas (ingesta, polling y reintento manual pueden
 * coincidir) y libera la llave al terminar para permitir un reintento real.
 */
export function ensureAssetAvailable(
  organizationId: string,
  assetId: string
): Promise<typeof schema.mediaAsset.$inferSelect | null> {
  const key = `${organizationId}:${assetId}`;
  const current = downloads.get(key);
  if (current) return current;
  const run = ensureAssetAvailableOnce(organizationId, assetId).finally(() => {
    downloads.delete(key);
  });
  downloads.set(key, run);
  return run;
}

/** Reinicia explícitamente un asset fallido y notifica ambos estados. */
export async function retryAssetDownload(
  organizationId: string,
  assetId: string
): Promise<typeof schema.mediaAsset.$inferSelect | null> {
  const pending = await getDb()
    .update(schema.mediaAsset)
    .set({ fetchStatus: "pending", fetchError: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.mediaAsset.organizationId, organizationId),
        eq(schema.mediaAsset.id, assetId),
        eq(schema.mediaAsset.fetchStatus, "failed")
      )
    )
    .returning();
  if (!pending[0]) return null;
  await publishMediaUpdate(organizationId, pending[0]);
  const result = await ensureAssetAvailable(organizationId, assetId);
  if (result) return result;
  const latest = await getDb()
    .select()
    .from(schema.mediaAsset)
    .where(
      and(
        eq(schema.mediaAsset.organizationId, organizationId),
        eq(schema.mediaAsset.id, assetId)
      )
    )
    .limit(1);
  return latest[0] ?? null;
}

/* ---------- Subida a Graph (salientes) ---------- */

/**
 * Sube un archivo a Graph (`POST /{phone_number_id}/media`, multipart) y
 * devuelve el media id para usar en /messages. Errores → MetaApiError (la
 * capa de envío los traduce con las mismas reglas que el texto).
 */
export async function uploadGraphMedia(
  credentials: Credentials,
  file: { data: Buffer | Uint8Array; mimeType: string; fileName?: string }
): Promise<string> {
  const env = getEnv();
  const url = `${env.META_GRAPH_BASE_URL}/${env.META_GRAPH_API_VERSION}/${credentials.phoneNumberId}/media`;
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", file.mimeType);
  const bytes = new Uint8Array(file.data);
  form.set(
    "file",
    new Blob([bytes], { type: file.mimeType }),
    file.fileName ?? "adjunto"
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.token}` },
      body: form,
    });
  } catch (cause) {
    throw new MetaApiError("No se pudo contactar la API de Meta", {
      status: 0,
      details: cause,
    });
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: number; type?: string } })
      ?.error;
    throw new MetaApiError(err?.message ?? `Meta respondió ${res.status}`, {
      status: res.status,
      code: err?.code ?? null,
      type: err?.type ?? null,
      details: json ?? text,
    });
  }
  const id = (json as { id?: string })?.id;
  if (!id) {
    throw new MetaApiError("Meta no devolvió ID del media subido", {
      status: res.status,
    });
  }
  return id;
}
