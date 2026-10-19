import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import http from "node:http";
import test from "node:test";
import { once } from "node:events";
import {
  createWebhookProxy,
  DEFAULT_UPSTREAM,
} from "../../scripts/webhook-proxy.mjs";

const TOKEN = "verify-token-local-seguro";
const APP_SECRET = "app-secret-local-de-prueba";
const BODY = Buffer.from('{"object":"whatsapp_business_account","secret":"no-log"}');

function signatureFor(body) {
  return `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  server.close();
  await once(server, "close");
}

test("solo expone el webhook exacto y conserva query, body y firma", async () => {
  const received = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({
      method: req.method,
      url: req.url,
      body: Buffer.concat(chunks),
      signature: req.headers["x-hub-signature-256"],
      authorization: req.headers.authorization,
      cookie: req.headers.cookie,
      extra: req.headers["x-internal-debug"],
      deliveryId: req.headers["x-meta-delivery-id"],
    });
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("challenge-123");
      return;
    }
    if (req.headers["x-hub-signature-256"] !== signatureFor(Buffer.concat(chunks))) {
      res.writeHead(401);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"received":true}');
  });
  const upstreamBase = await listen(upstream);
  const logs = [];
  const proxy = createWebhookProxy({
    verifyToken: TOKEN,
    upstream: upstreamBase,
    logger: { info: (line) => logs.push(line) },
  });
  const proxyBase = await listen(proxy);

  try {
    for (const path of [
      "/",
      "/login",
      "/inbox",
      "/api/settings/whatsapp",
      "/api/webhooks/wa/token-incorrecto",
    ]) {
      const response = await fetch(proxyBase + path);
      assert.equal(response.status, 404);
    }
    assert.equal(received.length, 0);

    const query =
      "?hub.mode=subscribe&hub.verify_token=verify-token-local-seguro&hub.challenge=challenge-123";
    const handshake = await fetch(
      `${proxyBase}/api/webhooks/wa/${TOKEN}${query}`,
      { headers: { authorization: "Bearer no-reenviar", cookie: "session=no" } }
    );
    assert.equal(handshake.status, 200);
    assert.equal(await handshake.text(), "challenge-123");

    const event = await fetch(`${proxyBase}/api/webhooks/wa/${TOKEN}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signatureFor(BODY),
        authorization: "Bearer no-reenviar",
        cookie: "session=no",
        "x-meta-delivery-id": "delivery-test-123",
      },
      body: BODY,
    });
    assert.equal(event.status, 200);
    assert.deepEqual(Buffer.from(await event.arrayBuffer()), Buffer.from('{"received":true}'));

    assert.equal(received.length, 2);
    assert.equal(received[0].method, "GET");
    assert.equal(received[0].url, `/api/webhooks/wa/${TOKEN}${query}`);
    assert.equal(received[1].method, "POST");
    assert.deepEqual(received[1].body, BODY);
    assert.equal(received[1].signature, signatureFor(BODY));
    assert.equal(received[1].authorization, undefined);
    assert.equal(received[1].cookie, undefined);
    assert.equal(received[1].extra, undefined);
    assert.equal(received[1].deliveryId, "delivery-test-123");

    const invalidSignature = await fetch(
      `${proxyBase}/api/webhooks/wa/${TOKEN}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": "sha256=incorrecta",
        },
        body: BODY,
      }
    );
    assert.equal(invalidSignature.status, 401);

    const forbiddenMethod = await fetch(
      `${proxyBase}/api/webhooks/wa/${TOKEN}`,
      { method: "PUT" }
    );
    assert.equal(forbiddenMethod.status, 405);
    assert.equal(forbiddenMethod.headers.get("allow"), "GET, POST");
    assert.equal(received.length, 3);

    const allLogs = logs.join("\n");
    assert.equal(allLogs.includes(TOKEN), false);
    assert.equal(allLogs.includes("no-log"), false);
    assert.equal(allLogs.includes("hub.verify_token"), false);
    assert.equal(allLogs.includes("incorrecta"), false);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("rechaza cuerpos grandes y no actúa como proxy abierto", async () => {
  assert.equal(DEFAULT_UPSTREAM, "http://127.0.0.1:3001");
  let upstreamCalls = 0;
  const upstream = http.createServer((_req, res) => {
    upstreamCalls += 1;
    res.end("unexpected");
  });
  const upstreamBase = await listen(upstream);
  const proxy = createWebhookProxy({
    verifyToken: TOKEN,
    upstream: upstreamBase,
    maxBodyBytes: 8,
    logger: { info: () => {} },
  });
  const proxyBase = await listen(proxy);

  try {
    const response = await fetch(`${proxyBase}/api/webhooks/wa/${TOKEN}`, {
      method: "POST",
      body: "123456789",
    });
    assert.equal(response.status, 413);
    assert.equal(upstreamCalls, 0);
    assert.throws(
      () =>
        createWebhookProxy({
          verifyToken: TOKEN,
          upstream: "https://localhost",
        }),
      /CA confiable/
    );
  } finally {
    await close(proxy);
    await close(upstream);
  }
});
