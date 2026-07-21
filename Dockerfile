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
ENV DATABASE_URL=postgresql://postgres:postgres@postgres:5432/app
ENV ORIGIN="http://localhost:3000"
ENV BETTER_AUTH_SECRET="development-secret-change-me"
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=postgresql://postgres:postgres@postgres:5432/app

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/static ./static
# Migrations + runtime migrator (drizzle-orm only — no drizzle-kit/config needed).
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
EXPOSE 3000
# Migrate → (optional seed) → start. See scripts/docker-entrypoint.sh.
# Absolute path so the entrypoint is found regardless of the launch CWD.
ENTRYPOINT ["sh", "/app/scripts/docker-entrypoint.sh"]
