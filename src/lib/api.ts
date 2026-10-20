import { z } from "zod";
import { requireSession, UnauthorizedError, type SessionContext } from "@/lib/auth/session";
import { hasPermission, type Permission } from "@/lib/auth/permissions";

/** Respuesta de error estándar de la API interna (contrato api.md). */
export function apiError(
  status: number,
  code: string,
  message: string
): Response {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Envuelve un route handler autenticado: resuelve la sesión (401 si no hay),
 * captura errores no controlados (500 sin stack) y deja pasar Response.
 */
export function withAuth<Args extends unknown[]>(
  handler: (session: SessionContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    let session: SessionContext;
    try {
      session = await requireSession();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return apiError(401, "unauthorized", "No autenticado");
      }
      throw err;
    }
    try {
      return await handler(session, ...args);
    } catch (err) {
      console.error("[api] error no controlado:", err);
      return apiError(500, "internal", "Error interno");
    }
  };
}

/**
 * Autenticación + autorización administrativa para route handlers.
 *
 * `withAuth` conserva el 401 cuando no hay sesión. Una sesión válida sin la
 * capacidad solicitada recibe un 403 genérico que no revela datos ni secretos
 * de la operación protegida.
 */
export function withPermission<Args extends unknown[]>(
  permission: Permission,
  handler: (session: SessionContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return withAuth(async (session, ...args) => {
    if (!hasPermission(session.role, permission)) {
      return apiError(
        403,
        "forbidden",
        "No tienes permiso para realizar esta acción"
      );
    }
    return handler(session, ...args);
  });
}

/** Parsea el body JSON con un esquema Zod; inválido → Response 422. */
export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: apiError(422, "invalid_body", "El body debe ser JSON válido"),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      response: apiError(422, "invalid_body", detail),
    };
  }
  return { ok: true, data: parsed.data };
}
