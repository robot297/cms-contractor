import { expect, type Page } from '@playwright/test';
import { test } from './fixtures/app';

/**
 * Light, dark, and system.
 *
 * The stored preference and the painted theme are two different values: `system`
 * is a choice, and what it resolves to is the OS's business and can change while
 * the tab is open. `<html data-theme>` therefore only ever carries `light` or
 * `dark` — no stylesheet in the app knows the word "system", which is what keeps
 * app.css a table of two themes rather than three.
 */

/** Wait out hydration: before it the button is visible, enabled and inert. */
async function armedToggle(page: Page) {
	const btn = page.locator('.theme-toggle');
	await expect(async () => {
		await btn.click();
		expect(await page.evaluate(() => localStorage.getItem('theme'))).not.toBeNull();
	}).toPass({ timeout: 15000 });
	return btn;
}

const stored = (page: Page) => page.evaluate(() => localStorage.getItem('theme'));
const stamp = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);

test.describe('theme mode', () => {
	test('one control walks light → dark → system', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'light' });
		await page.goto('/login');
		const btn = await armedToggle(page);

		// The first click lands on light (the cycle starts from system, the default).
		expect(await stored(page)).toBe('light');
		expect(await stamp(page)).toBe('light');
		await expect(btn).toHaveAttribute('aria-label', /Theme: Light\. Switch to dark\./);

		await btn.click();
		expect(await stored(page)).toBe('dark');
		expect(await stamp(page)).toBe('dark');
		await expect(btn).toHaveAttribute('aria-label', /Theme: Dark\. Switch to system\./);

		await btn.click();
		expect(await stored(page)).toBe('system');
		// Resolved against the emulated OS, which is light.
		expect(await stamp(page)).toBe('light');
		await expect(btn).toHaveAttribute('aria-label', /Theme: System\. Switch to light\./);

		await btn.click();
		expect(await stored(page)).toBe('light');
	});

	test('system resolves against the OS at first paint', async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem('theme', 'system'));

		await page.emulateMedia({ colorScheme: 'dark' });
		await page.goto('/login');
		expect(await stamp(page)).toBe('dark');

		await page.emulateMedia({ colorScheme: 'light' });
		await page.reload();
		expect(await stamp(page)).toBe('light');
		// The CHOICE is untouched by resolving it — this is the bug the split
		// exists to prevent: writing back today's OS value would freeze it in, and
		// the machine going dark at sunset would leave the app behind.
		expect(await stored(page)).toBe('system');
	});

	test('system follows the OS while the tab is open, an explicit choice does not', async ({
		page
	}) => {
		// A matchMedia stub, for two reasons. Playwright's emulateMedia flips
		// `.matches` but never dispatches `change` — verified: a listener registered
		// in the page sees zero events — and Chromium hands out a NEW MediaQueryList
		// per matchMedia() call, so a test cannot reach the app's own listener
		// without one shared object.
		await page.addInitScript(() => {
			const lists = new Map<string, EventTarget & { matches: boolean; media: string }>();
			let dark = false;
			(window as unknown as { __setDark: (v: boolean) => void }).__setDark = (v: boolean) => {
				dark = v;
				for (const [q, list] of lists) {
					list.matches = q.includes('dark') ? dark : !dark;
					list.dispatchEvent(new Event('change'));
				}
			};
			window.matchMedia = ((query: string) => {
				let list = lists.get(query);
				if (!list) {
					const target = new EventTarget() as EventTarget & { matches: boolean; media: string };
					target.media = query;
					target.matches = query.includes('dark') ? dark : !dark;
					// The legacy alias, which some code still reaches for.
					(target as unknown as { addListener: unknown }).addListener = target.addEventListener;
					lists.set(query, target);
					list = target;
				}
				return list;
			}) as typeof window.matchMedia;
		});

		await page.goto('/login');
		const btn = await armedToggle(page);
		while ((await stored(page)) !== 'system') await btn.click();
		expect(await stamp(page)).toBe('light');

		// The OS goes dark. No reload, no click.
		await page.evaluate(() =>
			(window as unknown as { __setDark: (v: boolean) => void }).__setDark(true)
		);
		await expect.poll(() => stamp(page)).toBe('dark');

		await page.evaluate(() =>
			(window as unknown as { __setDark: (v: boolean) => void }).__setDark(false)
		);
		await expect.poll(() => stamp(page)).toBe('light');

		// Now pick light explicitly. The OS must stop mattering.
		await btn.click();
		expect(await stored(page)).toBe('light');
		await page.evaluate(() =>
			(window as unknown as { __setDark: (v: boolean) => void }).__setDark(true)
		);
		await page.waitForTimeout(200);
		expect(await stamp(page)).toBe('light');
	});
});
