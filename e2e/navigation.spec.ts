import { test, expect, clickUntil, signUpContractor } from './fixtures/app';

/**
 * The nav chrome. Small surface, but it is on every screen — a menu that will
 * not close is a menu that blocks the whole app.
 */
test.describe('mobile navigation', () => {
	// The width at which the links collapse behind the hamburger.
	test.use({ viewport: { width: 480, height: 900 } });

	test('the menu opens, and closes again when you tap off it', async ({ page }) => {
		await signUpContractor(page);

		const menu = page.locator('.nav-collapse.open');
		await clickUntil(page.getByRole('button', { name: 'Open menu' }), menu);
		await expect(page.getByRole('link', { name: 'Orders' })).toBeVisible();

		// Tapping the page behind it closes it. It used to do nothing at all, which
		// reads as a stuck menu rather than as a deliberate modal — the account
		// menu beside it had had a click-away since it was built.
		await page.getByRole('button', { name: 'Close menu' }).nth(1).click({ force: true });
		await expect(menu).toHaveCount(0);
	});

	test('the X still closes it', async ({ page }) => {
		await signUpContractor(page);

		const menu = page.locator('.nav-collapse.open');
		await clickUntil(page.getByRole('button', { name: 'Open menu' }), menu);
		await page.getByRole('button', { name: 'Close menu' }).first().click();
		await expect(menu).toHaveCount(0);
	});

	test('following a link closes it too', async ({ page }) => {
		await signUpContractor(page);

		const menu = page.locator('.nav-collapse.open');
		await clickUntil(page.getByRole('button', { name: 'Open menu' }), menu);
		await page.getByRole('link', { name: 'People' }).click();
		await page.waitForURL('**/contractor/people');
		await expect(menu).toHaveCount(0);
	});
});

/**
 * Where the phone's links live, which is a saved preference rather than chrome.
 *
 * Covered because the way it broke was invisible to every other check: the form
 * posted `?/saveNav` while the action was called `saveNavPlacement`, and
 * SvelteKit answers an unknown action with a 404 that `use:enhance` swallows. The
 * radios rendered, took the click, and did nothing — nothing failed to compile,
 * no type was wrong, and no existing test went red. Only driving the control and
 * looking for the bar catches that.
 */
test.describe('navigation placement', () => {
	test.use({ viewport: { width: 480, height: 900 } });

	test('a contractor can move the phone navigation to the foot of the screen', async ({ page }) => {
		await signUpContractor(page);

		// Top bar is the default, so there is no tab bar to begin with.
		await expect(page.locator('nav.bottombar')).toHaveCount(0);

		// The settings sections are real links with their own URLs, so the tab is
		// reachable directly rather than by clicking through to it.
		await page.goto('/contractor/settings?tab=workspace');

		// The LABEL, because the radio inside it is `.sr-only` and has no box of its
		// own to press. Retried against the effect rather than clicked once: the
		// choice saves from an `onchange` handler, and before hydration the label is
		// visible, enabled, and completely inert — a first click checks the radio in
		// the DOM, posts nothing, and is then undone the moment Svelte attaches and
		// re-asserts `checked` from its own state.
		const bar = page.locator('nav.bottombar');
		await clickUntil(page.locator('label.nav-choice').filter({ hasText: 'Bottom bar' }), bar);
		await expect(bar.getByRole('link', { name: 'Orders' })).toBeVisible();

		// The page's foot clears the bar rather than running under it. The
		// reservation was a hand-totalled constant that had drifted from the bar's
		// real height, so the last ten pixels of the footer — the copyright line —
		// sat behind it. Both now come from one number; this is what says they
		// still agree.
		// Scrolled to the foot first: the bar is fixed to the viewport and the footer
		// is not, so anywhere above the bottom of the page the two are simply far
		// apart and the comparison means nothing.
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		const clearance = await page.evaluate(() => {
			const foot = document.querySelector('footer .bar')!.getBoundingClientRect();
			const nav = document.querySelector('nav.bottombar')!.getBoundingClientRect();
			const text = document.querySelector('.foot-text')!.getBoundingClientRect();
			return { footToNav: nav.top - foot.bottom, textToNav: nav.top - text.bottom };
		});
		expect(clearance.footToNav).toBeGreaterThanOrEqual(0);
		// And the text is not pressed against it either.
		expect(clearance.textToNav).toBeGreaterThan(24);

		// And it survives a reload, which is what says the choice reached the
		// database rather than only the component that drew the radio.
		await page.reload();
		await expect(page.locator('nav.bottombar')).toBeVisible();

		// Back again, so the preference is a switch and not a one-way door.
		await page.goto('/contractor/settings?tab=workspace');
		const top = page.locator('label.nav-choice').filter({ hasText: 'Top bar' });
		await expect(async () => {
			await top.click();
			await expect(page.locator('nav.bottombar')).toHaveCount(0, { timeout: 1_000 });
		}).toPass();
	});
});
