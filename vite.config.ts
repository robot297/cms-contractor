import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { varlockVitePlugin } from '@varlock/vite-integration';
import { sentrySvelteKit } from '@sentry/sveltekit';

// Source maps are uploaded only when a build is given a token to upload them
// with. Read from process.env rather than varlock's ENV because this is build
// configuration, evaluated before the plugin chain that provides ENV — and
// because these three are build-time only, never read by the running app.
const { SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT } = process.env;
const uploadSourceMaps = Boolean(SENTRY_AUTH_TOKEN && SENTRY_ORG && SENTRY_PROJECT);

export default defineConfig({
	plugins: [
		// Must come before sveltekit() — it replaces Vite's own .env loading with
		// varlock, so env vars are validated against .env.schema and env.d.ts is
		// regenerated on every dev/build.
		varlockVitePlugin(),
		// Before sveltekit() too, per the SDK's own requirement. Without a token
		// this contributes nothing to the build: no upload, no network, no sentry-cli.
		// The cost of leaving it out would be paid later — a production stack trace
		// that names minified chunks instead of files.
		...(uploadSourceMaps
			? [
					sentrySvelteKit({
						sourceMapsUploadOptions: {
							org: SENTRY_ORG,
							project: SENTRY_PROJECT,
							authToken: SENTRY_AUTH_TOKEN
						}
					})
				]
			: []),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			typescript: {
				config: (config) => {
					config.include.push('../drizzle.config.ts');
					// varlock's generated env.d.ts — it augments `varlock/env` so
					// ENV.* is typed. Note the generated tsconfig already lists a
					// bare "env.d.ts", which is SvelteKit's own, not this one.
					config.include.push('../env.d.ts');
				}
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		environment: 'node',
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
});
