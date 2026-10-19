import { createHash } from "node:crypto";

function fingerprint(value) {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

const encryptionKey = process.env.ENCRYPTION_KEY ?? "";
const authSecret = process.env.BETTER_AUTH_SECRET ?? "";
const encryptionKeyValid =
  /^[A-Za-z0-9+/]+={0,2}$/.test(encryptionKey) &&
  Buffer.from(encryptionKey, "base64").length === 32;
const authSecretValid = authSecret.length >= 16;

console.log(
  `ENCRYPTION_KEY format=${encryptionKeyValid ? "ok" : "invalid"} fingerprint=sha256:${fingerprint(encryptionKey)}`,
);
console.log(
  `BETTER_AUTH_SECRET format=${authSecretValid ? "ok" : "invalid"} fingerprint=sha256:${fingerprint(authSecret)}`,
);
console.log("Compare estas dos lineas en origen y destino; no publiques la salida.");

if (!encryptionKeyValid || !authSecretValid) process.exitCode = 1;
