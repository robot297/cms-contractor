# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Placeholders, NOT secrets — and nothing reads their values.
#
# varlock validates the environment against .env.schema during `vite build`, and
# the schema marks these required, so the build needs them PRESENT. It never
# needs them REAL: no secret is inlined into the bundle, because every one is
# read at container start through `varlock run` (scripts/docker-entrypoint.sh).
# The built artifact is byte-identical whatever these say — which is exactly why
# a real value must never be passed here.
#
# Set as a prefix on the RUN rather than as ENV so they live for this one command
# and never become image-layer metadata. As ENV they showed up in `docker history`
# and tripped BuildKit's SecretsUsedInArgOrEnv check — a fair complaint even for a
# fake value, since the next person to paste a real one inherits a silent leak.
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" \
	ORIGIN="http://localhost:3000" \
	BETTER_AUTH_SECRET="build-time-placeholder-not-a-secret" \
	pnpm build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
# No DATABASE_URL default here, deliberately.
#
# It used to carry a compose-shaped placeholder, which meant the variable was
# never actually absent — so varlock's validation at container start could not do
# the one thing it exists for. A deploy whose DATABASE_URL failed to inject would
# boot happily and point at whatever host `postgres` resolves to on that network,
# instead of stopping. Absent is better: the entrypoint fails loudly and names it.
# The local stack is unaffected — docker-compose.yml sets DATABASE_URL explicitly.

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/static ./static
# Migrations + runtime migrator (drizzle-orm only — no drizzle-kit/config needed).
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
# varlock validates the runtime env against this schema at container start.
COPY --from=build /app/.env.schema ./.env.schema
EXPOSE 3000
# Migrate → (optional seed) → start. See scripts/docker-entrypoint.sh.
# Absolute path so the entrypoint is found regardless of the launch CWD.
ENTRYPOINT ["sh", "/app/scripts/docker-entrypoint.sh"]
