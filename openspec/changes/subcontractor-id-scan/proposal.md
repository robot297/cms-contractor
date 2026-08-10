## Why

Adding a subcontractor means typing a name and an address off a card the contractor is already holding — on a phone, on a job site, with gloves on. It is the slowest, most error-prone part of onboarding a trade partner, and a mistyped name is the one that breaks the invite (the email is what binds a Subcontractor to a User).

The card itself carries the data in machine-readable form. Every US and Canadian driver's licence and state ID has a PDF417 barcode on the back encoding the AAMVA fields — name, address, ID number, dates — exactly. Trade licence cards don't, but they are legible to a vision model.

## What Changes

- Introduce **ID Scan**: a contractor points their camera at a subcontractor's ID and the Add/Edit Subcontractor form is prefilled with what the card says.
- **Barcode first.** The PDF417 on the back of a US/CA licence decodes on-device to exact AAMVA fields. No image leaves the browser, no network call, no per-scan cost, and the parse is a pure function that unit-tests against fixture payloads.
- **Vision fallback.** When there is no barcode to read — a trade/contractor licence card, a foreign ID, a damaged strip — the contractor can send the photo to the server, which asks Claude for the same fields as structured JSON.
- **Confirm before it lands.** A scan never writes anything. It fills the form and the contractor reviews and saves, exactly as if they had typed it.
- **The photo is discarded.** It lives in browser memory for the length of the scan; nothing is written to disk or to the database. The fields the contractor keeps are the only thing that persists.
- **A simulator for testing.** `ID_SCAN_DEV_TOOLS=true` lets the scan be driven from fixture payloads with no camera, no card, and no API key — the same shape as the existing billing and email dev tools.

Out of scope (deferred): storing the scan as a credential document (that belongs with `customer-documents`), insurance certificate (COI) extraction, scanning on the Customer form, and any automated verification that the ID is genuine.

## Capabilities

### New Capabilities

- `subcontractor-id-scan`: Capture an ID by camera, decode it on-device by barcode or off-device by vision, and prefill the Add/Edit Subcontractor form with reviewable fields, retaining no image.

### Modified Capabilities

- `subcontractor-directory`: the Add and Edit forms gain a scan entry point. No requirement changes to how a Subcontractor is created or stored — a scan produces the same field values a contractor could have typed.

## Impact

- **Data model** (`src/lib/server/db/schema.ts`): a nullable `licenseExpiresAt` on `subcontractor`, so a trade licence's expiry — the field that actually decides whether a sub may work — has somewhere to land. One additive migration, no backfill.
- **Domain** (`src/lib/id-scan.ts`): the `ScannedId` shape, the pure AAMVA PDF417 parser, and the mapping from a scan onto subcontractor form fields. Pure and shared client/server.
- **Client** (`src/lib/IdScanner.svelte`): the capture modal — camera, on-device decode loop, vision fallback, confirm sheet. Reuses the camera pattern already in the subcontractors and customers pages.
- **Server** (`src/lib/server/id-scan.server.ts`): the vision extraction, configured-or-degrade behind `ANTHROPIC_API_KEY` exactly as email degrades behind `RESEND_API_KEY`.
- **Route** (`src/routes/contractor/subcontractors/+page.server.ts`): a `scanId` action, behind the same billing write guard as every other write on the page.
- **Config** (`.env.schema`, `env.d.ts`): `ANTHROPIC_API_KEY` (optional — the barcode path works without it) and `ID_SCAN_DEV_TOOLS`.
- **Dependencies**: `zxing-wasm` (client-side PDF417 decode), `@anthropic-ai/sdk` (vision fallback).
- **Language** (`CONTEXT.md`): adds **ID Scan** and **Scanned ID**.
