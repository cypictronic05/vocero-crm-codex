/**
 * Capacidades administrativas del backend.
 *
 * Se mantienen separadas para que la supervisora reciba visibilidad,
 * asignación y resultados sin heredar credenciales, canales ni configuración
 * técnica del negocio.
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
  CONVERSATIONS_VIEW_ALL: "conversations:view-all",
  RESULTS_VIEW: "results:view",
  TEAM_VIEW: "team:view",
  EXCHANGE_RATES_AUTHORIZE: "exchange-rates:authorize",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const APP_ROLES = ["owner", "supervisor", "member"] as const;
export type AppRole = (typeof APP_ROLES)[number];
export const ASSIGNABLE_ROLES = ["supervisor", "member"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export function isAppRole(role: string): role is AppRole {
  return (APP_ROLES as readonly string[]).includes(role);
}

const OWNER_PERMISSIONS = new Set<Permission>(Object.values(PERMISSIONS));
const SUPERVISOR_PERMISSIONS = new Set<Permission>([
  PERMISSIONS.CONVERSATIONS_ASSIGN,
  PERMISSIONS.CONVERSATIONS_VIEW_ALL,
  PERMISSIONS.RESULTS_VIEW,
  PERMISSIONS.TEAM_VIEW,
]);
const MEMBER_PERMISSIONS = new Set<Permission>();

const ROLE_PERMISSIONS: Readonly<Record<AppRole, ReadonlySet<Permission>>> = {
  owner: OWNER_PERMISSIONS,
  supervisor: SUPERVISOR_PERMISSIONS,
  member: MEMBER_PERMISSIONS,
};

/** Roles desconocidos no reciben permisos por defecto (fail closed). */
export function hasPermission(
  role: string | null | undefined,
  permission: Permission
): boolean {
  if (!role || !isAppRole(role)) return false;
  return ROLE_PERMISSIONS[role].has(permission);
}
