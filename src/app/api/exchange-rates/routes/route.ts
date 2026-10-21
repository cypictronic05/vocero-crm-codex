import { apiError, parseBody, withAuth } from "@/lib/api";
import { exchangeRatesDisabledResponse, exchangeRatesEnabled } from "@/server/exchange-rates/flag";
import { configureExchangeRateRoute, organizationRatesEnabled } from "@/server/exchange-rates/service";
import { exchangeRateErrorResponse } from "@/server/exchange-rates/http";
import { configureExchangeRateRouteSchema } from "@/server/exchange-rates/validation";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, request: Request) => {
  if (!exchangeRatesEnabled() || !(await organizationRatesEnabled(session.organizationId))) return exchangeRatesDisabledResponse();
  if (session.role !== "owner") return apiError(403, "forbidden", "Solo el propietario configura fórmulas de ruta");
  const body = await parseBody(request, configureExchangeRateRouteSchema);
  if (!body.ok) return body.response;
  try {
    const route = await configureExchangeRateRoute(session, body.data);
    return Response.json({ route }, { status: 201 });
  } catch (error) {
    return exchangeRateErrorResponse(error);
  }
});
