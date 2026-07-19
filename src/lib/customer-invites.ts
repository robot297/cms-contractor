export type CustomerInviteStatus = 'pending' | 'revoked' | 'used';

export type CustomerInvite = {
	id: string;
	customerEmail: string;
	status: CustomerInviteStatus;
	createdAt: Date;
	expiresAt: Date;
	magicLink: string;
};

export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export function createCustomerInvite(
	customerEmail: string,
	createdAt: Date = new Date()
): CustomerInvite {
	const expiresAt = new Date(createdAt.getTime() + INVITE_TTL_MS);
	return {
		id: `${customerEmail}-${createdAt.getTime()}`,
		customerEmail,
		status: 'pending',
		createdAt,
		expiresAt,
		magicLink: `/customer/invite/${encodeURIComponent(customerEmail)}?token=${createdAt.getTime()}`
	};
}

export function isInviteActive(invite: CustomerInvite, now: Date = new Date()): boolean {
	// Expires *at* the 24h mark: active only while now is strictly before expiry.
	return invite.status === 'pending' && invite.expiresAt.getTime() > now.getTime();
}

export function revokeCustomerInvite(invite: CustomerInvite): CustomerInvite {
	return { ...invite, status: 'revoked' };
}

export function resendCustomerInvite(
	invite: CustomerInvite,
	now: Date = new Date()
): CustomerInvite {
	return {
		...invite,
		status: 'pending',
		createdAt: now,
		expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
		magicLink: `/customer/invite/${encodeURIComponent(invite.customerEmail)}?token=${now.getTime()}`
	};
}
