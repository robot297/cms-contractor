CREATE TABLE "subscription" (
	"contractor_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'trialing' NOT NULL,
	"trial_ends_at" timestamp,
	"current_period_end" timestamp,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_contractor_id_user_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_stripe_subscription_idx" ON "subscription" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "subscription_stripe_customer_idx" ON "subscription" USING btree ("stripe_customer_id");--> statement-breakpoint
-- Backfill: every contractor who existed before billing shipped is comped
-- permanently — free, no Stripe record, never lapses. These are the people whose
-- feedback built the product; they do not get a paywall as a thank-you.
--
-- `ensureSubscription` applies the same rule at runtime via `shouldBeComped`
-- (BILLING_LAUNCHED_AT in src/lib/crm.ts), so the migration and the app cannot
-- classify the same contractor differently. Idempotent, so re-running is safe.
INSERT INTO "subscription" ("contractor_id", "status", "trial_ends_at")
SELECT "id", 'comped', NULL FROM "user" WHERE "role" = 'contractor'
ON CONFLICT ("contractor_id") DO NOTHING;