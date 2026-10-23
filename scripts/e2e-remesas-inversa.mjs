import { setTimeout as wait } from "node:timers/promises";

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
  return { response, json: await response.clone().json().catch(() => null) };
}

async function main() {
  const credentials = { email: "owner-remesas-inversa@example.invalid", password: "remesas-inversa-e2e-123", name: "Owner Remesas Inversa" };
  let auth = await api("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify(credentials) });
  if (!auth.response.ok) auth = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: credentials.email, password: credentials.password }) });
  ok(auth.response.ok && cookie, "sesión WhatsApp simulada activa");
  ok((await api("/api/settings/exchange-rates", { method: "PATCH", body: JSON.stringify({ action: "module", enabled: true }) })).response.ok, "módulo activo");

  const routes = await api("/api/exchange-rates");
  async function route(originCountry, originCurrency, destinationCountry, destinationCurrency, operation) {
    const existing = routes.json?.routes?.find((candidate) => candidate.originCountry === originCountry && candidate.destinationCountry === destinationCountry);
    if (existing) return existing;
    return (await api("/api/exchange-rates/routes", { method: "POST", body: JSON.stringify({ originCountry, originCurrency, destinationCountry, destinationCurrency, operation, precision: 2 }) })).json.route;
  }
  const brToCo = await route("BR", "BRL", "CO", "COP", "multiply");
  const coToBr = await route("CO", "COP", "BR", "BRL", "multiply");
  const now = new Date().toISOString();
  for (const item of [{ route: brToCo, rate: "1000" }, { route: coToBr, rate: "0.001" }]) {
    const draft = await api("/api/exchange-rates", { method: "POST", body: JSON.stringify({ routeId: item.route.id, commercialRate: item.rate, validFrom: now, validUntil: null }) });
    if (draft.json?.quote?.status === "draft") await api(`/api/exchange-rates/${draft.json.quote.id}/publish`, { method: "POST" });
  }

  const phoneNumberId = "PN-REMESAS-INVERSA-E2E";
  await api("/api/settings/ai/schedule", { method: "PUT", body: JSON.stringify({ startMinute: 0, endMinute: 1439, timeZone: "UTC" }) });
  await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  await api("/api/settings/whatsapp", { method: "PUT", body: JSON.stringify({ wabaId: "WABA-REMESAS-INVERSA-E2E", phoneNumberId, token: "token-ficticio" }) });
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });
  const sender = `57300${Date.now().toString().slice(-7)}`;
  const messages = [
    "Si envío 100 reales brasileños a Colombia, ¿cuántos pesos reciben?",
    "Necesito que reciban 100.000 pesos colombianos. ¿Cuántos reales debo enviar?",
  ];
  let outbox = [];
  for (const [index, text] of messages.entries()) {
    const waMessageId = `wamid.remesas.inversa.${Date.now()}.${index}`;
    const result = await api("/api/dev/wa-mock/inbound", { method: "POST", body: JSON.stringify({ phoneNumberId, from: sender, name: "Cliente Remesas", text, waMessageId }) });
    ok(result.response.ok, `mensaje literal ${index + 1} entra por WhatsApp mock (${waMessageId})`);
    const before = outbox.length;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      outbox = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
      if (outbox.length > before) break;
      await wait(500);
    }
    ok(outbox.length > before, `respuesta persistida para mensaje ${index + 1}`);
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    outbox = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
    if (outbox.length >= 2) break;
    await wait(500);
  }
  const replies = outbox.map((entry) => entry.body?.text?.body ?? "").filter(Boolean);
  ok(replies.some((reply) => reply.includes("🇧🇷 Brasil → 🇨🇴 Colombia")), "ambos mensajes seleccionan BR → CO");
  ok(replies.filter((reply) => reply.includes("🇧🇷 Brasil → 🇨🇴 Colombia")).length >= 2, "se generan dos respuestas sin duplicados adicionales");
  ok(!replies.some((reply) => reply.includes("🇨🇴 Colombia → 🇧🇷 Brasil")), "no se sustituye por CO → BR");
  console.log(`\n${checks} comprobaciones E2E de remesa inversa correctas.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
