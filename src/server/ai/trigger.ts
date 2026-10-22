import { scheduleAgentTurn } from "@/server/ai/pipeline";
import { isAiConfiguredFor } from "@/lib/ai/provider";
import { despachoActivo } from "@/server/brains/config";
import { despacharAlCerebro } from "@/server/dispatch/encolar";
import { isAiScheduleActive } from "@/lib/ai-schedule";
import { getOrganizationAiSchedule } from "@/server/ai/schedule";
import { isExchangeRateIntent } from "@/server/exchange-rates/conversation";
import { exchangeRatesEnabled } from "@/server/exchange-rates/flag";
import { organizationRatesEnabled } from "@/server/exchange-rates/service";

/**
 * Punto de enganche del turno tras la ingesta de un mensaje entrante REAL (las
 * conversaciones del Laboratorio invocan el pipeline directamente, sin
 * debounce).
 *
 * 021 — Con un cerebro configurado (`BRAIN_DISPATCH_URL` + `BOT_API_KEY`) el
 * turno no se piensa aquí: se encola un despacho y el worker se lo entrega. Los
 * dos caminos son excluyentes: mientras el despacho está activo el agente
 * incluido no contesta, tenga o no proveedor de IA e interruptor encendido. Es
 * lo que evita la doble respuesta sin depender de que alguien se acuerde de
 * apagar uno.
 *
 * 025 — `messageId` es el entrante que provoca el turno. Quien lo lleve —el
 * despacho en su fila, el agente incluido en su coalesce— lo anota como algo
 * que DEBE: si el cliente escribe mientras se piensa la respuesta a lo
 * anterior, ese mensaje queda detrás de ella y sin la nota se da por atendido.
 */
export async function maybeRunAgentTurn(
  conversationId: string,
  organizationId: string,
  messageId: string,
  messageText: string | null = null,
  at: Date = new Date()
): Promise<void> {
  // 028 — De día la conversación ya fue asignada a una persona por la fase 2.
  // El mensaje queda en PostgreSQL; no se crea trabajo para ningún bot.
  const schedule = await getOrganizationAiSchedule(organizationId);
  if (!isAiScheduleActive(schedule, at)) return;
  if (despachoActivo()) {
    await despacharAlCerebro(conversationId, organizationId, messageId);
    return;
  }
  const aiConfigured = await isAiConfiguredFor(organizationId);
  if (!aiConfigured) {
    // Las cotizaciones publicadas son una capacidad determinista: no dependen
    // de un proveedor LLM. Sin IA solo abrimos turno para esta intención y
    // únicamente cuando TASAS está activo para la organización.
    if (
      !messageText ||
      !isExchangeRateIntent(messageText) ||
      !exchangeRatesEnabled() ||
      !(await organizationRatesEnabled(organizationId))
    ) return;
  }
  scheduleAgentTurn(conversationId, messageId);
}
