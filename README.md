# ConActFor

Contractor CRM to help enable better customer transparency for contractors who maybe prefer a sleek, streamlined mobile-first experience over all else.

## Tech Stack

- SvelteKit (Framework)
- Better Auth (Authentication)
- Drizzle (Database ORM)
- Varlock (Secure .env variable handling)
- Prettier and ESLint (Style and format)
- Vite (build)
- Coolify (deploys the `Dockerfile` — **not** Nixpacks; see Deployment)

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

If `ORIGIN` is unset it falls back to `http://localhost:5173` and Better Auth
will reject sign-in/sign-up from the deployed domain. The GitHub OAuth
**Authorization callback URL** is `${ORIGIN}/api/auth/callback/github`.

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
