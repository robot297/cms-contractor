CREATE TABLE "order_worker" (
	"order_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"role" text,
	"notes" text,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "order_worker_order_id_worker_id_pk" PRIMARY KEY("order_id","worker_id")
);
--> statement-breakpoint
CREATE TABLE "worker" (
	"id" text PRIMARY KEY NOT NULL,
	"contractor_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"role" text,
	"notes" text,
	"avatar" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_worker" ADD CONSTRAINT "order_worker_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_worker" ADD CONSTRAINT "order_worker_worker_id_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."worker"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker" ADD CONSTRAINT "worker_contractor_id_user_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_worker_workerId_idx" ON "order_worker" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "order_worker_startsOn_idx" ON "order_worker" USING btree ("starts_on");--> statement-breakpoint
CREATE INDEX "worker_contractorId_idx" ON "worker" USING btree ("contractor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "worker_contractor_email_idx" ON "worker" USING btree ("contractor_id","email") WHERE "worker"."email" is not null;