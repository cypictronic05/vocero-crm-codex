import { withAuth } from "@/lib/api";
import { exchangeRateErrorResponse } from "@/server/exchange-rates/http";
import { exchangeRatesDisabledResponse, exchangeRatesEnabled } from "@/server/exchange-rates/flag";
import { organizationRatesEnabled, publishExchangeRate } from "@/server/exchange-rates/service";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ quoteId: string }> };

export const POST = withAuth(async (session, _request: Request, context: Params) => {
  if (!exchangeRatesEnabled() || !(await organizationRatesEnabled(session.organizationId))) return exchangeRatesDisabledResponse();
  try {
    const { quoteId } = await context.params;
    return Response.json({ quote: await publishExchangeRate(session, quoteId) });
  } catch (error) {
    return exchangeRateErrorResponse(error);
  }
});
