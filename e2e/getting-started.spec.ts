import { test, expect, signUpContractor, uid } from './fixtures/app';

/**
 * The getting-started card.
 *
 * Two steps, and the first one never leaves the dashboard. It used to be five,
 * each a link to a different screen — getting one job into the app meant
 * crossing four of them — so what is worth protecting here is that the customer
 * and the job are created together, in one submit, from where the card is.
 */
test.describe('getting started', () => {
	test('a brand-new contractor is asked for one thing', async ({ page }) => {
		await signUpContractor(page);

		const card = page.locator('section.guide');
		await expect(card).toBeVisible();
		await expect(card.getByRole('heading', { name: 'Add your first job' })).toBeVisible();

		// One ask at a time. The steps behind it are dots, not a list of chores,
		// and none of the removed steps — templates, subcontractors — is back.
		await expect(card.getByText('Make the communications sound like you')).toHaveCount(0);
		await expect(card.getByText('Bring in a subcontractor')).toHaveCount(0);
	});

	test('the first job creates a customer and an order in one submit', async ({ page }) => {
		await signUpContractor(page);
		const customer = `Dana Whitfield ${uid()}`;
		const project = `Poolside Pergola ${uid()}`;

		const dialog = page.locator('dialog.firstjob');
		await expect(async () => {
			if (await dialog.isVisible()) return;
			await page
				.locator('section.guide')
				.getByRole('button', { name: 'Add your first job' })
				.click({ timeout: 2_000 });
			await expect(dialog).toBeVisible({ timeout: 1_000 });
		}).toPass({ timeout: 20_000 });

		// Both halves on one surface — this is the whole point of the rewrite.
		await dialog.locator('input[name="name"]').fill(customer);
		await dialog.locator('input[name="email"]').fill(`e2e-${uid()}@example.test`);
		await dialog.locator('input[name="projectName"]').fill(project);
		await dialog.locator('select[name="projectType"]').selectOption('Pergola');
		await dialog.getByRole('button', { name: 'Create job' }).click();

		// Lands on the job it just made — the confirmation is the thing itself.
		await page.waitForURL(/\/contractor\/orders\/[0-9a-f-]+$/);
		await expect(page.getByRole('heading', { name: project })).toBeVisible();

		// And both records exist, not just the order.
		await page.goto('/contractor/people');
		await expect(page.getByText(customer).first()).toBeVisible();
	});

	test('the second step says the portal is optional, and can be waved away', async ({ page }) => {
		await signUpContractor(page);
		const dialog = page.locator('dialog.firstjob');
		await expect(async () => {
			if (await dialog.isVisible()) return;
			await page
				.locator('section.guide')
				.getByRole('button', { name: 'Add your first job' })
				.click({ timeout: 2_000 });
			await expect(dialog).toBeVisible({ timeout: 1_000 });
		}).toPass({ timeout: 20_000 });
		await dialog.locator('input[name="name"]').fill(`Casey ${uid()}`);
		await dialog.locator('input[name="email"]').fill(`e2e-${uid()}@example.test`);
		await dialog.locator('input[name="projectName"]').fill(`Deck ${uid()}`);
		await dialog.locator('select[name="projectType"]').selectOption('Deck');
		await dialog.getByRole('button', { name: 'Create job' }).click();
		await page.waitForURL(/\/contractor\/orders\/[0-9a-f-]+$/);

		await page.goto('/contractor?guide=1');
		const card = page.locator('section.guide');
		await expect(card.getByRole('heading', { name: 'Invite your customer' })).toBeVisible();
		// Says the optional part out loud: a contractor who never invites anybody is
		// using the app correctly, and chat is the only thing they give up.
		await expect(card).toContainText('Optional');
		await expect(card).toContainText('needs an account on their side');

		// And waving it away finishes the card rather than leaving it open forever.
		await card.getByRole('button', { name: 'No thanks' }).click();
		await expect(page.locator('section.guide')).toHaveCount(0);
	});
});
