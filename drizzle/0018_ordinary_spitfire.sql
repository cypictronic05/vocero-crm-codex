CREATE TABLE "team_audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"target_member_id" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "status" text DEFAULT 'enabled' NOT NULL;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "weekly_schedule" jsonb DEFAULT '[{"day":0,"startMinute":360,"endMinute":1320},{"day":1,"startMinute":360,"endMinute":1320},{"day":2,"startMinute":360,"endMinute":1320},{"day":3,"startMinute":360,"endMinute":1320},{"day":4,"startMinute":360,"endMinute":1320},{"day":5,"startMinute":360,"endMinute":1320},{"day":6,"startMinute":360,"endMinute":1320}]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "team_audit_event" ADD CONSTRAINT "team_audit_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_audit_event" ADD CONSTRAINT "team_audit_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_audit_event_org_created_idx" ON "team_audit_event" USING btree ("organization_id","created_at");