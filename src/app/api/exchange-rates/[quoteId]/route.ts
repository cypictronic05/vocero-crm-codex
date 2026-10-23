import { parseBody, withAuth } from "@/lib/api";
import { exchangeRatesDisabledResponse, exchangeRatesEnabled } from "@/server/exchange-rates/flag";
import { exchangeRateErrorResponse } from "@/server/exchange-rates/http";
import { organizationRatesEnabled, updateExchangeRateDraft } from "@/server/exchange-rates/service";
import { updateExchangeRateDraftSchema } from "@/server/exchange-rates/validation";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ quoteId: string }> };

export const PATCH = withAuth(async (session, request: Request, context: Params) => {
  if (!exchangeRatesEnabled() || !(await organizationRatesEnabled(session.organizationId))) return exchangeRatesDisabledResponse();
  const body = await parseBody(request, updateExchangeRateDraftSchema);
  if (!body.ok) return body.response;
  const { quoteId } = await context.params;
  try {
    return Response.json({ quote: await updateExchangeRateDraft(session, quoteId, body.data) });
  } catch (error) {
    return exchangeRateErrorResponse(error);
  }
});
