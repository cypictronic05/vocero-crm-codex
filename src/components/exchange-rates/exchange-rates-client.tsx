"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Clock3, History } from "lucide-react";

type Rate = {
  routeId: string; quoteId: string; originCountry: string; originCurrency: string;
  destinationCountry: string; destinationCurrency: string; active: boolean;
  version: number; sourceUnits: string; destinationUnits: string; commercialRate: string;
  precision: number; validFrom: string; validUntil: string | null;
  status: "draft" | "published" | "disabled"; createdByUserId: string;
  createdByName: string; publishedByUserId: string | null; publishedByName: string | null;
  createdAt: string; publishedAt: string | null;
};

type Supervisor = { id: string; userId: string; name: string; enabled: boolean };

function displayStatus(rate: Rate): string {
  if (rate.status === "draft") return "Borrador";
  if (rate.status === "disabled") return "Desactivada";
  const now = Date.now();
  if (new Date(rate.validFrom).getTime() > now) return "Programada";
  if (rate.validUntil && new Date(rate.validUntil).getTime() <= now) return "Vencida";
  return "Vigente";
}

export function ExchangeRatesClient({ initialEnabled, canManage, isOwner, initialRates, supervisors }: {
  initialEnabled: boolean; canManage: boolean; isOwner: boolean;
  initialRates: Rate[]; supervisors: Supervisor[];
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [rates, setRates] = useState(initialRates);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function request(url: string, init: RequestInit) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(url, init);
      const data = await response.json().catch(() => ({})) as { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "No se pudo completar la operación");
      router.refresh();
      const refreshed = await fetch("/api/exchange-rates");
      if (refreshed.ok) setRates(((await refreshed.json()) as { rates: Rate[] }).rates);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error inesperado");
    } finally { setBusy(false); }
  }

  async function toggleModule(next: boolean) {
    await request("/api/settings/exchange-rates", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "module", enabled: next }) });
    setEnabled(next);
  }

  async function createDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const validUntil = String(form.get("validUntil") ?? "");
    await request("/api/exchange-rates", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        originCountry: form.get("originCountry"), originCurrency: form.get("originCurrency"),
        destinationCountry: form.get("destinationCountry"), destinationCurrency: form.get("destinationCurrency"),
        sourceUnits: form.get("sourceUnits"), destinationUnits: form.get("destinationUnits"), commercialRate: form.get("commercialRate"),
        precision: Number(form.get("precision")), validFrom: new Date(String(form.get("validFrom"))).toISOString(),
        validUntil: validUntil ? new Date(validUntil).toISOString() : null,
      }),
    });
  }

  return (
    <div className="h-full overflow-y-auto bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <p className="kicker">Negocio</p>
          <h1 className="text-2xl font-bold tracking-tight">Tasas de cambio</h1>
          <p className="mt-1 text-sm text-muted-foreground">Fuente autorizada para el equipo y la IA. Las rutas inversas se administran por separado.</p>
        </header>

        {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        {isOwner && (
          <section className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="font-semibold">Módulo por organización</h2><p className="text-sm text-muted-foreground">Actívalo solo para negocios que operan remesas.</p></div>
              <button disabled={busy} onClick={() => void toggleModule(!enabled)} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{enabled ? "Desactivar módulo" : "Activar módulo"}</button>
            </div>
            {enabled && supervisors.length > 0 && <div className="mt-4 border-t pt-4"><p className="mb-2 text-sm font-semibold">Supervisoras autorizadas</p>{supervisors.map((member) => <label key={member.id} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" defaultChecked={member.enabled} onChange={(event) => void request("/api/settings/exchange-rates", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "capability", memberId: member.id, enabled: event.target.checked }) })} />{member.name}</label>)}</div>}
          </section>
        )}

        {enabled && canManage && (
          <section className="rounded-lg border bg-card p-4 sm:p-5">
            <h2 className="font-semibold">Nuevo borrador</h2>
            <p className="mt-1 text-sm text-muted-foreground">Guardar no publica. Revisa la vigencia antes de autorizar.</p>
            <form onSubmit={createDraft} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[['originCountry','País origen (CO)'],['originCurrency','Moneda origen (USD)'],['destinationCountry','País destino (VE)'],['destinationCurrency','Moneda destino (VES)'],['sourceUnits','Unidades origen'],['destinationUnits','Unidades destino'],['commercialRate','Tasa comercial']].map(([name,label]) => <label key={name} className="text-sm font-medium">{label}<input name={name} required className="mt-1 w-full rounded-md border bg-background px-3 py-2 uppercase" /></label>)}
              <label className="text-sm font-medium">Decimales<input name="precision" type="number" min="0" max="12" defaultValue="2" required className="mt-1 w-full rounded-md border bg-background px-3 py-2" /></label>
              <label className="text-sm font-medium sm:col-span-1">Válida desde<input name="validFrom" type="datetime-local" required className="mt-1 w-full rounded-md border bg-background px-3 py-2" /></label>
              <label className="text-sm font-medium sm:col-span-1">Válida hasta (opcional)<input name="validUntil" type="datetime-local" className="mt-1 w-full rounded-md border bg-background px-3 py-2" /></label>
              <div className="flex items-end lg:col-span-2"><button disabled={busy} className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">Guardar borrador</button></div>
            </form>
          </section>
        )}

        {enabled && canManage && rates.length > 0 && (
          <section className="rounded-lg border bg-card p-4">
            <h2 className="font-semibold">Responsables e historial</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-muted-foreground"><tr><th className="pb-2 pr-4">Versión</th><th className="pb-2 pr-4">Acción</th><th className="pb-2 pr-4">Responsable</th><th className="pb-2">Fecha</th></tr></thead>
                <tbody>{rates.map((rate) => <tr key={`audit-${rate.quoteId}`} className="border-t"><td className="py-2 pr-4">{rate.originCurrency}→{rate.destinationCurrency} v{rate.version}</td><td className="py-2 pr-4">{displayStatus(rate)}</td><td className="py-2 pr-4">{rate.publishedByName ?? rate.createdByName}</td><td className="py-2">{new Date(rate.publishedAt ?? rate.createdAt).toLocaleString()}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        )}

        {enabled && <section><div className="mb-3 flex items-center gap-2"><History className="h-5 w-5" /><h2 className="font-semibold">{canManage ? "Cotizaciones e historial" : "Tasas vigentes"}</h2></div>{rates.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No hay tasas para mostrar.</div> : <div className="grid gap-4 md:grid-cols-2">{rates.map((rate) => <article key={rate.quoteId} className="rounded-lg border bg-card p-4"><div className="flex items-start justify-between gap-2"><div className="flex items-center gap-2 font-semibold"><span>{rate.originCountry} · {rate.originCurrency}</span><ArrowRight className="h-4 w-4"/><span>{rate.destinationCountry} · {rate.destinationCurrency}</span></div><span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold">{displayStatus(rate)}</span></div><p className="mt-4 text-xl font-bold">{rate.sourceUnits} {rate.originCurrency} = {rate.destinationUnits} {rate.destinationCurrency}</p><p className="mt-1 text-sm text-muted-foreground">Tasa {rate.commercialRate} · precisión {rate.precision} · versión {rate.version}</p><p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5"/>Desde {new Date(rate.validFrom).toLocaleString()} {rate.validUntil ? `hasta ${new Date(rate.validUntil).toLocaleString()}` : "sin vencimiento"}</p>{canManage && rate.status === "draft" && <div className="mt-4 rounded-md border border-warning-border bg-warning-surface p-3"><p className="flex gap-2 text-sm"><AlertTriangle className="h-4 w-4 shrink-0 text-warning-text"/>Publicar hará que equipo e IA usen esta cotización durante su vigencia.</p><button disabled={busy} onClick={() => void request(`/api/exchange-rates/${rate.quoteId}/publish`, { method: "POST" })} className="mt-3 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">Publicar</button></div>}{canManage && rate.status === "published" && <button disabled={busy} onClick={() => void request(`/api/exchange-rates/${rate.quoteId}/disable`, { method: "POST" })} className="mt-4 rounded-md border px-3 py-2 text-sm font-semibold hover:bg-muted">Desactivar</button>}</article>)}</div>}</section>}
      </div>
    </div>
  );
}
