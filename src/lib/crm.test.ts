import { describe, expect, it } from 'vitest';
import {
	defaultFollowUp,
	DEFAULT_FOLLOWUP_DAYS,
	FOLLOWUP_DAY_CHOICES,
	followUpDaysLabel,
	isFollowUpDays,
	digitsOnly,
	formatLocation,
	formatPhone,
	getVisibleCustomerState,
	isCustomerLinked,
	isFollowUpDue,
	parseDateInput,
	toDateInput,
	followUpUrgency,
	followUpDaysOverdue,
	followUpLabel,
	isValidAvatarDataUrl,
	buildFeedbackIssue,
	feedbackTypeLabel,
	isFeedbackType,
	normalizeEmail,
	parseTags,
	redactCustomerForGuest,
	validateFeedback,
	isSubcontractorLinked,
	isSubcontractorTier,
	subscriptionAccess,
	mapProviderStatus,
	limitStatus,
	shouldBeComped,
	trialEndFrom,
	BILLING_LAUNCHED_AT,
	TRIAL_LIMITS,
	snoozeDate,
	isSnoozePreset,
	tierLabel,
	validateCustomerContact,
	validateOrderSetup,
	validateSubcontractorContact,
	renderTemplate,
	composeEmail,
	customerProgress,
	checkUploadContent,
	sniffFileType,
	safeFilename,
	splitFilename,
	normalizeMessageTopic,
	messageTopicLabel,
	CUSTOMER_QUICK_ACTIONS,
	CONTRACTOR_ORDER_STATES,
	CUSTOMER_PROGRESS_STEPS,
	customerStateLabel,
	isCustomerActionState
} from './crm';

describe('customer-visible state mapping', () => {
	it('maps contractor lifecycle states to a coarse rail stage', () => {
		expect(getVisibleCustomerState('Deposit Pending')).toBe('Pending');
		expect(getVisibleCustomerState('Work Scheduled')).toBe('Scheduled');
		expect(getVisibleCustomerState('Work Complete')).toBe('Completed');
	});

	// The regression this suite exists for: `Final Payment Pending` was missing
	// from the switch and fell through a `default` to 'Pending', which sent the
	// customer's rail BACKWARDS to the first step on a job whose work was done.
	it('keeps a job awaiting final payment in the working stage, not back at the start', () => {
		expect(getVisibleCustomerState('Final Payment Pending')).toBe('In Progress');
	});

	it('gives every contractor state a rail stage and a label', () => {
		// Both switches are exhaustive with no `default`, so a state added later is
		// a type error. This is the runtime half of that guarantee: it also catches
		// a `default` being reintroduced, which would silence the type error.
		for (const state of CONTRACTOR_ORDER_STATES) {
			expect(getVisibleCustomerState(state), state).toBeTruthy();
			expect(customerStateLabel(state), state).toBeTruthy();
		}
	});

	it('speaks to the customer rather than repeating the contractor workflow', () => {
		// The label is the customer's words, not the workflow's. If these ever come
		// back identical, the point of having two functions has been lost.
		expect(customerStateLabel('Deposit Pending')).toBe('Deposit due');
		expect(customerStateLabel('Final Payment Pending')).toBe('Final payment due');
		expect(customerStateLabel('Inquiry')).toBe('Received');
	});

	it('every rail stage a label maps into is a real step or a stated departure', () => {
		const offPath = ['Cancelled', 'On Hold'];
		for (const state of CONTRACTOR_ORDER_STATES) {
			const stage = getVisibleCustomerState(state);
			const known =
				(CUSTOMER_PROGRESS_STEPS as readonly string[]).includes(stage) || offPath.includes(stage);
			expect(known, `${state} -> ${stage}`).toBe(true);
		}
	});

	it('flags only the states where the customer owes something', () => {
		expect(isCustomerActionState('Deposit Pending')).toBe(true);
		expect(isCustomerActionState('Final Payment Pending')).toBe(true);
		expect(isCustomerActionState('In Progress')).toBe(false);
		expect(isCustomerActionState('Quote Sent')).toBe(false);
	});
});

describe('customer progress', () => {
	it('places an on-path state on the track', () => {
		const p = customerProgress('In Progress');
		expect(p.onPath).toBe(true);
		if (p.onPath) {
			expect(p.steps).toEqual(['Pending', 'Scheduled', 'In Progress', 'Completed']);
			expect(p.currentIndex).toBe(2);
		}
	});

	it('marks the first and last steps correctly', () => {
		const first = customerProgress('Pending');
		const last = customerProgress('Completed');
		expect(first.onPath && first.currentIndex).toBe(0);
		expect(last.onPath && last.currentIndex).toBe(3);
	});

	it.each(['Cancelled', 'On Hold'] as const)('reports %s as off the path', (state) => {
		// Cancelled and On Hold are departures from the path, not points on it —
		// rendering them as a step would imply the job is still moving along it.
		const p = customerProgress(state);
		expect(p.onPath).toBe(false);
		if (!p.onPath) expect(p.label).toBe(state);
	});
});

