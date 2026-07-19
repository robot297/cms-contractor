## Why

Contractors need to exchange real artifacts with their customers — quotes, permits, photos, invoices, sign-off sheets — not just status text. Today there is no way to attach a document to a customer or order, share it into the customer portal, or ask the customer to acknowledge or respond to it. This change adds document upload, organization (tags), controlled sharing into the portal, and a lightweight response request, building on the customer directory (`contractor-customer-directory`).

## What Changes

- Introduce a **document entity**: an uploaded file owned by a contractor and attached to one of their customers (and optionally a specific order).
- **Upload**: contractors upload documents from the customer (or order) view. Files are stored on **local disk**; a `document` row holds metadata (name, size, mime type, storage key, owner, links).
- **Tags on documents**: contractors label documents for organization, consistent with customer tags.
- **Share with a client**: a contractor toggles a document as shared, making it visible (and downloadable) in that customer's portal; unshared documents stay contractor-only.
- **Request a response**: a contractor can request acknowledgement/response on a shared document; the customer can acknowledge or reply, and the contractor is notified.
- **Access control & downloads**: documents are served only to the owning contractor and the linked customer, scoped by role and ownership.

Out of scope (deferred): object-storage/S3 backend (local disk first), virus scanning, document versioning/e-signatures, and order/update templates.

## Capabilities

### New Capabilities
- `customer-documents`: Upload, tag, store (local disk + DB metadata), share into the customer portal, download with access control, and request/collect a customer response on a document.

### Modified Capabilities
<!-- No published main specs are affected at the requirement level beyond what customer-documents introduces. Portal visibility is additive. -->

## Impact

- **Data model** (`src/lib/server/db/schema.ts`): new `document` table (contractorId, customerId, optional orderId, name, mimeType, sizeBytes, storageKey, tags, shared flag, responseRequested/response fields, timestamps); migration in `drizzle/`.
- **Storage** (`src/lib/server/`): a small storage module writing to a configured uploads directory (e.g. `UPLOADS_DIR`), plus streaming download handlers.
- **Server logic** (`src/lib/server/crm.server.ts` or a new `documents.server.ts`): create/list/share/delete document, request-response, record-response.
- **Routes**: contractor upload/share/manage actions on the customer view; a download endpoint (`+server.ts`) guarded by ownership/role; customer portal document list + acknowledge/reply action.
- **Config** (`.env.schema`, `env.d.ts`): `UPLOADS_DIR` and a max-upload-size setting.
- **Domain** (`src/lib/crm.ts` or `documents.ts`): document validation (mime allowlist, size), shared with client and server via Zod.
