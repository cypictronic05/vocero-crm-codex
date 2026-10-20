import { hasPermission, PERMISSIONS } from "@/lib/auth/permissions";

/**
 * Quién puede CONFIGURAR la instancia: conectar el número, pegar la llave de
 * IA, escribir el agente, encenderlo. En esta instancia solo el `owner`
 * aprovisionado por bootstrap controlado puede hacerlo. Un `member` atiende la
 * Bandeja y no recibe permisos implícitos por conocer una URL. Las capacidades
 * granulares viven en `permissions.ts` para añadir después un supervisor sin
 * convertirlo en propietario.
 *
 * Vive en `lib/` porque lo consultan los dos lados: el menú (cliente) y la
 * redirección de la raíz (servidor).
 */
export function canConfigure(role: string | null | undefined): boolean {
  return hasPermission(role, PERMISSIONS.ORGANIZATION_CONFIGURE);
}
