import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests.
 *
 * These drive the real app: a real Vite dev server, real form actions, real
 * Postgres, real Better Auth sessions. The only things stubbed are the ones that
 * would otherwise reach outside this machine — the ZIP lookup, and the email
 * provider (via the app's own EMAIL_DEV_TOOLS simulator).
 *
 * Two rules make the suite deterministic:
 *
 *   1. It runs against its OWN database (`contractor-crm-e2e`), never the one you
 *      develop against. The app migrates it on boot, so nothing has to be set up
 *      by hand beyond creating the empty database once — see e2e/README.md.
 *   2. Every fixture a test creates is named with a per-worker unique suffix, so
 *      parallel workers and repeat runs can't collide on the `(contractor, email)`
 *      uniqueness the app enforces.
 */

/** The e2e server's port. Deliberately not 3000 (docker) or 5173 (your `pnpm dev`). */
const PORT = 4173;
const ORIGIN = `http://localhost:${PORT}`;

/**
 * The suite's own database, never the one you develop against. Overridable so a
 * CI runner can point at its own Postgres; `e2e/global-setup.ts` creates it if it
 * isn't there yet.
 */
const DATABASE_URL =
	process.env.E2E_DATABASE_URL ??
	'postgresql://postgres:postgres@localhost:5432/contractor-crm-e2e';

export default defineConfig({
	testDir: 'e2e',
	// A form action that never resolves should fail the test, not the run.
	timeout: 45_000,
	expect: { timeout: 10_000 },
	fullyParallel: true,
	// A stray `test.only` shouldn't quietly reduce CI to one test.
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	// The app is one Node process talking to one Postgres; past this the server
	// becomes the bottleneck and timings get flaky rather than faster.
	workers: process.env.CI ? 2 : 3,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

	use: {
		baseURL: ORIGIN,
		// Kept only for failures — traces are large, and a green run doesn't need them.
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'off',
		// Real users are not this fast; a default that low turns a slow query into a
		// mystery failure rather than a slow test.
		actionTimeout: 10_000
	},

	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				// Grants `navigator.clipboard` and friends without a permission prompt
				// mid-test. Camera is NOT granted: the ID-scan test uses the app's
				// fixture path rather than a fake video device.
				permissions: ['clipboard-read', 'clipboard-write']
			}
		}
	],

	webServer: {
		// Two steps, chained, and the order matters: `scripts/e2e-db.mjs` creates the
		// test database if it is missing, and it has to finish before anything
		// connects. Playwright's own `globalSetup` runs AFTER `webServer` has
		// started, and a top-level await in this file is not awaited by the config
		// loader — so `&&` is the only arrangement that actually sequences them.
		//
		// Plain `vite dev`, not `pnpm dev`: that script unsets DATABASE_URL so
		// varlock falls back to .env.local, which is exactly what must NOT happen
		// here. varlock lets process.env override every env file, so the values
		// below win over .env.local without editing it.
		command: `node scripts/e2e-db.mjs && pnpm exec vite dev --port ${PORT} --strictPort`,
		url: `${ORIGIN}/login`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		stdout: 'pipe',
		stderr: 'pipe',
		env: {
			DATABASE_URL,
			ORIGIN,
			// The seeded contractor and customer logins, for the specs that need the
			// customer portal (which needs a customer User bound to a customer row).
			SEED_DEV_LOGIN: 'true',
			// Blank ON PURPOSE, and load-bearing. With no deliverable mail the app
			// stops enforcing email verification (see auth.ts) — which is what lets a
			// spec sign up a brand-new contractor and land straight in the app instead
			// of stopping at "check your inbox". Every test gets its own contractor
			// that way, so they can run in parallel without sharing records.
			RESEND_API_KEY: '',
			EMAIL_FROM: '',
			// Lets the composer simulate a send outcome instead of calling Resend, so
			// the confirmation and failure states are reachable with no API key and no
			// real mail. Everything else on that path — billing gate, ownership check,
			// timeline write — still runs for real.
			EMAIL_DEV_TOOLS: 'true',
			// Runs a bundled licence payload through the real parser and the real
			// confirm-and-prefill step, so the scan flow is testable with no camera.
			ID_SCAN_DEV_TOOLS: 'true',
			// The contractor nav's "Customer view" switch, used to check the portal
			// renders an order without juggling two browser contexts.
			CUSTOMER_PORTAL_DEV_TOOLS: 'true',
			// Explicit rather than inherited: the app migrates the e2e database on
			// boot, which is what makes a freshly-created empty one work.
			RUN_MIGRATIONS_ON_START: 'true',
			// No error reporting from a test run.
			SENTRY_DSN: '',
			// Not a real key — present so billing code paths that check for one behave
			// consistently rather than depending on whatever is in .env.local.
			STRIPE_SECRET_KEY: ''
		}
	}
});
