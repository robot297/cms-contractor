#!/bin/sh
# Container start: apply migrations, optionally seed, then run the server.
set -e

# Resolve paths relative to THIS script's location, not the current working
# directory. Some hosts (e.g. Coolify) launch the entrypoint from a different
# CWD, which turned "node scripts/migrate.mjs" into ".../scripts/scripts/migrate.mjs"
# — the file was never found, migrations silently didn't run, and the server
# booted against an empty DB ("relation \"session\" does not exist").
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
cd "$APP_DIR"

# Everything runs under `varlock run`, which resolves the environment against
# .env.schema and injects it. Host-provided vars (Coolify et al.) still win —
# this only adds validation, so a missing/malformed var fails loudly here
# instead of surfacing as a confusing error mid-request.
VARLOCK="$APP_DIR/node_modules/.bin/varlock"

echo "→ Applying database migrations…"
"$VARLOCK" run -- node "$SCRIPT_DIR/migrate.mjs"

# Opt-in sample data. Set SEED_ON_START=true (and SEED_CONTRACTOR_EMAIL) for a
# single deploy to load demo customers/orders, then unset it. Never fatal — a
# failed/skipped seed must not stop the server from booting.
if [ "$SEED_ON_START" = "true" ]; then
	echo "→ SEED_ON_START=true — seeding sample data…"
	"$VARLOCK" run -- node "$SCRIPT_DIR/seed.mjs" || echo "⚠ seed skipped/failed (continuing to start the server)"
fi

echo "→ Starting server…"
exec "$VARLOCK" run -- node "$APP_DIR/build/index.js"
