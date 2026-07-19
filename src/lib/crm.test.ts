import { describe, expect, it } from 'vitest';
import { getVisibleCustomerState, shouldAutoArchive } from './crm';

describe('customer-visible state mapping', () => {
	it('maps contractor lifecycle states to customer-friendly labels', () => {
		expect(getVisibleCustomerState('Deposit Pending')).toBe('Pending');
		expect(getVisibleCustomerState('Work Scheduled')).toBe('Scheduled');
		expect(getVisibleCustomerState('Work Complete')).toBe('Completed');
	});
});

describe('archive automation', () => {
	it('marks stale work as eligible for archive after the inactivity window', () => {
		const staleDate = new Date(Date.now() - 32 * 24 * 60 * 60 * 1000);
		expect(shouldAutoArchive(staleDate)).toBe(true);
	});

	it('keeps recent work out of archive eligibility', () => {
		const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
		expect(shouldAutoArchive(recentDate)).toBe(false);
	});
});
