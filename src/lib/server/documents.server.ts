import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from './db';
import {
	customer,
	document,
	notification,
	order,
	orderSubcontractor,
	subcontractor,
	timelineEntry
} from './db/schema';
import {
	MAX_DOCUMENT_BYTES,
	checkUploadContent,
	formatBytes,
	safeFilename,
	splitFilename
} from '$lib/crm';
import { assertCanWrite } from './billing.server';
import { deleteBytes, getBytes, putBytes } from './document-store';

/**
 * Documents on an Order — one entity, one upload path, one authorization rule.
 *
 * This module exists because the same question ("may this person open this
 * file?") previously had three answers living in three places, and a fix to one
 * of them was not a fix to the others. Every read and write below authorizes
 * from the `Viewer` it is handed, never from the surface that called it.
 *
 * Bytes are reached through `document-store`, never from the table directly.
 */

export type DocumentRow = typeof document.$inferSelect;

/** Who is asking. Mirrors the union `messaging.server.ts` already proved out. */
export type Viewer =
	| { role: 'contractor'; userId: string }
	| {
			role: 'customer';
			userId: string;
			/**
			 * Development-only: a Contractor looking at one of their own customers'
			 * portals (ADR-0008). When set, the scope comes from the Customer row
			 * rather than from `userId` — which is the contractor's — and every write
			 * is refused, because there is no Customer here to attribute one to.
			 */
			customerId?: string;
	  }
	| { role: 'subcontractor'; userId: string };

/**
 * The viewer this request is being made by, or null when nobody is signed in.
 *
 * Every document surface resolves its viewer here rather than assembling one, so
 * the view-as case is handled once instead of being remembered three times.
 */
export function viewerFromLocals(locals: App.Locals): Viewer | null {
	if (!locals.user) return null;
	if (locals.viewAs) {
		return { role: 'customer', userId: locals.user.id, customerId: locals.viewAs.customerId };
	}
	const role = locals.user.role;
	if (role !== 'contractor' && role !== 'customer' && role !== 'subcontractor') return null;
	return { role, userId: locals.user.id };
}

export type DocumentMeta = {
	id: string;
	orderId: string;
	filename: string;
	mimeType: string;
	size: number;
	uploadedByRole: string;
	note: string | null;
	createdAt: Date;
	/** Null until the contractor has opened this order's documents. */
	readByContractorAt: Date | null;
};

const META = {
	id: document.id,
	orderId: document.orderId,
	filename: document.filename,
	mimeType: document.mimeType,
	size: document.size,
	uploadedByRole: document.uploadedByRole,
	note: document.note,
	createdAt: document.createdAt,
	readByContractorAt: document.readByContractorAt
};

/** Thrown when a Guest Contractor attempts a write their Tier forbids. */
export class DocumentWriteForbiddenError extends Error {
	constructor(message = 'Your access level is read-only on this job') {
		super(message);
		this.name = 'DocumentWriteForbiddenError';
	}
}

/** Thrown when a withdrawal is refused because the contractor already read it. */
export class DocumentAlreadyReadError extends Error {
	constructor() {
		super('Your contractor has already seen this document, so it can’t be taken back');
		this.name = 'DocumentAlreadyReadError';
	}
}

/**
 * May this viewer reach documents on this order — and if so, on what terms?
 *
 * One function, three branches. The duplication this replaces is how the
 * customer and contractor download endpoints came to have subtly different rules.
 */
