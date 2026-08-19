## 1. Config & storage

- [ ] 1.1 Add `UPLOADS_DIR` and a max-upload-size setting to `.env.schema` and `env.d.ts`
- [ ] 1.2 Create `src/lib/server/storage.ts` with `putObject(key, bytes)`, `getObjectStream(key)`, `deleteObject(key)` over `UPLOADS_DIR`; ensure the directory exists at boot
- [ ] 1.3 Add a pure Zod document schema in `src/lib/documents.ts` (mime allowlist + max size + tag parsing), shared client/server

## 2. Data model & migration

- [ ] 2.1 Add a `document` table to `src/lib/server/db/schema.ts`: `id`, `contractorId` (FK → user), `customerId` (FK → customer), nullable `orderId` (FK → order), `name`, `mimeType`, `sizeBytes`, `storageKey`, `tags` (text[]), `shared` (bool default false), `responseRequested` (bool default false), `responseText` (nullable), `respondedAt` (nullable), timestamps
- [ ] 2.2 Define Drizzle relations (document belongs-to contractor, customer, optional order)
- [ ] 2.3 Generate the Drizzle migration

## 3. Server operations (`src/lib/server/documents.server.ts`)

- [ ] 3.1 `uploadDocument(contractorId, customerId, { file, orderId?, tags? })` — validate size/mime, write bytes via storage, insert metadata; generate the storage key server-side (never trust the client filename)
- [ ] 3.2 `listCustomerDocuments(contractorId, customerId)` — the contractor's documents for a customer
- [ ] 3.3 `setDocumentShared(contractorId, documentId, shared)` and `setDocumentTags(...)`
- [ ] 3.4 `deleteDocument(contractorId, documentId)` — remove row + best-effort delete object
- [ ] 3.5 `requestDocumentResponse(contractorId, documentId)` — set responseRequested on a shared document
- [ ] 3.6 `recordDocumentResponse(userId, documentId, text?)` — customer acknowledge/reply; verify the customer is linked and the doc is shared; notify the contractor
- [ ] 3.7 `listSharedDocuments(userId)` / per-order portal query — shared documents for the customer's linked account

## 4. Contractor UI (customer view)

- [ ] 4.1 Upload form (multipart) on the customer view with client-side size/mime pre-check
- [ ] 4.2 Document list with tags, share toggle, request-response, and delete controls
- [ ] 4.3 Wire actions to the server operations with typed error handling

## 5. Download endpoint & customer portal

- [ ] 5.1 Add a guarded `src/routes/documents/[id]/+server.ts` GET that streams only to the owner contractor or the shared-with linked customer
- [ ] 5.2 Show shared documents in the customer portal with download links
- [ ] 5.3 Add a customer acknowledge/reply action for documents with a requested response

## 6. Verification

- [ ] 6.1 Verify each spec scenario (upload valid/invalid; tag; share/unshare visibility; owner vs unauthorized download; request + acknowledge notifies contractor)
- [ ] 6.2 Unit-test the pure document schema (mime/size/tags); run type-check and the suite
- [ ] 6.3 Run `openspec validate customer-documents`
