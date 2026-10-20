/**
 * Capacidades administrativas del backend.
 *
 * Se mantienen separadas aunque hoy solo el propietario las posea: cuando se
 * introduzca un rol supervisor podrá recibir, por ejemplo, asignación y equipo
 * sin heredar credenciales, canales ni configuración del negocio.
 */
export const PERMISSIONS = {
  ORGANIZATION_CONFIGURE: "organization:configure",
  CHANNELS_CONFIGURE: "channels:configure",
  AI_CONFIGURE: "ai:configure",
  INTEGRATIONS_CONFIGURE: "integrations:configure",
  AGENT_CONFIGURE: "agent:configure",
  TEAM_MANAGE: "team:manage",
  PIPELINE_CONFIGURE: "pipeline:configure",
  TEMPLATES_CONFIGURE: "templates:configure",
  LAB_MANAGE: "lab:manage",
  DEMO_SEED: "demo:seed",
  CONVERSATIONS_ASSIGN: "conversations:assign",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const OWNER_PERMISSIONS = new Set<Permission>(Object.values(PERMISSIONS));
const MEMBER_PERMISSIONS = new Set<Permission>();

const ROLE_PERMISSIONS: Readonly<Record<string, ReadonlySet<Permission>>> = {
  owner: OWNER_PERMISSIONS,
  member: MEMBER_PERMISSIONS,
};

/** Roles desconocidos no reciben permisos por defecto (fail closed). */
export function hasPermission(
  role: string | null | undefined,
  permission: Permission
): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}
