import { getSql } from "@/lib/db";
import { currentAiWindowStart, isAiScheduleActive } from "@/lib/ai-schedule";
import { despachoActivo } from "@/server/brains/config";
import { scheduleAgentTurn } from "@/server/ai/pipeline";
import { scheduleFromOrganization } from "@/server/ai/schedule";

type PendingTurn = {
  conversation_id: string;
  message_id: string;
  incoming_created_at: Date;
  ai_schedule_start_minute: number;
  ai_schedule_end_minute: number;
  ai_schedule_time_zone: string;
};

/**
 * Recupera el único hueco no persistente del agente incluido: un entrante ya
 * confirmado en Postgres cuyo debounce/modelo se perdió al morir el proceso.
 * Solo mira la ventana nocturna actual y exige que no exista un saliente
 * posterior; así un reinicio no revive conversaciones antiguas ni duplica una
 * respuesta ya guardada. El despacho externo usa su outbox persistente propio.
 */
export async function resumePendingNightTurns(at = new Date()): Promise<number> {
  if (despachoActivo()) return 0;
  const lookback = new Date(at.getTime() - 24 * 60 * 60 * 1_000);
  // postgres-js serializa Date en las consultas del ORM, pero este SQL crudo
  // se ejecuta también durante el instrumentation de Next. Pasar el ISO evita
  // que el transformador del runtime intente tratar Date como string.
  const lookbackIso = lookback.toISOString();

  try {
    const rows = await getSql()<PendingTurn[]>`
      select distinct on (c.id)
        c.id as conversation_id,
        incoming.id as message_id,
        incoming.created_at as incoming_created_at,
        o.ai_schedule_start_minute,
        o.ai_schedule_end_minute,
        o.ai_schedule_time_zone
      from conversation c
      join organization o on o.id = c.organization_id
      join agent_profile ap
        on ap.organization_id = c.organization_id
       and ap.enabled = true
      join message incoming
        on incoming.conversation_id = c.id
       and incoming.organization_id = c.organization_id
       and incoming.direction = 'in'
      where c.is_test = false
        and c.ai_enabled = true
        and c.human_intervention_at is null
        and (c.handoff_at is null or c.handoff_reason = 'cliente')
        and incoming.created_at >= ${lookbackIso}::timestamp
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
    const activeRows = rows.filter((row) => {
      const schedule = scheduleFromOrganization({
        aiScheduleStartMinute: row.ai_schedule_start_minute,
        aiScheduleEndMinute: row.ai_schedule_end_minute,
        aiScheduleTimeZone: row.ai_schedule_time_zone,
      });
      const since = currentAiWindowStart(schedule, at);
      return (
        isAiScheduleActive(schedule, at) &&
        since !== null &&
        row.incoming_created_at >= since
      );
    });
    for (const row of activeRows) {
      scheduleAgentTurn(row.conversation_id, row.message_id);
    }
    if (activeRows.length > 0) {
      console.log(
        `[boot] ${activeRows.length} turno(s) de IA pendiente(s) reprogramado(s)`
      );
    }
    return activeRows.length;
  } catch (error) {
    console.error("[boot] no se pudieron recuperar turnos nocturnos:", error);
    return 0;
  }
}
