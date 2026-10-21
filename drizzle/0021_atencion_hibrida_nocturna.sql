ALTER TABLE "conversation" ADD COLUMN "human_intervention_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "human_intervention_by_member_id" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "ai_schedule_start_minute" integer DEFAULT 1320 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "ai_schedule_end_minute" integer DEFAULT 360 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "ai_schedule_time_zone" text DEFAULT 'America/Bogota' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_human_intervention_by_member_id_member_id_fk" FOREIGN KEY ("human_intervention_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;