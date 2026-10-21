import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
let cookie = "";
let checks = 0;

function ok(value, message) {
  checks += 1;
  if (!value) throw new Error(`FAIL: ${message}`);
  console.log(`  OK  ${message}`);
}

async function api(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
  });
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length) cookie = cookies.map((value) => value.split(";")[0]).join("; ");
  const json = await response.clone().json().catch(() => null);
  return { response, json };
}

async function main() {
  const credentials = { email: "owner-tasas@example.invalid", password: "tasas-e2e-password-123", name: "Owner Tasas" };
  let auth = await api("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify(credentials) });
  if (!auth.response.ok) auth = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: credentials.email, password: credentials.password }) });
  ok(auth.response.ok && cookie, "sesión owner activa");

  const enabled = await api("/api/settings/exchange-rates", { method: "PATCH", body: JSON.stringify({ action: "module", enabled: true }) });
  ok(enabled.response.ok, "módulo activado por organización");

  // El arnés es re-ejecutable sobre su organización ficticia: desactiva solo
  // los borradores/publicaciones que dejó una corrida anterior.
  const previous = await api("/api/exchange-rates");
  for (const rate of previous.json?.rates ?? []) {
    if (rate.status === "draft" || rate.status === "published") {
      const disabled = await api(`/api/exchange-rates/${rate.quoteId}/disable`, { method: "POST" });
      ok(disabled.response.ok, `preparación idempotente de ${rate.quoteId}`);
    }
  }

  const formulaConflict = await api("/api/exchange-rates/routes", { method: "POST", body: JSON.stringify({
    originCountry: "CO", originCurrency: "COP", destinationCountry: "VE", destinationCurrency: "VES",
    operation: "multiply", precision: 2,
  }) });
  ok(formulaConflict.response.status === 422, "CO → VE rechaza MULTIPLY y exige DIVIDE");

  let route = previous.json?.routes?.find((candidate) => candidate.originCountry === "CO" && candidate.originCurrency === "COP" && candidate.destinationCountry === "VE" && candidate.destinationCurrency === "VES");
  if (!route) {
    const configured = await api("/api/exchange-rates/routes", { method: "POST", body: JSON.stringify({
      originCountry: "CO", originCurrency: "COP", destinationCountry: "VE", destinationCurrency: "VES",
      operation: "divide", precision: 2,
    }) });
    ok(configured.response.status === 201 && configured.json?.route?.calculationOperation === "divide", "owner configura CO → VE como DIVIDE una sola vez");
    route = configured.json.route;
  } else {
    ok(route.calculationOperation === "divide" && route.roundingPrecision === 2, "ruta CO → VE conserva fórmula owner");
  }
  const immutable = await api("/api/exchange-rates/routes", { method: "POST", body: JSON.stringify({
    originCountry: "CO", originCurrency: "COP", destinationCountry: "VE", destinationCurrency: "VES",
    operation: "divide", precision: 2,
  }) });
  ok(immutable.response.status === 409, "la fórmula configurada no puede modificarse en la gestión diaria");

  const now = new Date();
  const draft = await api("/api/exchange-rates", { method: "POST", body: JSON.stringify({
    routeId: route.id, commercialRate: "3.68",
    validFrom: now.toISOString(), validUntil: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
  }) });
  ok(draft.response.status === 201 && draft.json?.quote?.status === "draft" && draft.json?.quote?.calculationOperation === "divide", "borrador copia fórmula PostgreSQL sin publicar");

  const invalid = await api("/api/exchange-rates", { method: "POST", body: JSON.stringify({
    routeId: route.id, commercialRate: "-1",
    validFrom: now.toISOString(), validUntil: null,
  }) });
  ok(invalid.response.status === 422, "valores negativos rechazados");

  const quoteId = draft.json.quote.id;
  const contender = await api("/api/exchange-rates", { method: "POST", body: JSON.stringify({
    routeId: route.id, commercialRate: "3.69",
    validFrom: now.toISOString(), validUntil: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
  }) });
  ok(contender.response.status === 201, "segundo borrador solapado creado para probar concurrencia");
  const publications = await Promise.all([
    api(`/api/exchange-rates/${quoteId}/publish`, { method: "POST" }),
    api(`/api/exchange-rates/${contender.json.quote.id}/publish`, { method: "POST" }),
  ]);
  ok(publications.filter(({ response }) => response.ok).length === 1 && publications.filter(({ response }) => response.status === 409).length === 1, "publicaciones concurrentes dejan una sola tasa solapada");
  const publishedId = publications[0].response.ok ? quoteId : contender.json.quote.id;
  const current = await api("/api/exchange-rates");
  ok(current.response.ok && current.json?.rates?.some((rate) => rate.quoteId === publishedId && rate.calculationOperation === "divide"), "tasa vigente conserva fórmula PostgreSQL");

  const expiredDraft = await api("/api/exchange-rates", { method: "POST", body: JSON.stringify({
    routeId: route.id, commercialRate: "3.67",
    validFrom: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(),
    validUntil: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
  }) });
  const expiredPublished = await api(`/api/exchange-rates/${expiredDraft.json.quote.id}/publish`, { method: "POST" });
  ok(expiredPublished.response.ok, "una vigencia histórica puede publicarse sin desplazar la tasa actual");
  const expiredDisabled = await api(`/api/exchange-rates/${expiredDraft.json.quote.id}/disable`, { method: "POST" });
  ok(expiredDisabled.response.ok && expiredDisabled.json?.quote?.status === "disabled", "tasa expirada puede desactivarse con auditoría");

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_BROWSER_PATH ? { executablePath: process.env.PLAYWRIGHT_BROWSER_PATH } : {}),
  });
  try {
    const context = await browser.newContext({ extraHTTPHeaders: { cookie } });
    const page = await context.newPage();
    await page.goto(`${BASE}/exchange-rates`);
    ok(await page.getByRole("heading", { name: "Tasas de cambio" }).isVisible(), "pantalla real visible");
    ok(await page.getByText(/100000 COP ÷ 3\.680000000000 = 27173\.91 VES/).last().isVisible(), "vista previa exacta DIVIDE visible antes de publicar");
    if (process.env.E2E_SCREENSHOT) {
      await page.screenshot({ path: process.env.E2E_SCREENSHOT, fullPage: true });
    }
  } finally {
    await browser.close();
  }
  console.log(`\n${checks} comprobaciones E2E correctas.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