describe('message topics', () => {
	it('accepts the known topics', () => {
		expect(normalizeMessageTopic('payment')).toBe('payment');
		expect(normalizeMessageTopic('issue')).toBe('issue');
	});

	it('falls back to general rather than throwing', () => {
		// An unknown topic must never cost the customer their message.
		expect(normalizeMessageTopic('nonsense')).toBe('general');
		expect(normalizeMessageTopic(null)).toBe('general');
		expect(normalizeMessageTopic(undefined)).toBe('general');
	});

	it('labels each topic for the contractor’s inbox', () => {
		expect(messageTopicLabel('payment')).toBe('Payment');
		expect(messageTopicLabel('issue')).toBe('Problem');
		expect(messageTopicLabel('general')).toBe('Message');
	});

	it('gives every quick action a valid topic', () => {
		for (const a of CUSTOMER_QUICK_ACTIONS) {
			expect(normalizeMessageTopic(a.topic)).toBe(a.topic);
		}
	});

	it('warns on the payment action that the app takes no payment', () => {
		// CONTEXT.md: this product tracks payment as a status and never processes
		// it. A button labelled "Make a payment" has to say so.
		const pay = CUSTOMER_QUICK_ACTIONS.find((a) => a.topic === 'payment');
		expect(pay?.note).toMatch(/not through this app/i);
	});
});

describe('upload content checking', () => {
	const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(24).fill(0)]);
	const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
	const JPEG = bytes(0xff, 0xd8, 0xff);
	const GIF = bytes(0x47, 0x49, 0x46, 0x38);
	const PDF = bytes(0x25, 0x50, 0x44, 0x46);
	const WEBP = new Uint8Array([
		0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0
	]);

	it('recognizes each accepted type from its signature', () => {
		expect(sniffFileType(PNG)).toBe('image/png');
		expect(sniffFileType(JPEG)).toBe('image/jpeg');
		expect(sniffFileType(GIF)).toBe('image/gif');
		expect(sniffFileType(WEBP)).toBe('image/webp');
		expect(sniffFileType(PDF)).toBe('application/pdf');
	});

	it('accepts a file whose content matches its claim', () => {
		expect(checkUploadContent('application/pdf', PDF)).toBeNull();
		expect(checkUploadContent('image/png', PNG)).toBeNull();
	});

	it('refuses a script however it is labelled', () => {
		// `#!/bin/sh` renamed receipt.pdf and posted as application/pdf is the
		// whole reason content is read rather than trusted.
		const shell = bytes(0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e);
		expect(checkUploadContent('application/pdf', shell)).toBe('scripts are not accepted');
		expect(checkUploadContent('image/png', shell)).toBe('scripts are not accepted');
	});

	it('refuses compressed archives, including Office formats', () => {
		// .docx/.xlsx/.pptx are zip containers, so "no compressed content" excludes
		// them too. Deliberate, not an oversight.
		const zip = bytes(0x50, 0x4b, 0x03, 0x04);
		expect(checkUploadContent('application/pdf', zip)).toBe('compressed archives are not accepted');
		expect(sniffFileType(bytes(0x1f, 0x8b))).toBe('archive');
		expect(sniffFileType(bytes(0x37, 0x7a, 0xbc, 0xaf))).toBe('archive');
		expect(sniffFileType(bytes(0x52, 0x61, 0x72, 0x21))).toBe('archive');
	});

	it('refuses executables', () => {
		expect(checkUploadContent('image/jpeg', bytes(0x7f, 0x45, 0x4c, 0x46))).toBe(
			'programs are not accepted'
		);
		expect(checkUploadContent('image/jpeg', bytes(0x4d, 0x5a))).toBe('programs are not accepted');
		expect(checkUploadContent('image/jpeg', bytes(0xcf, 0xfa, 0xed, 0xfe))).toBe(
			'programs are not accepted'
		);
	});

	it('refuses content that disagrees with its claimed type', () => {
		// Both are allowed types, but the mismatch means the client is broken or
		// probing — neither is worth storing.
		expect(checkUploadContent('application/pdf', PNG)).toBe('file content does not match its type');
	});

	it('refuses a disallowed type even when the content is unrecognized', () => {
		expect(checkUploadContent('application/zip', bytes(0x00, 0x01))).toBe('unsupported type');
	});

	it('refuses unrecognized content under an allowed claim', () => {
		// Plain text posted as a PDF has no signature we know; storing it would be
		// trusting the label again.
		expect(checkUploadContent('application/pdf', bytes(0x68, 0x65, 0x6c, 0x6c, 0x6f))).toBe(
			'file content does not match its type'
		);
	});

	it('does not read past the end of a short file', () => {
		expect(() => sniffFileType(new Uint8Array([0x25]))).not.toThrow();
		expect(sniffFileType(new Uint8Array([]))).toBeNull();
	});
});

