## 1. Configuration

- [x] 1.1 Add an `# Email — Resend` block to `.env.schema` with `RESEND_API_KEY` (`@sensitive @optional`) and `EMAIL_FROM` (`@optional`), commented in the style of the Stripe block: leave blank and mail degrades to `mailto:`, every surface still works.
- [x] 1.2 Add `resend` to `package.json` with `pnpm add resend` and confirm `env.d.ts` regenerates with the two new keys.

## 2. Provider interface

- [x] 2.1 Create `src/lib/server/email.server.ts` with `isEmailConfigured()` returning `Boolean(ENV.RESEND_API_KEY && ENV.EMAIL_FROM)`, reading `ENV` from `varlock/env`.
- [x] 2.2 Add a lazily-constructed Resend client that returns `null` when unconfigured, mirroring `stripeClient()` in `src/lib/server/stripe.server.ts`.
- [x] 2.3 Add `sendEmail({ to, replyTo, fromName, subject, html, text })` returning a discriminated result (`{ ok: true }` | `{ ok: false; reason: 'unconfigured' | 'provider'; detail?: string }`) — never throwing, and the only place a provider type is named.
- [x] 2.4 Build the From header as `"<fromName>" <EMAIL_FROM>` when a business name is present, falling back to the bare `EMAIL_FROM` when it is blank.
- [x] 2.5 Unit-test the From-header construction and the `isEmailConfigured` truth table (both set, each alone, neither) in `src/lib/server/email.server.test.ts` without calling the provider.

## 3. Send action

- [x] 3.1 Add a `sendEmail` form action reachable from every contractor surface, accepting `customerEmail`, `customerName`, `subject`, `body`, and optional `orderId`; guard it on a signed-in contractor.
- [x] 3.2 In the action, load the contractor's `contractorSettings` (business name + signature) from the database rather than trusting posted values, and resolve `replyTo` from the signed-in `user.email`.
- [x] 3.3 Recompose server-side with the existing `renderEmail(...)` from `$lib/email` — do not duplicate the rendering — and pass its `subject`/`html`/`text` to `sendEmail`.
- [x] 3.4 Return a typed failure to the client on `{ ok: false }` that carries the composed subject and body back, so the composer can offer the `mailto:` route with the message intact.
- [x] 3.5 When `orderId` is present, verify the Order belongs to the signed-in contractor before use; treat a failed check as no `orderId` (still send, write nothing).

## 4. Timeline record

- [x] 4.1 Add `recordEmailSent(orderId, { customerName, subject })` to `src/lib/server/crm.server.ts`, inserting a `timeline_entry` with `kind: 'message'`, `authorRole: 'contractor'`, `internal: false`, a title naming the recipient and `detail` carrying the subject.
- [x] 4.2 Call it from the send action only after `sendEmail` returns `{ ok: true }` and only when an authorised `orderId` is present.
- [ ] 4.3 Confirm the entry renders correctly in the customer portal timeline and the contractor's order detail.

## 5. Composer

- [x] 5.1 In `src/lib/ContactComposer.svelte`, add an `orderId?: string` prop and read an `emailSendingConfigured` flag from `page.data`.
- [x] 5.2 Replace the Email branch of `send()` with a form POST to the send action using `use:enhance`; leave the Text and Call branches on `window.location` untouched.
- [x] 5.3 Add a sending state that disables the send button while the request is in flight.
- [x] 5.4 On success, clear the composer and call `onsent()` as today.
- [x] 5.5 On failure, show an inline error with the composed message still in the fields and a "Open in your mail client instead" action that performs today's `mailto:` handoff.
- [x] 5.6 When `emailSendingConfigured` is false, send takes the `mailto:` path directly with no server round-trip and no error surface.

## 6. Call sites

- [x] 6.1 Pass `orderId` from the order-detail composer in `src/routes/contractor/orders/[id]/+page.svelte`.
- [x] 6.2 Pass `orderId` from the orders-list composer in `src/routes/contractor/orders/+page.svelte`.
- [x] 6.3 Leave the dashboard, customer directory, and subcontractor roster composers without `orderId` — they send, they just don't record.
- [x] 6.4 Expose `emailSendingConfigured` from `src/routes/contractor/+layout.server.ts` alongside the existing `emailTemplates` and `contractorSettings`.

## 7. Verification

- [x] 7.1 `pnpm check` passes (0 errors/warnings).
- [x] 7.2 `pnpm test` passes, including the new `email.server` unit tests.
- [ ] 7.3 Manual, unconfigured (both env vars blank): sending from each of the five surfaces opens `mailto:` exactly as before, with no error shown.
- [ ] 7.4 Manual, configured against a Resend test key: a send from an order arrives with the branded HTML, the business name as display name, the contractor's address as Reply-To, and writes one timeline entry.
- [ ] 7.5 Manual, forced provider failure (bad key): the composer reports the failure, keeps the message, offers the `mailto:` route, and writes no timeline entry.
- [ ] 7.6 Render the sent HTML in Gmail, Outlook, and Apple Mail — light and dark — and confirm the shell holds.