export async function orderAccess(
	viewer: Viewer,
	orderId: string
): Promise<{ contractorId: string; customerName: string; canWrite: boolean } | null> {
	if (viewer.role === 'contractor') {
		const [row] = await db
			.select({ contractorId: order.contractorId, customerName: customer.name })
			.from(order)
			.leftJoin(customer, eq(order.customerId, customer.id))
			.where(
				and(eq(order.id, orderId), eq(order.contractorId, viewer.userId), isNull(order.deletedAt))
			)
			.limit(1);
		return row
			? { ...row, customerName: row.customerName ?? 'your customer', canWrite: true }
			: null;
	}

	if (viewer.role === 'customer') {
		// Normally the Customer's own User. Under view-as it is the Customer row
		// itself, and the view is read-only — see the note on `Viewer`.
		const viewing = viewer.customerId !== undefined;
		const [row] = await db
			.select({ contractorId: order.contractorId, customerName: customer.name })
			.from(order)
			.innerJoin(customer, eq(order.customerId, customer.id))
			.where(
				and(
					eq(order.id, orderId),
					viewing ? eq(customer.id, viewer.customerId!) : eq(customer.userId, viewer.userId),
					isNull(order.deletedAt)
				)
			)
			.limit(1);
		return row ? { ...row, canWrite: !viewing } : null;
	}

	// Subcontractor: assigned to the order, and Tier decides whether they may
	// write. Guests read only — the same rule their order view already applies.
	const [row] = await db
		.select({
			contractorId: order.contractorId,
			customerName: customer.name,
			tier: subcontractor.tier
		})
		.from(orderSubcontractor)
		.innerJoin(subcontractor, eq(orderSubcontractor.subcontractorId, subcontractor.id))
		.innerJoin(order, eq(orderSubcontractor.orderId, order.id))
		.leftJoin(customer, eq(order.customerId, customer.id))
		.where(
			and(
				eq(orderSubcontractor.orderId, orderId),
				eq(subcontractor.userId, viewer.userId),
				isNull(order.deletedAt)
			)
		)
		.limit(1);
	return row
		? {
				contractorId: row.contractorId,
				customerName: row.customerName ?? 'the customer',
				canWrite: row.tier === 'trusted'
			}
		: null;
}

/**
 * Which documents on an order this viewer may see.
 *
 * A Customer sees only what they sent. What the Contractor attached stays theirs
 * until sharing exists as a concept — a deliberate hold, not an oversight.
 */
export async function listDocuments(viewer: Viewer, orderId: string): Promise<DocumentMeta[]> {
	const access = await orderAccess(viewer, orderId);
	if (!access) return [];
	const scope =
		viewer.role === 'customer'
			? and(eq(document.orderId, orderId), eq(document.uploadedByRole, 'customer'))
			: eq(document.orderId, orderId);
	return db.select(META).from(document).where(scope).orderBy(desc(document.createdAt));
}

/** One document's metadata, or null when this viewer may not reach it. */
export async function getDocument(
	viewer: Viewer,
	documentId: string
): Promise<DocumentMeta | null> {
	const [row] = await db.select(META).from(document).where(eq(document.id, documentId)).limit(1);
	if (!row) return null;
	const access = await orderAccess(viewer, row.orderId);
	if (!access) return null;
	// A customer may only reach their own uploads.
	if (viewer.role === 'customer' && row.uploadedByRole !== 'customer') return null;
	return row;
}

/** A document's bytes, authorized exactly as its metadata is. */
export async function getDocumentBytes(
	viewer: Viewer,
	documentId: string
): Promise<{ meta: DocumentMeta; data: Buffer } | null> {
	const meta = await getDocument(viewer, documentId);
	if (!meta) return null;
	const data = await getBytes(documentId);
	return data ? { meta, data } : null;
}

export type UploadInput = {
	filename: string;
	mimeType: string;
	size: number;
	data: Buffer;
	/** What this document is, in the uploader's words. */
	note?: string;
};
export type UploadOutcome =
	{ ok: true; filename: string } | { ok: false; filename: string; reason: string };

/**
 * Validate one file — size from the metadata, type from the BYTES.
 *
 * The MIME an upload declares comes from the browser and is trivially spoofed,
 * so the content is read and the two must agree. `checkUploadContent` is what
 * refuses a shell script named `receipt.pdf`, and what refuses every zip —
 * including .docx/.xlsx, which are zip containers.
 */
export function validateUpload(file: {
	mimeType: string;
	size: number;
	data: Uint8Array;
}): string | null {
	if (file.size === 0) return 'empty file';
	if (file.size > MAX_DOCUMENT_BYTES) return `larger than ${formatBytes(MAX_DOCUMENT_BYTES)}`;
	return checkUploadContent(file.mimeType, file.data);
}