describe('document filenames', () => {
	it('splits a name from its extension', () => {
		expect(splitFilename('IMG_4821.jpg')).toEqual({ stem: 'IMG_4821', ext: '.jpg' });
		expect(splitFilename('scan.of.permit.pdf')).toEqual({ stem: 'scan.of.permit', ext: '.pdf' });
	});

	it('treats a name with no usable extension as all stem', () => {
		expect(splitFilename('receipt')).toEqual({ stem: 'receipt', ext: '' });
		// A leading dot is the whole name (".env"), not an extension.
		expect(splitFilename('.env')).toEqual({ stem: '.env', ext: '' });
		expect(splitFilename('trailing.')).toEqual({ stem: 'trailing.', ext: '' });
	});

	it('keeps what a person would actually type', () => {
		expect(safeFilename('Kitchen - before', '.jpg')).toBe('Kitchen - before.jpg');
		expect(safeFilename('permit_2026', '.pdf')).toBe('permit_2026.pdf');
	});

	it('strips path separators so a rename cannot escape', () => {
		// This value reaches a Content-Disposition header and the filesystem.
		// Slashes go first, then the leading dots they left behind.
		expect(safeFilename('../../etc/passwd', '.pdf')).toBe('etcpasswd.pdf');
		expect(safeFilename('a\\b:c*d?e"f<g>h|i', '.png')).toBe('abcdefghi.png');
	});

	it('never returns a hidden or empty name', () => {
		expect(safeFilename('...', '.pdf')).toBe('document.pdf');
		expect(safeFilename('   ', '.pdf')).toBe('document.pdf');
		expect(safeFilename('', '.pdf')).toBe('document.pdf');
	});

	it('caps the length', () => {
		expect(safeFilename('x'.repeat(200), '.pdf')).toBe('x'.repeat(80) + '.pdf');
	});

	it('always keeps the extension the upload actually had', () => {
		// The stem is the customer's; the extension never is, so a rename can't
		// leave a document that won't open.
		expect(safeFilename('my notes.exe', '.pdf')).toBe('my notes.exe.pdf');
	});
});

describe('customer contact validation', () => {
	it('normalizes email to trimmed lowercase', () => {
		expect(normalizeEmail('  Dan.OBOT@Example.com ')).toBe('dan.obot@example.com');
	});

	it('requires a name', () => {
		const result = validateCustomerContact({ name: '  ', email: 'a@b.com' });
		expect(result).toEqual({ ok: false, field: 'name', message: 'Name is required' });
	});

	it('requires an email', () => {
		const result = validateCustomerContact({ name: 'Dan', email: '' });
		expect(result).toEqual({ ok: false, field: 'email', message: 'Email is required' });
	});

	it('rejects a malformed email', () => {
		const result = validateCustomerContact({ name: 'Dan', email: 'not-an-email' });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.field).toBe('email');
	});

	it('rejects a phone number without 10 digits', () => {
		const result = validateCustomerContact({ name: 'Dan', email: 'a@b.com', phone: '555-12' });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.field).toBe('phone');
	});

	it('rejects a state that is not a real code, and a malformed ZIP', () => {
		const badState = validateCustomerContact({ name: 'Dan', email: 'a@b.com', state: 'ZZ' });
		expect(badState.ok).toBe(false);
		if (!badState.ok) expect(badState.field).toBe('state');
		const badZip = validateCustomerContact({ name: 'Dan', email: 'a@b.com', postalCode: '1234' });
		expect(badZip.ok).toBe(false);
		if (!badZip.ok) expect(badZip.field).toBe('postalCode');
	});

	it('accepts and normalizes a valid contact with optional fields', () => {
		expect(
			validateCustomerContact({
				name: '  Dan  ',
				email: 'Dan@Example.com',
				phone: '5551234567',
				address: '  12 Main St ',
				city: ' Austin ',
				state: 'tx',
				postalCode: '78701',
				notes: ''
			})
		).toEqual({
			ok: true,
			value: {
				name: 'Dan',
				email: 'dan@example.com',
				phone: '(555) 123-4567',
				address: '12 Main St',
				city: 'Austin',
				// Stored uppercase whatever the casing it arrived in.
				state: 'TX',
				postalCode: '78701',
				notes: null,
				preferredContact: 'email'
			}
		});
	});

	it('defaults optional fields to null / empty', () => {
		const result = validateCustomerContact({ name: 'Dan', email: 'a@b.com' });
		expect(result).toEqual({
			ok: true,
			value: {
				name: 'Dan',
				email: 'a@b.com',
				phone: null,
				address: null,
				city: null,
				state: null,
				postalCode: null,
				notes: null,
				preferredContact: 'email'
			}
		});
	});
});

describe('phone formatting and tags', () => {
	it('strips non-digits', () => {
		expect(digitsOnly('(555) 123-4567')).toBe('5551234567');
	});

	it('progressively formats a US phone number', () => {
		expect(formatPhone('555')).toBe('(555');
		expect(formatPhone('555123')).toBe('(555) 123');
		expect(formatPhone('5551234567')).toBe('(555) 123-4567');
		expect(formatPhone('(555) 123-4567 ext ignored')).toBe('(555) 123-4567');
	});

	it('parses, trims, and de-duplicates tags', () => {
		expect(parseTags(' a, b ,a, ,c ')).toEqual(['a', 'b', 'c']);
		expect(parseTags('')).toEqual([]);
	});
});

