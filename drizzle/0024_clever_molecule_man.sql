CREATE TABLE "exchange_rate_country" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"country_code" text NOT NULL,
	"currency_code" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rate_country_code_ck" CHECK ("exchange_rate_country"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "exchange_rate_country_currency_ck" CHECK ("exchange_rate_country"."currency_code" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "exchange_rate_country" ADD CONSTRAINT "exchange_rate_country_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rate_country_org_country_uq" ON "exchange_rate_country" USING btree ("organization_id","country_code");--> statement-breakpoint
CREATE INDEX "exchange_rate_country_org_enabled_idx" ON "exchange_rate_country" USING btree ("organization_id","enabled");