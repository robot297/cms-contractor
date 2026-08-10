## Context

The subcontractors page already owns a camera: the avatar flow calls `getUserMedia({ facingMode: 'environment' })`, draws a frame to a canvas, and posts a data URL. ID Scan reuses that mechanism and changes what happens to the frame — instead of being downscaled into an avatar, it is decoded.

The Subcontractor record holds `name`, `email`, `phone`, `address` (one free-form line), `company`, `trade`, `tier`, `licenseNumber`, `insuranceCarrier`, `insuranceExpiresAt`. Only some of those appear on a government ID, which drives Decision 3.

There is no AI dependency in the repo today. There is a well-worn precedent for optional integrations: email degrades to `mailto:` when Resend is unconfigured, billing degrades to trial/comped when Stripe is unconfigured, and both ship a `*_DEV_TOOLS` simulator so the surface can be exercised without the provider.

## Goals / Non-Goals

**Goals:**

- Photograph an ID and get correct fields into the form, on a phone, offline where possible.
- A decode path that is deterministic and unit-testable without a camera, a network, or a real ID.
- No ID image at rest, anywhere.
- Degrade to today's typing when nothing is configured or nothing decodes.

**Non-Goals:**

- Verifying that an ID is authentic or unexpired-as-policy. This captures what the card says; it does not vouch for it.
- Storing the scan. Retaining ID images is a different feature with different obligations — see `customer-documents` for where document storage belongs.
- COI / insurance certificate extraction, and scanning on the Customer form. Both are follow-ons once the seam exists.

## Decisions

### Decision 1: PDF417 barcode first, vision second

Try the AAMVA barcode on the back of the card before offering to send a photo anywhere.

- **Why:** It is the only path that is simultaneously exact (the fields are encoded, not inferred), private (the image never leaves the device), free (no per-scan cost), offline, and _testable to a fixed expectation_ — the parser is a pure string→object function, so the hard part of the feature is covered by unit tests rather than by pointing a webcam at a card. The user's explicit requirement was that this be testable well; this is what makes that possible.
- **Alternative considered:** vision-only. Simpler (one code path, works on any card), but every scan costs money, sends ID PII to a third party, and can only be tested against recorded fixtures with a mocked client. Rejected as the primary path, kept as the fallback because barcodes only exist on US/CA government IDs — a contractor licence card has none.
- **Alternative considered:** on-device OCR (tesseract.js). Free and private like the barcode, but poor on glossy, holographed cards and a large wasm payload for a bad result. Rejected.

### Decision 2: A scan prefills; it never writes

The scanner hands values to the open form. The contractor reviews them and presses Save.