describe('location line from free-form address', () => {
	it('returns the city when there is no state', () => {
		expect(formatLocation('88 Cedar Ln, Springfield')).toBe('Springfield');
		expect(formatLocation('14 Elm St, Springfield')).toBe('Springfield');
	});

	it('returns "City, ST" when a 2-letter state (and optional ZIP) is present', () => {
		expect(formatLocation('123 Main St, Austin, TX')).toBe('Austin, TX');
		expect(formatLocation('123 Main St, Austin, tx 78701')).toBe('Austin, TX');
		expect(formatLocation('123 Main St, Austin, TX 78701-1234')).toBe('Austin, TX');
	});

	it('reads the same shapes written without commas', () => {
		expect(formatLocation('123 Main St Springfield IL 62704')).toBe('Springfield, IL');
		expect(formatLocation('123 Main St Springfield IL')).toBe('Springfield, IL');
		expect(formatLocation('1600 Pennsylvania Ave San Jose CA')).toBe('San Jose, CA');
		expect(formatLocation('88 Cedar Ln, Springfield IL')).toBe('Springfield, IL');
	});

	it('takes a bare town at its word', () => {
		expect(formatLocation('Springfield')).toBe('Springfield');
		expect(formatLocation('San Luis Obispo')).toBe('San Luis Obispo');
	});

	it('returns null when no city can be isolated', () => {
		expect(formatLocation(null)).toBeNull();
		expect(formatLocation('')).toBeNull();
		expect(formatLocation('88 Cedar Ln')).toBeNull();
		// A street with no number is still a street, not a town.
		expect(formatLocation('Cedar Lane')).toBeNull();
	});
});

describe('customer link state', () => {
	it('treats a customer with a bound login as linked', () => {
		expect(isCustomerLinked({ userId: 'user-1' })).toBe(true);
		expect(isCustomerLinked({ userId: null })).toBe(false);
	});
});

describe('order setup validation', () => {
	it('requires a customer, name, and type', () => {
		expect(validateOrderSetup({}).ok).toBe(false);
		expect(validateOrderSetup({ customerId: 'c1' })).toMatchObject({
			ok: false,
			field: 'projectName'
		});
		expect(validateOrderSetup({ customerId: 'c1', projectName: 'Backyard' })).toMatchObject({
			ok: false,
			field: 'projectType'
		});
	});

	it('accepts a known project type', () => {
		expect(
			validateOrderSetup({ customerId: 'c1', projectName: 'Backyard', projectType: 'Gazebo' })
		).toEqual({
			ok: true,
			value: { customerId: 'c1', projectName: 'Backyard', projectType: 'Gazebo' }
		});
	});

	it('uses the custom text when Other is chosen', () => {
		expect(
			validateOrderSetup({
				customerId: 'c1',
				projectName: 'Backyard',
				projectType: 'Other',
				projectTypeOther: '  Yurt  '
			})
		).toEqual({
			ok: true,
			value: { customerId: 'c1', projectName: 'Backyard', projectType: 'Yurt' }
		});
	});

	it('rejects Other without custom text', () => {
		expect(
			validateOrderSetup({ customerId: 'c1', projectName: 'x', projectType: 'Other' })
		).toMatchObject({ ok: false, field: 'projectType' });
	});
});

describe('follow-ups', () => {
	const now = new Date('2026-07-19T00:00:00.000Z');

	it('defaults a new follow-up to a fortnight out', () => {
		// Two weeks, not one. Getting in touch now resets this clock, and a weekly
		// cadence meant answering a question on Monday earned you a reminder about
		// the same job the following Monday.
		expect(DEFAULT_FOLLOWUP_DAYS).toBe(14);
		expect(defaultFollowUp(DEFAULT_FOLLOWUP_DAYS, now).toISOString()).toBe(
			'2026-08-02T00:00:00.000Z'
		);
	});

	it('honours a contractor-set interval', () => {
		expect(defaultFollowUp(3, now).toISOString()).toBe('2026-07-22T00:00:00.000Z');
	});

	it('only accepts the offered intervals', () => {
		expect(FOLLOWUP_DAY_CHOICES.every((d) => isFollowUpDays(d))).toBe(true);
		expect(isFollowUpDays(5)).toBe(false);
		expect(isFollowUpDays(0)).toBe(false);
	});

	it('reads the interval back in words', () => {
		expect(followUpDaysLabel(3)).toBe('3 days');
		expect(followUpDaysLabel(7)).toBe('a week');
		expect(followUpDaysLabel(14)).toBe('2 weeks');
		expect(followUpDaysLabel(30)).toBe('30 days');
	});

	it('is due when set on or before now', () => {
		expect(isFollowUpDue(new Date('2026-07-18T00:00:00.000Z'), now)).toBe(true);
		expect(isFollowUpDue(new Date('2026-07-20T00:00:00.000Z'), now)).toBe(false);
		expect(isFollowUpDue(null, now)).toBe(false);
	});

	it('snoozes by preset', () => {
		expect(snoozeDate('1d', now).toISOString()).toBe('2026-07-20T00:00:00.000Z');
		expect(snoozeDate('3d', now).toISOString()).toBe('2026-07-22T00:00:00.000Z');
		expect(snoozeDate('1w', now).toISOString()).toBe('2026-07-26T00:00:00.000Z');
	});
});

