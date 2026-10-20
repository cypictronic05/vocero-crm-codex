import { describe, expect, it } from "vitest";
import type { MessageDto, MessageMediaDto } from "@/lib/types";
import {
  mergeMediaUpdates,
  pendingMediaIds,
} from "@/components/inbox/media-sync";

const media = (
  assetId: string,
  fetchStatus: MessageMediaDto["fetchStatus"],
  fetchError: string | null = null
): MessageMediaDto => ({
  assetId,
  kind: assetId.includes("doc") ? "document" : "image",
  mimeType: fetchStatus === "available" ? "image/jpeg" : null,
  fileName: assetId.includes("doc") ? "cotizacion.pdf" : null,
  fileSize: fetchStatus === "available" ? 1234 : null,
  caption: null,
  fetchStatus,
  fetchError,
  payload: null,
});

const message = (
  id: string,
  attachment: MessageMediaDto | null,
  text: string | null = null
): MessageDto => ({
  id,
  conversationId: "cv_1",
  direction: "in",
  type: attachment?.kind ?? "text",
  text,
  status: "delivered",
  error: null,
  aiGenerated: false,
  origin: "operator",
  media: attachment,
  createdAt: "2026-10-20T12:00:00.000Z",
});

describe("sincronización de adjuntos de la Bandeja", () => {
  it("recepción: identifica únicamente imagen y documento pendientes", () => {
    const messages = [
      message("msg_text", null, "hola"),
      message("msg_image", media("asset_image", "pending")),
      message("msg_doc", media("asset_doc", "pending")),
      message("msg_ready", media("asset_ready", "available")),
    ];
    expect(pendingMediaIds(messages)).toEqual(["asset_image", "asset_doc"]);
  });

  it("descarga tardía: pending → available actualiza solo el mensaje afectado", () => {
    const untouched = message("msg_text", null, "borrador ya enviado");
    const pending = message("msg_image", media("asset_image", "pending"));
    const next = mergeMediaUpdates([untouched, pending], [
      {
        conversationId: "cv_1",
        messageId: "msg_image",
        media: media("asset_image", "available"),
      },
    ]);
    expect(next[0]).toBe(untouched);
    expect(next[1]?.media?.fetchStatus).toBe("available");
    expect(pendingMediaIds(next)).toEqual([]);
  });

  it("error definitivo: conserva el motivo y detiene el polling", () => {
    const next = mergeMediaUpdates(
      [message("msg_doc", media("asset_doc", "pending"))],
      [
        {
          conversationId: "cv_1",
          messageId: "msg_doc",
          media: media("asset_doc", "failed", "Meta no entregó URL del adjunto"),
        },
      ]
    );
    expect(next[0]?.media).toMatchObject({
      fetchStatus: "failed",
      fetchError: "Meta no entregó URL del adjunto",
    });
    expect(pendingMediaIds(next)).toEqual([]);
  });

  it("reintento: failed → pending → available vuelve a activar y luego apaga el polling", () => {
    const failed = message(
      "msg_image",
      media("asset_image", "failed", "fallo temporal")
    );
    const retrying = mergeMediaUpdates([failed], [
      {
        conversationId: "cv_1",
        messageId: "msg_image",
        media: media("asset_image", "pending"),
      },
    ]);
    expect(pendingMediaIds(retrying)).toEqual(["asset_image"]);

    const ready = mergeMediaUpdates(retrying, [
      {
        conversationId: "cv_1",
        messageId: "msg_image",
        media: media("asset_image", "available"),
      },
    ]);
    expect(ready[0]?.media?.fetchStatus).toBe("available");
    expect(pendingMediaIds(ready)).toEqual([]);
  });

  it("ignora una actualización automática de otra conversación", () => {
    const original = message("msg_image", media("asset_image", "pending"));
    const initial = [original];
    const next = mergeMediaUpdates(initial, [
      {
        conversationId: "cv_otra",
        messageId: "msg_image",
        media: media("asset_image", "available"),
      },
    ]);
    expect(next).toBe(initial);
    expect(next[0]).toBe(original);
    expect(next[0]?.media?.fetchStatus).toBe("pending");
  });
});
