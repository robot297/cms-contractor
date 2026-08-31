import { expect, type Page } from '@playwright/test';
import {
	test,
	signIn,
	createOrder,
	newOrderFields,
	DEV_CONTRACTOR,
	DEV_CUSTOMER,
	uid
} from './fixtures/app';
import { completeOrder } from './fixtures/order';
import { customerPage, openPortalOrder } from './fixtures/portal';

/**
 * Asking for a review when the job is done.
 *
 * The links are the contractor's — every platform hands out a different URL per
 * business — so this is two surfaces: Settings › Reviews, where they are pasted,
 * and the portal's completed job, where the customer is offered them.
 *
 * The condition is the interesting part. The links must be absent on an
 * unfinished job, and absent from the PAYLOAD rather than merely hidden, so the
 * tests below check the rendered page and not just what is on screen.
 */

const GOOGLE = 'https://g.page/r/CtestReviewLink/review';

/**
 * Paste one platform's link into Settings › Reviews.
 *
 * Waits on the FIELD, not on the "Saved ✓" tick. The tick is client state, so it
 * only appears once `use:enhance` has attached — and this form is a submit
 * button, so an un-hydrated click posts natively and reloads the page, wiping
 * it. Retrying the click (the suite's usual `clickUntil`) makes that worse
 * rather than better: every attempt restarts hydration, so the loop can starve.
 *
 * Both paths — enhanced fetch and native POST — leave the saved URL in the box,
 * so that is what this waits for. It is also the more honest assertion: the row
 * reaching the database is the fact, and the tick is decoration on top of it.
 */
async function setReviewLink(page: Page, platform: string, url: string) {
	await page.goto('/contractor/settings?tab=workspace');
	const form = page.locator(`form[action^="?/saveReviewLink"][data-platform="${platform}"]`);
	const field = form.locator('input[name="url"]');
	await field.fill(url);
	await form.getByRole('button', { name: 'Save' }).click();
	await expect(field).toHaveValue(url);
}

test.describe('review links', () => {
	test('a contractor pastes a link and it survives a reload', async ({ page }) => {
		await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
		await page.waitForURL('**/contractor');

		await setReviewLink(page, 'google', GOOGLE);

		// Reloaded, because the tick only proves the action returned — this proves
		// the row reached the database.
		await page.goto('/contractor/settings?tab=workspace');
		const field = page
			.locator('form[action^="?/saveReviewLink"][data-platform="google"]')
			.locator('input[name="url"]');
		await expect(field).toHaveValue(GOOGLE);
	});

	test('a bad link is refused, and the good one beside it is untouched', async ({ page }) => {
		await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
		await page.waitForURL('**/contractor');
		await setReviewLink(page, 'google', GOOGLE);

		await page.goto('/contractor/settings?tab=workspace');
		const yelp = page.locator('form[action^="?/saveReviewLink"][data-platform="yelp"]');
		// `type="url"` would block a truly malformed value in the browser, so this
		// uses a well-formed URL with a scheme the server must refuse.
		await yelp.locator('input[name="url"]').fill('javascript:alert(1)');
		await yelp.getByRole('button', { name: 'Save' }).click();
		await expect(yelp.locator('.err')).toBeVisible();

		// One form per platform is the point: Yelp failing must not touch Google.
		await page.goto('/contractor/settings?tab=workspace');
		await expect(
			page
				.locator('form[action^="?/saveReviewLink"][data-platform="google"]')
				.locator('input[name="url"]')
		).toHaveValue(GOOGLE);
	});

	test('the customer is asked only once the job is complete', async ({ page, browser }) => {
		await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
		await page.waitForURL('**/contractor');
		await setReviewLink(page, 'google', GOOGLE);

		const order = newOrderFields(DEV_CUSTOMER.name, { projectName: `Reviewed job ${uid()}` });
		const orderUrl = await createOrder(page, order);

		// Mid-job: no ask, and — the part that matters — no link in the payload.
		const customer = await customerPage(browser);
		await openPortalOrder(customer, order.projectName);
		await expect(customer.locator('#reviews')).toHaveCount(0);
		expect(await customer.content()).not.toContain('CtestReviewLink');

		await page.goto(orderUrl);
		await completeOrder(page, { total: '1200.00' });

		await customer.reload();
		const card = customer.locator('#reviews');
		await expect(card).toBeVisible();
		const link = card.getByRole('link', { name: /Google/ });
		await expect(link).toHaveAttribute('href', GOOGLE);
		// New tab, and never leaking the portal URL to the platform.
		await expect(link).toHaveAttribute('target', '_blank');
		await expect(link).toHaveAttribute('rel', /noopener/);

		await customer.close();
	});

	test('a contractor with no links configured asks for nothing', async ({ page, browser }) => {
		await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
		await page.waitForURL('**/contractor');
		// Clear every platform, so a link left by another test cannot pass this.
		await page.goto('/contractor/settings?tab=workspace');
		const forms = page.locator('form[action^="?/saveReviewLink"]');
		for (let i = 0; i < (await forms.count()); i++) {
			const form = forms.nth(i);
			const field = form.locator('input[name="url"]');
			if ((await field.inputValue()) === '') continue;
			await field.fill('');
			await form.getByRole('button', { name: 'Save' }).click();
			await expect(field).toHaveValue('');
		}

		const order = newOrderFields(DEV_CUSTOMER.name, { projectName: `Unreviewed ${uid()}` });
		const orderUrl = await createOrder(page, order);

		// Opened BEFORE the job is completed, then reloaded — a finished job drops
		// into the rail's collapsed "Past work" group, so its link is not there to
		// click afterwards.
		const customer = await customerPage(browser);
		await openPortalOrder(customer, order.projectName);

		await page.goto(orderUrl);
		await completeOrder(page, { total: '900.00' });

		await customer.reload();
		// Complete, but nothing configured — the card must not appear empty.
		await expect(customer.locator('#reviews')).toHaveCount(0);
		await customer.close();
	});
});
