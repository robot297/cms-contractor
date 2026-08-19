ALTER TABLE "attachment" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "timeline_entry" ADD COLUMN "expected_at" timestamp;