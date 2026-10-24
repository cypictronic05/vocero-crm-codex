import { createHash } from "node:crypto";
const BASE = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
let cookie = "";
let checks = 0;
const ok = (v, m) => { checks += 1; if (!v) throw new Error(`FAIL: ${m}`); console.log(`  OK  ${m}`); };
async function api(path, init = {}) { const r = await fetch(`${BASE}${path}`, { ...init, headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) } }); const cs = r.headers.getSetCookie?.() ?? []; if (cs.length) cookie = cs.map((x) => x.split(";")[0]).join("; "); return { r, json: await r.clone().json().catch(() => null), text: await r.clone().text().catch(() => "") }; }
async function main() {
  const user = { email: "owner-delivery-e2e@example.invalid", password: "delivery-e2e-123", name: "Owner Delivery E2E" };
  let auth = await api("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify(user) });
  if (!auth.r.ok) auth = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: user.email, password: user.password }) });
  ok(auth.r.ok, "owner autenticado");
  const before = await api("/api/settings/delivery-preparation"); ok(before.r.ok && before.json?.affected, "preview disponible");
  const sender = `57300${Date.now().toString().slice(-7)}`;
  const contact = await api("/api/contacts", { method: "POST", body: JSON.stringify({ name: "Contacto ficticio", phone: sender }) }); ok(contact.r.status === 201, "contacto y oportunidad creados");
  const phoneNumberId = "573000000001";
  ok((await api("/api/settings/ai/schedule", { method: "PUT", body: JSON.stringify({ startMinute: 0, endMinute: 1439, timeZone: "UTC" }) })).r.ok, "horario IA activo");
  ok((await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ enabled: true }) })).r.ok, "perfil IA activo");
  ok((await api("/api/settings/whatsapp", { method: "PUT", body: JSON.stringify({ wabaId: "WABA-DELIVERY-E2E", phoneNumberId, token: "token-ficticio" }) })).r.ok, "WhatsApp mock configurado");
  ok((await api("/api/dev/wa-mock/inbound", { method: "POST", body: JSON.stringify({ phoneNumberId, from: sender, text: "Mensaje ficticio de entrega", waMessageId: `wamid.delivery.${Date.now()}` }) })).r.ok, "conversación y mensaje ficticios creados");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const preview = await api("/api/settings/delivery-preparation"); ok(preview.json.affected.contacts === before.json.affected.contacts + 1, "conteo de preview exacto");
  const backup = await api("/api/settings/delivery-preparation", { method: "PUT" }); const digest = createHash("sha256").update(JSON.stringify({ ...backup.json, manifest: { ...backup.json.manifest, sha256: undefined } })).digest("hex"); ok(backup.r.ok && backup.json.manifest.sha256, "exportación con manifiesto y SHA-256"); ok(!Object.keys(backup.json).some((key) => /password|token|secret|credential/i.test(key)), "exportación sin secretos");
  ok((await api("/api/settings/delivery-preparation", { method: "POST", body: JSON.stringify({ action: "archive", confirm: true }) })).r.ok, "archivado reversible");
  ok((await api("/api/contacts")).json.contacts.every((x) => x.id !== contact.json.contact.id), "contacto archivado oculto");
  ok(!(await api("/api/pipeline/board")).json.leads.some((x) => x.contact?.id === contact.json.contact.id), "oportunidad archivada oculta del pipeline");
  ok((await api("/api/settings/delivery-preparation", { method: "POST", body: JSON.stringify({ action: "archive", confirm: true }) })).r.ok, "archivado idempotente");
  ok((await api("/api/settings/delivery-preparation", { method: "POST", body: JSON.stringify({ action: "restore", confirm: true }) })).r.ok, "restauración completa");
  ok((await api("/api/contacts")).json.contacts.some((x) => x.id === contact.json.contact.id), "contacto restaurado");
  ok((await api("/api/pipeline/board")).json.leads.some((x) => x.contact?.id === contact.json.contact.id), "oportunidad restaurada");
  const conversations = (await api("/api/conversations")).json.conversations ?? [];
  ok(conversations.some((x) => x.contactId === contact.json.contact.id || x.contact?.id === contact.json.contact.id), "conversación restaurada en Bandeja");
  const member = { email: "member-delivery-e2e@example.invalid", password: "delivery-member-123", name: "Member Delivery E2E" };
  const invited = await api("/api/settings/team", { method: "POST", body: JSON.stringify({ ...member, role: "member" }) });
  ok(invited.r.status === 201 || invited.r.status === 409, "member ficticio disponible");
  cookie = "";
  const memberAuth = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: member.email, password: member.password }) });
  if (memberAuth.r.ok) {
    ok((await api("/api/settings/delivery-preparation")).r.status === 403, "member no puede ver preview");
    ok((await api("/api/settings/delivery-preparation", { method: "PUT" })).r.status === 403, "member no puede exportar");
    ok((await api("/api/settings/delivery-preparation", { method: "POST", body: JSON.stringify({ action: "archive", confirm: true }) })).r.status === 403, "member no puede archivar");
    ok((await api("/api/settings/delivery-preparation", { method: "POST", body: JSON.stringify({ action: "restore", confirm: true }) })).r.status === 403, "member no puede restaurar");
  }
  console.log(`\n${checks} comprobaciones E2E de preparación correctas.`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
