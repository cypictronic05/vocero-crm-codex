import { apiError } from "@/lib/api";
import type { SessionContext } from "@/lib/auth/session";
import {
  assertOperatorCanSend,
  OperatorAvailabilityError,
} from "@/server/team/availability";

/** Guarda HTTP común de todas las entradas de envío humano. */
export async function operatorSendDenied(
  session: SessionContext
): Promise<Response | null> {
  try {
    await assertOperatorCanSend(session);
    return null;
  } catch (error) {
    const response = operatorSendErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export function operatorSendErrorResponse(error: unknown): Response | null {
  return error instanceof OperatorAvailabilityError
    ? apiError(403, error.code, error.message)
    : null;
}
