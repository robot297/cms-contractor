import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Shared e2e scaffolding: how a spec gets a signed-in contractor, and how it
 * creates the records it needs.
 *
 * The governing decision is that **every test signs up its own contractor**
 * rather than sharing a seeded one. It costs a form submit per test and buys
 * three things: tests can run in parallel without racing each other's records,
 * a rerun can't trip over last run's data, and the sign-up path itself — the
 * thing a real new contractor does first — is covered by every single spec
 * rather than by one that everything else then bypasses.
 *
 * That works because the e2e server runs with no mail provider configured, which
 * turns off email-verification enforcement (see auth.ts) so sign-up ends in a
 * session instead of a "check your inbox" wall. playwright.config.ts sets
 * RESEND_API_KEY and EMAIL_FROM to empty on purpose for exactly this reason.
 *
 * The exception is the customer portal, which needs a customer User bound to a
 * customer row — that binding is only made by accepting an invite, so those
 * specs use the seeded pair below.
 */

/**
 * The seeded logins, provisioned at boot when SEED_DEV_LOGIN=true.
 * Copied rather than imported: the source is a `.server.ts` that pulls in the
 * database and Better Auth, neither of which belongs in a Playwright process.
 * @see src/lib/server/dev-login.server.ts — keep these in step with it.
 */
export const DEV_CONTRACTOR = {
	email: 'contractor@upliftcollective.dev',
	password: 'testerooni#123',
	name: 'Dev Contractor'
} as const;

export const DEV_CUSTOMER = {
	email: 'customer@upliftcollective.dev',
	password: 'testerooni#123',
	name: 'Dev Customer'
} as const;

/** The order the dev customer can see, seeded alongside them. */
export const DEV_CUSTOMER_ORDER = 'Kitchen remodel';

/** A short, collision-proof tag for anything a test names. */
export function uid(): string {
	return randomUUID().slice(0, 8);
}

export type Contractor = { name: string; email: string; password: string };

/**
 * What the ZIP lookup answers with under test.
 *
 * Stubbed for every test: the real endpoint calls a third-party service, and a
 * suite that fails when that service is slow is a suite that reports on somebody
 * else's uptime rather than on this app.
 */
export const ZIP_FIXTURE = { '78701': { city: 'Austin', state: 'TX' } } as const;

/**
 * What the dashboard's weather widget answers with under test.
 *
 * Stubbed for the same reason as the ZIP lookup and with the same care: the real
 * endpoint calls a keyless forecast service, and a dashboard test that turned
 * red because somebody else's API was slow would be reporting on their uptime
 * rather than this app's. Deliberately a workable day — nothing here should make
 * an advisory banner appear and shift the layout under a test that is looking at
 * something else.
 */
export const WEATHER_FIXTURE = {
	place: 'Austin, TX',
	tempF: 72,
	feelsLikeF: 72,
	code: 1,
	windMph: 6,
	highF: 78,
	lowF: 54,
	rainChance: 10
} as const;

export const test = base.extend<{ zipStub: void; weatherStub: void }>({
	// Auto-applied: no spec has to remember to ask for it.
	weatherStub: [
		async ({ page }, use) => {
			await page.route('**/api/weather**', (route) =>
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(WEATHER_FIXTURE)
				})
			);
			await use();
		},
		{ auto: true }
	],
	zipStub: [
		async ({ page }, use) => {
			await page.route('**/api/zip/**', (route) => {
				const code = new URL(route.request().url()).pathname.split('/').pop() ?? '';
				const place = ZIP_FIXTURE[code as keyof typeof ZIP_FIXTURE];
				if (!place) return route.fulfill({ status: 404, body: '{}' });
				return route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(place)
				});
			});
			await use();
		},
		{ auto: true }
	]
});

export { expect };

// ------------------------------------------------------------------ sign-in

/**
 * Click something whose handler only exists once Svelte has hydrated, and keep
 * clicking until it demonstrably worked.
 *
 * Playwright waits for an element to be *actionable* — visible, stable, enabled
 * — none of which says anything about whether its `onclick` is attached yet. A
 * server-rendered button is all four of those things while its handler is still
 * a network round trip away, so a plain `.click()` on a freshly loaded page hits
 * an inert element and silently does nothing. That is the single most common
 * cause of a flaky SvelteKit suite; retrying against the effect closes it.
 */
export async function clickUntil(target: Locator, expected: Locator): Promise<void> {
	await expect(async () => {
		await target.click({ timeout: 2_000 });
		await expect(expected).toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 20_000 });
}

