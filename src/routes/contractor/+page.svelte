<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let showNotifications = $state(false);
	let confirmingDeleteInviteId: string | null = $state(null);

	const unread = $derived(data.notifications.filter((n) => n.unread).length);
	const highPending = $derived(
		data.notifications.filter((n) => n.unread && n.priority === 'high').length
	);

	function inviteLabel(status: string, expiresAt: Date): string {
		if (status === 'revoked') return 'Revoked';
		if (status === 'used') return 'Accepted';
		return new Date(expiresAt).getTime() > Date.now() ? 'Active' : 'Expired';
	}
</script>

<svelte:head>
	<title>Contractor dashboard</title>
</svelte:head>

<div style="max-width: 860px; margin: 0 auto; padding: 1rem; display: grid; gap: 1rem;">
	<header style="display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
		<h1 style="margin: 0;">Dashboard</h1>
		<!-- Notifications bell -->
		<div style="position: relative;">
			<button
				type="button"
				onclick={() => (showNotifications = !showNotifications)}
				aria-label="Notifications"
				title="Notifications"
				style="position: relative; width: 2.25rem; height: 2.25rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer; font-size: 1.05rem; line-height: 1;"
			>
				🔔
				{#if unread > 0}
					<span
						style="position: absolute; top: -4px; right: -4px; min-width: 1.1rem; height: 1.1rem; padding: 0 0.28rem; box-sizing: border-box; border-radius: 999px; background: #cf222e; color: #fff; font-size: 0.68rem; line-height: 1.1rem; text-align: center;"
						>{unread}</span
					>
				{/if}
			</button>
			{#if showNotifications}
				<div
					style="position: absolute; right: 0; top: calc(100% + 0.4rem); z-index: 20; width: min(340px, 90vw); background: #fff; border: 1px solid #d0d7de; border-radius: 12px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.15); padding: 0.75rem; display: grid; gap: 0.6rem; max-height: 60vh; overflow: auto;"
				>
					<div style="display: flex; justify-content: space-between; align-items: center;">
						<h2 style="margin: 0; font-size: 0.95rem;">Notifications</h2>
						{#if unread > 0}
							<form method="POST" action="?/markAllRead" use:enhance>
								<button
									type="submit"
									style="font-size: 0.85rem; color: #0969da; background: none; border: none; cursor: pointer;"
									>Mark all read</button
								>
							</form>
						{/if}
					</div>
					{#if highPending > 0}
						<div style="font-size: 0.8rem; color: #9a6700;">
							{highPending} high-priority milestone{highPending === 1 ? '' : 's'} will also be emailed.
						</div>
					{/if}
					{#if data.notifications.length === 0}
						<p style="margin: 0; color: #57606a; font-size: 0.9rem;">No notifications yet.</p>
					{/if}
					<div style="display: grid; gap: 0.5rem;">
						{#each data.notifications as n (n.id)}
							<div
								style="padding: 0.6rem; border-radius: 10px; background: {n.unread
									? '#f6f8fa'
									: '#fff'}; border: 1px solid #d0d7de; display: flex; justify-content: space-between; gap: 0.75rem; align-items: start;"
							>
								<div>
									<strong style="font-size: 0.9rem;">{n.title}</strong>
									{#if n.priority === 'high'}
										<span
											style="font-size: 0.7rem; color: #9a6700; border: 1px solid #d4a72c; border-radius: 999px; padding: 0.05rem 0.4rem; margin-left: 0.35rem;"
											>High</span
										>
									{/if}
									{#if n.detail}<div style="font-size: 0.85rem; color: #57606a;">
											{n.detail}
										</div>{/if}
								</div>
								{#if n.unread}
									<form method="POST" action="?/markRead" use:enhance>
										<input type="hidden" name="id" value={n.id} />
										<button
											type="submit"
											style="font-size: 0.78rem; color: #0969da; background: none; border: none; cursor: pointer; white-space: nowrap;"
											>Mark read</button
										>
									</form>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</header>

	<!-- Follow-ups due -->
	<a href={resolve('/contractor/orders')} style="text-decoration: none; color: inherit;">
		<div
			style="border: 1px solid {data.dueCount > 0
				? '#d4a72c'
				: '#d0d7de'}; background: {data.dueCount > 0
				? '#fffbe6'
				: '#f6f8fa'}; border-radius: 16px; padding: 1rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem;"
		>
			<div>
				<strong>{data.dueCount} follow-up{data.dueCount === 1 ? '' : 's'} due</strong>
				<div style="font-size: 0.9rem; color: #57606a;">
					{data.dueCount > 0 ? 'Orders waiting on your next touch.' : 'You’re all caught up.'}
				</div>
			</div>
			<span style="color: #0969da;">View orders →</span>
		</div>
	</a>

	<!-- Invites -->
	<section
		style="border: 1px solid #d0d7de; border-radius: 16px; padding: 1rem; display: grid; gap: 0.75rem;"
	>
		<h2 style="margin: 0; font-size: 1rem;">Customer invites</h2>
		{#if data.invites.length === 0}
			<p style="margin: 0; color: #57606a; font-size: 0.9rem;">No invites sent yet.</p>
		{/if}
		<div style="display: grid; gap: 0.5rem;">
			{#each data.invites as invite (invite.id)}
				<div
					style="padding: 0.75rem; border-radius: 12px; background: #f6f8fa; border: 1px solid #d0d7de; display: flex; justify-content: space-between; gap: 1rem; align-items: center; flex-wrap: wrap;"
				>
					<div>
						<strong>{invite.customerEmail}</strong>
						<div style="font-size: 0.85rem; color: #57606a;">
							{inviteLabel(invite.status, invite.expiresAt)} · expires {new Date(
								invite.expiresAt
							).toLocaleString()}
						</div>
					</div>
					<div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
						{#if confirmingDeleteInviteId === invite.id}
							<span style="font-size: 0.85rem; color: #57606a;">Delete this invite?</span>
							<form
								method="POST"
								action="?/deleteInvite"
								use:enhance={() =>
									async ({ update }) => {
										confirmingDeleteInviteId = null;
										await update();
									}}
							>
								<input type="hidden" name="inviteId" value={invite.id} />
								<button
									type="submit"
									style="padding: 0.4rem 0.7rem; border-radius: 999px; border: 1px solid #cf222e; background: #cf222e; color: #fff; cursor: pointer;"
									>Yes, delete</button
								>
							</form>
							<button
								type="button"
								onclick={() => (confirmingDeleteInviteId = null)}
								style="padding: 0.4rem 0.7rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer;"
								>Cancel</button
							>
						{:else}
							<form method="POST" action="?/resendInvite" use:enhance>
								<input type="hidden" name="inviteId" value={invite.id} />
								<button
									type="submit"
									style="padding: 0.4rem 0.7rem; border-radius: 999px; border: 1px solid #0969da; background: none; cursor: pointer;"
									>Resend</button
								>
							</form>
							{#if invite.status === 'pending'}
								<form method="POST" action="?/revokeInvite" use:enhance>
									<input type="hidden" name="inviteId" value={invite.id} />
									<button
										type="submit"
										style="padding: 0.4rem 0.7rem; border-radius: 999px; border: 1px solid #cf222e; color: #cf222e; background: none; cursor: pointer;"
										>Revoke</button
									>
								</form>
							{/if}
							<button
								type="button"
								title="Delete invite"
								aria-label="Delete invite"
								onclick={() => (confirmingDeleteInviteId = invite.id)}
								style="border: none; background: none; cursor: pointer; font-size: 1rem; line-height: 1; color: #cf222e; padding: 0.2rem 0.35rem;"
								>🗑</button
							>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</section>
</div>