describe('avatar data url', () => {
	it('accepts a small image data url', () => {
		expect(isValidAvatarDataUrl('data:image/jpeg;base64,' + 'A'.repeat(1000))).toBe(true);
	});

	it('rejects non-image or oversized data', () => {
		expect(isValidAvatarDataUrl('data:text/plain;base64,AAAA')).toBe(false);
		expect(isValidAvatarDataUrl('https://example.com/x.png')).toBe(false);
		expect(isValidAvatarDataUrl('data:image/png;base64,' + 'A'.repeat(400_000))).toBe(false);
	});
});

describe('subcontractor tier', () => {
	it('recognizes valid tiers only', () => {
		expect(isSubcontractorTier('trusted')).toBe(true);
		expect(isSubcontractorTier('guest')).toBe(true);
		expect(isSubcontractorTier('admin')).toBe(false);
		expect(isSubcontractorTier('')).toBe(false);
	});

	it('labels tiers for display', () => {
		expect(tierLabel('trusted')).toBe('Trusted Subcontractor');
		expect(tierLabel('guest')).toBe('Guest Contractor');
	});

	it('treats a subcontractor with a bound login as linked', () => {
		expect(isSubcontractorLinked({ userId: 'user-1' })).toBe(true);
		expect(isSubcontractorLinked({ userId: null })).toBe(false);
	});
});

describe('subcontractor profile validation', () => {
	it('requires name and email and formats phone', () => {
		const result = validateSubcontractorContact({
			name: 'Rae Ohm',
			email: '  Rae@Sparks.CO ',
			phone: '5551234567',
			trade: 'Electrical',
			company: 'Sparks Co',
			tags: 'licensed, insured'
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.email).toBe('rae@sparks.co');
			expect(result.value.phone).toBe('(555) 123-4567');
			expect(result.value.trade).toBe('Electrical');
			expect(result.value.tags).toEqual(['licensed', 'insured']);
		}
	});

	it('defaults tier to guest (least privilege)', () => {
		const result = validateSubcontractorContact({ name: 'A', email: 'a@b.com' });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.tier).toBe('guest');
	});

	it('honors an explicit trusted tier', () => {
		const result = validateSubcontractorContact({ name: 'A', email: 'a@b.com', tier: 'trusted' });
		expect(result.ok && result.value.tier).toBe('trusted');
	});

	it('parses insurance expiry into a Date and leaves blanks null', () => {
		const withDate = validateSubcontractorContact({
			name: 'A',
			email: 'a@b.com',
			insuranceExpiresAt: '2024-01-15'
		});
		expect(withDate.ok && withDate.value.insuranceExpiresAt instanceof Date).toBe(true);
		const noDate = validateSubcontractorContact({ name: 'A', email: 'a@b.com' });
		expect(noDate.ok && noDate.value.insuranceExpiresAt).toBe(null);
	});

	it('rejects a missing email', () => {
		const result = validateSubcontractorContact({ name: 'A', email: '' });
		expect(result).toEqual({ ok: false, field: 'email', message: 'Email is required' });
	});

	it('rejects a bad phone', () => {
		const result = validateSubcontractorContact({ name: 'A', email: 'a@b.com', phone: '12' });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.field).toBe('phone');
	});
});

describe('guest PII redaction', () => {
	it('strips all customer identity and contact fields', () => {
		expect(redactCustomerForGuest()).toEqual({
			name: null,
			email: null,
			phone: null,
			address: null
		});
	});
});

describe('support feedback', () => {
	it('recognizes valid feedback types', () => {
		expect(isFeedbackType('bug')).toBe(true);
		expect(isFeedbackType('feature')).toBe(true);
		expect(isFeedbackType('rant')).toBe(false);
	});

	it('labels feedback types', () => {
		expect(feedbackTypeLabel('bug')).toBe('Bug report');
		expect(feedbackTypeLabel('feature')).toBe('Feature request');
	});

	it('validates a good submission and trims fields', () => {
		const result = validateFeedback(
			{ type: 'bug', title: '  Save fails  ', detail: '  broken  ' },
			'contractor'
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({
				type: 'bug',
				title: 'Save fails',
				detail: 'broken',
				surface: 'contractor'
			});
		}
	});

	it('requires a summary and details', () => {
		expect(validateFeedback({ type: 'bug', title: '', detail: 'x' }, 'contractor')).toMatchObject({
			ok: false,
			field: 'title'
		});
		expect(validateFeedback({ type: 'feature', title: 'x', detail: '' }, 'customer')).toMatchObject(
			{
				ok: false,
				field: 'detail'
			}
		);
	});

	it('rejects an over-long summary', () => {
		const result = validateFeedback(
			{ type: 'bug', title: 'x'.repeat(141), detail: 'ok' },
			'contractor'
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.field).toBe('title');
	});

	it('builds a bug issue: [Bug] prefix, bug label context, submitter in body', () => {
		const { title, body } = buildFeedbackIssue(
			{
				type: 'bug',
				title: 'Status won’t save',
				detail: 'Tapping save does nothing.',
				surface: 'contractor'
			},
			{ name: 'Rae', email: 'rae@example.com' }
		);
		expect(title).toBe('[Bug][Contractor] Status won’t save');
		expect(body).toContain('Tapping save does nothing.');
		expect(body).toContain('Rae (rae@example.com)');
		expect(body).toContain('Type: Bug report');
		expect(body).toContain('Surface: Contractor app');
	});

	it('builds a feature issue with the [Feature] prefix', () => {
		const { title, body } = buildFeedbackIssue({
			type: 'feature',
			title: 'CSV export',
			detail: 'Export orders.',
			surface: 'contractor'
		});
		expect(title).toBe('[Feature][Contractor] CSV export');
		expect(body).toContain('Type: Feature request');
		// Falls back gracefully when no submitter is provided.
		expect(body).toContain('someone');
	});

	it('marks a report filed from the customer portal', () => {
		// Triage reads a list of titles; whose experience broke is the first thing
		// worth knowing, so the surface rides in the title as well as the body.
		const { title, body } = buildFeedbackIssue({
			type: 'bug',
			title: 'Timeline is empty',
			detail: 'Nothing shows.',
			surface: 'customer'
		});
		expect(title).toBe('[Bug][Customer] Timeline is empty');
		expect(body).toContain('Surface: Customer portal');
	});
});

