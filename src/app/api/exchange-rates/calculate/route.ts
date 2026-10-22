import { parseBody, withAuth } from "@/lib/api";
import { exchangeRatesDisabledResponse, exchangeRatesEnabled } from "@/server/exchange-rates/flag";
import { exchangeRateErrorResponse } from "@/server/exchange-rates/http";
import { calculateCurrentExchangeRate, organizationRatesEnabled } from "@/server/exchange-rates/service";
import { calculateExchangeRateSchema } from "@/server/exchange-rates/validation";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, request: Request) => {
  if (!exchangeRatesEnabled() || !(await organizationRatesEnabled(session.organizationId))) {
    return exchangeRatesDisabledResponse();
  }
  const body = await parseBody(request, calculateExchangeRateSchema);
  if (!body.ok) return body.response;
  try {
    const calculation = await calculateCurrentExchangeRate(session.organizationId, body.data);
    return Response.json({ calculation });
  } catch (error) {
    return exchangeRateErrorResponse(error);
  }
});