- **Why:** OCR and barcodes both fail in ways the person holding the card can see instantly and the server cannot see at all (wrong card, a passenger's licence, a decode that read the ghost image). It also means ID Scan adds no new write path to audit — it reaches the database through the same `addSubcontractor` / `editSubcontractor` actions as typing does, so the billing guard, the trial limit, and the duplicate-email rule all apply unchanged.

### Decision 3: Only name and address prefill; the rest is shown and dropped

A driver's licence yields a legal name, a residential address, a DOB, a document number, and an expiry. Only name and address map onto a Subcontractor.

- **Why:** `licenseNumber` on the Subcontractor record means their _trade_ licence ("EC-100420"), not their driver's licence. Filling it from a DL number would put the wrong number in a field the contractor will later read as a credential, and a driving expiry says nothing about whether they may do the work. The confirm sheet therefore _shows_ the DOB, document number and expiry off a government ID — so the contractor can see the scan read the right card — and then discards them with the image.
- **Consequence:** the vision path is what fills `licenseNumber`, because a trade licence card is the document that actually carries one. The two paths deliberately fill different fields.

### Decision 3a: `licenseExpiresAt` is added to the Subcontractor record

A nullable `license_expires_at` timestamp joins `licenseNumber`, captured on both forms and shown in the Credentials panel with the same urgency pill the insurance expiry gets.

- **Why:** a trade licence number without its expiry is half a credential — the number tells you they were licensed, the date tells you whether they still are, and that is the fact that decides whether a sub can go on a job. Reading a licence card and then dropping the one field that governs it would make the scan look like it worked while quietly losing the answer.
- **Shape:** additive and nullable, so every existing subcontractor keeps working with the field simply unset — the migration is one `ADD COLUMN`, with no backfill and nothing to reconcile.
- **Presentation:** `expiryStatus` (formerly `insuranceStatus`) now serves both dates, so "Expired 14 Feb" and "12d left" can't drift apart between the two credentials that can stop a job.

### Decision 4: The image is discarded, and that is a property of the design, not a policy

The frame lives in a `<canvas>` and a data URL held by the component. The barcode path never transmits it. The vision path posts it to the app's own server, which forwards it to the model and returns fields — it is never written to disk, never inserted into a row, and never logged.

- **Why:** Retaining government ID images obliges access control, a deletion path, and a retention answer, none of which this feature needs to do its job. The smallest thing that works is to hold the image only as long as the scan.
- **Trade-off:** there is no audit trail of what was scanned. Accepted: the record of the scan is the fields the contractor chose to save.

### Decision 5: Vision extraction is one server function, configured-or-degrade

`src/lib/server/id-scan.server.ts` exposes `extractIdFromImage(dataUrl)` and nothing outside it names Anthropic — the same containment rule `email.server.ts` applies to Resend. With no `ANTHROPIC_API_KEY` the function reports `unconfigured` and the UI says the barcode is the only way to scan here, rather than erroring.

- **Why:** the barcode path is genuinely useful on its own, so the feature must ship and work in development, in the demo, and for a self-hoster with no AI account. Same reasoning as ADR-0007 for email.
- **Model:** `claude-opus-5` with `output_config.format` (structured outputs), so the response is schema-validated JSON rather than prose to be regex'd. Vision and structured outputs are both first-class on this model.

### Decision 6: A dev-tools simulator, matching billing and email

`ID_SCAN_DEV_TOOLS=true` adds a panel to the scanner that decodes a bundled fixture payload instead of a camera frame, and lets the vision path return a canned result without calling the model.

- **Why:** the acceptance criteria for this feature are almost all "given this card, the form shows these values", and nobody should need a real driver's licence and a webcam to check one. This is the same lever `BILLING_DEV_TOOLS` and `EMAIL_DEV_TOOLS` already pull, so it needs no new concept.
- **Guard:** off unless the value is exactly `"true"`, and never on in production — it lets a signed-in contractor fabricate a scan result.

### Decision 7: AAMVA parsing scans for element IDs rather than trusting subfile offsets

The header declares byte offsets for each subfile. The parser reads them when they are sane, and otherwise falls back to scanning every line for a 3-character element ID.

- **Why:** real payloads routinely disagree with their own header — jurisdictions miscount, and readers normalize `\r\n`, which shifts every offset after the first. A parser that trusts the offsets fails on cards that a human reader handles fine. Scanning for `DAQ`, `DCS`, `DAC`… is forgiving in exactly the way the malformed-header case needs, and the header is still validated for the `ANSI ` magic so that arbitrary QR codes are rejected.

## Risks / Trade-offs

- **Decode rate depends on the camera and the light.** A worn barcode under a work light may not decode. → The vision fallback and plain typing both remain one tap away; the scanner never becomes the only way in.
- **The vision path sends ID PII to a third party.** → It is opt-in per scan (the contractor presses "Read the card" after the barcode fails), it is off entirely without a key, and the response is discarded with the image.
- **Vision extraction is non-deterministic.** → It is not on the primary path, its output is schema-validated before it reaches the UI, and it lands in a form the contractor confirms. Tests cover the schema and the degrade rule, not the model's judgement.
- **`zxing-wasm` ships a wasm binary.** → It is dynamically imported when the scanner opens, so it costs nothing on any other page, and the module is served from the app's own bundle rather than a CDN.
- **A licence expiry is not a trade licence expiry.** → Decision 3: shown, never stored.
