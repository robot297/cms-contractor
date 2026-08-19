## Context

What exists today, after the `customer-portal` change:

- One `attachment` table: `id`, `orderId`, `contractorId` (denormalized owner), `filename`, `mimeType`, `size`, `data` (bytea), `uploadedByRole`, `createdAt`.
- Three upload functions that do not know about each other — `addAttachment` (contractor, billing-guarded), `addPortalAttachment` (customer, deliberately not), `addSubcontractorAttachment` (subcontractor, tier-gated).
- Two download endpoints, `contractor/orders/[id]/attachment/[attachmentId]` and `customer/orders/[id]/attachment/[attachmentId]`, each re-implementing its own authorization.
- `AttachmentViewer.svelte`, added late and image-shaped: images get `<img>`, everything else gets an `<iframe>` with an escape hatch beside it.

The bug that prompted this was reported three times. Each report was real, and each fix addressed one surface because there was no single place a fix could land. That is the actual defect: the absence of a Document concept means "how do you open one of these" has three answers.

There is also an unstarted `customer-documents` change (0/22 tasks) proposing a _separate_ `document` table on local disk with tags, a share toggle and response requests. Two document models in one product is worse than either.

**Constraints.** Bytes live in Postgres today and moving them is a separate risk. [ADR-0005](../../../docs/adr/0005-lapsing-never-reaches-customers.md): a Customer's write must never consult their Contractor's subscription. Guest Subcontractors see redacted Orders and are read-only, which a shared viewer must not quietly undo.

## Goals / Non-Goals

**Goals:**

- One Document entity, one upload path, one authorization rule, one viewer.
- Opening a Document never navigates. It cannot leave a person somewhere they can only escape with the back button — including when the browser refuses to render the file.
- PDFs treated as the primary case, since that is what a quote, a permit and an invoice actually are. Images are one type among several.
- Retire the second document model before it is built.

**Non-Goals:**

- Object storage. Bytes stay in `bytea`. This change is already carrying a table rename.
- The contractor→customer sharing toggle. It needs a decision about default visibility that nothing currently forces, and it is not what is broken.
- Tags, versioning, e-signature, virus scanning, response requests. Named here so archiving `customer-documents` does not lose them.
- Any change to Tier redaction or the billing asymmetry.

## Decisions

### 1. Rename `attachment` → `document` rather than adding a second table

**Chosen:** rename in place, add `uploadedByUserId`.

**Alternative rejected:** the `customer-documents` plan — a new `document` table alongside `attachment`, bytes on local disk. It would mean two tables holding the same kind of thing, two upload paths per role instead of one, and a portal that has to merge two lists to answer "what is on this job". The tag and share features it was really after can be added to one table later; they were never the reason for a second one.

**Alternative rejected:** leave the table named `attachment` and only unify the code. Cheaper and lower-risk, and genuinely tempting. Rejected because the language is half the problem — `CONTEXT.md` has no entry for either word, the UI says "Documents" on one surface and "Files" on another, and leaving the storage layer saying `attachment` guarantees the next person picks the wrong noun. If we are unifying, unify the word.

**Migration risk is the real cost.** A rename is not additive, so it cannot be applied ahead of the code the way this project's other migrations have been. The plan is a two-step: add the new table as a view over the old, cut the code over, then drop. See Migration Plan — and if that proves fussier than it is worth, falling back to "keep the table name, change everything else" costs only the naming benefit.

### 2. One `documentAccess(viewer, documentId)` for every read

The `Viewer` union already exists in `messaging.server.ts` and proved itself there: both ends of a thread authorize from the identity they are handed rather than from the surface that called them. Documents get the same treatment, extended with the subcontractor case:

- **contractor** — owns the Order.
- **customer** — linked to the Order's Customer, and the Document was uploaded by a customer. (Contractor uploads stay private until sharing exists; that is a deliberate hold, restated as a requirement so it cannot be lost by accident.)
- **subcontractor** — assigned to the Order. A Guest sees Documents but writes none, matching their Tier's existing rule.

One function, three branches, called by the single download route and by every list. The current duplication is how the customer endpoint and the contractor endpoint came to have subtly different rules.

### 3. The viewer renders, and can always be escaped

Rendering by type, in order of what this product actually carries:

- **PDF** — an `<object>` with a `<embed>` fallback, sized as a portrait page rather than a letterbox. This is the case the current viewer handles worst and the one most quotes and permits arrive as.
- **Image** — `<img>`, contained.
- **Anything else** — no preview attempted; the panel says so and offers download.

**The rule that matters more than the rendering:** every state of the viewer carries a close control, a download, and an open-in-new-tab. A browser that refuses to render a PDF inline (mobile Safari, most reliably) must produce a panel with three working exits, not a blank rectangle. The failure being fixed here is not "the preview was ugly", it is "there was no way out", and a viewer that can render nothing is still correct if you can leave it.

Mechanics: `position: fixed` at a z-index above all app chrome, body scroll locked while open, focus moved to the close control and restored to the opener on close, Escape handled by the component and `stopPropagation`'d so it does not also close whatever is behind it.

**Alternative rejected:** a dedicated `/documents/[id]` page. Honest, shareable, and back-button-correct by construction. Rejected because it makes viewing a navigation — the customer loses their place on the job, and on a phone the return trip is a full page load. An overlay keeps the job on screen behind it.

**Alternative rejected:** `<dialog showModal()>`. It gives focus trapping and Escape free. Worth revisiting; skipped for now only because the app has no other `<dialog>`-based overlay and matching the existing sheet/scrim pattern keeps one idiom rather than two.

