CREATE TABLE "order_message" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"author_role" text NOT NULL,
	"author_user_id" text NOT NULL,
	"body" text NOT NULL,
	"read_by_contractor_at" timestamp,
	"read_by_customer_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_message" ADD CONSTRAINT "order_message_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_message" ADD CONSTRAINT "order_message_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_message_orderId_createdAt_idx" ON "order_message" USING btree ("order_id","created_at");