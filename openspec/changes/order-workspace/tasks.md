## 1. Data model & migration

- [x] 1.1 Add `projectName` (text), `projectType` (text), `nextFollowUpAt` (timestamp, nullable) to `order` in `src/lib/server/db/schema.ts`
- [x] 1.2 Add `avatar` (text, nullable) to `customer`
- [x] 1.3 Generate the Drizzle migration (`drizzle/0003_order_projects_followups_avatar.sql`; auto-applied on deploy)

## 2. Domain layer (`src/lib/crm.ts`)

- [x] 2.1 Add `PROJECT_TYPES` shelter constant and an `isProjectType` guard
- [x] 2.2 Add `validateOrderSetup` (project name required; type = known value or non-empty custom when Other)
- [x] 2.3 Add follow-up helpers: `defaultFollowUp` (+3d), `isFollowUpDue`, `snoozeDate` (`+1d/+3d/+1w`), `isSnoozePreset`
- [x] 2.4 Add avatar validation: `isValidAvatarDataUrl` (data:image/… URL under the byte cap)
- [x] 2.5 Unit-test the new pure helpers in `src/lib/crm.test.ts` (21 tests pass)

## 3. Server operations (`src/lib/server/crm.server.ts`)

- [x] 3.1 Extend `createOrder` to accept `{ customerId, projectName, projectType }` and default the follow-up to +3d
- [x] 3.2 Drop `ATTENTION_STATES`/`needsAttention`; add `followUpDue` to the order view
- [x] 3.3 `setFollowUp(orderId, contractorId, date | null)` and `snoozeFollowUp(orderId, contractorId, preset)`
- [x] 3.4 Expose `followUpDue` on the order view; the Orders page filters Due/All from it
- [x] 3.5 `setCustomerAvatar(contractorId, customerId, dataUrl | null)` — validate + persist (`InvalidAvatarError`)
- [x] 3.6 Domain helpers for order setup, follow-up, and avatar covered by unit tests

## 4. Orders page

- [x] 4.1 `src/routes/contractor/orders/+page.server.ts`: load orders + customers; actions createOrder, quickUpdate, deleteOrder, setFollowUp, snoozeFollowUp, clearFollowUp, sendInvite
- [x] 4.2 `src/routes/contractor/orders/+page.svelte`: order list with Due/All filter, project name + type, follow-up controls (set date, +1d/+3d/+1w snooze, clear) + delete confirm
- [x] 4.3 New Order modal: project name, searchable customer picker (pre-filled via `?customer=<id>`), project-type selector with Other free-text
- [x] 4.4 Removed order display + New Order from the dashboard; dashboard shows a "N follow-ups due" tile linking to Orders

## 5. Navigation

- [x] 5.1 Added **Orders** to the contractor nav in `+layout.svelte` (Dashboard / Orders / Customers) with active state

## 6. Customer avatar

- [x] 6.1 Camera capture in the directory (`<input type="file" accept="image/*" capture="environment">`) that downscales on a canvas (~256px JPEG) to a data URL and submits it
- [x] 6.2 `setAvatar` action on the customers route
- [x] 6.3 Avatar shown on customer cards with a neutral initial placeholder when absent

## 7. Verification

- [x] 7.1 Drive each spec scenario end-to-end against a running app + live Postgres (verified via demo-contractor session on `pnpm dev` + migrated `contractor-crm` DB: create order → valid state transition + note → set follow-up → delete-with-cascade (0 orphans), invalid state + invalid project-type rejected, customer-avatar set/clear/invalid-reject)
- [x] 7.2 Type-check (0 errors), unit tests (21), eslint (0), and a production build all pass
- [x] 7.3 `openspec validate order-workspace`
