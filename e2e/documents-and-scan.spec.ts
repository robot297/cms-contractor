import {
	test,
	expect,
	clickUntil,
	openAddSubcontractor,
	seedWorkspace,
	signUpContractor,
	uid
} from './fixtures/app';

/**
 * Getting information into the app off a piece of paper: uploading a document to
 * a job, and reading a card instead of typing it.
 */

/**
 * The smallest valid PNG — 1×1, transparent.
 *
 * A real image, not a renamed text file, because the upload path checks the
 * bytes against the claimed type and rejects anything whose content disagrees
 * with its name. Testing with a fake would only prove the rejection works.
 */
const ONE_PIXEL_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

test.describe('documents', () => {
	test('a document uploads to an order and appears on its file list', async ({ page }) => {
		await seedWorkspace(page);
		const filename = `permit-${uid()}.png`;

		await openFiles(page);
		// Picking the file submits the form — there is no separate upload button.
		await page.locator('input[type="file"][name="file"]').setInputFiles({
			name: filename,
			mimeType: 'image/png',
			buffer: ONE_PIXEL_PNG
		});

		// Two mentions, both wanted: the file list gains a row, and the order's
		// history records that a document arrived.
		await expect(page.getByText(filename).first()).toBeVisible();
		await expect(page.locator('.upload-note')).toHaveText('1 uploaded');

		// And it is really stored rather than merely echoed back: it is still there
		// after a reload, which means it reached the database.
		await page.reload();
		await openFiles(page);
		await expect(page.getByRole('button', { name: new RegExp(filename) }).first()).toBeVisible();
	});

	test('a file the app does not accept is refused', async ({ page }) => {
		await seedWorkspace(page);

		await openFiles(page);
		// A .png name over zip bytes ("PK.."). The upload path reads the content
		// rather than trusting the extension, which is the whole point of the check.
		await page.locator('input[type="file"][name="file"]').setInputFiles({
			name: `not-really-${uid()}.png`,
			mimeType: 'image/png',
			buffer: Buffer.from('PK this is a zip, not a picture')
		});

		// Named and explained, rather than silently dropped.
		await expect(page.locator('.upload-note')).toContainText(
			'compressed archives are not accepted'
		);
	});
});

test.describe('ID scan', () => {
	test('a scanned licence prefills the add-subcontractor form', async ({ page }) => {
		await signUpContractor(page);
		await page.goto('/contractor/subcontractors');

		const addForm = await openAddSubcontractor(page);

		const scanner = page.getByRole('dialog', { name: 'Scan an ID' });
		await clickUntil(addForm.getByRole('button', { name: 'Scan their ID' }), scanner);

		// ID_SCAN_DEV_TOOLS is on for the e2e server, which offers a bundled payload
		// through the REAL parser and the real confirm step — so this covers
		// everything the feature does except pointing a camera at a card.
		await scanner.getByRole('button', { name: 'Licence barcode' }).click();

		// The confirm step exists so the contractor can see the scan read the right
		// card — and can correct it — before any of it reaches the form. The card's
		// SHOUTED fields come back title-cased, which is what a name looks like.
		await expect(scanner.getByRole('heading', { name: 'Check what the card says' })).toBeVisible();
		await expect(scanner.getByLabel('Name')).toHaveValue('Michael Sample');
		await expect(scanner.getByLabel('Address')).toHaveValue(/Richmond/i);
		// Shown for checking, explicitly never stored.
		await expect(scanner.getByText('Also on the card — shown, not saved')).toBeVisible();
		await expect(scanner.getByText('T64235789')).toBeVisible();

		await scanner.getByRole('button', { name: 'Use these details' }).click();
		await expect(scanner).toBeHidden();

		// Prefilled, not saved: a scan hands fields to a form the contractor still
		// reviews and submits.
		await expect(addForm.locator('input[name="name"]')).toHaveValue('Michael Sample');
		await expect(addForm.locator('input[name="address"]')).toHaveValue(/Richmond/i);

		// The scan proposed it; submitting is what makes it real.
		await addForm.locator('input[name="email"]').fill(`e2e-scanned-${uid()}@example.test`);
		await addForm.getByRole('button', { name: 'Add subcontractor', exact: true }).click();
		await expect(addForm).toBeHidden();
		await expect(page.getByText('Michael Sample').first()).toBeVisible();
	});

	test('a trade licence contributes its number, a driving licence does not', async ({ page }) => {
		await signUpContractor(page);
		await page.goto('/contractor/subcontractors');

		const addForm = await openAddSubcontractor(page);
		const scanner = page.getByRole('dialog', { name: 'Scan an ID' });
		await clickUntil(addForm.getByRole('button', { name: 'Scan their ID' }), scanner);

		// A driver's licence number is a different thing wearing the same word, so
		// it must never land in `licenseNumber` — that field means a trade licence.
		await scanner.getByRole('button', { name: 'Licence barcode' }).click();
		// The document number is shown as a thing to check, not offered as a licence.
		await expect(scanner.getByLabel('License #')).toHaveCount(0);
		await scanner.getByRole('button', { name: 'Use these details' }).click();
		await expect(addForm.locator('input[name="licenseNumber"]')).toHaveValue('');

		// A trade licence is exactly what that field is for.
		await clickUntil(addForm.getByRole('button', { name: 'Scan their ID' }), scanner);
		await scanner.getByRole('button', { name: 'Trade licence' }).click();
		await scanner.getByRole('button', { name: 'Use these details' }).click();
		await expect(addForm.locator('input[name="licenseNumber"]')).toHaveValue('EC-100420');
	});
});

/** Reveal the order's file panel, which is collapsed behind the 📎 by default. */
async function openFiles(page: import('@playwright/test').Page): Promise<void> {
	const panel = page.locator('form[action="?/uploadDocuments"]');
	if (await panel.isVisible().catch(() => false)) return;
	await clickUntil(page.getByRole('button', { name: /Files on this order/ }), panel);
}
