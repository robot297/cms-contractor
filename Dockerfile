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
ENV DATABASE_URL=local.db
ENV ORIGIN="http://localhost:3000"
# Default placeholder for local builds; override this in Coolify/production with a real secret.
ENV BETTER_AUTH_SECRET="development-secret-change-me"
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/static ./static
EXPOSE 3000
CMD ["node", "build/index.js"]