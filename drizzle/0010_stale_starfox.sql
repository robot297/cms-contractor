CREATE TABLE "contractor_settings" (
	"contractor_id" text PRIMARY KEY NOT NULL,
	"business_name" text DEFAULT '' NOT NULL,
	"signature" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_template" (
	"id" text PRIMARY KEY NOT NULL,
	"contractor_id" text NOT NULL,
	"name" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contractor_settings" ADD CONSTRAINT "contractor_settings_contractor_id_user_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_template" ADD CONSTRAINT "email_template_contractor_id_user_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_template_contractorId_idx" ON "email_template" USING btree ("contractor_id");