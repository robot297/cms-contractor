ALTER TABLE "customer" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;