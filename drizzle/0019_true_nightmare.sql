CREATE TABLE "conversation_assignment_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"from_member_id" text,
	"to_member_id" text,
	"reason" text NOT NULL,
	"actor_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "assigned_member_id" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "assigned_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "assignment_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_assignment_event" ADD CONSTRAINT "conversation_assignment_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_assignment_event" ADD CONSTRAINT "conversation_assignment_event_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_assignment_event" ADD CONSTRAINT "conversation_assignment_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cae_org_conversation_created_idx" ON "conversation_assignment_event" USING btree ("organization_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "cae_org_created_idx" ON "conversation_assignment_event" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_assigned_member_id_member_id_fk" FOREIGN KEY ("assigned_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_org_assignee_idx" ON "conversation" USING btree ("organization_id","assigned_member_id","last_message_at");