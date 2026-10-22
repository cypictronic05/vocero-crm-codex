import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
let cookie = "";
let checks = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function hasta(condition, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const value = await condition();
    if (value) return value;
    await sleep(250);
  }
  return null;
}

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

  let reverseRoute = previous.json?.routes?.find((candidate) => candidate.originCountry === "VE" && candidate.originCurrency === "VES" && candidate.destinationCountry === "CO" && candidate.destinationCurrency === "COP");
  if (!reverseRoute) {
    const configured = await api("/api/exchange-rates/routes", { method: "POST", body: JSON.stringify({
      originCountry: "VE", originCurrency: "VES", destinationCountry: "CO", destinationCurrency: "COP",
      operation: "multiply", precision: 2,
    }) });
    ok(configured.response.status === 201, "owner agrega una segunda ruta VE → CO para el selector");
    reverseRoute = configured.json.route;
  } else {
    ok(reverseRoute.calculationOperation === "multiply", "ruta VE → CO conserva MULTIPLY");
  }

  const now = new Date();
  const reverseDraft = await api("/api/exchange-rates", { method: "POST", body: JSON.stringify({
    routeId: reverseRoute.id, commercialRate: "2.90",
    validFrom: now.toISOString(), validUntil: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
  }) });
  const reversePublished = await api(`/api/exchange-rates/${reverseDraft.json.quote.id}/publish`, { method: "POST" });
  ok(reversePublished.response.ok, "segunda ruta MULTIPLY queda disponible para consulta");
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
  const currentRate = current.json?.currentRates?.find((rate) => rate.quoteId === publishedId);
  ok(currentRate?.presentation?.formula?.endsWith(" VES") && !currentRate.presentation.displayRate.includes("000000"), "API comercial expresa destino VES y oculta ceros técnicos");

  const calculated = await api("/api/exchange-rates/calculate", { method: "POST", body: JSON.stringify({ routeId: route.id, amount: "100.000" }) });
  ok(calculated.response.ok && calculated.json?.calculation?.presentation?.formula === currentRate.presentation.formula, "calculadora usa la misma tasa vigente y fórmula PostgreSQL");
  const preview = await api("/api/exchange-rates/preview", { method: "POST", body: JSON.stringify({ routeId: route.id, commercialRate: "3,53", amount: "100000" }) });
  ok(preview.response.ok && preview.json?.preview?.presentation?.formula === "100.000 COP ÷ 3,53 = 28.328,61 VES", "vista previa exacta disponible antes de publicar");
  const conversationalCalculation = await api("/api/exchange-rates/calculate", { method: "POST", body: JSON.stringify({ routeId: route.id, amount: "200000" }) });
  const expectedConversationFormula = conversationalCalculation.json?.calculation?.presentation?.formula?.replace(/ = ([^=]+)$/, " = *$1*");

  const phoneNumberId = "PN-TASAS-E2E";
  const activeSchedule = await api("/api/settings/ai/schedule", { method: "PUT", body: JSON.stringify({
    startMinute: 0, endMinute: 1439, timeZone: "UTC",
  }) });
  ok(activeSchedule.response.ok, "horario activo configurado solo para la organización ficticia");
  const enabledAgent = await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  ok(enabledAgent.response.ok, "agente activado únicamente en la organización ficticia");
  const whatsapp = await api("/api/settings/whatsapp", { method: "PUT", body: JSON.stringify({
    wabaId: "WABA-TASAS-E2E", phoneNumberId, token: "token-ficticio-tasas-e2e",
  }) });
  ok(whatsapp.response.ok, "WhatsApp ficticio conectado exclusivamente al mock local");
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });
  const sender = "573009990001";
  const routeQuestion = await api("/api/dev/wa-mock/inbound", { method: "POST", body: JSON.stringify({
    phoneNumberId, from: sender, name: "Cliente Tasas E2E",
    text: "¿Cuál es la tasa de Colombia a Venezuela?", waMessageId: "wamid.tasas.contexto.1",
  }) });
  ok(routeQuestion.response.ok, "consulta de ruta simulada entra por WhatsApp");
  const initialOutbox = await hasta(async () => {
    const entries = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
    return entries.some((entry) => entry.body?.text?.body?.includes("Colombia → 🇻🇪 Venezuela")) ? entries : null;
  });
  ok(Boolean(initialOutbox), "el backend responde la tasa vigente sin proveedor externo");
  const beforeAmount = initialOutbox?.length ?? 0;
  const amountQuestion = await api("/api/dev/wa-mock/inbound", { method: "POST", body: JSON.stringify({
    phoneNumberId, from: sender, name: "Cliente Tasas E2E",
    text: "¿Cuánto recibe mi familiar si envío 200 mil?", waMessageId: "wamid.tasas.importe.2",
  }) });
  ok(amountQuestion.response.ok, "consulta natural con importe entra por WhatsApp");
  const amountOutbox = await hasta(async () => {
    const entries = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
    return entries.length > beforeAmount && entries.some((entry) => entry.body?.text?.body?.includes(expectedConversationFormula)) ? entries : null;
  });
  const newReplies = amountOutbox?.slice(beforeAmount) ?? [];
  ok(newReplies.length === 1, "el cálculo contextual genera una sola respuesta");
  ok(newReplies[0]?.body?.text?.body?.includes("Monto estimado, sujeto a confirmación"), "la respuesta amigable conserva el aviso de estimación");

  const expiredDraft = await api("/api/exchange-rates", { method: "POST", body: JSON.stringify({
    routeId: route.id, commercialRate: "3.67",
    validFrom: "2020-01-01T00:00:00.000Z",
    validUntil: "2020-01-02T00:00:00.000Z",
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
    const context = await browser.newContext({ extraHTTPHeaders: { cookie }, viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    await page.goto(`${BASE}/exchange-rates`);
    ok(await page.getByRole("heading", { name: "Tasas de cambio" }).isVisible(), "pantalla real visible");
    ok(await page.getByLabel("Ruta seleccionada").isVisible() && await page.getByPlaceholder("País o moneda").isVisible(), "selector buscable de rutas accesible");
    ok(await page.getByLabel("Ruta seleccionada").locator("option").count() >= 3, "selector carga múltiples rutas desde PostgreSQL");
    ok(await page.getByText(/Ver todas las tasas vigentes \(2\)/).isVisible(), "resumen compacto permite mostrar todas las tasas");
    ok(await page.getByText(currentRate.presentation.formula, { exact: true }).first().isVisible(), "tarjeta comercial muestra fórmula exacta y moneda destino");
    ok(await page.getByRole("heading", { name: "Vista previa · WhatsApp" }).isVisible(), "vista previa de WhatsApp usa la respuesta del servidor");
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "escritorio sin desbordamiento horizontal");
    if (process.env.E2E_SCREENSHOT) {
      await page.screenshot({ path: process.env.E2E_SCREENSHOT, fullPage: true });
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      await page.screenshot({ path: process.env.E2E_SCREENSHOT.replace(/(\.[^.]+)$/, "-dark$1"), fullPage: true });
      const mobileContext = await browser.newContext({ extraHTTPHeaders: { cookie }, viewport: { width: 390, height: 844 } });
      const mobilePage = await mobileContext.newPage();
      await mobilePage.goto(`${BASE}/exchange-rates`);
      ok(await mobilePage.getByRole("heading", { name: "Tasas de cambio" }).isVisible(), "vista móvil carga con navegación cerrada");
      ok(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "móvil sin desbordamiento horizontal");
      await mobilePage.screenshot({ path: process.env.E2E_SCREENSHOT.replace(/(\.[^.]+)$/, "-mobile$1"), fullPage: true });
      await mobileContext.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`\n${checks} comprobaciones E2E correctas.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
