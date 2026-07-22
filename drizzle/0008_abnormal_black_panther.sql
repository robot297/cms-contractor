CREATE TABLE "order_subcontractor" (
	"order_id" text NOT NULL,
	"subcontractor_id" text NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "order_subcontractor_order_id_subcontractor_id_pk" PRIMARY KEY("order_id","subcontractor_id")
);
--> statement-breakpoint
CREATE TABLE "subcontractor" (
	"id" text PRIMARY KEY NOT NULL,
	"contractor_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"address" text,
	"company" text,
	"trade" text,
	"tier" text DEFAULT 'guest' NOT NULL,
	"license_number" text,
	"insurance_carrier" text,
	"insurance_expires_at" timestamp,
	"notes" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"avatar" text,
	"user_id" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subcontractor_invite" (
	"id" text PRIMARY KEY NOT NULL,
	"subcontractor_id" text,
	"contractor_id" text NOT NULL,
	"subcontractor_email" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subcontractor_invite_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "order_subcontractor" ADD CONSTRAINT "order_subcontractor_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_subcontractor" ADD CONSTRAINT "order_subcontractor_subcontractor_id_subcontractor_id_fk" FOREIGN KEY ("subcontractor_id") REFERENCES "public"."subcontractor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor" ADD CONSTRAINT "subcontractor_contractor_id_user_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor" ADD CONSTRAINT "subcontractor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_invite" ADD CONSTRAINT "subcontractor_invite_subcontractor_id_subcontractor_id_fk" FOREIGN KEY ("subcontractor_id") REFERENCES "public"."subcontractor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_invite" ADD CONSTRAINT "subcontractor_invite_contractor_id_user_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_subcontractor_subId_idx" ON "order_subcontractor" USING btree ("subcontractor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subcontractor_contractor_email_idx" ON "subcontractor" USING btree ("contractor_id","email");--> statement-breakpoint
CREATE INDEX "subcontractor_contractorId_idx" ON "subcontractor" USING btree ("contractor_id");--> statement-breakpoint
CREATE INDEX "subcontractor_userId_idx" ON "subcontractor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sub_invite_contractorId_idx" ON "subcontractor_invite" USING btree ("contractor_id");--> statement-breakpoint
CREATE INDEX "sub_invite_subcontractorId_idx" ON "subcontractor_invite" USING btree ("subcontractor_id");