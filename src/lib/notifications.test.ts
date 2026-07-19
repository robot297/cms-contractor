import { describe, expect, it } from 'vitest';
import type { NotificationItem } from './notifications';
import {
	buildNotificationSummary,
	markAllAsRead,
	markAsRead,
	selectMilestoneEmails
} from './notifications';

describe('notifications', () => {
	it('summarizes unread and high-priority notifications', () => {
		const summary = buildNotificationSummary([
			{
				id: '1',
				title: 'Deposit reminder',
				detail: 'Payment due soon',
				unread: true,
				priority: 'high'
			},
			{
				id: '2',
				title: 'Work scheduled',
				detail: 'The crew is confirmed',
				unread: false,
				priority: 'standard'
			}
		]);

		expect(summary).toEqual({ unread: 1, total: 2, highPriority: 1 });
	});

	it('marks a specific notification as read', () => {
		const updated = markAsRead(
			[
				{
					id: '1',
					title: 'Deposit reminder',
					detail: 'Payment due soon',
					unread: true,
					priority: 'high'
				}
			],
			'1'
		);

		expect(updated[0]?.unread).toBe(false);
	});

	it('marks every notification as read at once', () => {
		const items: NotificationItem[] = [
			{ id: '1', title: 'A', detail: '', unread: true, priority: 'high' },
			{ id: '2', title: 'B', detail: '', unread: true, priority: 'standard' },
			{ id: '3', title: 'C', detail: '', unread: false, priority: 'standard' }
		];
		expect(markAllAsRead(items).every((i) => !i.unread)).toBe(true);
	});

	it('escalates only unread high-priority milestones to email', () => {
		const items: NotificationItem[] = [
			{ id: '1', title: 'Milestone reached', detail: 'Work complete', unread: true, priority: 'high' },
			{ id: '2', title: 'Already seen', detail: '', unread: false, priority: 'high' },
			{ id: '3', title: 'Routine', detail: '', unread: true, priority: 'standard' }
		];
		const emails = selectMilestoneEmails(items);
		expect(emails).toEqual([
			{ notificationId: '1', subject: 'Update: Milestone reached', body: 'Work complete' }
		]);
	});
});
