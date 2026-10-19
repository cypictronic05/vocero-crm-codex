import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const urlValue = process.env.MIGRATION_MEDIA_URL ?? "";
const expected = (process.env.MIGRATION_MEDIA_SHA256 ?? "").toLowerCase();
const dataRoot = process.env.DATA_ROOT ?? "/data";
const maximumBytes = Number(process.env.MIGRATION_MEDIA_MAX_BYTES ?? 10 * 1024 ** 3);
const target = `${dataRoot}/migration/incoming-media.tar.gz`;
const partial = `${target}.partial-${process.pid}`;

if (!/^[a-f0-9]{64}$/.test(expected)) {
  throw new Error("MIGRATION_MEDIA_SHA256 debe ser un SHA-256 hexadecimal");
}

const url = new URL(urlValue);
if (url.protocol !== "https:") throw new Error("MIGRATION_MEDIA_URL debe usar HTTPS");

await mkdir(`${dataRoot}/migration`, { recursive: true, mode: 0o700 });
try {
  await stat(target);
  throw new Error(`${target} ya existe; no se sobrescribio`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const response = await fetch(url, { redirect: "error" });
if (!response.ok || !response.body) {
  throw new Error(`La descarga privada fallo con HTTP ${response.status}`);
}

const declaredLength = Number(response.headers.get("content-length") ?? 0);
if (declaredLength > maximumBytes) throw new Error("El objeto excede el limite permitido");

const hash = createHash("sha256");
let received = 0;
const verifier = new Transform({
  transform(chunk, _encoding, callback) {
    received += chunk.length;
    if (received > maximumBytes) return callback(new Error("El objeto excede el limite permitido"));
    hash.update(chunk);
    callback(null, chunk);
  },
});

try {
  await pipeline(Readable.fromWeb(response.body), verifier, createWriteStream(partial, { mode: 0o600 }));
  const actual = hash.digest("hex");
  if (actual !== expected) throw new Error("SHA-256 del adjunto no coincide con el manifiesto");
  await rename(partial, target);
  console.log(`Adjuntos descargados y verificados en ${target} (${received} bytes)`);
} catch (error) {
  await rm(partial, { force: true });
  throw error;
}
