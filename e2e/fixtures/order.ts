import { expect, type Locator, type Page } from '@playwright/test';
import { clickUntil } from './app';

/**
 * Driving one order's workspace.
 *
 * Split out from app.ts because this is the densest screen in the product — a
 * status popover, a contact composer, a follow-up popover, a file panel and a
 * three-way tab strip, most of it behind an icon button. Left inline, every spec
 * that touches an order would restate the same four clicks.
 */

export type OrderTab = 'History' | 'Messages' | 'People';

/**
 * Tab label to pane id, where the two differ.
 *
 * The People pane's id stayed `panel-crew` when crew and subcontractors merged,
 * so every deep link kept working.
 *
 * There was a fourth: "Waiting on them" → `panel-asks`. That tab is gone — what
 * the job needs from the customer sits above the history now, and only when
 * there is some — so callers that used to open it want History.
 */
const PANE_IDS: Record<OrderTab, string> = {
	History: 'panel-history',
	Messages: 'panel-messages',
	People: 'panel-crew'
};

/**
 * Bring one of the workspace's panes into view.
 *
 * Two layouts to satisfy. Below 1100px the panes are behind a tab strip and one
 * shows at a time, so this clicks. At desktop widths — which includes the 1280px
 * viewport these tests run at — the strip is gone and all three panes are on
 * screen at once, so there is nothing to click and the pane is simply already
 * there. Asserting the PANE is visible either way keeps every caller honest
 * about what it actually needs, rather than about which layout it got.
 */
export async function openTab(page: Page, tab: OrderTab): Promise<void> {
	const paneId = PANE_IDS[tab];
	const pane = page.locator(`#${paneId}`);
	const button = page.getByRole('tab', { name: new RegExp(`^${tab}`) });

	if (await button.isVisible().catch(() => false)) {
		await expect(async () => {
			await button.click({ timeout: 2_000 });
			await expect(button).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 });
		}).toPass({ timeout: 20_000 });
	}
	await expect(pane).toBeVisible();
}

/** The timeline list — the order's history of what happened. */
export function timeline(page: Page): Locator {
	return page.locator('ol.timeline');
}

/** One timeline entry, found by its title. */
export function timelineEntry(page: Page, title: string | RegExp): Locator {
	return timeline(page).locator('li.tl-entry').filter({ hasText: title });
}

/**
 * Move the order to a new state, optionally recording why.
 *
 * The status editor is a popover behind the ⚙️, and its submit stays disabled
 * until the selection actually differs from the current state — so picking the
 * state the order is already in is a no-op the form refuses, by design.
 */
export async function setStatus(page: Page, state: string, note?: string): Promise<void> {
	const form = page.locator('form[action="?/updateStatus"]');
	await clickUntil(page.getByRole('button', { name: 'Update status' }), form);

	// A radiogroup, not a <select>: every stage is on screen at once, and the radio
	// itself is visually hidden behind its label — so the label is what gets clicked.
	await form.getByText(state, { exact: true }).click();
	// The note is the exception, not the rule, so the field is behind a checkbox.
	if (note) {
		await form.getByRole('checkbox', { name: 'Add an internal note' }).check();
		await form.locator('input[name="note"]').fill(note);
	}
	await form.getByRole('button', { name: 'Save status' }).click();
	await expect(form).toBeHidden();
}

/** Record an internal note against the order, from the History tab. */
export async function addInternalNote(page: Page, note: string): Promise<void> {
	await openTab(page, 'History');
	const form = page.locator('form[action="?/addNote"]');
	await clickUntil(page.getByRole('button', { name: 'Add note' }), form);
	await form.locator('input[name="note"]').fill(note);
	await form.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(form).toBeHidden();
}

/**
 * Put somebody on this job — crew or subcontractor, one flow for both.
 *
 * The staged "mark rows, then Save N" step is gone: every assignment now carries
 * dates, so there is a form to submit either way and staging only added a second
 * press in front of it. Assignment is immediate, and defaults the start to today.
 */
export async function assignPerson(page: Page, name: string): Promise<void> {
	await openTab(page, 'People');
	const pane = page.locator('#panel-crew');

	// The books aren't listed wholesale — people are found by searching.
	await clickUntil(
		pane.getByRole('button', { name: 'Put someone on this job' }),
		pane.getByPlaceholder('Search crew and subs…')
	);
	await pane.getByPlaceholder('Search crew and subs…').fill(name);

	const row = pane.locator('.crew-pick-row').filter({ hasText: name });
	await row.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(assignedCrew(page).filter({ hasText: name })).toBeVisible();
}

/** Kept under its old name for the specs that only ever assign a sub. */
export const assignSubcontractor = assignPerson;

/** The rows for people already on this job (as opposed to picker search hits). */
export function assignedCrew(page: Page): Locator {
	return page.locator('#panel-crew li.crew-item');
}

/**
 * Open the customer's contact composer, which lives behind the 💬 in the header.
 *
 * One click now. It used to be two: the 💬 sat inside a collapsed "Customer
 * details" panel that had to be opened first — a panel of read-only facts behind
 * a control that looked like an edit affordance. The facts moved into the header
 * line itself and editing moved to the People directory, so the composer is
 * simply where the customer is named.
 */