describe('email template rendering', () => {
	it('substitutes known placeholders from vars', () => {
		expect(
			renderTemplate('Hi {{customer}}, about {{project}} from {{contractor}}', {
				customer: 'Dana',
				project: 'Backyard Pergola',
				contractor: 'Oak & Iron'
			})
		).toBe('Hi Dana, about Backyard Pergola from Oak & Iron');
	});

	it('tolerates whitespace inside the braces', () => {
		expect(renderTemplate('Hi {{ customer }}', { customer: 'Dana' })).toBe('Hi Dana');
	});

	it('resolves missing values to an empty string', () => {
		expect(renderTemplate('Project: {{project}}.', {})).toBe('Project: .');
		expect(renderTemplate('Project: {{project}}.', { project: null })).toBe('Project: .');
	});

	it('leaves unknown tokens untouched', () => {
		expect(renderTemplate('Hello {{foo}} {{customer}}', { customer: 'Dana' })).toBe(
			'Hello {{foo}} Dana'
		);
	});
});

describe('composeEmail', () => {
	it('resolves subject + body and appends the signature block', () => {
		const { subject, body } = composeEmail(
			{ subject: 'Your {{project}} quote', body: 'Hi {{customer}},\n\nReady to go.' },
			{ customer: 'Dana', project: 'Deck', contractor: 'Oak & Iron' },
			'Thanks,\n{{contractor}}'
		);
		expect(subject).toBe('Your Deck quote');
		expect(body).toBe('Hi Dana,\n\nReady to go.\n\nThanks,\nOak & Iron');
	});

	it('omits the signature when none is provided', () => {
		const { body } = composeEmail({ subject: 's', body: 'Body' }, {}, '');
		expect(body).toBe('Body');
	});

	it('uses the signature alone when the body is empty', () => {
		const { body } = composeEmail({ subject: 's', body: '' }, {}, 'Cheers');
		expect(body).toBe('Cheers');
	});
});

// -------------------------------------------------------------- Subscriptions

describe('subscriptionAccess', () => {
	const now = new Date('2026-08-10T12:00:00.000Z');

	it('lets a comped subscription write, uncapped and forever', () => {
		const a = subscriptionAccess({ status: 'comped', trialEndsAt: null }, now);
		expect(a.canWrite).toBe(true);
		expect(a.limitsApply).toBe(false);
		expect(a.reason).toBeNull();
	});

	it('lets an active subscription write, uncapped', () => {
		const a = subscriptionAccess({ status: 'active', trialEndsAt: null }, now);
		expect(a.canWrite).toBe(true);
		expect(a.limitsApply).toBe(false);
	});

	// ADR-0005: Stripe retries for weeks. Locking out a contractor whose card
	// glitched would do exactly the reputational damage the gate exists to avoid.
	it('keeps a past_due subscription writing while the provider retries', () => {
		const a = subscriptionAccess({ status: 'past_due', trialEndsAt: null }, now);
		expect(a.canWrite).toBe(true);
		expect(a.reason).toBeNull();
	});

	it('lets a live trial write, with limits applied', () => {
		const trialEndsAt = new Date('2026-08-14T12:00:00.000Z');
		const a = subscriptionAccess({ status: 'trialing', trialEndsAt }, now);
		expect(a.canWrite).toBe(true);
		expect(a.limitsApply).toBe(true);
		expect(a.trialDaysRemaining).toBe(4);
	});

	it('rounds a part-day of trial up rather than down', () => {
		const trialEndsAt = new Date('2026-08-10T12:00:01.000Z');
		const a = subscriptionAccess({ status: 'trialing', trialEndsAt }, now);
		expect(a.canWrite).toBe(true);
		expect(a.trialDaysRemaining).toBe(1);
	});

	it('blocks the instant the trial end is reached', () => {
		const a = subscriptionAccess({ status: 'trialing', trialEndsAt: now }, now);
		expect(a.canWrite).toBe(false);
		expect(a.reason).toBe('trial-ended');
		expect(a.limitsApply).toBe(false);
	});

	it('blocks a trial that ended in the past', () => {
		const trialEndsAt = new Date('2026-08-09T12:00:00.000Z');
		const a = subscriptionAccess({ status: 'trialing', trialEndsAt }, now);
		expect(a.canWrite).toBe(false);
		expect(a.reason).toBe('trial-ended');
	});

	it('treats a trial with no end date as live rather than locking out on a null', () => {
		const a = subscriptionAccess({ status: 'trialing', trialEndsAt: null }, now);
		expect(a.canWrite).toBe(true);
		expect(a.limitsApply).toBe(true);
		expect(a.trialDaysRemaining).toBeNull();
	});

	it('blocks a lapsed subscription', () => {
		const a = subscriptionAccess({ status: 'lapsed', trialEndsAt: null }, now);
		expect(a.canWrite).toBe(false);
		expect(a.reason).toBe('subscription-ended');
	});
});

