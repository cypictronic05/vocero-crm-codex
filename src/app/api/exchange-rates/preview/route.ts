import { parseBody, withAuth } from "@/lib/api";
import { exchangeRatesDisabledResponse, exchangeRatesEnabled } from "@/server/exchange-rates/flag";
import { exchangeRateErrorResponse } from "@/server/exchange-rates/http";
import { organizationRatesEnabled, previewExchangeRateDraft } from "@/server/exchange-rates/service";
import { previewExchangeRateSchema } from "@/server/exchange-rates/validation";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, request: Request) => {
  if (!exchangeRatesEnabled() || !(await organizationRatesEnabled(session.organizationId))) {
    return exchangeRatesDisabledResponse();
  }
  const body = await parseBody(request, previewExchangeRateSchema);
  if (!body.ok) return body.response;
  try {
    const preview = await previewExchangeRateDraft(session, body.data);
    return Response.json({ preview });
  } catch (error) {
    return exchangeRateErrorResponse(error);
  }
});