/**
 * Store one or more documents against an order.
 *
 * Validation is PER FILE and a failure is not contagious: picking five files
 * where one is oversized sends the other four and names the one that was
 * refused. Aborting the batch punishes someone for one mistake; dropping it
 * silently lets them believe they sent something they did not.
 *
 * The billing guard applies to a contractor and to nobody else — a customer's
 * write never depends on their contractor's subscription
 * (docs/adr/0005-lapsing-never-reaches-customers.md).
 */
export async function uploadDocuments(
	viewer: Viewer,
	orderId: string,
	files: UploadInput[]
): Promise<UploadOutcome[]> {
	const access = await orderAccess(viewer, orderId);
	if (!access) throw new Error('Order not found');
	if (!access.canWrite) throw new DocumentWriteForbiddenError();
	if (viewer.role === 'contractor') await assertCanWrite(access.contractorId);

	const outcomes: UploadOutcome[] = [];
	const storedNames: string[] = [];
	let stored = 0;
	for (const file of files) {
		const problem = validateUpload(file);
		if (problem) {
			outcomes.push({ ok: false, filename: file.filename, reason: problem });
			continue;
		}
		// The stem may have come from a rename field; the extension never does, so
		// a renamed document always still opens.
		const { stem, ext } = splitFilename(file.filename);
		// The row is created without its bytes, which then go through the seam —
		// `data` is NOT NULL, so it takes an empty placeholder for the moment
		// between the two statements. That costs one trivial write and buys the
		// property the seam exists for: an object-store backend changes
		// `document-store` and nothing else.
		const [row] = await db
			.insert(document)
			.values({
				orderId,
				contractorId: access.contractorId,
				filename: safeFilename(stem, ext),
				mimeType: file.mimeType,
				size: file.size,
				data: Buffer.alloc(0),
				uploadedByRole: viewer.role,
				uploadedByUserId: viewer.userId,
				note: file.note?.trim() || null
			})
			.returning({ id: document.id });
		await putBytes(row.id, file.data);
		stored += 1;
		storedNames.push(safeFilename(stem, ext));
		outcomes.push({ ok: true, filename: file.filename });
	}

	// One notification and one history entry for the batch, not one per file.
	if (stored > 0) {
		await notifyUpload(viewer, access, orderId, stored);
		await recordDocumentHistory(viewer, orderId, 'added', storedNames);
	}
	return outcomes;
}

async function notifyUpload(
	viewer: Viewer,
	access: { contractorId: string; customerName: string },
	orderId: string,
	count: number
): Promise<void> {
	const noun = count === 1 ? 'document' : `${count} documents`;
	if (viewer.role === 'contractor') return; // the contractor is the recipient
	await db.insert(notification).values({
		userId: access.contractorId,
		orderId,
		title:
			viewer.role === 'customer'
				? `${noun === 'document' ? 'Document' : noun} from ${access.customerName}`
				: `${noun === 'document' ? 'Document' : noun} from a subcontractor`,
		detail: ''
	});
}

/**
 * Record a document event on the Order's timeline.
 *
 * Documents belong in the history in a way messages do not: the timeline records
 * what happened to the job, and a permit arriving or a receipt being withdrawn
 * is a thing that happened. (A message is what was *said* about the job, which is
 * why threads stay out — see CONTEXT.md.)
 *
 * Visibility follows who can actually open the document. A Customer's upload is
 * visible to both, because both can see it. A Contractor's or Subcontractor's is
 * internal — a customer-visible "Document added: quote.pdf" they cannot open
 * would be worse than silence.
 */
async function recordDocumentHistory(
	viewer: Viewer,
	orderId: string,
	action: 'added' | 'removed',
	filenames: string[]
): Promise<void> {
	if (filenames.length === 0) return;
	const count = filenames.length;
	const who =
		viewer.role === 'customer'
			? 'Customer'
			: viewer.role === 'subcontractor'
				? 'Subcontractor'
				: '';
	await db.insert(timelineEntry).values({
		orderId,
		kind: 'milestone',
		title: `${who ? who + ' ' : ''}document${count === 1 ? '' : 's'} ${action}`.trim(),
		detail: count === 1 ? filenames[0] : filenames.join(', '),
		authorRole: viewer.role === 'customer' ? 'customer' : 'contractor',
		internal: viewer.role !== 'customer'
	});
}

