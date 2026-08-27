ALTER TABLE "order_subcontractor" ADD COLUMN "starts_on" date;--> statement-breakpoint
ALTER TABLE "order_subcontractor" ADD COLUMN "ends_on" date;--> statement-breakpoint
ALTER TABLE "order_subcontractor" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "order_subcontractor" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "worker" ADD COLUMN "company" text;--> statement-breakpoint
CREATE INDEX "order_subcontractor_startsOn_idx" ON "order_subcontractor" USING btree ("starts_on");