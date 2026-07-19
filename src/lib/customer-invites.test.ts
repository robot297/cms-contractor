import { describe, expect, it } from 'vitest';
import {
	createCustomerInvite,
	isInviteActive,
	resendCustomerInvite,
	revokeCustomerInvite
} from './customer-invites';

describe('customer magic-link invites', () => {
	it('expires invites after 24 hours', () => {
		const invite = createCustomerInvite(
			'customer@example.com',
			new Date('2026-01-01T00:00:00.000Z')
		);
		expect(isInviteActive(invite, new Date('2026-01-02T00:00:00.000Z'))).toBe(false);
	});

	it('supports revocation and resend with a fresh expiry window', () => {
		const invite = createCustomerInvite(
			'customer@example.com',
			new Date('2026-01-01T00:00:00.000Z')
		);
		const revoked = revokeCustomerInvite(invite);
		expect(revoked.status).toBe('revoked');

		const resent = resendCustomerInvite(invite, new Date('2026-01-01T12:00:00.000Z'));
		expect(resent.status).toBe('pending');
		expect(resent.expiresAt.getTime() - resent.createdAt.getTime()).toBe(24 * 60 * 60 * 1000);
	});
});
