ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;
ALTER TABLE "lead" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;
CREATE INDEX IF NOT EXISTS "conversation_org_archived_idx" ON "conversation" ("organization_id", "archived_at");
CREATE INDEX IF NOT EXISTS "lead_org_archived_idx" ON "lead" ("organization_id", "archived_at");
CREATE TABLE IF NOT EXISTS "delivery_preparation_event" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "actor_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "action" text NOT NULL,
  "details" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "delivery_preparation_org_created_idx" ON "delivery_preparation_event" ("organization_id", "created_at");
