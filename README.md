# Contractor CRM

Contractor CRM to help enable better customer transparency for contractors who maybe prefer a sleek, streamlined mobile-first experience over all else.

## Tech Stack

- SvelteKit (Framework)
- Better Auth (Authentication)
- Drizzle (Database ORM)
- Varlock (Secure .env variable handling)
- Sentry (Error reporting, opt-in — see Error reporting)
- Prettier and ESLint (Style and format)
- Vite (build)
- Coolify (deploys the `Dockerfile` — **not** Nixpacks; see Deployment)

## Conventions

- [Styling](docs/styling.md) — theme tokens, the shared classes, and the
  dark-mode trap that keeps recurring. Worth reading before touching CSS.
- [Architecture decisions](docs/adr/) — why things are the way they are.

## Local Development

> Note: This project includes an optional Dev Container pattern.

Installing dependencies:

```bash
pnpm install
```

Serve the application:

```bash
pnpm dev
```

### Dev-only flags

All are off unless set to exactly `true`, and all **must stay unset in production**.
Each is documented in full in `.env.schema`; set them in `.env.local` and restart.

**Quote the value** — `FLAG="true"`, not `FLAG=true`. Varlock coerces an unquoted
`true` into a boolean while a quoted one stays a string, and the flags compare
against the string, so the unquoted form silently does nothing.

| Flag                        | What it gives you                                                           |
| --------------------------- | --------------------------------------------------------------------------- |
| `SEED_DEV_LOGIN`            | Pre-verified **contractor and customer** logins at boot, with sample work   |
| `CUSTOMER_PORTAL_DEV_TOOLS` | A **Customer view** button in the contractor nav, no sign-out needed        |
| `BILLING_DEV_TOOLS`         | A panel forcing your subscription into any state (trial, lapsed, comped, …) |
| `EMAIL_DEV_TOOLS`           | Forces the next send to succeed or fail without calling the provider        |
| `ID_SCAN_DEV_TOOLS`         | Runs a bundled fixture through the ID-scan confirm path, no camera or key   |

#### Seeing the customer portal

```bash
# .env.local
SEED_DEV_LOGIN="true"
CUSTOMER_PORTAL_DEV_TOOLS="true"
```

`SEED_DEV_LOGIN` provisions **two** accounts at boot, both pre-verified, password
`testerooni#123`:

| Account                           | Role       | Comes with                                                   |
| --------------------------------- | ---------- | ------------------------------------------------------------ |
| `contractor@upliftcollective.dev` | contractor | A comped subscription                                        |
| `customer@upliftcollective.dev`   | customer   | A linked customer record + a kitchen remodel with a timeline |

The customer is one of the contractor's own, already linked — so the portal has
real work on it the moment you get there. Two ways in:

- **Sign in as the customer** for the real thing: real auth, real session, real role.
- **Click 👁 Customer view** in the contractor nav to jump straight there without
  signing out. A yellow DEV banner names the customer, with an Exit button.

The switch is **read-only**: every write is refused, because a message stored there
would claim the customer wrote it. Your own role is never changed, and ownership of
the target customer is re-checked on every request. With the flag unset the button
is absent, the route 404s, and any leftover selection cookie is cleared.
See [ADR-0008](docs/adr/0008-view-as-is-a-development-affordance.md).

The seeded order carries one **internal** timeline note on purpose — it must never
appear in the portal, so it is there to make that visible when you look.

## Deployment

Deployed via Coolify in the `crm` namespace of my `uplift-collective.dev` domain.

