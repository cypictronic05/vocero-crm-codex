import { notFound, redirect } from "next/navigation";
import { ExchangeRatesClient } from "@/components/exchange-rates/exchange-rates-client";
import { getSessionOrNull } from "@/lib/auth/session";
import { exchangeRatesEnabled } from "@/server/exchange-rates/flag";
import { canManageExchangeRates, getExchangeRateSettings, listExchangeRates, organizationRatesEnabled } from "@/server/exchange-rates/service";

export const dynamic = "force-dynamic";

export default async function ExchangeRatesPage() {
  if (!exchangeRatesEnabled()) notFound();
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  const enabled = await organizationRatesEnabled(session.organizationId);
  if (!enabled && session.role !== "owner") notFound();
  const canManage = enabled && await canManageExchangeRates(session);
  const rates = enabled ? await listExchangeRates(session.organizationId, canManage) : [];
  const settings = session.role === "owner" ? await getExchangeRateSettings(session.organizationId) : null;
  return (
    <ExchangeRatesClient
      initialEnabled={enabled}
      canManage={canManage}
      isOwner={session.role === "owner"}
      initialRates={rates.map((rate) => ({
        ...rate,
        validFrom: rate.validFrom.toISOString(),
        validUntil: rate.validUntil?.toISOString() ?? null,
        createdAt: rate.createdAt.toISOString(),
        publishedAt: rate.publishedAt?.toISOString() ?? null,
      }))}
      supervisors={settings?.supervisors ?? []}
    />
  );
}
