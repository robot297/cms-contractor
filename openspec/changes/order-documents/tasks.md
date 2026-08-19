## 1. Decide before building

- [x] 1.1 DECIDED: unread-gated withdrawal — a Customer may take back a document until the Contractor has read it. Needs `readByContractorAt`
- [x] 1.2 DECIDED: do the rename to `document`. Also added by the same decision: multi-file upload, and a storage seam because object storage is a known upcoming need
- [x] 1.3 Archive `openspec/changes/customer-documents/` unimplemented, so the repo stops holding two document models

## 2. Additive schema

- [x] 2.1 Add `uploadedByUserId` (nullable, fk → user) and `readByContractorAt` to `attachment`; generate the migration and confirm it is additive only
- [x] 2.2 Backfill `uploadedByUserId` for contractor uploads from `contractorId`; leave the rest null — null means "unknown", not "nobody"
- [x] 2.3 Apply locally and confirm the columns and the backfill

## 3. Server: one module

- [x] 3.1 Create `src/lib/server/documents.server.ts` with a `Viewer` union covering contractor, customer and subcontractor
- [x] 3.2 Implement `documentAccess(viewer, documentId)` — contractor owns the Order, customer is linked to its Customer and the document came from a customer, subcontractor is assigned. One function, three branches
- [x] 3.3 Implement `uploadDocuments(viewer, orderId, files[])`: validate type and size PER FILE, resolve `contractorId` from the Order, stamp role and user id, apply `safeFilename`/`splitFilename`, notify once for the batch, and return a per-file result so one refusal never costs the rest
- [x] 3.10 Create `src/lib/server/document-store.ts` — `putBytes`, `getBytes`, `deleteBytes` over the `data` column; the one place bytes are touched, so an S3 backend later is a module swap
- [x] 3.4 Apply the billing guard on the contractor branch only (ADR-0005), matching `sendMessage`
- [x] 3.5 Implement `listDocuments(viewer, orderId)`, `getDocument(viewer, documentId)`, `renameDocument`, `deleteDocument`, `withdrawDocument`
- [x] 3.6 Implement `markDocumentRead(orderId, contractorId)` so the Contractor's list shows unread arrivals and withdrawal can be gated
- [x] 3.7 Collapse `addAttachment`, `addPortalAttachment` and `addSubcontractorAttachment` into callers of `uploadDocument`, or delete them
- [x] 3.8 Write `documents.server.test.ts` in this repo's idiom: pure rules executed, and the authorization branches plus the billing asymmetry asserted against source, as `messaging.server.test.ts` does
- [x] 3.9 Add the new function names to `billing.guard.test.ts` — contractor upload guarded, every other path not

## 10. Hardening and history (added mid-flight)

- [x] 10.1 Sniff file content server-side (`sniffFileType` / `checkUploadContent`) — the declared MIME comes from the browser and is spoofable, so bytes and claim must agree
- [x] 10.2 Name the dangerous families explicitly so refusals say what was found: archives (incl. .docx/.xlsx, which are zips), executables, scripts
- [x] 10.3 Add `note` and `tags` to a document; `updateDocument` to set them
- [x] 10.4 Write the Order history on document add and remove; contractor/subcontractor uploads internal, customer uploads visible to both
- [x] 10.5 Add `expectedAt` to a timeline entry — the delivery date on a parts order, the end of a delay
- [x] 10.6 Rename the portal's "Earlier updates" to **History**; show `expectedAt` per entry and surface the outstanding one in the hero
- [x] 10.7 Contractor: set an expected date when changing status, and manage document notes/tags/delete
- [x] 10.8 Customer: delete/withdraw control on their own documents, with the reason when refused

## 4. One route

- [x] 4.1 Add `src/routes/documents/[documentId]/+server.ts` resolving the viewer from `locals` and delegating to `documentAccess`; support `?dl` for a save
- [x] 4.2 Redirect the three existing `attachment/[attachmentId]` routes to it
- [x] 4.3 Confirm a document is refused for each unauthorized role, not merely for a signed-out visitor

## 5. Viewer

- [x] 5.1 Rename `AttachmentViewer.svelte` to `DocumentViewer.svelte`
- [x] 5.2 Render PDFs as a portrait document at readable width with page scrolling — `<object>` with an `<embed>` fallback — rather than the current letterbox iframe
- [x] 5.3 Render images contained; state plainly that any other type cannot be previewed instead of embedding a blank frame
- [x] 5.4 Guarantee close, download and open-in-new-tab in EVERY state, including the unpreviewable one — the failure being fixed is "no way out", not "ugly preview"
- [x] 5.5 Keep the focus, scroll-lock and Escape handling already written; verify Escape does not also close a sheet behind it
- [x] 5.6 Extract `DocumentList.svelte` so the three surfaces stop hand-rolling rows

## 6. Surfaces

- [x] 6.1 Customer portal: use `DocumentList` + `DocumentViewer`; extend the confirm step to a multi-file batch — per-file name, size and remove, one Send, per-file outcome reported
- [x] 6.2 Customer portal: withdrawal control per the decision in 1.1, stating why when refused
- [x] 6.3 Contractor order workspace: same list and viewer in the Files tab; keep the provenance chip; mark unread arrivals
- [x] 6.4 Contractor: delete stays available on any document on their Order
- [x] 6.5 Subcontractor portal: same list and viewer; Trusted may upload, Guest is read-only — verify Tier is unchanged
- [x] 6.6 Grep every surface for a direct link to document bytes and confirm none remain

## 7. Rename (only if 1.2 says yes)

- [x] 7.1 Rename `attachment` to `document` in schema and migration, with the code cutover in the same deploy
- [x] 7.2 Update `AttachmentMeta` and every type name to Document
- [ ] 7.3 Drop the redirecting attachment routes after one release

## 8. Documentation

- [x] 8.1 Add **Document** to `CONTEXT.md`'s Language section; retire **Attachment** as a synonym; add the Order↔Document relationship
- [x] 8.2 Record in `CONTEXT.md` that a Customer sees only their own Documents until sharing exists as a concept
- [x] 8.3 Note the deferred ideas inherited from `customer-documents` — tags, sharing, response requests, object storage — as explicit non-goals

## 9. Verification

- [x] 9.1 `pnpm check` clean and `pnpm lint` no worse — the 4 eslint errors and the prettier warnings on docs/`.github` predate this change and are untouched by it; everything under `src/` is prettier-clean
- [x] 9.2 `pnpm test` green, including the new documents tests
- [x] 9.3 `openspec validate order-documents --strict` passes
- [x] 9.4 Confirm no direct byte links remain on any surface (6.6 automated as a source-reading test)
- [ ] 9.5 Hand off for browser review — **stating which URL to use**: the Vite dev server, not the Docker container on :3000, which serves a build baked at image time
