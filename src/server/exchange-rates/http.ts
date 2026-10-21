import { apiError } from "@/lib/api";
import { ExchangeRateError } from "@/server/exchange-rates/service";

export function exchangeRateErrorResponse(error: unknown): Response {
  if (!(error instanceof ExchangeRateError)) throw error;
  const status =
    error.code === "forbidden"
      ? 403
      : error.code === "not_found" || error.code === "module_disabled"
        ? 404
        : error.code === "overlap" || error.code === "invalid_state"
          ? 409
          : 422;
  return apiError(status, error.code, error.message);
}
