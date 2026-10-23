import { apiError, parseBody, withAuth } from "@/lib/api";
import { VERIFIED_REMITTANCE_ROUTES } from "@/server/exchange-rates/catalog";
import { exchangeRatesDisabledResponse, exchangeRatesEnabled } from "@/server/exchange-rates/flag";
import { exchangeRateErrorResponse } from "@/server/exchange-rates/http";
import {
  bulkActivateExchangeRateRoutes,
  listExchangeRateCountries,
  listExchangeRateRouteMatrix,
  organizationRatesEnabled,
  updateExchangeRateCountry,
} from "@/server/exchange-rates/service";
import { bulkExchangeRateRoutesSchema, updateExchangeRateCountrySchema } from "@/server/exchange-rates/validation";

export const dynamic = "force-dynamic";

async function moduleAvailable(organizationId: string) {
  return exchangeRatesEnabled() && await organizationRatesEnabled(organizationId);
}

export const GET = withAuth(async (session) => {
  if (!(await moduleAvailable(session.organizationId))) return exchangeRatesDisabledResponse();
  const [countries, routes] = await Promise.all([
    listExchangeRateCountries(session.organizationId),
    listExchangeRateRouteMatrix(session.organizationId),
  ]);
  return Response.json({ countries, routes, verifiedRoutes: VERIFIED_REMITTANCE_ROUTES });
});

export const PATCH = withAuth(async (session, request: Request) => {
  if (!(await moduleAvailable(session.organizationId))) return exchangeRatesDisabledResponse();
  if (session.role !== "owner") return apiError(403, "forbidden", "Solo el propietario habilita países");
  const body = await parseBody(request, updateExchangeRateCountrySchema);
  if (!body.ok) return body.response;
  try {
    const country = await updateExchangeRateCountry(session, body.data);
    return Response.json({ country });
  } catch (error) {
    return exchangeRateErrorResponse(error);
  }
});

export const POST = withAuth(async (session, request: Request) => {
  if (!(await moduleAvailable(session.organizationId))) return exchangeRatesDisabledResponse();
  if (session.role !== "owner") return apiError(403, "forbidden", "Solo el propietario activa corredores comerciales");
  const body = await parseBody(request, bulkExchangeRateRoutesSchema);
  if (!body.ok) return body.response;
  try {
    const result = await bulkActivateExchangeRateRoutes(session, body.data);
    return Response.json({ result }, { status: body.data.dryRun ? 200 : 201 });
  } catch (error) {
    return exchangeRateErrorResponse(error);
  }
});
