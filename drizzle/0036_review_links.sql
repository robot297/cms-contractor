CREATE TABLE "review_link" (
	"contractor_id" text NOT NULL,
	"platform" text NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "review_link_contractor_id_platform_pk" PRIMARY KEY("contractor_id","platform")
);
--> statement-breakpoint
ALTER TABLE "review_link" ADD CONSTRAINT "review_link_contractor_id_user_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;