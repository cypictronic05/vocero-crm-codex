CREATE TABLE "exchange_rate_audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"route_id" text,
	"quote_id" text,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rate_quote" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"route_id" text NOT NULL,
	"version" integer NOT NULL,
	"source_units" numeric(30, 12) NOT NULL,
	"destination_units" numeric(30, 12) NOT NULL,
	"commercial_rate" numeric(30, 12) NOT NULL,
	"precision" integer NOT NULL,
	"valid_from" timestamp NOT NULL,
	"valid_until" timestamp,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"published_by_user_id" text,
	"published_at" timestamp,
	"disabled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rate_quote_values_ck" CHECK ("exchange_rate_quote"."source_units" > 0 AND "exchange_rate_quote"."destination_units" > 0 AND "exchange_rate_quote"."commercial_rate" > 0),
	CONSTRAINT "exchange_rate_quote_precision_ck" CHECK ("exchange_rate_quote"."precision" BETWEEN 0 AND 12),
	CONSTRAINT "exchange_rate_quote_interval_ck" CHECK ("exchange_rate_quote"."valid_until" IS NULL OR "exchange_rate_quote"."valid_until" > "exchange_rate_quote"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "exchange_rate_request" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text,
	"request_text" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "exchange_rate_route" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"origin_country" text NOT NULL,
	"origin_currency" text NOT NULL,
	"destination_country" text NOT NULL,
	"destination_currency" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rate_route_distinct_ck" CHECK ("exchange_rate_route"."origin_country" <> "exchange_rate_route"."destination_country" OR "exchange_rate_route"."origin_currency" <> "exchange_rate_route"."destination_currency")
);
--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "can_manage_exchange_rates" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "exchange_rates_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "exchange_rate_audit_event" ADD CONSTRAINT "exchange_rate_audit_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate_audit_event" ADD CONSTRAINT "exchange_rate_audit_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate_audit_event" ADD CONSTRAINT "exchange_rate_audit_event_route_id_exchange_rate_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."exchange_rate_route"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate_audit_event" ADD CONSTRAINT "exchange_rate_audit_event_quote_id_exchange_rate_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."exchange_rate_quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate_quote" ADD CONSTRAINT "exchange_rate_quote_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate_quote" ADD CONSTRAINT "exchange_rate_quote_route_id_exchange_rate_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."exchange_rate_route"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate_quote" ADD CONSTRAINT "exchange_rate_quote_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate_quote" ADD CONSTRAINT "exchange_rate_quote_published_by_user_id_user_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate_request" ADD CONSTRAINT "exchange_rate_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate_request" ADD CONSTRAINT "exchange_rate_request_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate_request" ADD CONSTRAINT "exchange_rate_request_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate_route" ADD CONSTRAINT "exchange_rate_route_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate_route" ADD CONSTRAINT "exchange_rate_route_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exchange_rate_audit_org_created_idx" ON "exchange_rate_audit_event" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rate_quote_org_route_version_uq" ON "exchange_rate_quote" USING btree ("organization_id","route_id","version");--> statement-breakpoint
CREATE INDEX "exchange_rate_quote_org_status_valid_idx" ON "exchange_rate_quote" USING btree ("organization_id","status","valid_from","valid_until");--> statement-breakpoint
CREATE INDEX "exchange_rate_request_org_status_idx" ON "exchange_rate_request" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rate_route_org_direction_uq" ON "exchange_rate_route" USING btree ("organization_id","origin_country","origin_currency","destination_country","destination_currency");--> statement-breakpoint
CREATE INDEX "exchange_rate_route_org_active_idx" ON "exchange_rate_route" USING btree ("organization_id","active");