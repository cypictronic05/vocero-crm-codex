"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Clock3, History } from "lucide-react";

type Rate = {
  routeId: string; quoteId: string; originCountry: string; originCurrency: string;
  destinationCountry: string; destinationCurrency: string; active: boolean;
  version: number; sourceUnits: string; destinationUnits: string; commercialRate: string;
  routeOperation: "multiply" | "divide" | null; roundingPrecision: number | null;
  calculationOperation: "multiply" | "divide" | null;
  precision: number; previewAmount: string | null; previewResult: string | null;
  validFrom: string; validUntil: string | null;
  status: "draft" | "published" | "disabled"; createdByUserId: string;
  createdByName: string; publishedByUserId: string | null; publishedByName: string | null;
  createdAt: string; publishedAt: string | null;
};

type Route = {
  id: string; originCountry: string; originCurrency: string;
  destinationCountry: string; destinationCurrency: string;
  calculationOperation: "multiply" | "divide" | null;
  roundingPrecision: number | null; active: boolean;
};

type Supervisor = { id: string; userId: string; name: string; enabled: boolean };

function operationLabel(operation: "multiply" | "divide" | null): string {
  if (operation === "multiply") return "MULTIPLY (×)";
  if (operation === "divide") return "DIVIDE (÷)";
  return "Sin configurar";
}

function displayStatus(rate: Rate): string {
  if (rate.status === "draft") return "Borrador";
  if (rate.status === "disabled") return "Desactivada";
  const now = Date.now();
  if (new Date(rate.validFrom).getTime() > now) return "Programada";
  if (rate.validUntil && new Date(rate.validUntil).getTime() <= now) return "Vencida";
  return "Vigente";
}

