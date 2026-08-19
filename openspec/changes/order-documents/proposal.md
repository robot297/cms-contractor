## Why

Documents are the part of a job that has to change hands: quotes, permits, receipts, sign-off sheets, the photo of the meter reading. The `customer-portal` change shipped a first pass — a Customer can send a file up and the Contractor sees it labelled — but it treated viewing as an afterthought, and the afterthought is where it broke. An attachment was opened by linking straight at its bytes, which replaces the page with a bare file and leaves the browser's back button as the only way out. That was patched twice, each time on one surface, each time leaving another.

The underlying problem is that this product has no **Document** concept. It has an `attachment` row with bytes in a column, three unrelated upload paths (contractor, subcontractor, customer), two download endpoints with duplicated authorization, and no shared answer to "how does a person look at one of these". Every surface improvises, so every surface improvises differently.

It also has an unstarted `customer-documents` change describing a _fourth_ model — a separate `document` table on local disk with tags and sharing — which would leave the product with two document systems that disagree.

## What Changes

- Introduce **Document** as a domain concept: one file attached to one Order, with an owner, an uploader, a name, and a type. It replaces "attachment" in the ubiquitous language and absorbs what the `attachment` table already stores.
- **One viewer, everywhere.** Opening a Document renders it over the current page and never navigates. PDFs are the primary case and are rendered as such — a portrait document at readable width with page scrolling — with images handled as one type among several rather than the design centre. Every surface that lists Documents uses it: the Customer portal, the Contractor's order workspace, and the Subcontractor portal.
- **A viewer that cannot trap you.** Close by control, backdrop, and Escape; a file the browser cannot render inline falls back to an explicit download and open-in-new-tab rather than a blank frame.
- **One authorization path.** A single `documentAccess(viewer, documentId)` resolves who may read a Document, replacing the per-route checks currently duplicated across three download endpoints.
- **Unified upload, many files at once.** One validated upload path taking the uploader's role, so the contractor, customer and subcontractor flows stop drifting apart. A person may select several files in one go, name each on the confirm step, and drop any before sending. A file that fails validation SHALL NOT cost the rest of the batch — partial success is reported per file rather than swallowing or aborting everything.
- **Delete and rename**, scoped by who uploaded: a Contractor manages any Document on their Order; a Customer may withdraw one they sent and has not yet been read.
- **BREAKING (internal):** `customer-documents` is superseded. Its local-disk `document` table, tag vocabulary and share-toggle model are folded into this change or explicitly deferred; it is archived unimplemented rather than left to contradict this.

- **A single seam for bytes.** Reading and writing a Document's bytes moves behind one small module. Bytes stay in Postgres today; object storage is a known upcoming need and this is what makes it a contained swap rather than a rewrite across five call sites.

Out of scope (deferred): object storage itself — the seam is built, the S3 backend is not, because moving existing bytes is its own migration with its own risk. Also deferred: virus scanning, versioning, e-signature, and the contractor→customer _sharing_ toggle, which needs its own decision about default visibility and is not what is broken today.

## Capabilities

### New Capabilities

- `order-documents`: Documents on an Order — the entity, one validated upload path shared by all three roles, one authorization rule, one dismissible viewer used by every surface, download, rename and withdrawal.

### Modified Capabilities

- `customer-portal`: Its document requirements move to `order-documents`, which owns them for every role rather than for the Customer alone. The portal keeps only what is specific to it — that a Customer sees their own uploads and not the Contractor's unshared files.
- `subcontractor-portal`: A Subcontractor's job photos become Documents and gain the same viewer. Tier still governs write access; nothing about Guest redaction changes.

## Impact

- **Data model** (`src/lib/server/db/schema.ts`, `drizzle/`): `attachment` is renamed to `document` and gains `uploadedByUserId` alongside the existing `uploadedByRole`, so a Document knows who sent it and not merely what kind of person did. A rename migration, plus a compatibility view or a coordinated code change — this is the one risky step and the design doc has to earn it.
- **Server** (`src/lib/server/documents.server.ts`, new): the upload, list, read, rename and delete operations, plus `documentAccess`. `addAttachment` / `addPortalAttachment` / `addSubcontractorAttachment` collapse into it.
- **Routes**: the three `attachment/[id]` endpoints collapse into one `documents/[id]` handler that resolves the viewer from `locals`. Existing URLs redirect for one release.
- **Components**: `src/lib/AttachmentViewer.svelte` becomes `DocumentViewer.svelte` with real PDF handling; a shared `DocumentList.svelte` so the three surfaces stop hand-rolling rows.
- **Domain** (`CONTEXT.md`): **Document** enters the language; **Attachment** is retired as a synonym.
- **Supersedes**: `openspec/changes/customer-documents/` is archived unimplemented, with its deferred ideas (tags, sharing, response requests) recorded here as explicit non-goals rather than lost.
- **Billing**: unchanged and load-bearing — a Customer sending a Document is a customer write and stays ungated ([ADR-0005](../../../docs/adr/0005-lapsing-never-reaches-customers.md)); the billing-guard test grows the new function names.
