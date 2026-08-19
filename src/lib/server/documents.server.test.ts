import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateUpload } from './documents.server';
import { MAX_DOCUMENT_BYTES } from '$lib/crm';

/**
 * The database is never touched here — this project has no DB harness. The
 * validation rule is executed directly; the properties that live inside queries
 * (which viewer may reach what, where the billing guard lands, that bytes only
 * move through the seam) are asserted against the source, the way
 * billing.guard.test.ts and messaging.server.test.ts do.
 *
 * That is the right shape for this module in particular: its whole reason to
 * exist is that one rule replaced three, so what is worth pinning is that there
 * is still only one of each.
 */

describe('validateUpload', () => {
	/** A real PDF signature — validation reads bytes now, not the declared type. */
	const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, ...new Array(20).fill(0)]);
	const pdf = { mimeType: 'application/pdf', size: 1000, data: pdfBytes };

	it('accepts an allowed type whose content agrees', () => {
		expect(validateUpload(pdf)).toBeNull();
	});

	it('refuses an unsupported declared type', () => {
		expect(validateUpload({ ...pdf, mimeType: 'application/zip' })).toBe('unsupported type');
	});

	it('refuses a file over the limit, naming the limit', () => {
		expect(validateUpload({ ...pdf, size: MAX_DOCUMENT_BYTES + 1 })).toMatch(/larger than/);
	});

	it('accepts a file exactly at the limit', () => {
		expect(validateUpload({ ...pdf, size: MAX_DOCUMENT_BYTES })).toBeNull();
	});

	it('refuses an empty file', () => {
		// A zero-byte pick is almost always a cancelled dialog rather than intent.
		expect(validateUpload({ ...pdf, size: 0 })).toBe('empty file');
	});

	it('refuses a script wearing a PDF label', () => {
		// The declared type is allowed and the size is fine — only reading the
		// bytes catches this, which is the whole reason validation takes them.
		const shell = new Uint8Array([0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e, 0x2f, 0x73, 0x68]);
		expect(validateUpload({ ...pdf, data: shell })).toBe('scripts are not accepted');
	});

	it('refuses an archive wearing an image label', () => {
		const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(20).fill(0)]);
		expect(validateUpload({ mimeType: 'image/png', size: 500, data: zip })).toBe(
			'compressed archives are not accepted'
		);
	});

	it('checks size before content, so a huge file is refused without a scan', () => {
		const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
		expect(
			validateUpload({ mimeType: 'image/png', size: MAX_DOCUMENT_BYTES + 1, data: zip })
		).toMatch(/larger than/);
	});
});

const source = readFileSync('src/lib/server/documents.server.ts', 'utf8');

/** Extract a top-level `export [async] function name(...) { ... }` body. */
function functionBody(name: string): string {
	const start = source.search(new RegExp(`^export (?:async )?function ${name}\\b`, 'm'));
	if (start === -1) throw new Error(`${name} not found — was it renamed or removed?`);
	const end = source.indexOf('\n}', start);
	return source.slice(start, end === -1 ? undefined : end);
}

