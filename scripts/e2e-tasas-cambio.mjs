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

  const now = new Date();
  const draft = await api("/api/exchange-rates", { method: "POST", body: JSON.stringify({
    originCountry: "CO", originCurrency: "USD", destinationCountry: "VE", destinationCurrency: "VES",
    sourceUnits: "1", destinationUnits: "39.12", commercialRate: "39.12", precision: 2,
    validFrom: now.toISOString(), validUntil: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
  }) });
  ok(draft.response.status === 201 && draft.json?.quote?.status === "draft", "borrador creado sin publicar");

  const invalid = await api("/api/exchange-rates", { method: "POST", body: JSON.stringify({
    originCountry: "CO", originCurrency: "USD", destinationCountry: "PE", destinationCurrency: "PEN",
    sourceUnits: "1", destinationUnits: "-1", commercialRate: "-1", precision: 2,
    validFrom: now.toISOString(), validUntil: null,
  }) });
  ok(invalid.response.status === 422, "valores negativos rechazados");

  const quoteId = draft.json.quote.id;
  const published = await api(`/api/exchange-rates/${quoteId}/publish`, { method: "POST" });
  ok(published.response.ok && published.json?.quote?.status === "published", "publicación separada y autorizada");
  const current = await api("/api/exchange-rates");
  ok(current.response.ok && current.json?.rates?.some((rate) => rate.quoteId === quoteId), "tasa vigente consultable");

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_BROWSER_PATH ? { executablePath: process.env.PLAYWRIGHT_BROWSER_PATH } : {}),
  });
  try {
    const context = await browser.newContext({ extraHTTPHeaders: { cookie } });
    const page = await context.newPage();
    await page.goto(`${BASE}/exchange-rates`);
    ok(await page.getByRole("heading", { name: "Tasas de cambio" }).isVisible(), "pantalla real visible");
    ok(await page.getByText("1.000000000000 USD = 39.120000000000 VES").last().isVisible(), "tarjeta muestra unidades exactas");
    if (process.env.E2E_SCREENSHOT) {
      await page.screenshot({ path: process.env.E2E_SCREENSHOT, fullPage: true });
    }
  } finally {
    await browser.close();
  }
  console.log(`\n${checks} comprobaciones E2E correctas.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