- [crm.upliftcollective.dev](https://crm.upliftcollective.dev)

### Required environment variables

Set these in the host (Coolify), **not** in a committed `.env`:

| Variable                | Purpose                                                        | Example                              |
| ----------------------- | -------------------------------------------------------------- | ------------------------------------ |
| `DATABASE_URL`          | Postgres connection string for the **prod** DB                 | `postgres://user:pass@host:5432/crm` |
| `ORIGIN`                | Public URL; Better Auth rejects other origins                  | `https://crm.upliftcollective.dev`   |
| `BETTER_AUTH_SECRET`    | 32+ char secret for sessions/tokens                            | (generate a random one)              |
| `GITHUB_CLIENT_ID`      | GitHub OAuth app client id (optional)                          |                                      |
| `GITHUB_CLIENT_SECRET`  | GitHub OAuth app client secret (optional)                      |                                      |
| `SEED_ON_START`         | Set `true` for **one** deploy to load sample data, then remove | `true`                               |
| `SEED_CONTRACTOR_EMAIL` | Which existing contractor the sample data attaches to          | `you@example.com`                    |
| `STRIPE_SECRET_KEY`     | Stripe secret key. Leave unset to run without billing          | `sk_live_…`                          |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `/api/stripe/webhook`                       | `whsec_…`                            |
| `STRIPE_PRICE_MONTHLY`  | Recurring price id, $29/contractor/month                       | `price_…`                            |
| `STRIPE_PRICE_ANNUAL`   | Recurring price id, $290/contractor/year                       | `price_…`                            |
| `BILLING_DEV_TOOLS`     | `true` enables the subscription-state simulator. **Dev only**  | (leave unset)                        |
| `SENTRY_DSN`            | Error reporting. Leave unset to run without it                 | `https://…@…ingest.sentry.io/…`      |
| `SENTRY_ENVIRONMENT`    | Which deployment events come from                              | `production`                         |

Every `*_DEV_TOOLS` flag and `SEED_DEV_LOGIN` must be left unset here — see
[Dev-only flags](#dev-only-flags).

If `ORIGIN` is unset it falls back to `http://localhost:5173` and Better Auth
will reject sign-in/sign-up from the deployed domain. The GitHub OAuth
**Authorization callback URL** is `${ORIGIN}/api/auth/callback/github`.

### Error reporting (Sentry)

Off unless `SENTRY_DSN` is set. With it blank — which is the default, and the
right setting for local development — the SDK is never initialised, errors go to
the console as they always have, and no surface behaves differently. Nothing in
the app depends on Sentry being reachable.

To switch it on, set `SENTRY_DSN` (and optionally `SENTRY_ENVIRONMENT`). Both
halves of the app report: server load functions, actions and hooks via
`src/hooks.server.ts`, and the browser via `src/hooks.client.ts`. Both initialise
from the same options in `src/lib/sentry.ts`, so the two ends cannot drift.

**What is deliberately not sent.** This app's records are mostly other people's
personal information, so the posture is to identify _which_ account hit an error
and never _who they are_:

- `sendDefaultPii` is off, so no IP addresses and no session cookies.
- Request bodies are dropped outright — a failed "add customer" action otherwise
  carries the whole customer.
- Cookie/authorization headers, and capability parameters in URLs (`?token=`,
  `?code=`, …), are redacted in both request and breadcrumb URLs.
- The user object is reduced to `{ id, role }`. Name and email add nothing to a
  stack trace that a database lookup can't supply.
- Session Replay is **not** enabled, and shouldn't be: these screens are full of
  customer names, addresses and message threads.

`src/lib/sentry.test.ts` covers the scrubbing. It is the part worth testing —
a leak there is silent, since nothing looks wrong from inside the app.

**Source maps** are uploaded only when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and
`SENTRY_PROJECT` are all set at build time (see `vite.config.ts`). Without them
the build skips the upload entirely and never touches the network — but a
production stack trace will name minified chunks instead of files, so set them
for real deploys.

`SENTRY_TRACES_SAMPLE_RATE` (default `0.1`) governs **performance traces only**.
Errors are always sent regardless, so turning it down to control cost never costs
visibility into failures.

### Billing (Stripe)

Contractors get a 14-day trial on signup, then one plan at $29 per contractor per
month (or $290/year). There are no pricing tiers — see
[ADR-0006](docs/adr/0006-one-plan-priced-per-contractor.md).

**Without Stripe keys** the app runs fine: trials and the read-only lapse still
work, and the subscribe buttons report that checkout isn't configured. That is the
normal local-development setup.

To enable payments:

1. In Stripe, create one product with two recurring prices — $29/month and
   $290/year — and copy the `price_…` ids into `STRIPE_PRICE_MONTHLY` /
   `STRIPE_PRICE_ANNUAL`. The amounts live in Stripe, so changing what you charge
   never needs a deploy.
2. Add a webhook endpoint at `${ORIGIN}/api/stripe/webhook` subscribed to
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted` and
   `invoice.payment_failed`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
3. Locally, forward events instead:
   `stripe listen --forward-to localhost:5173/api/stripe/webhook`.

#### Testing billing

Three layers, because the interesting parts of billing aren't unit-testable:

| What                                                          | Where                                  | Run                 |
| ------------------------------------------------------------- | -------------------------------------- | ------------------- |
| Pure rules — who may write, the caps, provider-status mapping | `src/lib/crm.test.ts`                  | `pnpm test`         |
| Every contractor write is guarded, every portal path isn't    | `src/lib/server/billing.guard.test.ts` | `pnpm test`         |
| The wiring: lapse, limits, portals, refusals                  | `scripts/test-billing.mjs`             | `pnpm test:billing` |

`pnpm test:billing` drives a **running dev server** over real HTTP — real signups,
real form actions, real guards — and checks the things unit tests can't see: that a
lapsed contractor can still read everything, that their customers and
subcontractors are untouched, and that a refused write leaves the database alone.
It creates throwaway accounts and deletes them afterwards.

```sh
pnpm dev            # one terminal
pnpm test:billing   # another
```

To click through the states by hand, set `BILLING_DEV_TOOLS=true` and restart.
The billing page grows a panel that forces your own subscription into any state —
fresh trial, trial ending, trial expired, active, past due, lapsed, comped — so you
don't have to wait out 14 days or fail a real card. **Never enable it in
production:** it lets any signed-in contractor comp themselves. With it off, the
panel is hidden and the action is refused (both covered by `pnpm test:billing`).

`BILLING_LAUNCHED_AT` in `src/lib/crm.ts` is the line between grandfathered and
paying: any login created before it is comped permanently. **It must be in the
past** — a future date comps every new signup and switches the paywall off. (That
is also the rollback: push it forward to comp everyone, without dropping the table
or disturbing existing paid subscriptions.)

### End-to-end tests

`pnpm test:e2e` drives the real app in a browser — real server, real form
actions, real Postgres, real sessions — against its own `contractor-crm-e2e`
database, never the one you develop against. It creates that database itself, so
the only setup is `pnpm exec playwright install chromium` once and a running
Postgres.

`pnpm test` stays the unit suite. See [e2e/README.md](e2e/README.md) for what is
stubbed (the ZIP lookup, and the app's own email/ID-scan simulators) and why.

### Database migrations

Migrations live in `drizzle/` and are applied **automatically on startup** —
the container runs `node scripts/migrate.mjs` before `node build/index.js`
(see the `Dockerfile` entrypoint and the `start` script). It fails fast if a
migration errors, so the server never boots against an out-of-sync schema.

- **Build pack:** the Coolify app **must** use the **Dockerfile** build pack. It is
  the only path that pins Node 22, installs with the frozen lockfile, and supplies
  the build-time `DATABASE_URL` / `ORIGIN` / `BETTER_AUTH_SECRET` that `vite build`
  needs. Coolify defaults to **Nixpacks**, which ignores the `Dockerfile` entirely
  and fails the build with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`. The Dockerfile
  entrypoint runs migrations before starting the server.
- Migrations are idempotent (tracked in a `__drizzle_migrations` table); redeploys
  only apply new ones.
- To migrate a database manually: `DATABASE_URL='<prod-url>' pnpm migrate`.

### Sample data (optional, opt-in)

The startup sequence is **migrate → (optional seed) → start**
(`scripts/docker-entrypoint.sh`). Seeding is off by default and is only for a
demo phase — it is **destructive** (it deletes and re-creates that contractor's
customers/orders on every run) and **never fatal** (a failed/skipped seed can't
stop the server from booting).

To load sample data on a deploy:

1. Sign up your contractor on the deployed site first (the seed attaches to an
   existing contractor).
2. Set `SEED_ON_START=true` and `SEED_CONTRACTOR_EMAIL=<that email>`, deploy once.
3. **Remove `SEED_ON_START`** — otherwise every future deploy wipes and re-seeds
   that contractor's data.

Prefer the safer one-off instead of the flag when you can:
`DATABASE_URL='<prod-url>' SEED_CONTRACTOR_EMAIL=you@x.com pnpm db:seed`.

### ⚠️ Don't mix `db:push` and `db:migrate` on the same database

Pick one lane per database:

- **Migrations (use this for prod, and locally to mirror prod):** after a schema
  change run `pnpm db:generate`, then `pnpm db:migrate`. This is what the deploy
  runs on startup, and every change is recorded in `__drizzle_migrations`.
- **Push (fast, throwaway local only):** `pnpm db:push` force-syncs the schema
  but does **not** advance the migration ledger — and it produces no migration
  files for deploy.

Mixing them breaks migrations: `db:push` applies a column/table that a later
migration also tries to create, so `db:migrate` then fails with
`relation/column … already exists`. If a database gets tangled this way, reset it
(throwaway data) and re-run migrations:

```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
```

### First-time / reset

The migrations use plain `CREATE TABLE`, so they must run against an **empty**
database. If the prod DB already has partial tables (e.g. from an earlier
`db:push`) with no migration history, reset it once, then redeploy:

```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
```

### Deploy checklist

1. Set `DATABASE_URL`, `ORIGIN`, `BETTER_AUTH_SECRET` (+ GitHub vars if used).
2. Ensure the prod DB is empty (reset once if needed, see above).
3. Deploy. Startup logs should show `✓ Migrations applied` then `✓ Database connected`.
4. Sign up a contractor at `/login` (self-signup creates a contractor; customers join via invite).
5. If taking payments: set the four `STRIPE_*` vars, confirm `BILLING_LAUNCHED_AT`
   is in the past, and send a test event from the Stripe dashboard to verify the
   webhook endpoint returns 200.