/** Sign up a brand-new contractor and land them in the app. */
export async function signUpContractor(page: Page): Promise<Contractor> {
	const tag = uid();
	const who: Contractor = {
		name: `E2E Contractor ${tag}`,
		email: `e2e-contractor-${tag}@example.test`,
		password: 'e2e-password-123'
	};
	await page.goto('/login');
	const form = page.locator('form[action="?/signUp"]');
	await clickUntil(page.getByRole('button', { name: 'Sign up', exact: true }), form);

	await form.getByLabel('Name').fill(who.name);
	await form.getByLabel('Email').fill(who.email);
	await form.getByLabel('Password').fill(who.password);
	await form.getByRole('button', { name: 'Create account' }).click();
	// Sign-up redirects to `/`, which forwards a contractor to their dashboard.
	await page.waitForURL('**/contractor');
	return who;
}

/**
 * Sign in an account that already exists.
 *
 * Scoped to the sign-in form: "Sign in" is also the name of the tab that selects
 * it, and an unscoped lookup matches both. No hydration dance needed — this is a
 * real `<form method="POST">`, so it submits whether or not the enhancement has
 * loaded.
 */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
	await page.goto('/login');
	const form = page.locator('form[action="?/signIn"]');
	await form.getByLabel('Email').fill(email);
	await form.getByLabel('Password').fill(password);
	await form.getByRole('button', { name: 'Sign in' }).click();
}

/**
 * Sign out.
 *
 * Posts to the shared sign-out endpoint rather than hunting the button through
 * the responsive nav — signing out is setup for the next assertion, not the
 * thing under test. `page.request` shares the browser context's cookie jar, so
 * the session it ends is the one the page is holding.
 */
export async function signOut(page: Page): Promise<void> {
	const res = await page.request.post('/logout');
	expect(res.ok()).toBeTruthy();
	await page.goto('/login');
}

// ------------------------------------------------------------------ records

export type CustomerFields = { name: string; email: string; phone?: string; zip?: string };

/** Build a customer whose name and email can't collide with any other test's. */
export function newCustomerFields(overrides: Partial<CustomerFields> = {}): CustomerFields {
	const tag = uid();
	return {
		name: `Casey Customer ${tag}`,
		email: `e2e-customer-${tag}@example.test`,
		phone: '5125550134',
		...overrides
	};
}

/**
 * Open a modal that the page may have opened already.
 *
 * Three of these forms open by themselves when the thing they create doesn't
 * exist yet — the customer directory, the subcontractor roster and the order
 * list all do it, and all three are empty for a freshly signed-up contractor.
 * So the first call in a spec finds the form already up and the second has to
 * press the button, and a helper that assumed either one would fail half the
 * time.
 */
async function openModal(dialog: Locator, trigger: Locator): Promise<void> {
	await expect(async () => {
		// Checked inside the retry, not before it: those forms open from `onMount`,
		// so "is it already open" is false until hydration and true a tick later.
		if (await dialog.isVisible()) return;
		await trigger.click({ timeout: 2_000 });
		await expect(dialog).toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 20_000 });
}

/** The add-customer modal, addressed by its heading rather than by class. */
function addCustomerDialog(page: Page): Locator {
	return page.getByRole('dialog').filter({ hasText: 'Add someone' });
}

/**
 * Create a customer through the add form.
 *
 * Ends by going back to the directory rather than asserting in place: adding the
 * *first* customer hands the contractor to the dashboard (that add form opened
 * because the directory was empty, which is the same moment the getting-started
 * guide sends them here), so where you are afterwards depends on how many
 * customers you already had.
 */
export async function addCustomer(page: Page, fields: CustomerFields): Promise<CustomerFields> {
	await page.goto('/contractor/people');
	const dialog = addCustomerDialog(page);
	// The ＋ and the modal's submit share an accessible name, so the trigger is
	// addressed as the icon button it is.
	await openModal(dialog, page.locator('button.icon-btn[aria-label="Add customer"]'));

	// Addressed by form-control name, not by label text. These names are the
	// contract the server action reads (`form.get('name')`), so they are the most
	// stable thing on the form — label copy is presentation and moves around.
	await dialog.locator('input[name="name"]').fill(fields.name);
	await dialog.locator('input[name="email"]').fill(fields.email);
	if (fields.phone) await dialog.locator('input[name="phone"]').fill(fields.phone);
	if (fields.zip) await dialog.locator('input[name="postalCode"]').fill(fields.zip);

	await dialog.getByRole('button', { name: 'Add customer', exact: true }).click();
	await expect(dialog).toBeHidden();

	await page.goto('/contractor/people');
	await expect(page.getByText(fields.name).first()).toBeVisible();
	return fields;
}

