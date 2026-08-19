-- The `attachment` table becomes `document`.
--
-- The one non-additive migration this project has taken, and the reason it is
-- alone in its own file: the code cutover ships in the same deploy, and a
-- rollback is a reverse rename rather than a revert.
--
-- Constraint and index names are renamed alongside the table. Postgres does not
-- do this for you, and leaving them is how a schema ends up describing a table
-- that no longer exists. The renames are conditional because a database built by
-- `drizzle-kit push` may not carry exactly the names a generated migration would
-- have given it, and a cosmetic name must not be what fails the deploy.
ALTER TABLE "attachment" RENAME TO "document";--> statement-breakpoint
DO $$
DECLARE
	renames text[][] := ARRAY[
		ARRAY['attachment_orderId_idx', 'document_orderId_idx'],
		ARRAY['attachment_pkey', 'document_pkey'],
		ARRAY['attachment_order_id_order_id_fk', 'document_order_id_order_id_fk'],
		ARRAY['attachment_contractor_id_user_id_fk', 'document_contractor_id_user_id_fk'],
		ARRAY['attachment_uploaded_by_user_id_user_id_fk', 'document_uploaded_by_user_id_user_id_fk']
	];
	pair text[];
BEGIN
	FOREACH pair SLICE 1 IN ARRAY renames LOOP
		IF EXISTS (
			SELECT 1 FROM pg_constraint
			WHERE conname = pair[1] AND conrelid = 'public.document'::regclass
		) THEN
			EXECUTE format('ALTER TABLE public.document RENAME CONSTRAINT %I TO %I', pair[1], pair[2]);
		ELSIF EXISTS (
			SELECT 1 FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE c.relname = pair[1] AND n.nspname = 'public' AND c.relkind = 'i'
		) THEN
			EXECUTE format('ALTER INDEX public.%I RENAME TO %I', pair[1], pair[2]);
		END IF;
	END LOOP;
END $$;
