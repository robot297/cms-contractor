CREATE TABLE "line_item" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"label" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "site_address" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "site_city" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "site_state" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "site_postal_code" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "start_date" timestamp;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "target_date" timestamp;--> statement-breakpoint
ALTER TABLE "line_item" ADD CONSTRAINT "line_item_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "line_item_orderId_position_idx" ON "line_item" USING btree ("order_id","position");