export type SubcontractorFields = {
	name: string;
	email: string;
	trade?: string;
	/** Access tier. `trusted` sees the customer's details; `guest` is redacted. */
	tier?: 'guest' | 'trusted';
};

export function newSubcontractorFields(
	overrides: Partial<SubcontractorFields> = {}
): SubcontractorFields {
	const tag = uid();
	return {
		name: `Sam Subcontractor ${tag}`,
		email: `e2e-sub-${tag}@example.test`,
		trade: 'Electrical',
		...overrides
	};
}

/**
 * Reveal the add-subcontractor form and return it.
 *
 * Unlike the customer and order forms this one does not open on an empty roster
 * on its own — it opens when the server says to (`data.openAdd`), which the
 * getting-started guide drives. So the ＋ is the reliable way in.
 */
export async function openAddSubcontractor(page: Page): Promise<Locator> {
	const dialog = page.getByRole('dialog', { name: 'Add subcontractor' });
	await openModal(dialog, page.locator('button.icon-btn[aria-label="Add subcontractor"]'));
	return dialog;
}

/** Create a subcontractor through the add form. */
export async function addSubcontractor(
	page: Page,
	fields: SubcontractorFields
): Promise<SubcontractorFields> {
	await page.goto('/contractor/subcontractors');
	const dialog = await openAddSubcontractor(page);

	await dialog.locator('input[name="name"]').fill(fields.name);
	await dialog.locator('input[name="email"]').fill(fields.email);
	if (fields.trade) await dialog.locator('input[name="trade"]').fill(fields.trade);
	if (fields.tier) await dialog.locator('select[name="tier"]').selectOption(fields.tier);

	await dialog.getByRole('button', { name: 'Add subcontractor', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByText(fields.name).first()).toBeVisible();
	return fields;
}

export type OrderFields = { projectName: string; customerName: string; projectType?: string };

export function newOrderFields(customerName: string, overrides: Partial<OrderFields> = {}) {
	return {
		projectName: `E2E Deck Rebuild ${uid()}`,
		customerName,
		projectType: 'Deck',
		...overrides
	};
}

/**
 * Create an order and land on its workspace.
 *
 * Returns the order's URL, because almost every following assertion is about
 * that one order and finding it again by name through the list is noise.
 */
export async function createOrder(page: Page, fields: OrderFields): Promise<string> {
	await page.goto('/contractor/orders');
	const dialog = page.locator('dialog.neworder');
	await openModal(dialog, page.getByRole('button', { name: 'New order' }).first());

	await dialog.locator('input[name="projectName"]').fill(fields.projectName);
	// The option label is "Name — City, ST" once a customer has an address, so it
	// is matched on the name rather than compared whole.
	await dialog
		.locator('select[name="customerId"]')
		.selectOption({ label: await optionLabelContaining(dialog, fields.customerName) });
	await dialog.locator('select[name="projectType"]').selectOption(fields.projectType ?? 'Deck');
	await dialog.getByRole('button', { name: 'Create order' }).click();
	await expect(dialog).toBeHidden();

	await openOrder(page, fields.projectName);
	return page.url();
}

/** Resolve the one `<option>` whose label mentions `needle`. */
async function optionLabelContaining(scope: Locator, needle: string): Promise<string> {
	const option = scope.locator('option', { hasText: needle }).first();
	await expect(option).toHaveCount(1);
	return ((await option.textContent()) ?? '').trim();
}

/** Open an order's workspace from the list. */
export async function openOrder(page: Page, projectName: string): Promise<void> {
	await page.getByRole('link', { name: projectName }).first().click();
	await page.waitForURL(/\/contractor\/orders\/[0-9a-f-]+$/);
}

/**
 * One contractor with a customer, an order, and (unless asked otherwise) a
 * subcontractor — the starting point most specs want before they test anything.
 *
 * `withSubcontractor: false` is for the specs about an empty roster. Building
 * the contractor without one is the honest way to reach that state; archiving
 * one afterwards would be testing the archive flow on the way to testing
 * something else.
 */
export async function seedWorkspace(page: Page, options: { withSubcontractor?: boolean } = {}) {
	const contractor = await signUpContractor(page);
	const customer = await addCustomer(page, newCustomerFields());
	const subcontractor =
		options.withSubcontractor === false
			? null
			: await addSubcontractor(page, newSubcontractorFields());
	const order = newOrderFields(customer.name);
	const orderUrl = await createOrder(page, order);
	return { contractor, customer, subcontractor, order, orderUrl };
}
