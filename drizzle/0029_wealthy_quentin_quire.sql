CREATE TABLE "payment" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"kind" text DEFAULT 'progress' NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" text,
	"note" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_orderId_receivedAt_idx" ON "payment" USING btree ("order_id","received_at");--> statement-breakpoint
-- Backfill: every order closed out as paid under ADR-0010 becomes one `final`
-- payment row, so the new arithmetic (balance = total − sum(payments)) reports
-- those jobs as settled rather than as fully outstanding. Without this, every
-- historically-paid job would show its whole total as a balance due the moment
-- the invoice starts being rendered from payment rows.
--
-- `order.paid_at` / `order.payment_method` are left in place and are no longer
-- read: the row they seeded is now the record. See the schema comment.
INSERT INTO "payment" ("id", "order_id", "kind", "amount_cents", "method", "note", "received_at", "created_at")
SELECT
	gen_random_uuid()::text,
	"id",
	'final',
	COALESCE("final_amount_cents", 0),
	"payment_method",
	NULL,
	"paid_at",
	"paid_at"
FROM "order"
WHERE "paid_at" IS NOT NULL;
