ALTER TABLE "contractor_settings" ADD COLUMN "guide_state" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "contractor_settings" ADD COLUMN "guide_follow_up_ack_at" timestamp;