describe('limitStatus', () => {
	it('reports usage under the cap as having room', () => {
		const s = limitStatus({ customer: 3, order: 4, subcontractor: 1 });
		expect(s.customer.atLimit).toBe(false);
		expect(s.customer.remaining).toBe(TRIAL_LIMITS.customer - 3);
		expect(s.subcontractor.remaining).toBe(TRIAL_LIMITS.subcontractor - 1);
	});

	it('is at the limit exactly on the boundary', () => {
		const s = limitStatus({
			customer: TRIAL_LIMITS.customer,
			order: 0,
			subcontractor: 0
		});
		expect(s.customer.atLimit).toBe(true);
		expect(s.customer.remaining).toBe(0);
		expect(s.order.atLimit).toBe(false);
	});

	// A contractor can end up over a cap (e.g. limits tightened). They keep every
	// record — creation is what stops.
	it('clamps remaining at zero when over the limit', () => {
		const s = limitStatus({ customer: TRIAL_LIMITS.customer + 5, order: 0, subcontractor: 0 });
		expect(s.customer.atLimit).toBe(true);
		expect(s.customer.remaining).toBe(0);
	});

	it('honours explicitly supplied limits', () => {
		const s = limitStatus(
			{ customer: 2, order: 0, subcontractor: 0 },
			{
				customer: 2,
				order: 10,
				subcontractor: 10
			}
		);
		expect(s.customer.atLimit).toBe(true);
	});
});

describe('shouldBeComped', () => {
	it('comps a login created before billing launched', () => {
		expect(shouldBeComped(new Date(BILLING_LAUNCHED_AT.getTime() - 1))).toBe(true);
	});

	it('does not comp a login created at or after billing launched', () => {
		expect(shouldBeComped(BILLING_LAUNCHED_AT)).toBe(false);
		expect(shouldBeComped(new Date(BILLING_LAUNCHED_AT.getTime() + 1))).toBe(false);
	});
});

describe('trialEndFrom', () => {
	it('ends the trial 14 days out', () => {
		const from = new Date('2026-08-01T00:00:00.000Z');
		expect(trialEndFrom(from).toISOString()).toBe('2026-08-15T00:00:00.000Z');
	});
});

describe('mapProviderStatus', () => {
	it('treats active and trialing as a live paid subscription', () => {
		expect(mapProviderStatus('active')).toBe('active');
		expect(mapProviderStatus('trialing')).toBe('active');
	});

	// The important one: a failed card must not lock a paying contractor out while
	// the provider is still retrying (ADR-0005).
	it('keeps recoverable failures writable', () => {
		for (const s of ['past_due', 'unpaid', 'incomplete', 'paused']) {
			expect(mapProviderStatus(s)).toBe('past_due');
		}
		expect(subscriptionAccess({ status: 'past_due', trialEndsAt: null }).canWrite).toBe(true);
	});

	it('lapses only once the provider has given up', () => {
		expect(mapProviderStatus('canceled')).toBe('lapsed');
		expect(mapProviderStatus('incomplete_expired')).toBe('lapsed');
	});

	it('falls back to a recoverable status for anything unrecognised', () => {
		expect(mapProviderStatus('something_new')).toBe('past_due');
	});
});

describe('BILLING_LAUNCHED_AT', () => {
	// A future date silently comps every new signup — the paywall would appear to
	// work while charging nobody. This is the one constant that must be in the past.
	it('is in the past, so new signups actually start a trial', () => {
		expect(BILLING_LAUNCHED_AT.getTime()).toBeLessThan(Date.now());
		expect(shouldBeComped(new Date())).toBe(false);
	});
});

/**
 * Follow-up urgency. Compared by calendar day on purpose — see the note on
 * `followUpUrgency`. Dates are built with the local-time constructor rather than
 * ISO strings, because `new Date('2026-07-19')` is UTC midnight, which is the
 * PREVIOUS day in every US timezone and would make these tests pass or fail
 * depending on where they run.
 */
