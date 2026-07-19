## Context

The `contractor-customer-directory` change established a first-class, contractor-scoped `customer` record that optionally links to a login (`customer.userId`), and orders that reference a customer. This change adds documents on top of that: contractors upload files, organize them with tags, share them into the customer portal, and request a response. There is no file storage in the repo yet — the app uses SvelteKit form actions, Drizzle/Postgres, and `@sveltejs/adapter-node`.

## Goals / Non-Goals

**Goals:**
- A `document` entity owned by a contractor, attached to a customer (and optionally an order).
- Upload with validation (size + mime allowlist), bytes on local disk, metadata in Postgres.
- Tags on documents; a shared flag controlling portal visibility.
- Access-controlled streaming downloads (owner contractor or shared-with customer only).
- A lightweight "request a response" on a shared document, with customer acknowledge/reply and contractor notification.

**Non-Goals:**
- Object storage / S3 (local disk first; storage is abstracted for a later swap).
- Virus scanning, versioning, e-signatures, thumbnailing.
- Templates (separate change).

## Decisions

### Decision 1: Local disk for bytes, Postgres for metadata
Store file bytes under a configured `UPLOADS_DIR`, keyed by a generated `storageKey` (e.g. `<documentId>` or `<customerId>/<uuid>`). A `document` table holds `id`, `contractorId`, `customerId`, nullable `orderId`, `name`, `mimeType`, `sizeBytes`, `storageKey`, `tags` (text[]), `shared` (bool), `responseRequested` (bool), `responseText`/`respondedAt` (nullable), timestamps.

- **Why:** Fastest path at the pre-launch stage; works with adapter-node; no new infra/credentials. Metadata in Postgres keeps listing/scoping/joins simple.
- **Alternative considered:** S3-compatible object storage (scalable, but needs a bucket + creds + SDK now) and Postgres `bytea` (no infra, but bloats the DB and streams poorly). Rejected for now; the storage module is abstracted so S3 can replace disk later.

### Decision 2: Storage module abstracts the filesystem
A `src/lib/server/storage.ts` exposes `putObject(key, bytes)`, `getObjectStream(key)`, and `deleteObject(key)` over `UPLOADS_DIR`. Server code never touches `fs` paths directly.

- **Why:** Confines the disk dependency to one seam so a future object-storage swap is a single-file change.

### Decision 3: Downloads via a guarded `+server.ts` endpoint
A route like `src/routes/documents/[id]/+server.ts` (GET) resolves the document, checks that the requester is the owning contractor or the linked customer with `shared = true`, then streams from the storage module. Uploads happen through form actions on the contractor customer view using multipart form data.

- **Why:** File responses need a raw endpoint, not a page load. Centralizing the access check in one handler keeps the rule enforceable and testable.

### Decision 4: Sharing is a boolean flag on the document; portal reads shared docs by customer
The customer portal lists documents where `document.customerId` belongs to a customer whose `userId` is the current user and `shared = true`. "Request a response" sets `responseRequested = true`; the customer's acknowledge/reply writes `responseText`/`respondedAt` and notifies the contractor via the existing notification system.

- **Why:** Reuses the customer↔user link and the notification pathway already built; avoids a separate ACL table for the MVP.

### Decision 5: Validation shared via Zod
Mime allowlist and max size live in a Zod schema in `src/lib/documents.ts` (pure), used by the upload action server-side and available to the client for pre-submit checks — mirroring the customer-contact validation approach.

## Risks / Trade-offs

- **Local disk is not durable/portable across instances** → Acceptable pre-launch (single node); storage module isolates the swap to object storage later.
- **Path traversal / unsafe filenames** → Never use the client filename as the storage key; generate the key server-side and store the original name only as display metadata.
- **Unbounded uploads exhaust disk** → Enforce a max size and a mime allowlist server-side before writing; reject early.
- **Orphaned files if a delete half-fails** → Delete the DB row and best-effort delete the object; a periodic sweep can reconcile orphans later.
- **Serving files bypassing the access check** → Only ever serve through the guarded endpoint; `UPLOADS_DIR` is not web-served directly.

## Migration Plan

1. Add the `document` table; generate a Drizzle migration.
2. Add `UPLOADS_DIR` (and max-size) to `.env.schema`/`env.d.ts`; ensure the directory exists at boot.
3. Ship the storage module, upload/share/response server ops, the guarded download endpoint, and the UI.
4. **Rollback:** additive table + new routes; drop the table and remove `UPLOADS_DIR` usage to revert. Uploaded files can be deleted from disk.

## Open Questions

- Allowed mime types for v1 (PDF, images, common office docs)? Proposed: PDF, PNG/JPG, and common office formats; reject executables.
- Max upload size for v1? Proposed: 10–25 MB.
- Should documents attach to an order as well as a customer in v1, or customer-only first? Proposed: customer-level with an optional order link.
