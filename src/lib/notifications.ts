export type NotificationItem = {
	id: string;
	title: string;
	detail: string;
	unread: boolean;
	priority: 'standard' | 'high';
};

export function buildNotificationSummary(items: NotificationItem[]) {
	const unread = items.filter((item) => item.unread).length;
	return {
		unread,
		total: items.length,
		highPriority: items.filter((item) => item.priority === 'high').length
	};
}

export function markAsRead(items: NotificationItem[], id: string): NotificationItem[] {
	return items.map((item) => (item.id === id ? { ...item, unread: false } : item));
}

export function markAllAsRead(items: NotificationItem[]): NotificationItem[] {
	return items.map((item) => (item.unread ? { ...item, unread: false } : item));
}

export type MilestoneEmail = {
	notificationId: string;
	subject: string;
	body: string;
};

/**
 * App-first notifications are the default; only high-priority milestones are
 * escalated to email. Already-read items are not re-sent.
 */
export function selectMilestoneEmails(items: NotificationItem[]): MilestoneEmail[] {
	return items
		.filter((item) => item.priority === 'high' && item.unread)
		.map((item) => ({
			notificationId: item.id,
			subject: `Update: ${item.title}`,
			body: item.detail
		}));
}
