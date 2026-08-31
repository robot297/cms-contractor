import { readFileSync } from 'node:fs';
import { test, signIn, DEV_CONTRACTOR } from './fixtures/app';

/**
 * TEMPORARY — screenshots of the real app in each candidate theme.
 *
 * Not a test: it asserts nothing. It exists so a theme can be judged on the
 * actual dashboard and orders list rather than on swatches, and it drives the
 * real seeded workspace so every state that matters is on screen at once.
 *
 * SKIPPED unless `SHOTS=1`, because it is a review tool and not part of the
 * suite: one run per palette per mode, all of which only write PNGs, would be
 * several minutes of CI spent proving nothing — and a green run would say the
 * app works when all it did was take pictures.
 *
 *   SHOTS=1 pnpm exec playwright test e2e/palette-shots.spec.ts
 *
 * Delete this file along with the switcher once a theme is chosen.
 */
test.skip(!process.env.SHOTS, 'Review tool — run with SHOTS=1');

/**
 * The candidates, read out of the stylesheet that defines them.
 *
 * A hand-kept copy went stale the moment round two landed: five candidates the
 * tool built to judge them could not photograph. `src/lib/theme.svelte` would be
 * the tidier source, but Playwright does not compile runes, so importing it here
 * throws at load — and the CSS is the thing that decides whether a shot is even
 * possible. Comments are blanked first, because the file's header documents the
 * selector shape with a stand-in name that is not a real palette.
 */
const PALETTES: string[] = [
	...new Set(
		[
			...readFileSync('src/app.css', 'utf8')
				.replace(/\/\*[\s\S]*?\*\//g, '')
				.matchAll(/\[data-palette='([a-z]+)'\]/g)
		].map((m) => m[1])
	)
];
const THEMES = ['dark', 'light'] as const;

/** Wide enough for the two-column dashboard and the multi-column lists. */
test.use({ viewport: { width: 1440, height: 1200 } });

for (const palette of PALETTES) {
	for (const theme of THEMES) {
		test(`${palette} — ${theme}`, async ({ page }) => {
			// Stamped before the app boots, the same way app.html does it, so the
			// first paint is already in the right palette.
			await page.addInitScript(
				([p, t]) => {
					try {
						localStorage.setItem('palette', p);
						localStorage.setItem('theme', t);
					} catch {
						/* private mode — the stamps below still apply */
					}
				},
				[palette, theme]
			);

			await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
			await page.waitForURL('**/contractor');
			// The webfont swaps in late and the charts measure after a frame; without
			// this the shot catches a half-laid-out page.
			await page.waitForLoadState('networkidle');
			await page.evaluate(() => document.fonts?.ready);

			// Viewport-height, not full-page. The seeded workspace has 130 orders, and
			// a full-page shot is 5000px of repeated rows with the chrome that
			// actually carries the theme squeezed into the top 3%.
			await page.screenshot({ path: `palette-shots/${palette}-${theme}-dashboard.png` });

			await page.goto('/contractor/orders');
			await page.waitForLoadState('networkidle');
			await page.screenshot({ path: `palette-shots/${palette}-${theme}-orders.png` });
		});
	}
}
