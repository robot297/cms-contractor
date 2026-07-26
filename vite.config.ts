import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { varlockVitePlugin } from '@varlock/vite-integration';

export default defineConfig({
	plugins: [
		// Must come before sveltekit() — it replaces Vite's own .env loading with
		// varlock, so env vars are validated against .env.schema and env.d.ts is
		// regenerated on every dev/build.
		varlockVitePlugin(),
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
