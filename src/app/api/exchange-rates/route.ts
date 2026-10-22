import { parseBody, withAuth } from "@/lib/api";
import { exchangeRatesDisabledResponse, exchangeRatesEnabled } from "@/server/exchange-rates/flag";
import { createExchangeRateDraft, canManageExchangeRates, listExchangeRateRoutes, listExchangeRates, listPresentedCurrentRates, organizationRatesEnabled } from "@/server/exchange-rates/service";
import { exchangeRateErrorResponse } from "@/server/exchange-rates/http";
import { createExchangeRateSchema } from "@/server/exchange-rates/validation";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  if (!exchangeRatesEnabled() || !(await organizationRatesEnabled(session.organizationId))) return exchangeRatesDisabledResponse();
  const canManage = await canManageExchangeRates(session);
  const rates = await listExchangeRates(session.organizationId, canManage);
  const currentRates = await listPresentedCurrentRates(session.organizationId);
  const routes = await listExchangeRateRoutes(session.organizationId);
  return Response.json({ rates, currentRates, routes, canManage });
});

export const POST = withAuth(async (session, request: Request) => {
  if (!exchangeRatesEnabled() || !(await organizationRatesEnabled(session.organizationId))) return exchangeRatesDisabledResponse();
  const body = await parseBody(request, createExchangeRateSchema);
  if (!body.ok) return body.response;
  try {
    const quote = await createExchangeRateDraft(session, body.data);
    return Response.json({ quote }, { status: 201 });
  } catch (error) {
    return exchangeRateErrorResponse(error);
  }
});
