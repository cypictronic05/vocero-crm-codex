import http from "node:http";
import { pathToFileURL } from "node:url";
import path from "node:path";

export const DEFAULT_PROXY_HOST = "127.0.0.1";
export const DEFAULT_PROXY_PORT = 8787;
export const DEFAULT_UPSTREAM = "http://127.0.0.1:3001";
export const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

const BLOCKED_REQUEST_HEADERS = new Set([
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

class BodyTooLargeError extends Error {}

function validateUpstream(value) {
  const url = new URL(value);
  const loopback = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  if (url.protocol !== "http:" || !loopback.has(url.hostname)) {
    throw new Error(
      "VOCERO_LOCAL_URL debe usar el puerto HTTP de loopback dedicado; " +
        "HTTPS requiere una CA confiable y no se habilita implícitamente"
    );
  }
  return url;
}

function validatePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("WEBHOOK_PROXY_PORT debe ser un puerto válido");
  }
  return port;
}

function sendEmpty(res, status, extraHeaders = {}) {
  res.writeHead(status, {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  res.end();
}

async function readRawBody(req, maxBodyBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBodyBytes) throw new BodyTooLargeError();
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function forwardedHeaders(req) {
  const headers = new Headers();
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    const name = req.rawHeaders[index];
    const value = req.rawHeaders[index + 1];
    if (!name || value === undefined) continue;
    if (BLOCKED_REQUEST_HEADERS.has(name.toLowerCase())) continue;
    headers.append(name, value);
  }
  return headers;
}

function logResult(logger, method, status, startedAt) {
  logger.info?.(
    `[webhook-proxy] ${method} ${status} ${Date.now() - startedAt}ms`
  );
}

export function createWebhookProxy({
  verifyToken,
  upstream = DEFAULT_UPSTREAM,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  logger = console,
  fetchImpl = fetch,
} = {}) {
  if (typeof verifyToken !== "string" || verifyToken.length < 8) {
    throw new Error("META_WEBHOOK_VERIFY_TOKEN es obligatorio (mínimo 8 caracteres)");
  }
  const upstreamUrl = validateUpstream(upstream);
  const allowedPath = `/api/webhooks/wa/${encodeURIComponent(verifyToken)}`;

  return http.createServer((req, res) => {
    const startedAt = Date.now();
    void (async () => {
      const incoming = new URL(req.url ?? "/", "http://proxy.local");
      if (incoming.pathname !== allowedPath) {
        sendEmpty(res, 404);
        logResult(logger, req.method ?? "UNKNOWN", 404, startedAt);
        return;
      }

      const method = req.method ?? "";
      if (method !== "GET" && method !== "POST") {
        sendEmpty(res, 405, { allow: "GET, POST" });
        logResult(logger, method || "UNKNOWN", 405, startedAt);
        return;
      }

      let body;
      try {
        body = method === "POST" ? await readRawBody(req, maxBodyBytes) : undefined;
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          sendEmpty(res, 413);
          logResult(logger, method, 413, startedAt);
          return;
        }
        throw error;
      }

      const target = new URL(incoming.pathname + incoming.search, upstreamUrl);
      let upstreamResponse;
      try {
        upstreamResponse = await fetchImpl(target, {
          method,
          headers: forwardedHeaders(req),
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        sendEmpty(res, 502);
        logResult(logger, method, 502, startedAt);
        return;
      }

      const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
      const responseHeaders = {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      };
      const contentType = upstreamResponse.headers.get("content-type");
      if (contentType) responseHeaders["content-type"] = contentType;
      res.writeHead(upstreamResponse.status, responseHeaders);
      res.end(responseBody);
      logResult(logger, method, upstreamResponse.status, startedAt);
    })().catch(() => {
      if (!res.headersSent) sendEmpty(res, 502);
      else res.destroy();
      logResult(logger, req.method ?? "UNKNOWN", 502, startedAt);
    });
  });
}

export function startFromEnvironment(env = process.env, logger = console) {
  const port = validatePort(env.WEBHOOK_PROXY_PORT ?? DEFAULT_PROXY_PORT);
  const host = DEFAULT_PROXY_HOST;
  const server = createWebhookProxy({
    verifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
    upstream: env.VOCERO_LOCAL_URL ?? DEFAULT_UPSTREAM,
    logger,
  });
  server.listen(port, host, () => {
    logger.info?.(
      `[webhook-proxy] listo en http://${host}:${port}; solo webhook de WhatsApp`
    );
  });
  return server;
}

const invoked = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invoked === import.meta.url) {
  const server = startFromEnvironment();
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
