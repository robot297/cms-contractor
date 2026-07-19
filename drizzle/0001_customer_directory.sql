CREATE TABLE "customer" (
	"id" text PRIMARY KEY NOT NULL,
	"contractor_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"user_id" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order" DROP CONSTRAINT "order_customer_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "order_customerEmail_idx";--> statement-breakpoint
ALTER TABLE "customer_invite" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_invite" ADD COLUMN "customer_id" text;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_contractor_id_user_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_contractor_email_idx" ON "customer" USING btree ("contractor_id","email");--> statement-breakpoint
CREATE INDEX "customer_contractorId_idx" ON "customer" USING btree ("contractor_id");--> statement-breakpoint
CREATE INDEX "customer_userId_idx" ON "customer" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "customer_invite" ADD CONSTRAINT "customer_invite_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invite_customerId_idx" ON "customer_invite" USING btree ("customer_id");--> statement-breakpoint
ALTER TABLE "order" DROP COLUMN "customer_name";--> statement-breakpoint
ALTER TABLE "order" DROP COLUMN "customer_email";