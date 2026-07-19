import { describe, expect, it } from 'vitest';
import {
	digitsOnly,
	formatPhone,
	getVisibleCustomerState,
	isCustomerLinked,
	normalizeEmail,
	parseTags,
	validateCustomerContact
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
				tags: ['kitchen', 'repeat']
			}
		});
	});

	it('defaults optional fields to null / empty', () => {
		const result = validateCustomerContact({ name: 'Dan', email: 'a@b.com' });
		expect(result).toEqual({
			ok: true,
			value: { name: 'Dan', email: 'a@b.com', phone: null, address: null, notes: null, tags: [] }
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
