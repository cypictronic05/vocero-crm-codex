import { apiError, withAuth } from "@/lib/api";
import { exchangeRatesDisabledResponse, exchangeRatesEnabled } from "@/server/exchange-rates/flag";
import { getExchangeRateSelection, organizationRatesEnabled } from "@/server/exchange-rates/service";
import { exchangeRateSelectionSchema } from "@/server/exchange-rates/validation";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, request: Request) => {
  if (!exchangeRatesEnabled() || !(await organizationRatesEnabled(session.organizationId))) return exchangeRatesDisabledResponse();
  const url = new URL(request.url);
  const parsed = exchangeRateSelectionSchema.safeParse({
    originCountry: url.searchParams.get("originCountry"),
    destinationCountry: url.searchParams.get("destinationCountry"),
  });
  if (!parsed.success) {
    return apiError(422, "invalid_query", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }
  const selection = await getExchangeRateSelection(session.organizationId, parsed.data);
  return Response.json(selection);
});
