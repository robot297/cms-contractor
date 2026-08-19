import { expect, type Browser, type Page } from '@playwright/test';
import { clickUntil, signIn, DEV_CUSTOMER } from './app';

/**
 * Driving the customer portal.
 *
 * Shared because two specs need it and both got the same thing wrong
 * independently — see `openPortalOrder`.
 */

/** Sign the seeded customer in, in their own browser context. */
export async function customerPage(browser: Browser): Promise<Page> {
	const context = await browser.newContext();
	const page = await context.newPage();
	await signIn(page, DEV_CUSTOMER.email, DEV_CUSTOMER.password);
	// The portal opens on a job rather than an index — a customer with one job in
	// flight should not have to pick it out of a list first.
	await page.waitForURL(/\/customer(\/|$)/);
	return page;
}

/**
 * Open one of the customer's jobs from the rail, and WAIT until it is open.
 *
 * The waiting is the whole point. Clicking a link and carrying straight on
 * leaves the next line acting against whichever job the portal happened to land
 * on — and because the seeded workspace gives this customer several, that is a
 * real job with a real thread rather than a blank page that would fail loudly.
 * A test doing this sent its message to somebody else's order and then reported
 * that the dashboard had lost it.
 */
export async function openPortalOrder(page: Page, projectName: string): Promise<void> {
	await page.getByRole('link', { name: projectName }).first().click();
	// The heading, not the URL: it only renders once the order's own data has
	// loaded, so it proves the page is really this job and not still the last one.
	await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
}

/**
 * Expand the portal's collapsed history, when the job has one to expand.
 *
 * Retried against the effect rather than clicked once: this often runs straight
 * after `reload()`, and a drill whose handler has not hydrated yet is visible,
 * enabled, and completely inert.
 */
export async function openPortalHistory(page: Page): Promise<void> {
	const drill = page.getByRole('button', { name: /^History/ });
	if (!(await drill.isVisible().catch(() => false))) return;
	await clickUntil(drill, page.locator('ol.timeline'));
}
