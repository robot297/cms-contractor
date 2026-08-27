# End-to-end tests

Playwright specs that drive the real app — real Vite server, real form actions,
real Postgres, real Better Auth sessions.

```sh
pnpm exec playwright install chromium   # once
docker compose up -d db                 # if Postgres isn't already up
pnpm test:e2e
```

That's the whole setup. The suite creates its own database and the app migrates
it on boot.

| Command                | What it does                                         |
| ---------------------- | ---------------------------------------------------- |
| `pnpm test:e2e`        | Run everything headless                              |
| `pnpm test:e2e:ui`     | Playwright's watch UI — the fastest way to debug one |
| `pnpm test:e2e:reset`  | Drop and recreate the e2e database first             |
| `pnpm test:e2e:report` | Open the HTML report from the last run               |

`pnpm test` stays the unit suite (vitest). The two are separate on purpose: unit
tests are pure and instant, these are neither.

## What is real, and what isn't

Nearly everything is real. Three things are not, and each is faked at the
narrowest point that keeps a run from depending on the outside world:

| Thing            | How                                        | Why                                                                                                            |
| ---------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| ZIP → city/state | `page.route` stub in `fixtures/app.ts`     | The real endpoint calls a third party. A suite that fails when they're slow reports on their uptime, not ours. |
| Email sending    | The app's own `EMAIL_DEV_TOOLS` simulator  | Only the provider call is skipped — billing gate, ownership check and timeline write all still run.            |
| ID scan          | The app's own `ID_SCAN_DEV_TOOLS` fixtures | Runs the **real** parser and the real confirm step, without a camera or a driver's licence.                    |

`sms:` and `tel:` handoffs aren't faked — they're real navigations to schemes
Chromium can't follow, so the tests intercept them and assert on the URL the app
built, which is the whole of what the app controls.

## The database

The suite runs against `contractor-crm-e2e`, **never** the `contractor-crm`
database you develop against. `scripts/e2e-db.mjs` creates it when missing; the
app migrates it on boot (`RUN_MIGRATIONS_ON_START`).

That script is chained ahead of `vite dev` in the `webServer` command rather than
living in `globalSetup`, and the placement is load-bearing: Playwright starts
`webServer` **before** it runs `globalSetup`, so a hook there is already too late
— the app boots first and dies migrating a database that doesn't exist. A
top-level `await` in the config doesn't work either; the config loader doesn't
await it.

Point it somewhere else with `E2E_DATABASE_URL`.

Data accumulates across runs and that is fine — every test names its records with
a unique suffix and asserts only on its own. `pnpm test:e2e:reset` is for when you
want to poke around the data by hand, not for correctness.

## How a test gets an account

**Every test signs up its own contractor.** It costs one form submit and buys
parallel-safety, rerun-safety, and coverage of the sign-up path from every spec
rather than from one that everything else then bypasses.

This works because the e2e server runs with no mail provider configured, which
turns off email-verification enforcement (see `auth.ts`) — so sign-up ends in a
session rather than at a "check your inbox" wall. `playwright.config.ts` sets
`RESEND_API_KEY` and `EMAIL_FROM` empty on purpose for exactly this reason.

**The customer portal is the exception.** A portal login is a User bound to a
customer record, and that binding is only ever made by accepting an emailed
invite — which this server cannot send. Those specs use the seeded pair
(`SEED_DEV_LOGIN`) and stay parallel-safe by giving each test its **own order**
for that customer instead of sharing the seeded one.

## Writing a new spec

Import `test` from `./fixtures/app`, not from `@playwright/test` — the local one
carries the ZIP stub.

```ts
import { test, expect, seedWorkspace } from './fixtures/app';
import { setStatus, openTab, timelineEntry } from './fixtures/order';

test('...', async ({ page }) => {
	const { order, orderUrl, customer } = await seedWorkspace(page);
	await setStatus(page, 'In Progress');
	await openTab(page, 'History');
	await expect(timelineEntry(page, 'Status changed')).toBeVisible();
});
```

### The one trap: hydration

Playwright waits for an element to be _actionable_ — visible, stable, enabled.
None of that says its `onclick` is attached yet. A server-rendered button is all
three while its handler is still a network round trip away, so a plain `.click()`
right after `goto()` hits an inert element and silently does nothing.

Use `clickUntil(target, expected)` for anything client-side. It retries the click
until the effect you name actually appears. This is the single most common cause
of a flaky SvelteKit suite.

Three forms also open **themselves** when the thing they create doesn't exist yet
(customer directory, subcontractor roster, order list) — so the first call finds
them already up and later ones must press the button. The `openModal` helper
handles both; don't assume either.

### Selector conventions

- Form fields: `input[name="..."]` — those names are the contract the server
  action reads, so they're the most stable thing on the page. Label copy is
  presentation and moves.
- Buttons, links, tabs, dialogs: roles and accessible names.
- Scope to the dialog. Several triggers share an accessible name with the submit
  they open (`Add customer` is both the ＋ and the save).

## Files

| File                         | Covers                                                               |
| ---------------------------- | -------------------------------------------------------------------- |
| `auth.spec.ts`               | Sign up, sign in, sign out, refusal, route guarding                  |
| `contractor-core.spec.ts`    | Adding a customer, subcontractor and order; ZIP autofill             |
| `order-workspace.spec.ts`    | Assigning crew, status, notes, history, email/text/call              |
| `customer-portal.spec.ts`    | What the customer sees, internal notes staying internal, close-out   |
| `documents-and-scan.spec.ts` | Upload, content-type refusal, ID scan prefill                        |
| `follow-ups.spec.ts`         | Follow-up due/snooze/clear, and customers awaiting a reply           |
| `order-lifecycle.spec.ts`    | Import → order → statuses → deposit + balance → invoice, both sides  |
| `crew.spec.ts`               | Crew vs subcontractor, stints and on-site today, the one directory   |
| `getting-started.spec.ts`    | The guide card, and the first job made in one submit                 |
| `navigation.spec.ts`         | The nav's destinations, and where the folded routes redirect         |
| `dev-fixtures.spec.ts`       | The seeded dev workspace, and the dashboard states it exists to show |
| `palette-shots.spec.ts`      | Not a test — screenshots of each candidate theme, `SHOTS=1` only     |
| `fixtures/app.ts`            | Sign-in, record creation, the ZIP stub, `seedWorkspace`              |
| `fixtures/order.ts`          | Driving one order's workspace                                        |
| `fixtures/portal.ts`         | Driving the customer's side of the same order                        |
| `../scripts/e2e-db.mjs`      | Creates (or resets) the test database before the server starts       |
