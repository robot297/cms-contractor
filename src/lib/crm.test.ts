import { describe, expect, it } from 'vitest';
import {
	defaultFollowUp,
	digitsOnly,
	formatPhone,
	getVisibleCustomerState,
	isCustomerLinked,
	isFollowUpDue,
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
	snoozeDate,
	tierLabel,
	validateCustomerContact,
	validateOrderSetup,
	validateSubcontractorContact
} from './crm';

describe('customer-visible state mapping', () => {
	it('maps contractor lifecycle states to customer-friendly labels', () => {
		expect(getVisibleCustomerState('Deposit Pending')).toBe('Pending');
		expect(getVisibleCustomerState('Work Scheduled')).toBe('Scheduled');
		expect(getVisibleCustomerState('Work Complete')).toBe('Completed');
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

	it('accepts and normalizes a valid contact with optional fields', () => {
		expect(
			validateCustomerContact({
				name: '  Dan  ',
				email: 'Dan@Example.com',
				phone: '5551234567',
				address: '  12 Main St ',
				notes: '',
				tags: 'kitchen, kitchen , repeat'
			})
		).toEqual({
			ok: true,
			value: {
				name: 'Dan',
				email: 'dan@example.com',
				phone: '(555) 123-4567',
				address: '12 Main St',
				notes: null,
				tags: ['kitchen', 'repeat'],
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
				notes: null,
				tags: [],
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

	it('defaults a new follow-up to 3 days out', () => {
		expect(defaultFollowUp(now).toISOString()).toBe('2026-07-22T00:00:00.000Z');
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
		const result = validateFeedback({ type: 'bug', title: '  Save fails  ', detail: '  broken  ' });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ type: 'bug', title: 'Save fails', detail: 'broken' });
		}
	});

	it('requires a summary and details', () => {
		expect(validateFeedback({ type: 'bug', title: '', detail: 'x' })).toMatchObject({
			ok: false,
			field: 'title'
		});
		expect(validateFeedback({ type: 'feature', title: 'x', detail: '' })).toMatchObject({
			ok: false,
			field: 'detail'
		});
	});

	it('rejects an over-long summary', () => {
		const result = validateFeedback({ type: 'bug', title: 'x'.repeat(141), detail: 'ok' });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.field).toBe('title');
	});

	it('builds a bug issue: [Bug] prefix, bug label context, submitter in body', () => {
		const { title, body } = buildFeedbackIssue(
			{ type: 'bug', title: 'Status won’t save', detail: 'Tapping save does nothing.' },
			{ name: 'Rae', email: 'rae@example.com' }
		);
		expect(title).toBe('[Bug] Status won’t save');
		expect(body).toContain('Tapping save does nothing.');
		expect(body).toContain('Rae (rae@example.com)');
		expect(body).toContain('Type: Bug report');
	});

	it('builds a feature issue with the [Feature] prefix', () => {
		const { title, body } = buildFeedbackIssue({
			type: 'feature',
			title: 'CSV export',
			detail: 'Export orders.'
		});
		expect(title).toBe('[Feature] CSV export');
		expect(body).toContain('Type: Feature request');
		// Falls back gracefully when no submitter is provided.
		expect(body).toContain('a contractor');
	});
});
