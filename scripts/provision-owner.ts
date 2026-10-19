/**
 * Aprovisionamiento inicial fuera de HTTP para una instancia cerrada.
 * Se ejecuta manualmente dentro del contenedor de la app y solo funciona si
 * no existen organizaciones NI usuarios. Nunca imprime contraseña ni hash.
 */
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { customAlphabet } from "nanoid";
import postgres from "postgres";
import { z } from "zod";
import { DEFAULT_WEEKLY_SCHEDULE } from "@/lib/team";

const inputSchema = z.object({
  databaseUrl: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
  confirmation: z.literal("NEXORA_PROVISION_OWNER"),
});

const input = inputSchema.safeParse({
  databaseUrl: process.env.DATABASE_URL,
  name: process.env.INITIAL_OWNER_NAME,
  email: process.env.INITIAL_OWNER_EMAIL,
  password: process.env.INITIAL_OWNER_PASSWORD,
  confirmation: process.env.PROVISION_OWNER_CONFIRM,
});

if (!input.success) {
  console.error(
    "Aprovisionamiento cancelado. Define INITIAL_OWNER_NAME, " +
      "INITIAL_OWNER_EMAIL, INITIAL_OWNER_PASSWORD (mínimo 12) y " +
      "PROVISION_OWNER_CONFIRM=NEXORA_PROVISION_OWNER.",
  );
  process.exit(2);
}

const passwordHash = await hashPassword(input.data.password);
if (!(await verifyPassword({ hash: passwordHash, password: input.data.password }))) {
  throw new Error("El hash generado no se pudo verificar; no se modificó la base");
}

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const random = customAlphabet(alphabet, 20);
const id = (prefix: string) => `${prefix}_${random()}`;
const userId = id("usr");
const accountId = id("acc");
const organizationId = id("org");
const memberId = id("mem");

const stages = [
  { name: "Nuevo", kind: "open" },
  { name: "En conversación", kind: "open" },
  { name: "Interesado", kind: "open" },
  { name: "Cliente", kind: "won" },
  { name: "Perdido", kind: "lost" },
] as const;

const sql = postgres(input.data.databaseUrl, { max: 1, connect_timeout: 10 });
try {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(874201)`;
    const [state] = await tx<[{ organizations: number; users: number }]>`
      select
        (select count(*)::int from organization) as organizations,
        (select count(*)::int from "user") as users
    `;
    if (!state || state.organizations !== 0 || state.users !== 0) {
      throw new Error(
        "La instancia ya contiene usuarios u organizaciones; usa migración o recuperación, no aprovisionamiento",
      );
    }

    await tx`
      insert into "user" (id, name, email, email_verified)
      values (${userId}, ${input.data.name}, ${input.data.email}, true)
    `;
    await tx`
      insert into account (id, account_id, provider_id, user_id, password)
      values (${accountId}, ${userId}, 'credential', ${userId}, ${passwordHash})
    `;
    await tx`
      insert into organization (id, name, slug)
      values (${organizationId}, ${`Nexora — ${input.data.name}`}, 'principal')
    `;
    await tx`
      insert into member (id, organization_id, user_id, role)
      values (${memberId}, ${organizationId}, ${userId}, 'owner')
    `;
    await tx`
      insert into team_audit_event
        (id, organization_id, actor_user_id, target_member_id, action, before, after)
      values (
        ${id("tae")}, ${organizationId}, ${userId}, ${memberId},
        'member_created', null,
        ${JSON.stringify({
          role: "owner",
          status: "enabled",
          weeklySchedule: DEFAULT_WEEKLY_SCHEDULE,
          source: "console_provisioning",
        })}::jsonb
      )
    `;
    for (const [position, stage] of stages.entries()) {
      await tx`
        insert into pipeline_stage (id, organization_id, name, position, kind)
        values (${id("stg")}, ${organizationId}, ${stage.name}, ${position}, ${stage.kind})
      `;
    }
    await tx`
      insert into agent_profile (id, organization_id)
      values (${id("agp")}, ${organizationId})
    `;
  });
  console.log("Propietario inicial creado de forma transaccional. El registro público continúa cerrado.");
} finally {
  await sql.end({ timeout: 5 });
}
