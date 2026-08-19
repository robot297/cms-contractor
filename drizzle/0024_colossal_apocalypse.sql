ALTER TABLE "attachment" ADD COLUMN "uploaded_by_user_id" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "read_by_contractor_at" timestamp;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;