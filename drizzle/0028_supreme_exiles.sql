ALTER TABLE "order" ADD COLUMN "final_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "final_notes" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "paid_at" timestamp;