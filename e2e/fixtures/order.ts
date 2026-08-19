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

export type OrderTab = 'History' | 'Messages' | 'Workers';

/** Switch the workspace's tab strip. */
export async function openTab(page: Page, tab: OrderTab): Promise<void> {
	const button = page.getByRole('tab', { name: new RegExp(`^${tab}`) });
	await expect(async () => {
		await button.click({ timeout: 2_000 });
		await expect(button).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 });
	}).toPass({ timeout: 20_000 });
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
 * Put a subcontractor on this job.
 *
 * Assignment is staged rather than immediate: tapping a row marks it, and
 * nothing reaches the database until "Save N" is pressed. The test drives it the
 * same way round, because that staging is the behaviour worth protecting.
 */
export async function assignSubcontractor(page: Page, name: string): Promise<void> {
	await openTab(page, 'Workers');

	// The roster isn't listed wholesale — people are found by searching for them.
	const search = page.getByLabel('Search your roster to add crew');
	await expect(search).toBeVisible();
	await search.fill(name);

	const row = page.locator('button.sub-row').filter({ hasText: name });
	await clickUntil(row, page.getByRole('button', { name: /Save \d+/ }));
	await expect(row).toHaveAttribute('aria-pressed', 'true');

	await page.getByRole('button', { name: /Save \d+/ }).click();
	// Once saved there is nothing staged left to commit, and the person is on the
	// job rather than merely marked.
	await expect(page.getByRole('button', { name: /Save \d+/ })).toBeHidden();
	await expect(assignedCrew(page).filter({ hasText: name })).toBeVisible();
}

/** The rows for people already on this job (as opposed to roster search hits). */
export function assignedCrew(page: Page): Locator {
	return page.locator('.sub-list button.sub-row');
}

/** Open the customer's contact composer, which lives behind the 💬. */
export async function openContactComposer(page: Page): Promise<Locator> {
	const composer = page.locator('.contact-pop');
	// The composer hangs off the customer pane, which is itself collapsed.
	await clickUntil(
		page.getByRole('button', { name: 'Customer details' }),
		page.getByRole('button', { name: 'Contact customer' })
	);
	await clickUntil(page.getByRole('button', { name: 'Contact customer' }), composer);
	return composer;
}

/** Open the follow-up popover, hung off the ⏰ in the header. */
export async function openFollowUp(page: Page): Promise<Locator> {
	const pop = page.locator('.followup-pop');
	await clickUntil(page.getByRole('button', { name: 'Snooze or set follow-up' }), pop);
	return pop;
}
