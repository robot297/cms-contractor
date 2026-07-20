## Context

Orders today are `order` rows (contractor, customer, lifecycle `state`, timeline) rendered on the dashboard. "Needs attention" is derived from `ATTENTION_STATES` (Inquiry / Deposit Pending / Final Payment Pending) in `crm.server.ts` and shown as `needsAttention` on the order view. Order creation is a modal on the dashboard that picks a customer and calls `createOrder(contractorId, { customerId })`. Customers (`customer` table) carry name/email/phone/address/notes/tags. The app uses SvelteKit form actions, Drizzle/Postgres, Zod (shared client/server), and a shared `/contractor` layout for nav.

## Goals / Non-Goals

**Goals:**
- A dedicated Orders page; remove orders from the dashboard; add Orders to nav.
- Project name + project type (shelter enum + Other free-text) on orders.
- Contractor-set follow-up date with snooze/clear, replacing automatic needs-attention; a "due" view.
- Customer avatar captured via camera, stored as a downscaled data URL.

**Non-Goals:**
- File/object storage for images (avatar is an inline data URL; documents remain the separate `customer-documents` change).
- Per-order documents, templates, or customer-facing project-type display changes.
- Recurring/automated follow-up reminders or notifications (manual follow-up dates only).

## Decisions

### Decision 1: Order gains `projectName`, `projectType`, `nextFollowUpAt`
Add `projectName` (text), `projectType` (text — holds either a known shelter value or the custom "Other" text), and `nextFollowUpAt` (timestamp, nullable). A single `projectType` text column stores both enum and custom values; the known set is validated in the domain layer, and "Other" writes the free-text through.

- **Why:** Minimal, additive columns. One text column for type avoids an enum + separate custom column and keeps "Other" trivial. Nullable follow-up date is the whole follow-up model.
- **Alternative considered:** A `projectTypeCustom` column alongside an enum. Rejected as redundant for the MVP.

### Decision 2: Follow-up is an explicit date (default +3 days); drop `ATTENTION_STATES`
Remove `ATTENTION_STATES`/`needsAttention` from the order view. New orders default `nextFollowUpAt` to creation + 3 days; the contractor can then set/snooze/clear it. "Due" = `nextFollowUpAt != null && nextFollowUpAt <= now`. Snoozing computes a new date (`+1d/+3d/+1w` or a custom date) via a pure helper; the server persists it. The Orders page offers a "Due" filter and an "All" filter. The dashboard shows a "N follow-ups due" count linking to Orders.

- **Why:** The user wants control, not a rule. A single nullable date + pure date math is simple and testable; "due" is a trivial comparison.
- **Trade-off:** No automatic nudging — if a contractor never sets a date, nothing is flagged. Accepted; that is the requested behavior.

### Decision 3: Project types are a domain constant + Zod
`PROJECT_TYPES = ['Gazebo','Pavilion','Pergola','Carport','Pole Barn','Shed','Deck']` in `crm.ts`, with `'Other'` handled in the UI. Validation: `projectType` must be a known value OR (when Other) a non-empty custom string; `projectName` required. Shared Zod schema mirrors the customer-contact pattern.

- **Why:** Fixed, code-owned list is fine for the MVP; Zod keeps client/server validation in one place.

### Decision 4: Avatar is a downscaled data URL in a `customer.avatar` column
Capture via `<input type="file" accept="image/*" capture="environment">` (opens the camera on mobile, file picker on desktop). Downscale/compress client-side on a canvas to a small max dimension (e.g. 256px, JPEG ~0.8) and submit the resulting data URL. Store in `customer.avatar` (text, nullable). Server validates it is a `data:image/…` URL under a byte cap (e.g. ~200 KB) before saving.

- **Why:** Avatars are tiny; a bounded data URL needs no file-storage infra and renders directly via `<img src={avatar}>`. Client-side downscaling keeps the column small and the payload cheap.
- **Alternative considered:** Local-disk file + metadata (the documents approach). Rejected for avatars — heavier for a thumbnail, and file storage is deliberately deferred.
- **Trade-off:** Data URLs bloat row size and load with every customer query. Mitigated by the size cap and small dimensions; revisit if avatars grow or lists get large (could select avatar separately).

### Decision 5: Orders page owns order UI; dashboard slims down
New `src/routes/contractor/orders/+page.{server.ts,svelte}` (guarded by the existing contractor layout) loads orders + the contractor's customers (for the New Order picker) and hosts create/update/delete/follow-up actions. The dashboard drops the order list and New Order; nav gains Orders. New Order modal fields: project name, customer picker (pre-fillable via a query param when launched from a customer), project-type selector with an Other text field.

- **Why:** Matches the requested IA and the established layout/action patterns; keeps each surface focused.

## Risks / Trade-offs

- **Data-URL avatars increase `customer` row size and every directory query's payload** → cap bytes + downscale to ~256px; if it becomes a problem, omit `avatar` from list queries and load on demand.
- **Single `projectType` column blurs enum vs custom** → domain validation enforces "known value or non-empty custom"; acceptable for the MVP.
- **No automatic follow-up means nothing is flagged unless the contractor sets a date** → intended; the Orders "Due" view makes what's set visible.
- **Migration adds columns** → all new columns are nullable/additive; backward-compatible. Existing orders simply have no project name/type/follow-up until edited.
- **Removing needs-attention changes the dashboard's meaning** → the dashboard's follow-ups framing moves to the Orders "Due" view; update copy accordingly.

## Migration Plan

1. Add `order.projectName`, `order.projectType`, `order.nextFollowUpAt`, `customer.avatar`; generate a Drizzle migration (applied automatically on deploy via the startup migrator).
2. Ship domain helpers, server ops, the Orders route, nav change, and avatar capture.
3. Existing orders remain valid with null project fields / follow-up; no back-fill.
4. **Rollback:** additive columns; drop them to revert.

## Open Questions

- Avatar byte cap and max dimension — proposed ~200 KB / 256px. Adjust if photos look too soft.
- Should the dashboard keep any order summary (e.g. a "N follow-ups due" count linking to Orders), or show none? Proposed: a small due count that links to the Orders page.
- Snooze presets — proposed +1d / +3d / +1w / custom. Confirm the set.