export async function openContactComposer(page: Page): Promise<Locator> {
	const composer = page.locator('.contact-pop');
	await clickUntil(
		page.locator('.head-customer').getByRole('button', { name: /^Message / }),
		composer
	);
	return composer;
}

/** Open the follow-up popover, hung off the ⏰ in the header. */
export async function openFollowUp(page: Page): Promise<Locator> {
	const pop = page.locator('.followup-pop');
	await clickUntil(page.getByRole('button', { name: 'Snooze or set follow-up' }), pop);
	return pop;
}

// ------------------------------------------------------------------ Invoice

/** The money card on the contractor's order workspace. */
export function invoiceCard(page: Page): Locator {
	return page.locator('section.card.invoice');
}

/**
 * Bring the money into view.
 *
 * The invoice used to be a card above the tab strip and is now the Billing tab.
 * Above 1100px — which includes the 1280px these tests run at — the strip is
 * hidden and every pane shows at once, so this is a no-op there. It is here so a
 * narrower viewport does not silently start failing on a hidden pane.
 */
export async function openBilling(page: Page): Promise<void> {
	await openTab(page, 'Billing');
}

/**
 * The card's headline figure, as one string: "Balance due $2,400.00".
 *
 * Reads the hero block at the top of the card — the balance leads the invoice
 * rather than trailing it, so this is the first thing on it rather than the last.
 */
export async function invoiceBalance(page: Page): Promise<string> {
	const hero = invoiceCard(page).locator('.inv-hero');
	await expect(hero).toBeVisible();
	return ((await hero.textContent()) ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Set what the job costs.
 *
 * The total is behind a toggle rather than always editable — see the card — so
 * this presses whichever of "Set total" / "Edit" is showing. Retried against the
 * effect for the usual hydration reason.
 */
export async function setProjectTotal(page: Page, dollars: string): Promise<void> {
	const card = invoiceCard(page);
	const form = card.locator('form[action="?/setOrderTotal"]');
	await clickUntil(card.getByRole('button', { name: /^(Set total|Edit)$/ }), form);
	await form.locator('input[name="total"]').fill(dollars);
	await form.getByRole('button', { name: 'Save' }).click();
	await expect(form).toBeHidden();
}

/**
 * Record money received.
 *
 * `kind` and `method` are chip radios whose inputs are visually hidden, so the
 * label is what gets clicked — the same arrangement as the status radiogroup.
 */
export async function recordPayment(
	page: Page,
	options: {
		amount: string;
		kind?: 'Deposit' | 'Payment' | 'Final payment';
		method?: string;
		note?: string;
	}
): Promise<void> {
	const card = invoiceCard(page);
	const form = card.locator('form[action="?/recordPayment"]');
	await clickUntil(card.getByRole('button', { name: 'Record a payment' }), form);

	await form.locator('input[name="amount"]').fill(options.amount);
	if (options.kind) await form.getByText(options.kind, { exact: true }).click();
	if (options.method) await form.getByText(options.method, { exact: true }).click();
	if (options.note) await form.locator('input[name="note"]').fill(options.note);

	await form.getByRole('button', { name: 'Record payment' }).click();
	await expect(form).toBeHidden();
}

/**
 * Fetch the invoice exactly as the customer would receive it.
 *
 * `page.request` shares the browser context's cookies, so this is the signed-in
 * contractor asking for their own order's invoice — the same authorization the
 * route enforces for a click.
 */
export async function fetchInvoiceEmail(
	page: Page,
	orderUrl: string,
	format: 'html' | 'text' = 'html'
): Promise<string> {
	const url = `${new URL(orderUrl).pathname}/invoice${format === 'text' ? '?format=text' : ''}`;
	const res = await page.request.get(url);
	expect(res.ok()).toBeTruthy();
	return res.text();
}

/**
 * Close the order out, recording the balance and (optionally) emailing the invoice.
 *
 * Deliberately NOT reachable through `setStatus`: `Work Complete` and
 * `Work Cancelled` are filtered out of the status radiogroup, because closing a
 * job also settles the money, and picking it from a list of stages would skip
 * that. A spec that wants a finished job wants this.
 */
export async function completeOrder(
	page: Page,
	options: { total?: string; notes?: string; markPaid?: boolean; sendInvoice?: boolean } = {}
): Promise<void> {
	const statusForm = page.locator('form[action="?/updateStatus"]');
	await clickUntil(page.getByRole('button', { name: 'Update status' }), statusForm);
	await page.getByRole('button', { name: 'Complete order' }).click();

	const form = page.locator('form[action="?/completeOrder"]');
	await expect(form).toBeVisible();
	if (options.total) await form.locator('input[name="amount"]').fill(options.total);
	if (options.notes) await form.locator('textarea[name="notes"]').fill(options.notes);
	// Addressed by control name: the "mark paid" label states the outstanding
	// amount, so its text changes with the job.
	if (options.markPaid) await form.locator('input[name="markPaid"]').check();
	if (options.sendInvoice) await form.locator('input[name="sendInvoice"]').check();

	await form.getByRole('button', { name: 'Complete order' }).click();
	await expect(form).toBeHidden();
}
