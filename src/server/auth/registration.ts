import { count } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";

/**
 * Politica fail-safe del registro publico:
 * - closed: nunca permite crear usuarios, aunque la base este vacia;
 * - bootstrap: permite exclusivamente el primer propietario y se cierra al
 *   existir una organizacion.
 *
 * No existe un modo publico permanente. Las cuentas de equipo solo atraviesan
 * este gate dentro del contexto server-side del propietario autenticado.
 */
export async function isPublicSignupAllowed(): Promise<boolean> {
  if (getEnv().REGISTRATION_MODE !== "bootstrap") return false;
  const db = getDb();
  const rows = await db.select({ n: count() }).from(schema.organization);
  return (rows[0]?.n ?? 0) === 0;
}