export function ExchangeRatesClient({ initialEnabled, canManage, isOwner, initialRates, initialRoutes, supervisors }: {
  initialEnabled: boolean; canManage: boolean; isOwner: boolean;
  initialRates: Rate[]; initialRoutes: Route[]; supervisors: Supervisor[];
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [rates, setRates] = useState(initialRates);
  const [routes, setRoutes] = useState(initialRoutes);
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
      if (refreshed.ok) {
        const payload = (await refreshed.json()) as { rates: Rate[]; routes: Route[] };
        setRates(payload.rates);
        setRoutes(payload.routes);
      }
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
        routeId: form.get("routeId"), commercialRate: form.get("commercialRate"),
        validFrom: new Date(String(form.get("validFrom"))).toISOString(),
        validUntil: validUntil ? new Date(validUntil).toISOString() : null,
      }),
    });
  }

  async function configureRoute(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await request("/api/exchange-rates/routes", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        originCountry: form.get("originCountry"), originCurrency: form.get("originCurrency"),
        destinationCountry: form.get("destinationCountry"), destinationCurrency: form.get("destinationCurrency"),
        operation: form.get("calculationOperation"),
        precision: Number(form.get("roundingPrecision")),
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

        {enabled && isOwner && (
          <section className="rounded-lg border bg-card p-4 sm:p-5">
            <h2 className="font-semibold">Configuración de rutas</h2>
            <p className="mt-1 text-sm text-muted-foreground">Solo la persona propietaria define una vez la fórmula y el redondeo comercial. Las cotizaciones diarias no pueden cambiarlos.</p>
            <form onSubmit={configureRoute} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[["originCountry", "País origen (CO)"], ["originCurrency", "Moneda origen (COP)"], ["destinationCountry", "País destino (VE)"], ["destinationCurrency", "Moneda destino (VES)"]].map(([name, label]) => <label key={name} className="text-sm font-medium">{label}<input name={name} required maxLength={3} className="mt-1 w-full rounded-md border bg-background px-3 py-2 uppercase" /></label>)}
              <label className="text-sm font-medium">Operación<select name="calculationOperation" required className="mt-1 w-full rounded-md border bg-background px-3 py-2"><option value="multiply">MULTIPLY (×)</option><option value="divide">DIVIDE (÷)</option></select></label>
              <label className="text-sm font-medium">Decimales finales<input name="roundingPrecision" type="number" min="0" max="12" defaultValue="2" required className="mt-1 w-full rounded-md border bg-background px-3 py-2" /></label>
              <div className="flex items-end sm:col-span-2"><button disabled={busy} className="w-full rounded-md border border-primary px-4 py-2 text-sm font-semibold text-primary disabled:opacity-50">Configurar ruta</button></div>
            </form>
            {routes.length > 0 && <div className="mt-4 grid gap-2 border-t pt-4 sm:grid-cols-2">{routes.map((route) => <div key={route.id} className="rounded-md bg-muted p-3 text-sm"><span className="font-semibold">{route.originCountry} · {route.originCurrency} → {route.destinationCountry} · {route.destinationCurrency}</span><span className="mt-1 block text-muted-foreground">{operationLabel(route.calculationOperation)}{route.roundingPrecision === null ? "" : ` · ${route.roundingPrecision} decimales`}</span></div>)}</div>}
          </section>
        )}

        {enabled && canManage && (
          <section className="rounded-lg border bg-card p-4 sm:p-5">
            <h2 className="font-semibold">Actualización diaria de tasas</h2>
            <p className="mt-1 text-sm text-muted-foreground">Selecciona una ruta configurada y actualiza únicamente su tasa y vigencia. Guardar no publica.</p>
            <form onSubmit={createDraft} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-sm font-medium sm:col-span-2">Ruta<select name="routeId" required className="mt-1 w-full rounded-md border bg-background px-3 py-2"><option value="">Selecciona una ruta</option>{routes.filter((route) => route.calculationOperation && route.roundingPrecision !== null && route.active).map((route) => <option key={route.id} value={route.id}>{route.originCountry} · {route.originCurrency} → {route.destinationCountry} · {route.destinationCurrency} · {operationLabel(route.calculationOperation)}</option>)}</select></label>
              <label className="text-sm font-medium">Tasa comercial<input name="commercialRate" inputMode="decimal" required placeholder="3.68" className="mt-1 w-full rounded-md border bg-background px-3 py-2" /></label>
              <label className="text-sm font-medium sm:col-span-1">Válida desde<input name="validFrom" type="datetime-local" required className="mt-1 w-full rounded-md border bg-background px-3 py-2" /></label>
              <label className="text-sm font-medium sm:col-span-1">Válida hasta (opcional)<input name="validUntil" type="datetime-local" className="mt-1 w-full rounded-md border bg-background px-3 py-2" /></label>
              <div className="flex items-end sm:col-span-2 lg:col-span-3"><button disabled={busy || !routes.some((route) => route.calculationOperation && route.roundingPrecision !== null && route.active)} className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">Guardar borrador</button></div>
            </form>
            {!routes.some((route) => route.calculationOperation && route.roundingPrecision !== null && route.active) && <p className="mt-3 text-sm text-warning-text">La persona propietaria debe configurar al menos una ruta antes de actualizar tasas.</p>}
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

        {enabled && <section><div className="mb-3 flex items-center gap-2"><History className="h-5 w-5" /><h2 className="font-semibold">{canManage ? "Cotizaciones e historial" : "Tasas vigentes"}</h2></div>{rates.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No hay tasas para mostrar.</div> : <div className="grid gap-4 md:grid-cols-2">{rates.map((rate) => <article key={rate.quoteId} className="rounded-lg border bg-card p-4"><div className="flex items-start justify-between gap-2"><div className="flex items-center gap-2 font-semibold"><span>{rate.originCountry} · {rate.originCurrency}</span><ArrowRight className="h-4 w-4"/><span>{rate.destinationCountry} · {rate.destinationCurrency}</span></div><span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold">{displayStatus(rate)}</span></div><p className="mt-4 text-xl font-bold">{operationLabel(rate.calculationOperation)}</p><p className="mt-1 text-sm text-muted-foreground">Tasa {rate.commercialRate} · precisión {rate.precision} · versión {rate.version}</p>{rate.previewAmount && rate.previewResult && rate.calculationOperation ? <div className="mt-3 rounded-md border bg-muted p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vista previa antes de publicar</p><p className="mt-1 font-semibold">{rate.previewAmount} {rate.originCurrency} {rate.calculationOperation === "multiply" ? "×" : "÷"} {rate.commercialRate} = {rate.previewResult} {rate.destinationCurrency}</p></div> : <div className="mt-3 rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning-text">Cotización histórica sin fórmula comercial. No se reinterpreta ni puede publicarse.</div>}<p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5"/>Desde {new Date(rate.validFrom).toLocaleString()} {rate.validUntil ? `hasta ${new Date(rate.validUntil).toLocaleString()}` : "sin vencimiento"}</p>{canManage && rate.status === "draft" && rate.calculationOperation && <div className="mt-4 rounded-md border border-warning-border bg-warning-surface p-3"><p className="flex gap-2 text-sm"><AlertTriangle className="h-4 w-4 shrink-0 text-warning-text"/>Confirma la vista previa. Al publicar, equipo e IA usarán esta fórmula y tasa durante su vigencia.</p><button disabled={busy} onClick={() => void request(`/api/exchange-rates/${rate.quoteId}/publish`, { method: "POST" })} className="mt-3 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">Publicar</button></div>}{canManage && rate.status === "published" && <button disabled={busy} onClick={() => void request(`/api/exchange-rates/${rate.quoteId}/disable`, { method: "POST" })} className="mt-4 rounded-md border px-3 py-2 text-sm font-semibold hover:bg-muted">Desactivar</button>}</article>)}</div>}</section>}
      </div>
    </div>
  );
}
