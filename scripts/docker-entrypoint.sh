#!/bin/sh
# Container start: apply migrations, optionally seed, then run the server.
set -e

echo "→ Applying database migrations…"
node scripts/migrate.mjs

# Opt-in sample data. Set SEED_ON_START=true (and SEED_CONTRACTOR_EMAIL) for a
# single deploy to load demo customers/orders, then unset it. Never fatal — a
# failed/skipped seed must not stop the server from booting.
if [ "$SEED_ON_START" = "true" ]; then
	echo "→ SEED_ON_START=true — seeding sample data…"
	node scripts/seed.mjs || echo "⚠ seed skipped/failed (continuing to start the server)"
fi

echo "→ Starting server…"
exec node build/index.js
