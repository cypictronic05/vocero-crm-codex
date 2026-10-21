import { apiError, parseBody, withPermission } from "@/lib/api";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { exchangeRatesDisabledResponse, exchangeRatesEnabled } from "@/server/exchange-rates/flag";
import { ExchangeRateError, getExchangeRateSettings, updateExchangeRateSettings } from "@/server/exchange-rates/service";
import { exchangeRateSettingsSchema } from "@/server/exchange-rates/validation";

export const dynamic = "force-dynamic";

export const GET = withPermission(PERMISSIONS.EXCHANGE_RATES_AUTHORIZE, async (session) => {
  if (!exchangeRatesEnabled()) return exchangeRatesDisabledResponse();
  if (session.role !== "owner") return apiError(403, "forbidden", "Solo el propietario administra autorizaciones");
  return Response.json(await getExchangeRateSettings(session.organizationId));
});

export const PATCH = withPermission(PERMISSIONS.EXCHANGE_RATES_AUTHORIZE, async (session, request: Request) => {
  if (!exchangeRatesEnabled()) return exchangeRatesDisabledResponse();
  const body = await parseBody(request, exchangeRateSettingsSchema);
  if (!body.ok) return body.response;
  try {
    await updateExchangeRateSettings(session, body.data);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ExchangeRateError) return apiError(error.code === "not_found" ? 404 : 403, error.code, error.message);
    throw error;
  }
});
