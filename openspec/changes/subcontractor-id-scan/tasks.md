## 1. Domain — the pure core

- [x] 1.1 Add `src/lib/id-scan.ts` with the `ScannedId` type, the AAMVA element-code table, and `parseAamva(raw)` — element-code scan with header validation, per Decision 7
- [x] 1.2 Add jurisdiction-aware date parsing (USA `MMDDCCYY`, CAN `CCYYMMDD`) and ZIP normalization (9-digit padded → 5 or ZIP+4)
- [x] 1.3 Add `scanToSubcontractorFields(scan)` — the name/address-only mapping from Decision 3, plus the display-only fields
- [x] 1.4 Add the Zod schema the vision path is validated against, shared client/server
- [x] 1.5 Add `src/lib/id-scan.test.ts` — fixture payloads covering a well-formed US licence, a Canadian licence, a payload with wrong offsets, a truncated/garbage payload, and a non-AAMVA barcode

## 1b. Data model — the trade licence expiry

- [x] 1b.1 Add nullable `licenseExpiresAt` to the `subcontractor` table and generate the migration (`drizzle/0020_wakeful_dexter_bennett.sql` — one additive `ADD COLUMN`, no backfill)
- [x] 1b.2 Thread it through `SubcontractorContact`, the Zod schema, `SubcontractorDetailsInput`, and both the create and edit writes
- [x] 1b.3 Add the field to the Add and Edit forms and to `readProfile`
- [x] 1b.4 Show it in the Credentials panel via `expiryStatus` (renamed from `insuranceStatus`, now shared by both expiries)
- [x] 1b.5 Have a trade-licence scan fill it, and drop it from the shown-not-saved list

## 2. Config

- [x] 2.1 Add `ANTHROPIC_API_KEY` (optional, sensitive) and `ID_SCAN_DEV_TOOLS` to `.env.schema`; regenerate `env.d.ts`
- [x] 2.2 Add `zxing-wasm` and `@anthropic-ai/sdk` to `package.json`

## 3. Server — the vision fallback

- [x] 3.1 Add `src/lib/server/id-scan.server.ts`: `idScanConfigured(key)`, `isIdScanConfigured()`, `isIdScanDevToolsEnabled()`, `extractIdFromImage(dataUrl)`
- [x] 3.2 Call `claude-opus-5` with the image and `output_config.format`; validate the response against the shared Zod schema before returning it
- [x] 3.3 Return a typed result (`ok` / `unconfigured` / `unreadable` / `provider`) rather than throwing, so the UI can say what happened
- [x] 3.4 Confirm nothing writes the image: no disk, no row, no log line
- [x] 3.5 Add `src/lib/server/id-scan.server.test.ts` — the configured-or-degrade predicate, the dev-tools guard, and response validation against a recorded payload

## 4. Route action

- [x] 4.1 Add a `scanId` action to `src/routes/contractor/subcontractors/+page.server.ts`, behind the existing billing write guard
- [x] 4.2 Enforce a maximum image size before the provider is reached
- [x] 4.3 Surface the dev-tools flag and the configured flag to the page so the scanner can render the right affordances

## 5. Client — the scanner

- [x] 5.1 Add `src/lib/IdScanner.svelte`: camera → decode loop → vision fallback → confirm sheet, reusing the existing `getUserMedia` pattern
- [x] 5.2 Dynamically import `zxing-wasm` on open so it costs nothing elsewhere; decode frames on an interval and stop on the first AAMVA hit
- [x] 5.3 Confirm sheet: prefilled fields editable, display-only fields (DOB / document number / expiry) clearly marked as not saved
- [x] 5.4 Dev-tools panel behind the flag — run a fixture through the same confirm path
- [x] 5.5 Stop the camera and drop the frame on close, capture, and error alike

## 6. Wire into the directory

- [x] 6.1 Add the scan entry point to the Add-subcontractor modal
- [x] 6.2 Add it to the Edit-profile form, filling only empty fields unless the contractor overwrites
- [x] 6.3 Dark-mode pass on the scanner surfaces (tokens, not bare `[data-theme='dark']` overrides)
- [x] 6.4 Align the directory header with the customers directory — full-bleed sunken ground, column padding and gaps, baseline-aligned title with a count, pill search field — keeping colors tokenised rather than copying hex across

## 7. Documentation & verification

- [x] 7.1 Add **ID Scan** and **Scanned ID** to `CONTEXT.md`
- [ ] 7.2 Verify each spec scenario in a browser on a phone: real licence barcode, a card with no barcode, permission denied, vision unconfigured
- [x] 7.3 Run `pnpm check` and `pnpm test`
- [ ] 7.4 Run `openspec validate subcontractor-id-scan`
