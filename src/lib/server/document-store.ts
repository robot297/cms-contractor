import { eq } from 'drizzle-orm';
import { db } from './db';
import { document } from './db/schema';

/**
 * The one place a Document's bytes are touched.
 *
 * Today that is a `bytea` column, which is fine at this size and unchanged from
 * how the app has always stored these bytes. They were previously read and
 * written from five call sites across three modules; consolidating them is worth
 * doing on its own merits.
 *
 * That it also makes object storage a module swap rather than a rewrite is the
 * reason to do it now rather than later — multi-file upload means an Order's row
 * footprint grows faster than it used to, so the day that move is needed has got
 * closer. Deliberately three functions and no interface gymnastics: if S3 never
 * happens, what is left is still less duplication than before.
 */

/** Write a document's bytes. Called only from the upload path. */
export async function putBytes(documentId: string, bytes: Buffer): Promise<void> {
	await db.update(document).set({ data: bytes }).where(eq(document.id, documentId));
}

/** Read a document's bytes. Authorization is the caller's job, not this module's. */
export async function getBytes(documentId: string): Promise<Buffer | null> {
	const [row] = await db
		.select({ data: document.data })
		.from(document)
		.where(eq(document.id, documentId))
		.limit(1);
	return row?.data ?? null;
}

/**
 * Drop a document's bytes.
 *
 * A no-op while the bytes live in the row itself — deleting the row takes them
 * with it. It exists so the delete path already calls through the seam, and an
 * object-store backend has somewhere to put its cleanup instead of that being
 * the change that has to find every call site.
 */
export async function deleteBytes(documentId: string): Promise<void> {
	// Nothing to do for the in-row backend: deleting the row takes its bytes with
	// it. The id stays in the signature because it is part of the seam's contract
	// — an object-store backend needs it, and callers should not have to change
	// when the backend does.
	void documentId;
}
