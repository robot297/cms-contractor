ALTER TABLE "customer" ADD COLUMN "avatar" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "project_name" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "project_type" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "next_follow_up_at" timestamp;