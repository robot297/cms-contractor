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
