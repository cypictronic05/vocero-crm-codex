import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { SendError, sendText } from "@/server/inbox/send";
import {
  AiSendGuardError,
  withAiConversationSendLock,
} from "@/server/ai/eligibility";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  text: z.string().min(1).max(4096),
});

/**
 * Envío del cerebro externo A TRAVÉS del CRM: el token de WhatsApp nunca sale
 * de aquí. Usa el mismo camino que el composer de la bandeja (`sendText`), así
 * que el mensaje queda en el hilo marcado como IA, respeta la ventana de 24 h
 * y hereda el guard de sandbox del Laboratorio.
 *
 * 409 tipados: ai_paused (un humano tomó la conversación) ·
 * outside_bot_shift · window_closed · sandbox_violation.
 */
export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  try {
    const result = await withAiConversationSendLock({
      conversationId: body.data.conversationId,
      organizationId,
      action: () =>
        sendText({
          conversationId: body.data.conversationId,
          organizationId,
          text: body.data.text,
          aiGenerated: true,
        }),
    });
    return Response.json({ messageId: result.messageId });
  } catch (err) {
    if (err instanceof AiSendGuardError) {
      return apiError(err.code === "not_found" ? 404 : 409, err.code, err.message);
    }
    if (err instanceof SendError) {
      if (err.code === "window_closed") {
        return apiError(409, "window_closed", err.message);
      }
      if (err.code === "sandbox_violation") {
        return apiError(409, "sandbox_violation", err.message);
      }
      return apiError(502, err.code, err.message);
    }
    throw err;
  }
}
