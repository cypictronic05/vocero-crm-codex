import { getSql } from "@/lib/db";
import {
  currentNightWindowStart,
  isNightBotActive,
} from "@/lib/night-bot";
import { despachoActivo } from "@/server/brains/config";
import { scheduleAgentTurn } from "@/server/ai/pipeline";

type PendingTurn = {
  conversation_id: string;
  message_id: string;
};

/**
 * Recupera el único hueco no persistente del agente incluido: un entrante ya
 * confirmado en Postgres cuyo debounce/modelo se perdió al morir el proceso.
 * Solo mira la ventana nocturna actual y exige que no exista un saliente
 * posterior; así un reinicio no revive conversaciones antiguas ni duplica una
 * respuesta ya guardada. El despacho externo usa su outbox persistente propio.
 */
export async function resumePendingNightTurns(at = new Date()): Promise<number> {
  if (!isNightBotActive(at) || despachoActivo()) return 0;
  const since = currentNightWindowStart(at);
  if (!since) return 0;

  try {
    const rows = await getSql()<PendingTurn[]>`
      select distinct on (c.id)
        c.id as conversation_id,
        incoming.id as message_id
      from conversation c
      join agent_profile ap
        on ap.organization_id = c.organization_id
       and ap.enabled = true
      join message incoming
        on incoming.conversation_id = c.id
       and incoming.organization_id = c.organization_id
       and incoming.direction = 'in'
      where c.is_test = false
        and c.ai_enabled = true
        and c.handoff_at is null
        and incoming.created_at >= ${since}
        and not exists (
          select 1
          from message outgoing
          where outgoing.conversation_id = c.id
            and outgoing.organization_id = c.organization_id
            and outgoing.direction = 'out'
            and outgoing.created_at > incoming.created_at
        )
      order by c.id, incoming.created_at desc
    `;
    for (const row of rows) {
      scheduleAgentTurn(row.conversation_id, row.message_id);
    }
    if (rows.length > 0) {
      console.log(
        `[boot] ${rows.length} turno(s) nocturno(s) pendiente(s) reprogramado(s)`
      );
    }
    return rows.length;
  } catch (error) {
    console.error("[boot] no se pudieron recuperar turnos nocturnos:", error);
    return 0;
  }
}
