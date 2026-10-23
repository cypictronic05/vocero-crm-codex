import { describe, expect, it } from "vitest";
import { contenidoEntrante, mediaInputFrom } from "@/server/inbox/ingest";
import { AUDIO_WRITING_ACK, isInboundAudio, requiresHumanMediaReview } from "@/server/ai/media-safety";
import type { WebhookMessage } from "@/server/inbox/webhook";

describe("notas de voz sin transcripción automática", () => {
  const audio: WebhookMessage = {
    id: "wamid.audio.test",
    from: "573000000000",
    timestamp: "1792627200",
    type: "audio",
    audio: { id: "media_audio_test", mime_type: "audio/ogg", voice: true },
  };

  it("reconoce audio/voice, conserva el adjunto y no fabrica texto", () => {
    expect(contenidoEntrante(audio)).toEqual({ type: "audio", text: null });
    expect(mediaInputFrom(audio)).toMatchObject({
      kind: "audio",
      waMediaId: "media_audio_test",
      mimeType: "audio/ogg",
    });
    expect(isInboundAudio({ direction: "in", type: "audio" })).toBe(true);
  });

  it("usa un único mensaje fijo sin escalar ni alterar comprobantes", () => {
    expect(AUDIO_WRITING_ACK).toBe(
      "🎤 ¡Recibí tu nota de voz!\n\nPor ahora puedo ayudarte mejor por escrito. 📝\n\n¿Podrías escribirme tu consulta? Así podré ayudarte con mayor precisión. 💙"
    );
    expect(requiresHumanMediaReview([{ direction: "in", type: "audio" }])).toBe(false);
    expect(requiresHumanMediaReview([{ direction: "in", type: "image" }])).toBe(true);
    expect(requiresHumanMediaReview([{ direction: "in", type: "document" }])).toBe(true);
  });
});
