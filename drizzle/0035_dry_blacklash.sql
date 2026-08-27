CREATE TABLE "customer_task" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"due_on" date,
	"blocking" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"completed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_task" ADD CONSTRAINT "customer_task_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_task_orderId_idx" ON "customer_task" USING btree ("order_id","completed_at");