### 4. One upload path taking the uploader

`uploadDocument(viewer, orderId, file, opts)` — validates type and size once, resolves `contractorId` from the Order rather than from the request, stamps `uploadedByRole` and `uploadedByUserId` from the viewer, and notifies the other side. The three existing functions become thin callers or disappear.

The billing guard stays exactly where it is: applied when `viewer.role === 'contractor'`, never otherwise. This is the same asymmetry `sendMessage` already encodes, and the same source-reading test will cover it.

**Filenames** keep the `safeFilename` / `splitFilename` treatment already written: the stem is the user's, the extension comes from the uploaded file, and the value is sanitized server-side because it reaches a `Content-Disposition` header.

### 5. Several files in one go, with per-file outcomes

`<input type="file" multiple>`, then a confirm step listing every picked file — each with an editable name, its size, and a remove control — and one Send.

**Validation is per file, and a failure is not contagious.** Picking five files where one is 20 MB sends the other four and reports the one that was refused, by name. The alternatives are both worse: aborting the batch punishes someone for a mistake in one file, and silently dropping it means they believe they sent something they did not. So `uploadDocuments` returns a result per file and the UI says "3 sent · roof-survey.tiff was an unsupported type".

**Alternative rejected:** upload each file as its own request as it is picked. Simpler server, and progress feels immediate. Rejected because it removes the confirm step this change just added — a camera roll's `IMG_4821.jpg` would land on the contractor unnamed again, which is the thing the confirm step exists to prevent.

### 6. One seam for bytes, before it is needed

Every read and write of a Document's bytes goes through `src/lib/server/document-store.ts` — `putBytes`, `getBytes`, `deleteBytes`. Today all three are a column access.

This is deliberate anticipation rather than speculative abstraction, and the distinction matters: bytes are currently touched in five places across three modules, so consolidating them is worth doing on its own merits. That the consolidation also makes an S3 backend a one-module change is the reason to do it now rather than later. It is three functions and no interface gymnastics — if object storage never happens, what remains is still less duplication than today.

**Not built:** the S3 backend. Moving existing bytes out of `bytea` is a data migration with real risk, and nothing today needs it.

### 7. Withdrawal, not deletion, on the customer side

A Contractor may delete any Document on their Order. A Customer may **withdraw** one they uploaded — but only until the Contractor has read it, mirroring how the message thread already tracks per-side read state. A document that has been seen cannot be silently un-sent; that is a record of what was exchanged, not a draft.

This needs a `readByContractorAt` on the Document, which is the same shape `order_message` already uses. Consistent, and it gives the Contractor's file list an unread marker for free.

## Risks / Trade-offs

- **The table rename is the only non-additive migration this project has taken** → Staged (see Migration Plan) so the code cutover and the drop are separate deploys. If staging proves awkward, the fallback is to keep the table name and take only the code unification — most of this change's value with none of the migration risk.
- **Two document models exist in the repo right now** (`customer-documents` unstarted, this one) → Resolved by archiving the other unimplemented as part of this change, with its deferred ideas recorded as non-goals here. Leaving both is the actual risk.
- **PDF inline rendering is unreliable across browsers** → Accepted and designed around rather than fought: the viewer never depends on the preview succeeding, because download and open-in-new-tab are always present. A blank preview is a bad experience; a blank preview with no exit is the bug.
- **Bytes stay in Postgres while multi-upload makes it easier to put more of them there** → This is the trade-off worth watching. A 10 MB cap still holds per file, but someone can now send five at once, so an Order's row footprint grows faster than before. Mitigated by the seam (decision 6), which turns the eventual move into a backend swap rather than a rewrite — but the move itself is still owed, and multi-upload brings the day it is needed closer.
- **Partial-success reporting is a state people skim past** → The result names the files that failed and why, and the ones that succeeded appear in the list immediately, so the two halves are visible rather than described.
- **A shared viewer across three portals could leak the wrong file to the wrong role** → This is exactly why `documentAccess` is one function with three branches rather than three implementations. It gets the same source-reading test treatment as the billing guard, and the subcontractor branch is the one to watch, since Tier already redacts other parts of the same Order.
- **The unread-gated withdrawal adds a rule people must infer** → The button says why it is gone ("your contractor has seen this"), rather than vanishing silently.

## Migration Plan

1. Add `uploadedByUserId` (nullable) and `readByContractorAt` to `attachment`. Additive, safe to deploy ahead of code.
2. Backfill `uploadedByUserId` where it can be inferred (contractor uploads → `contractorId`); leave null elsewhere. Null means "we do not know", not "nobody".
3. Ship `documents.server.ts` and the unified route and viewer, still reading the `attachment` table. **Everything in this change except the rename is deliverable at this point** — including the bug fix.
4. Rename the table to `document` in its own migration, with the code cutover in the same deploy.
5. Drop the old download routes after one release; until then they redirect.

**Rollback:** steps 1–3 are independently revertible. Step 4 needs a reverse rename, which is why it is last and alone.

## Open Questions

- Should a Subcontractor's job photos be visible to the Customer? They are work on the Customer's own job, and today they are not. Leaning no until sharing exists as a concept, but it is a product call rather than a technical one.
- Does the Contractor's file list want the Documents split by uploader, or one list with provenance chips as it is now? One list is simpler and currently reads fine at the volumes we have; worth revisiting if a job accumulates dozens.
- Is the unread-gated withdrawal worth its complexity, or should a Customer simply not be able to withdraw at all? The simpler rule is defensible; this one is friendlier. Decide before building task 6.
