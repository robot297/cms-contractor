import { test, expect, seedWorkspace, uid } from './fixtures/app';

/**
 * Crew — the people who work alongside the contractor, as distinct from the
 * subcontractors they engage.
 *
 * The distinction is the feature, so most of what is checked here is that the
 * two stay apart: a crew member never appears in the subcontractor roster, is
 * never offered an access tier or a portal invite, and can exist with no email
 * at all — which a subcontractor cannot, because that is where their invite is
 * delivered.
 */

/** `YYYY-MM-DD`, n days from today, in the browser's own timezone. */
function isoDay(offset = 0): string {
	const d = new Date();
	d.setDate(d.getDate() + offset);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Click something whose handler only exists once Svelte has hydrated.
 *
 * The fixtures do the same for their modals. Playwright waits for an element to
 * be *actionable*, which a server-rendered button already is — the click lands
 * before `onclick` is attached and simply does nothing.
 */
async function clickWhenLive(
	trigger: import('@playwright/test').Locator,
	expected: import('@playwright/test').Locator
) {
	await expect(async () => {
		if (await expected.isVisible()) return;
		await trigger.click({ timeout: 2_000 });
		await expect(expected).toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 20_000 });
}

/** Put a crew member on the open job, defaulting their start to today. */
async function putOnJob(page: import('@playwright/test').Page, name?: string) {
	const crewPane = page.locator('#panel-crew');
	await clickWhenLive(
		crewPane.getByRole('button', { name: 'Put someone on this job' }),
		crewPane.getByPlaceholder('Search crew and subs…')
	);
	// The row for THIS person when one is named, so a test that seeded a
	// subcontractor too doesn't silently assign whichever sorted first.
	const row = name
		? crewPane.locator('.crew-pick-row').filter({ hasText: name })
		: crewPane.locator('.crew-pick-row').first();
	await row.getByRole('button', { name: 'Add', exact: true }).click();
	return crewPane;
}

/**
 * Add one crew member through the real form.
 *
 * There is ONE "add someone" dialog for all three roles, opened by the ＋ in the
 * directory header — not a button per kind. What somebody is to you is the first
 * question inside it, because that answer decides what the rest of the form even
 * asks: crew are the one kind that may have no email, and the one kind with a
 * role on site rather than a trade.
 */
async function addCrew(
	page: import('@playwright/test').Page,
	fields: { name: string; role?: string; phone?: string; email?: string; company?: string }
) {
	await page.goto('/contractor/people');
	const sheet = page.locator('dialog').filter({ hasText: 'Add someone' });
	// Retried, because the handler that opens it only exists after hydration —
	// the same reason `openModal` in the fixtures does this.
	await expect(async () => {
		if (await sheet.isVisible()) return;
		await page.getByRole('button', { name: 'Add customer' }).click({ timeout: 2_000 });
		await expect(sheet).toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 20_000 });

	// The radio itself is visually hidden, so the label is the control — clicking
	// the input would fail actionability rather than tell us anything.
	await sheet.getByRole('radio', { name: 'Crew', exact: true }).check({ force: true });

	await sheet.locator('input[name="name"]').fill(fields.name);
	// `role` is the radiogroup above; what they do on site is `workRole`.
	if (fields.role) await sheet.locator('input[name="workRole"]').fill(fields.role);
	if (fields.company) await sheet.locator('input[name="company"]').fill(fields.company);
	if (fields.phone) await sheet.locator('input[name="phone"]').fill(fields.phone);
	if (fields.email) await sheet.locator('input[name="email"]').fill(fields.email);
	// The save button names what is being saved, so it changes with the role.
	await sheet.getByRole('button', { name: 'Add crew', exact: true }).click();
	await expect(sheet).toBeHidden();
	await expect(page.getByText(fields.name).first()).toBeVisible();
}

test.describe('crew', () => {
	test('a crew member can be added with only a name and a phone', async ({ page }) => {
		await seedWorkspace(page, { withSubcontractor: false });
		const name = `Dave Mackie ${uid()}`;

		// No email. A subcontractor cannot be created this way — theirs is the
		// invite channel — and a crew member having no address is the normal case.
		await addCrew(page, { name, role: 'Framer', phone: '5125550134' });

		await expect(page.getByText(name).first()).toBeVisible();
		// Two rows, not one: the seeded customer is in this directory too. That is
		// the merge working — one row here would mean the crew member had landed in
		// a list of their own. Counted off the rows themselves, since the header no
		// longer carries a total.
		await expect(page.locator('.contact-open')).toHaveCount(2);
	});

	test('crew never turn up in the subcontractor roster', async ({ page }) => {
		await seedWorkspace(page, { withSubcontractor: false });
		const name = `Peer Hand ${uid()}`;
		await addCrew(page, { name, role: 'Helper' });

		// The whole point of the separate table: a crew member has no access tier
		// and no portal invite, so they must never appear anywhere that offers one.
		// The roster page is still where a sub's tier, insurance and invite live —
		// and a crew member must never appear on it, because none of that applies
		// to them and offering it would be the app lying about what they can do.
		await page.goto('/contractor/subcontractors');
		await expect(page.getByText(name)).toHaveCount(0);
	});

	test('a crew member goes on a job for a date range and shows as on site today', async ({
		page
	}) => {
		const { orderUrl } = await seedWorkspace(page, { withSubcontractor: false });
		const name = `Rosa Vega ${uid()}`;
		await addCrew(page, { name, role: 'Operator' });

		await page.goto(orderUrl);
		await expect(page.locator('#panel-crew').getByText('Nobody is on this job yet.')).toBeVisible();
		const crewPane = await putOnJob(page, name);

		// Assigning defaults the start to today, so they are on site immediately.
		await expect(crewPane.getByText(name)).toBeVisible();
		await expect(crewPane.getByText(`On site today: ${name}`)).toBeVisible();
		await expect(crewPane.getByText('Today', { exact: true })).toBeVisible();
	});

	test('dates can be set, and a range in the future is not on site today', async ({ page }) => {
		const { orderUrl } = await seedWorkspace(page, { withSubcontractor: false });
		const name = `Sam Reed ${uid()}`;
		await addCrew(page, { name });

		await page.goto(orderUrl);
		const crewPane = await putOnJob(page, name);
		await crewPane.getByRole('button', { name: 'Dates' }).click();
		await crewPane.locator('input[name="startsOn"]').fill(isoDay(7));
		await crewPane.locator('input[name="endsOn"]').fill(isoDay(11));
		await crewPane.getByRole('button', { name: 'Save dates' }).click();

		// Next week is not today, so the on-site line has nothing to report.
		await expect(crewPane.getByText(`On site today: ${name}`)).toHaveCount(0);
		await expect(crewPane.getByText(name).first()).toBeVisible();
	});

	test('an end date before its start is refused', async ({ page }) => {
		const { orderUrl } = await seedWorkspace(page, { withSubcontractor: false });
		const name = `Kit Alder ${uid()}`;
		await addCrew(page, { name });

		await page.goto(orderUrl);
		const crewPane = await putOnJob(page, name);
		await crewPane.getByRole('button', { name: 'Dates' }).click();
		await crewPane.locator('input[name="startsOn"]').fill(isoDay(10));
		await crewPane.locator('input[name="endsOn"]').fill(isoDay(3));
		await crewPane.getByRole('button', { name: 'Save dates' }).click();

		// A backwards range matches no days at all, so the crew member would
		// silently never appear on a schedule. Caught and said out loud instead.
		await expect(crewPane.getByRole('alert')).toContainText('before the start date');
	});

	test('a crew member can be taken off a job', async ({ page }) => {
		const { orderUrl } = await seedWorkspace(page, { withSubcontractor: false });
		const name = `Toby Lane ${uid()}`;
		await addCrew(page, { name });

		await page.goto(orderUrl);
		const crewPane = await putOnJob(page, name);
		await expect(crewPane.getByText(name)).toBeVisible();

		await crewPane.getByRole('button', { name: 'Dates' }).click();
		await crewPane.getByRole('button', { name: 'Remove' }).click();
		await crewPane.getByRole('button', { name: `Yes, take ${name} off` }).click();

		await expect(crewPane.getByText('Nobody is on this job yet.')).toBeVisible();
	});

	test('crew and subs share one panel on the job', async ({ page }) => {
		// One list, one question. It was two panels — one of them labelled "Workers"
		// while it assigned subcontractors — which is the confusion this ends.
		const { orderUrl, subcontractor } = await seedWorkspace(page);
		const name = `Ellis Ford ${uid()}`;
		await addCrew(page, { name, role: 'Framer' });

		await page.goto(orderUrl);
		const pane = page.locator('#panel-crew');
		await clickWhenLive(
			pane.getByRole('button', { name: 'Put someone on this job' }),
			pane.getByPlaceholder('Search crew and subs…')
		);

		// Both kinds are offered by the one picker, and neither is labelled as a
		// kind: the crew/sub chips are gone. Whose company somebody is on is what
		// separates a hand from a hired firm, and that is already on the row.
		const crewRow = pane.locator('.crew-pick-row').filter({ hasText: name });
		const subRow = pane.locator('.crew-pick-row').filter({ hasText: subcontractor!.name });
		await expect(crewRow).toBeVisible();
		await expect(subRow).toBeVisible();
		await expect(pane.locator('.crew-kind')).toHaveCount(0);
	});

	test('a subcontractor gets a date range just like crew', async ({ page }) => {
		// Subs gained the stint crew already had. "Acme is here Mon–Fri" is exactly
		// as useful a fact for a business as it is for a hand.
		const { orderUrl, subcontractor } = await seedWorkspace(page);
		await page.goto(orderUrl);
		const pane = page.locator('#panel-crew');
		await clickWhenLive(
			pane.getByRole('button', { name: 'Put someone on this job' }),
			pane.getByPlaceholder('Search crew and subs…')
		);
		await pane
			.locator('.crew-pick-row')
			.filter({ hasText: subcontractor!.name })
			.getByRole('button', { name: 'Add', exact: true })
			.click();

		const row = pane.locator('.crew-item').filter({ hasText: subcontractor!.name });
		await expect(row).toBeVisible();
		await expect(pane.getByText(`On site today: ${subcontractor!.name}`)).toBeVisible();

		await row.getByRole('button', { name: 'Dates' }).click();
		await row.locator('input[name="startsOn"]').fill(isoDay(7));
		await row.locator('input[name="endsOn"]').fill(isoDay(11));
		await row.getByRole('button', { name: 'Save dates' }).click();

		await expect(pane.getByText(`On site today: ${subcontractor!.name}`)).toHaveCount(0);
	});

	test('one directory holds crew and subs, with nothing sorting them', async ({ page }) => {
		const { subcontractor } = await seedWorkspace(page);
		const name = `Nia Blake ${uid()}`;
		await addCrew(page, { name, role: 'Helper', company: `Acme ${uid()}` });

		await page.goto('/contractor/people');
		// One search finds either kind — the whole point of merging the pages.
		await expect(page.getByText(name).first()).toBeVisible();
		await expect(page.getByText(subcontractor!.name).first()).toBeVisible();

		// Nothing on the page SPLITS them any more: no All/Crew/Subs filter and no
		// group-by-company toggle. You come here to find a person, and what you
		// know about them is in the search.
		await expect(page.getByRole('button', { name: /^Crew/ })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^Subs/ })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Group by company' })).toHaveCount(0);

		// The row still SAYS which roles somebody holds, which is a different
		// thing from sorting the list by them: the same person can be a customer,
		// a hand and a firm you engage, and which of those is true changes what
		// their profile offers. One list, chips per row.
		const crewRow = page.locator('.contact-open').filter({ hasText: name });
		await expect(crewRow.locator('.role-chip', { hasText: 'Crew' })).toBeVisible();
		const subRow = page.locator('.contact-open').filter({ hasText: subcontractor!.name });
		await expect(subRow.locator('.role-chip', { hasText: 'Subcontractor' })).toBeVisible();
	});

	test('search reaches both kinds through one company', async ({ page }) => {
		// The reason these are one list: a crew hand can be an Acme employee while
		// Acme is separately engaged as a subcontractor, and "who do I have from
		// Acme" is one question with one answer.
		await seedWorkspace(page, { withSubcontractor: false });
		const company = `Acme ${uid()}`;
		const name = `Rae Nolan ${uid()}`;
		await addCrew(page, { name, role: 'Framer', company });

		await page.goto('/contractor/people');
		await page.getByPlaceholder('Search').fill(company);
		await expect(page.getByText(name).first()).toBeVisible();
	});
});
