import { expect, type Page } from '@playwright/test';
import { test, signIn, DEV_CONTRACTOR, DEV_CUSTOMER } from './fixtures/app';

/**
 * The appearance preview.
 *
 * A palette menu can only show two swatches, and app.css is explicit that a
 * theme is four things — colour, geometry, type and the atmosphere behind the
 * app. The preview exists to show the other three, so these tests assert on
 * exactly that: two palettes must differ in ground colour, in corner radius and
 * in typeface, or it is a swatch with extra steps.
 *
 * Everything is read from computed style rather than from a screenshot: this is
 * about tokens reaching the right properties, and a pixel diff would fail on any
 * unrelated palette tweak.
 */

/** What the preview is actually painting, in one read. */
async function readPreview(page: Page) {
	return page.evaluate(() => {
		const ground = document.querySelector('.preview .ground') as HTMLElement;
		const brand = document.querySelector('.preview .brand') as HTMLElement;
		const mini = document.querySelector('.preview .mini') as HTMLElement;
		const btn = document.querySelector('.preview .btn') as HTMLElement;
		return {
			ground: getComputedStyle(ground).backgroundColor,
			atmos: getComputedStyle(ground).backgroundImage === 'none' ? 'none' : 'painted',
			typeface: getComputedStyle(brand).fontFamily.split(',')[0],
			radius: getComputedStyle(mini).borderRadius,
			accent: getComputedStyle(btn).backgroundColor
		};
	});
}

async function loadWith(page: Page, palette: string, theme: string) {
	await page.evaluate(
		([p, t]) => {
			localStorage.setItem('palette', p);
			localStorage.setItem('theme', t);
		},
		[palette, theme]
	);
	await page.goto('/contractor/settings?tab=workspace');
	await page.locator('.preview').waitFor();
}

test.describe('theme preview', () => {
	test('shows colour, geometry, type and air — and changes with the palette', async ({ page }) => {
		await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
		await page.waitForURL('**/contractor');

		// Blueprint is square and Vapor is 14px — the two ends of the geometry
		// range, chosen because a preview that only recolours would pass on any
		// other pair.
		await loadWith(page, 'blueprint', 'light');
		const blueprint = await readPreview(page);
		await loadWith(page, 'vapor', 'dark');
		const vapor = await readPreview(page);

		expect(blueprint.ground, 'colour').not.toBe(vapor.ground);
		expect(blueprint.radius, 'geometry').not.toBe(vapor.radius);
		expect(blueprint.typeface, 'type').not.toBe(vapor.typeface);
		expect(blueprint.accent).not.toBe(vapor.accent);
		// The atmosphere is what app.css calls the thing that "makes a theme a
		// place"; a preview without it is a colour chip.
		expect(blueprint.atmos).toBe('painted');
		expect(vapor.atmos).toBe('painted');
	});

	test('follows light and dark within one palette', async ({ page }) => {
		await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
		await page.waitForURL('**/contractor');

		await loadWith(page, 'voltage', 'light');
		const light = await readPreview(page);
		await loadWith(page, 'voltage', 'dark');
		const dark = await readPreview(page);

		expect(light.ground).not.toBe(dark.ground);
		expect(light.typeface, 'the face is the palette’s, not the mode’s').toBe(dark.typeface);
	});

	test('the portal’s copy previews the PORTAL’s accent', async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('palette:portal', 'ember');
			localStorage.setItem('theme:portal', 'dark');
		});
		await signIn(page, DEV_CUSTOMER.email, DEV_CUSTOMER.password);
		await page.waitForURL('**/customer**');
		await page.goto('/customer/account');
		await page.locator('.preview').waitFor();

		const seen = await readPreview(page);
		const rootBrand = await page.evaluate(() =>
			getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()
		);
		// `.shell` repoints --brand at the customer accent, and the preview reads
		// tokens rather than palette names — so it comes out in the portal's colour
		// without knowing which side of the product it is on.
		expect(seen.accent).not.toBe(rootBrand);
	});

	test('is decorative, not something a screen reader reads out', async ({ page }) => {
		await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
		await page.waitForURL('**/contractor');
		await page.goto('/contractor/settings?tab=workspace');
		// Every element in it is a coloured rectangle standing in for a real one.
		await expect(page.locator('.preview .frame')).toHaveAttribute('aria-hidden', 'true');
	});
});
