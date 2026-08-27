ALTER TABLE "contractor_settings" ADD COLUMN "nav_placement" text DEFAULT 'top' NOT NULL;--> statement-breakpoint
ALTER TABLE "document" DROP COLUMN "tags";--> statement-breakpoint
ALTER TABLE "order" DROP COLUMN "tags";--> statement-breakpoint
ALTER TABLE "subcontractor" DROP COLUMN "tags";