/** Set a document's note. Anyone who may write on the order may label it. */
export async function updateDocument(
	viewer: Viewer,
	documentId: string,
	input: { note?: string }
): Promise<void> {
	const meta = await getDocument(viewer, documentId);
	if (!meta) throw new Error('Document not found');
	const access = await orderAccess(viewer, meta.orderId);
	if (!access?.canWrite) throw new DocumentWriteForbiddenError();
	if (viewer.role === 'contractor') await assertCanWrite(access.contractorId);
	await db
		.update(document)
		.set({
			note: input.note?.trim() || null
		})
		.where(eq(document.id, documentId));
}

/**
 * Mark this order's documents read for the contractor side. Opening the order's
 * files is what does it — which is also what closes the window on a customer's
 * withdrawal.
 */
export async function markDocumentsRead(viewer: Viewer, orderId: string): Promise<void> {
	if (viewer.role !== 'contractor') return;
	const access = await orderAccess(viewer, orderId);
	if (!access) return;
	await db
		.update(document)
		.set({ readByContractorAt: new Date() })
		.where(and(eq(document.orderId, orderId), isNull(document.readByContractorAt)));
}

/** Rename a document. The extension is never taken from the supplied name. */
export async function renameDocument(
	viewer: Viewer,
	documentId: string,
	stem: string
): Promise<void> {
	const meta = await getDocument(viewer, documentId);
	if (!meta) throw new Error('Document not found');
	const access = await orderAccess(viewer, meta.orderId);
	if (!access?.canWrite) throw new DocumentWriteForbiddenError();
	if (viewer.role === 'contractor') await assertCanWrite(access.contractorId);
	const { ext } = splitFilename(meta.filename);
	await db
		.update(document)
		.set({ filename: safeFilename(stem, ext) })
		.where(eq(document.id, documentId));
}

/** A contractor removing any document on their own order. */
export async function deleteDocument(viewer: Viewer, documentId: string): Promise<void> {
	const meta = await getDocument(viewer, documentId);
	if (!meta) throw new Error('Document not found');
	const access = await orderAccess(viewer, meta.orderId);
	if (!access) throw new Error('Document not found');
	if (viewer.role !== 'contractor') throw new DocumentWriteForbiddenError();
	await assertCanWrite(access.contractorId);
	await deleteBytes(documentId);
	await db.delete(document).where(eq(document.id, documentId));
	await recordDocumentHistory(viewer, meta.orderId, 'removed', [meta.filename]);
}

/**
 * A customer taking back something they sent — but only until it has been read.
 * A document the contractor has seen is a record of what was exchanged, not a
 * draft, so the refusal says so rather than the control quietly vanishing.
 */
export async function withdrawDocument(viewer: Viewer, documentId: string): Promise<void> {
	if (viewer.role !== 'customer') throw new DocumentWriteForbiddenError();
	const meta = await getDocument(viewer, documentId);
	if (!meta) throw new Error('Document not found');
	const access = await orderAccess(viewer, meta.orderId);
	// False under view-as: a developer looking at the portal must not be able to
	// take back something a real customer sent (ADR-0008).
	if (!access?.canWrite) throw new DocumentWriteForbiddenError();
	if (meta.uploadedByRole !== 'customer') throw new DocumentWriteForbiddenError();
	if (meta.readByContractorAt) throw new DocumentAlreadyReadError();
	await deleteBytes(documentId);
	await db.delete(document).where(eq(document.id, documentId));
	await recordDocumentHistory(viewer, meta.orderId, 'removed', [meta.filename]);
}

/** Unread document counts per order, for the contractor's order list. */
export async function unreadDocumentOrders(contractorId: string): Promise<Set<string>> {
	const rows = await db
		.selectDistinct({ orderId: document.orderId })
		.from(document)
		.innerJoin(order, eq(document.orderId, order.id))
		.where(
			and(
				eq(order.contractorId, contractorId),
				isNull(order.deletedAt),
				isNull(document.readByContractorAt)
			)
		);
	return new Set(rows.map((r) => r.orderId));
}