describe('there is exactly one authorization rule', () => {
	it.each([
		'listDocuments',
		'getDocument',
		'uploadDocuments',
		'markDocumentsRead',
		'renameDocument',
		'deleteDocument'
	])('%s authorizes through orderAccess', (fn) => {
		expect(functionBody(fn)).toMatch(/await orderAccess\(/);
	});

	it('withdrawDocument authorizes through getDocument, which authorizes in turn', () => {
		// It reaches orderAccess one level down rather than directly — the chain is
		// what matters, not the call site.
		expect(functionBody('withdrawDocument')).toMatch(/await getDocument\(viewer, documentId\)/);
		expect(functionBody('getDocument')).toMatch(/await orderAccess\(/);
	});

	it('scopes each role by its own relationship to the order', () => {
		const access = functionBody('orderAccess');
		expect(access).toMatch(/eq\(order\.contractorId, viewer\.userId\)/);
		expect(access).toMatch(/eq\(customer\.userId, viewer\.userId\)/);
		expect(access).toMatch(/eq\(subcontractor\.userId, viewer\.userId\)/);
	});

	it('excludes deleted orders for every role', () => {
		// Three branches, three predicates — a missing one would expose a deleted
		// order's documents to exactly one role, which is the hardest kind to spot.
		const access = functionBody('orderAccess');
		expect(access.match(/isNull\(order\.deletedAt\)/g)).toHaveLength(3);
	});

	it('gives a guest subcontractor read access and no more', () => {
		expect(functionBody('orderAccess')).toMatch(/canWrite: row\.tier === 'trusted'/);
	});
});

describe('a customer only ever reaches their own uploads', () => {
	it('filters the list to customer uploads', () => {
		expect(functionBody('listDocuments')).toMatch(
			/viewer\.role === 'customer'[\s\S]*?eq\(document\.uploadedByRole, 'customer'\)/
		);
	});

	it('refuses a single contractor document to a customer', () => {
		// The list filter alone is not enough — a direct fetch by id must refuse too.
		expect(functionBody('getDocument')).toMatch(
			/viewer\.role === 'customer' && row\.uploadedByRole !== 'customer'/
		);
	});
});

describe('the billing guard is asymmetric by construction', () => {
	it('guards the contractor branch of upload only', () => {
		// ADR-0005: a customer sending their contractor a permit must not break
		// because that contractor's card failed.
		expect(functionBody('uploadDocuments')).toMatch(
			/if \(viewer\.role === 'contractor'\) await assertCanWrite\(/
		);
	});

	it('never guards a read or a customer write', () => {
		for (const fn of ['listDocuments', 'getDocument', 'getDocumentBytes', 'withdrawDocument']) {
			expect(functionBody(fn)).not.toMatch(/assertCanWrite\(/);
		}
	});
});

describe('per-file outcomes', () => {
	const upload = functionBody('uploadDocuments');

	it('validates inside the loop, not before it', () => {
		// Validating the batch up front is how one bad file comes to cost the rest.
		expect(upload).toMatch(/for \(const file of files\)[\s\S]*?validateUpload\(file\)/);
	});

	it('continues past a refused file rather than throwing', () => {
		expect(upload).toMatch(/outcomes\.push\(\{ ok: false[\s\S]*?continue;/);
	});

	it('notifies and records history once for the batch, not once per file', () => {
		expect(upload).toMatch(
			/if \(stored > 0\) \{[\s\S]*?await notifyUpload\([\s\S]*?await recordDocumentHistory\(/
		);
	});

	it('records only the files that actually stored', () => {
		// storedNames is pushed inside the success path, so a refused file never
		// appears in the history entry.
		expect(upload).toMatch(/storedNames\.push\(/);
		expect(upload).toMatch(/'added', storedNames/);
	});
});

describe('withdrawal is gated on the contractor having read it', () => {
	const withdraw = functionBody('withdrawDocument');

	it('refuses once read', () => {
		expect(withdraw).toMatch(/if \(meta\.readByContractorAt\) throw new DocumentAlreadyReadError/);
	});

	it('refuses anyone but the uploading customer', () => {
		expect(withdraw).toMatch(/viewer\.role !== 'customer'/);
		expect(withdraw).toMatch(/meta\.uploadedByRole !== 'customer'/);
	});
});

describe('document events reach the order history', () => {
	const history = source.slice(source.indexOf('async function recordDocumentHistory'));

	it('writes a timeline entry', () => {
		// Documents belong in the history in a way messages do not: the timeline
		// records what happened to the job, and a permit arriving is that.
		expect(history).toMatch(/db\.insert\(timelineEntry\)/);
	});

	it('hides a contractor or subcontractor upload from the customer', () => {
		// A customer-visible "Document added: quote.pdf" they cannot open would be
		// worse than silence.
		expect(history).toMatch(/internal: viewer\.role !== 'customer'/);
	});

	it('is recorded on removal as well as on arrival', () => {
		expect(functionBody('deleteDocument')).toMatch(/recordDocumentHistory\([\s\S]*?'removed'/);
		expect(functionBody('withdrawDocument')).toMatch(/recordDocumentHistory\([\s\S]*?'removed'/);
	});
});

describe('there is one route, and it decides nothing for itself', () => {
	const route = readFileSync('src/routes/documents/[documentId]/+server.ts', 'utf8');

	it('resolves the viewer rather than assuming a role', () => {
		// The two endpoints this replaced each hard-coded their own role check, and
		// each had a slightly different idea of what that role could reach.
		expect(route).toMatch(/viewerFromLocals\(locals\)/);
		expect(route).toMatch(/getDocumentBytes\(viewer, params\.documentId\)/);
	});

	it('carries no authorization rule of its own', () => {
		// Anything role-shaped here would be the duplication growing back.
		expect(route).not.toMatch(/role === '(contractor|customer|subcontractor)'/);
		expect(route).not.toMatch(/\bdb\b/);
	});

	it('refuses every unauthorized viewer, not merely a signed-out one', () => {
		// getDocumentBytes returns null for a role with no relationship to the
		// order, and this is where that becomes a 404 rather than bytes. A 404 and
		// not a 403: a document someone may not reach should not be confirmed to
		// exist at all.
		expect(route).toMatch(/if \(!found\) error\(404/);
	});

	it('serves a download as well as an inline render', () => {
		expect(route).toMatch(/url\.searchParams\.has\('dl'\)/);
		expect(route).toMatch(/Content-Disposition/);
		expect(route).toMatch(/filename="\$\{safeName\}"/);
	});
});

describe('no surface links at a document’s bytes', () => {
	/** Every .svelte file under src, which is where a stray link would appear. */
	function svelteFiles(dir: string): string[] {
		const out: string[] = [];
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) out.push(...svelteFiles(full));
			else if (entry.name.endsWith('.svelte')) out.push(full);
		}
		return out;
	}

	/**
	 * An <a> whose href reaches a document, in either the current shape or the one
	 * this change replaced. The viewer's own bar is the deliberate exception —
	 * those links are the way OUT of the overlay, not the way in.
	 */
	const BYTE_LINK = /<a\b[^>]*href=[^>]*(documentHref|\/documents\/|\/attachment\/)/;

	it('the check would catch a direct link', () => {
		// A source-reading test that matches nothing is worth nothing, so the
		// pattern is exercised against the exact shape it exists to forbid.
		expect(BYTE_LINK.test('<a class="doc" href={documentHref(d.id)}>{d.filename}</a>')).toBe(true);
		expect(BYTE_LINK.test('<button onclick={() => (preview = d)}>{d.filename}</button>')).toBe(
			false
		);
	});

	it('opens documents through the viewer, never through an <a>', () => {
		// The bug this whole change exists to fix: an <a href> at the bytes replaces
		// the page with a bare file and leaves the back button as the only exit.
		const offenders = svelteFiles('src')
			.filter((f) => !f.endsWith('DocumentViewer.svelte'))
			.filter((f) => BYTE_LINK.test(readFileSync(f, 'utf8')));
		expect(offenders).toEqual([]);
	});
});

describe('bytes move only through the seam', () => {
	it('never selects or writes the data column directly', () => {
		// The seam exists so an object-store backend is a module swap. A direct
		// `document.data` here is that plan quietly coming undone.
		expect(source).not.toMatch(/document\.data/);
	});

	it('writes, reads and deletes through document-store', () => {
		expect(source).toMatch(/from '\.\/document-store'/);
		expect(functionBody('uploadDocuments')).toMatch(/await putBytes\(/);
		expect(functionBody('getDocumentBytes')).toMatch(/await getBytes\(/);
		expect(functionBody('deleteDocument')).toMatch(/await deleteBytes\(/);
		expect(functionBody('withdrawDocument')).toMatch(/await deleteBytes\(/);
	});

	it('does not carry bytes in the insert', () => {
		// `data: file.data` in the values object would be the seam quietly coming
		// undone — the row would arrive with its bytes and putBytes would be dead.
		expect(functionBody('uploadDocuments')).not.toMatch(/data: file\.data/);
	});
});
