# ConActFor

Contractor CRM to help enable better customer transparency for contractors who maybe prefer a sleek, streamlined mobile-first experience over all else.

## Tech Stack

- SvelteKit (Framework)
- Better Auth (Authentication)
- Drizzle (Database ORM)
- Varlock (Secure .env variable handling)
- Prettier and ESLint (Style and format)
- Vite (build)
- Coolify (uses Nix for deployment)

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

| Variable               | Purpose                                        | Example                              |
| ---------------------- | ---------------------------------------------- | ------------------------------------ |
| `DATABASE_URL`         | Postgres connection string for the **prod** DB | `postgres://user:pass@host:5432/crm` |
| `ORIGIN`               | Public URL; Better Auth rejects other origins  | `https://crm.upliftcollective.dev`   |
| `BETTER_AUTH_SECRET`   | 32+ char secret for sessions/tokens            | (generate a random one)              |
| `GITHUB_CLIENT_ID`     | GitHub OAuth app client id (optional)          |                                      |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret (optional)      |                                      |

If `ORIGIN` is unset it falls back to `http://localhost:5173` and Better Auth
will reject sign-in/sign-up from the deployed domain. The GitHub OAuth
**Authorization callback URL** is `${ORIGIN}/api/auth/callback/github`.

### Database migrations

Migrations live in `drizzle/` and are applied **automatically on startup** —
the container runs `node scripts/migrate.mjs` before `node build/index.js`
(see the `Dockerfile` entrypoint and the `start` script). It fails fast if a
migration errors, so the server never boots against an out-of-sync schema.

- **Build pack:** use the **Dockerfile** build pack in Coolify, or set the start
  command to `pnpm start` — both run migrations first.
- Migrations are idempotent (tracked in a `__drizzle_migrations` table); redeploys
  only apply new ones.
- To migrate a database manually: `DATABASE_URL='<prod-url>' pnpm migrate`.

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
