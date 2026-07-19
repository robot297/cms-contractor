const AUTO_ARCHIVE_DAYS = 30;

export const CONTRACTOR_ORDER_STATES = [
	'Inquiry',
	'Quote Sent',
	'Deposit Pending',
	'Parts Ordered',
	'Work Scheduled',
	'In Progress',
	'Final Payment Pending',
	'Work Complete',
	'Work Cancelled',
	'On Hold / Archived'
] as const;

export type ContractorOrderState = (typeof CONTRACTOR_ORDER_STATES)[number];

export function isContractorOrderState(value: string): value is ContractorOrderState {
	return (CONTRACTOR_ORDER_STATES as readonly string[]).includes(value);
}

/** States a contractor picks from in the quick-update surface (excludes archive). */
export const QUICK_UPDATE_STATES: ContractorOrderState[] = CONTRACTOR_ORDER_STATES.filter(
	(s) => s !== 'On Hold / Archived'
);

export type UserRole = 'contractor' | 'customer';

export type TimelineKind = 'status' | 'invoice' | 'message' | 'milestone' | 'issue';

/** A customer's active order is anything not terminal or archived. */
export function isActiveState(state: ContractorOrderState): boolean {
	return state !== 'Work Complete' && state !== 'Work Cancelled' && state !== 'On Hold / Archived';
}

export type CustomerVisibleState =
	'Pending' | 'Scheduled' | 'In Progress' | 'Completed' | 'Cancelled' | 'On Hold';

export function getVisibleCustomerState(state: ContractorOrderState): CustomerVisibleState {
	switch (state) {
		case 'Inquiry':
		case 'Quote Sent':
		case 'Deposit Pending':
		case 'Parts Ordered':
			return 'Pending';
		case 'Work Scheduled':
			return 'Scheduled';
		case 'In Progress':
			return 'In Progress';
		case 'Work Complete':
			return 'Completed';
		case 'Work Cancelled':
			return 'Cancelled';
		case 'On Hold / Archived':
			return 'On Hold';
		default:
			return 'Pending';
	}
}

export function shouldAutoArchive(lastUpdatedAt: Date): boolean {
	const ageInDays = (Date.now() - lastUpdatedAt.getTime()) / (1000 * 60 * 60 * 24);
	return ageInDays >= AUTO_ARCHIVE_DAYS;
}