describe('followUpUrgency', () => {
	/** 2026-07-19, 2pm local. */
	const now = new Date(2026, 6, 19, 14, 0, 0);
	const day = (offset: number, hour = 0) => new Date(2026, 6, 19 + offset, hour, 0, 0);

	it('reports a date on an earlier day as overdue', () => {
		expect(followUpUrgency(day(-1), now)).toBe('overdue');
		expect(followUpUrgency(day(-9), now)).toBe('overdue');
	});

	it('reports today as today, whatever time of day it is', () => {
		expect(followUpUrgency(day(0, 0), now)).toBe('today');
		expect(followUpUrgency(day(0, 9), now)).toBe('today');
		// Still today's work at 4pm, not "nine hours overdue" — the whole reason
		// this is a calendar comparison rather than an elapsed-time one.
		expect(followUpUrgency(day(0, 23), now)).toBe('today');
	});

	it('reports a later day as upcoming', () => {
		expect(followUpUrgency(day(1), now)).toBe('upcoming');
		expect(followUpUrgency(day(30), now)).toBe('upcoming');
	});

	it('reports no date, and an unparseable one, as none', () => {
		expect(followUpUrgency(null, now)).toBe('none');
		expect(followUpUrgency('not a date', now)).toBe('none');
	});

	it('accepts an ISO string, as the loader hands it over the wire', () => {
		expect(followUpUrgency(day(-2).toISOString(), now)).toBe('overdue');
	});
});

describe('followUpDaysOverdue', () => {
	const now = new Date(2026, 6, 19, 14, 0, 0);
	const day = (offset: number, hour = 0) => new Date(2026, 6, 19 + offset, hour, 0, 0);

	it('counts whole calendar days late', () => {
		expect(followUpDaysOverdue(day(-1), now)).toBe(1);
		expect(followUpDaysOverdue(day(-14), now)).toBe(14);
	});

	it('is zero for today and for anything still ahead', () => {
		expect(followUpDaysOverdue(day(0, 23), now)).toBe(0);
		expect(followUpDaysOverdue(day(3), now)).toBe(0);
		expect(followUpDaysOverdue(null, now)).toBe(0);
	});
});

describe('followUpLabel', () => {
	const now = new Date(2026, 6, 19, 14, 0, 0);
	const day = (offset: number) => new Date(2026, 6, 19 + offset, 0, 0, 0);

	it('counts the days rather than only saying "overdue"', () => {
		// Three days late and three weeks late are different conversations.
		expect(followUpLabel(day(-1), now)).toBe('1 day overdue');
		expect(followUpLabel(day(-3), now)).toBe('3 days overdue');
		expect(followUpLabel(day(-21), now)).toBe('21 days overdue');
	});

	it('names today plainly', () => {
		expect(followUpLabel(day(0), now)).toBe('Due today');
	});

	it('reads an upcoming date in the same words the settings use', () => {
		expect(followUpLabel(day(1), now)).toBe('Due in a day');
		expect(followUpLabel(day(7), now)).toBe('Due in a week');
	});

	it('says so when there is no follow-up at all', () => {
		expect(followUpLabel(null, now)).toBe('No follow-up set');
	});
});

/**
 * The date-picker round trip. These are the regression guard for a one-day
 * error that was invisible until the dashboard started counting days: every
 * assertion here fails under the old `new Date('2026-08-14')` for any runner
 * west of Greenwich.
 */
describe('parseDateInput / toDateInput', () => {
	it('parses a picker value as the local calendar day it names', () => {
		const parsed = parseDateInput('2026-08-14')!;
		expect(parsed.getFullYear()).toBe(2026);
		expect(parsed.getMonth()).toBe(7);
		expect(parsed.getDate()).toBe(14);
		// Local midnight, not UTC midnight — that difference IS the bug.
		expect(parsed.getHours()).toBe(0);
	});

	it('round-trips a day without drifting', () => {
		for (const day of ['2026-01-01', '2026-08-14', '2026-12-31']) {
			expect(toDateInput(parseDateInput(day))).toBe(day);
		}
	});

	it('treats blank and absent as no date', () => {
		expect(parseDateInput('')).toBeNull();
		expect(parseDateInput('   ')).toBeNull();
		expect(parseDateInput(undefined)).toBeNull();
	});

	it('refuses a malformed value rather than guessing', () => {
		expect(parseDateInput('14/08/2026')).toBeNull();
		expect(parseDateInput('2026-8-4')).toBeNull();
		expect(parseDateInput('tomorrow')).toBeNull();
	});

	it('refuses a date that does not exist instead of rolling it forward', () => {
		// `new Date(2026, 1, 31)` silently becomes 3 March.
		expect(parseDateInput('2026-02-31')).toBeNull();
		expect(parseDateInput('2026-13-01')).toBeNull();
	});

	it('formats null and an unparseable date as empty', () => {
		expect(toDateInput(null)).toBe('');
		expect(toDateInput('not a date')).toBe('');
	});
});

describe('snoozeDate', () => {
	const from = new Date(2026, 6, 19, 9, 0, 0);
	const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);

	it.each([
		['1d', 1],
		['3d', 3],
		['1w', 7],
		['1m', 30]
	] as const)('pushes %s out by %i days', (preset, days) => {
		expect(daysBetween(from, snoozeDate(preset, from))).toBe(days);
	});

	it('accepts every preset it advertises, and nothing else', () => {
		for (const preset of ['1d', '3d', '1w', '1m']) expect(isSnoozePreset(preset)).toBe(true);
		expect(isSnoozePreset('2w')).toBe(false);
		expect(isSnoozePreset('')).toBe(false);
		// The lookup is an object, so inherited keys must not read as presets.
		expect(isSnoozePreset('toString')).toBe(false);
	});
});
