<script lang="ts">
	import { enhance } from '$app/forms';
	import { QUICK_UPDATE_STATES } from '$lib/crm';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type View = 'follow-ups' | 'active';
	let view = $state<View>('follow-ups');

	const unread = $derived(data.notifications.filter((n) => n.unread).length);
	const highPending = $derived(
		data.notifications.filter((n) => n.unread && n.priority === 'high').length
	);
	const visibleOrders = $derived(
		view === 'follow-ups' ? data.orders.filter((o) => o.needsAttention) : data.orders
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
	<header style="display: flex; justify-content: space-between; align-items: start; gap: 1rem;">
		<div style="display: grid; gap: 0.35rem;">
			<h1 style="margin: 0;">Follow-ups</h1>
			<p style="margin: 0; color: #57606a;">Signed in as {data.userName}</p>
		</div>
		<form method="POST" action="?/signOut" use:enhance>
			<button type="submit" style="padding: 0.4rem 0.8rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer;">Sign out</button>
		</form>
	</header>

	<div style="padding: 0.75rem 0.9rem; border-radius: 12px; background: #f6f8fa; border: 1px solid #d0d7de;">
		Notifications: {unread} unread / {data.notifications.length} total
	</div>

	<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
		<button type="button" onclick={() => (view = 'follow-ups')} style="padding: 0.5rem 0.75rem; border-radius: 999px; border: 1px solid #d0d7de; background: {view === 'follow-ups' ? '#0969da' : '#f6f8fa'}; color: {view === 'follow-ups' ? '#fff' : 'inherit'};">Today’s follow-ups</button>
		<button type="button" onclick={() => (view = 'active')} style="padding: 0.5rem 0.75rem; border-radius: 999px; border: 1px solid #d0d7de; background: {view === 'active' ? '#0969da' : '#f6f8fa'}; color: {view === 'active' ? '#fff' : 'inherit'};">All active orders</button>
	</div>

	<!-- Notifications -->
	<section style="border: 1px solid #d0d7de; border-radius: 16px; padding: 1rem; display: grid; gap: 0.75rem;">
		<div style="display: flex; justify-content: space-between; align-items: center;">
			<h2 style="margin: 0; font-size: 1rem;">Notifications</h2>
			{#if unread > 0}
				<form method="POST" action="?/markAllRead" use:enhance>
					<button type="submit" style="font-size: 0.85rem; color: #0969da; background: none; border: none; cursor: pointer;">Mark all read</button>
				</form>
			{/if}
		</div>
		{#if highPending > 0}
			<div style="font-size: 0.85rem; color: #9a6700;">{highPending} high-priority milestone{highPending === 1 ? '' : 's'} will also be emailed.</div>
		{/if}
		{#if data.notifications.length === 0}
			<p style="margin: 0; color: #57606a; font-size: 0.9rem;">No notifications yet.</p>
		{/if}
		<div style="display: grid; gap: 0.5rem;">
			{#each data.notifications as n (n.id)}
				<div style="padding: 0.75rem; border-radius: 12px; background: {n.unread ? '#f6f8fa' : '#fff'}; border: 1px solid #d0d7de; display: flex; justify-content: space-between; gap: 1rem; align-items: center;">
					<div>
						<strong>{n.title}</strong>
						{#if n.priority === 'high'}
							<span style="font-size: 0.7rem; color: #9a6700; border: 1px solid #d4a72c; border-radius: 999px; padding: 0.05rem 0.4rem; margin-left: 0.35rem;">High</span>
						{/if}
						{#if n.detail}<div style="font-size: 0.9rem; color: #57606a;">{n.detail}</div>{/if}
					</div>
					{#if n.unread}
						<form method="POST" action="?/markRead" use:enhance>
							<input type="hidden" name="id" value={n.id} />
							<button type="submit" style="font-size: 0.8rem; color: #0969da; background: none; border: none; cursor: pointer;">Mark read</button>
						</form>
					{/if}
				</div>
			{/each}
		</div>
	</section>

	<!-- New order -->
	<section style="border: 1px solid #d0d7de; border-radius: 16px; padding: 1rem; display: grid; gap: 0.75rem;">
		<h2 style="margin: 0; font-size: 1rem;">New order</h2>
		<form method="POST" action="?/createOrder" use:enhance style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
			<input name="customerName" placeholder="Customer name" required style="flex: 1; min-width: 140px; padding: 0.5rem; border-radius: 8px; border: 1px solid #d0d7de;" />
			<input name="customerEmail" type="email" placeholder="Email" required style="flex: 1; min-width: 140px; padding: 0.5rem; border-radius: 8px; border: 1px solid #d0d7de;" />
			<button type="submit" style="padding: 0.5rem 0.9rem; border-radius: 999px; border: 1px solid #0969da; background: #0969da; color: #fff; cursor: pointer;">Add</button>
		</form>
	</section>

	<!-- Orders -->
	<section style="display: grid; gap: 0.75rem;">
		{#if visibleOrders.length === 0}
			<p style="color: #57606a;">No {view === 'follow-ups' ? 'follow-ups' : 'orders'} right now.</p>
		{/if}
		{#each visibleOrders as order (order.id)}
			<article style="border: 1px solid #d0d7de; border-radius: 16px; padding: 1rem; display: grid; gap: 0.75rem;">
				<div style="display: flex; justify-content: space-between; gap: 1rem; align-items: center;">
					<div>
						<strong>{order.customerName}</strong>
						<div style="font-size: 0.9rem; color: #57606a;">{order.state} · customer sees “{order.customerVisibleState}”</div>
					</div>
					{#if order.needsAttention}
						<span style="font-size: 0.85rem; color: #cf222e;">Needs attention</span>
					{/if}
				</div>

				<form method="POST" action="?/quickUpdate" use:enhance style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
					<input type="hidden" name="orderId" value={order.id} />
					<select name="state" style="padding: 0.5rem; border-radius: 8px; border: 1px solid #d0d7de;">
						{#each QUICK_UPDATE_STATES as s (s)}
							<option value={s} selected={s === order.state}>{s}</option>
						{/each}
					</select>
					<input name="note" placeholder="Optional note" style="flex: 1; min-width: 120px; padding: 0.5rem; border-radius: 8px; border: 1px solid #d0d7de;" />
					<button type="submit" style="padding: 0.5rem 0.9rem; border-radius: 999px; border: 1px solid #0969da; background: #0969da; color: #fff; cursor: pointer;">Quick update</button>
				</form>

				<form method="POST" action="?/sendInvite" use:enhance style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
					<input type="hidden" name="orderId" value={order.id} />
					<input name="customerEmail" type="email" value={order.customerEmail} style="flex: 1; min-width: 140px; padding: 0.5rem; border-radius: 8px; border: 1px solid #d0d7de;" />
					<button type="submit" style="padding: 0.5rem 0.9rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer;">Invite customer</button>
				</form>
			</article>
		{/each}
	</section>

	<!-- Invites -->
	<section style="border: 1px solid #d0d7de; border-radius: 16px; padding: 1rem; display: grid; gap: 0.75rem;">
		<h2 style="margin: 0; font-size: 1rem;">Customer invites</h2>
		{#if data.invites.length === 0}
			<p style="margin: 0; color: #57606a; font-size: 0.9rem;">No invites sent yet.</p>
		{/if}
		<div style="display: grid; gap: 0.5rem;">
			{#each data.invites as invite (invite.id)}
				<div style="padding: 0.75rem; border-radius: 12px; background: #f6f8fa; border: 1px solid #d0d7de; display: flex; justify-content: space-between; gap: 1rem; align-items: center; flex-wrap: wrap;">
					<div>
						<strong>{invite.customerEmail}</strong>
						<div style="font-size: 0.85rem; color: #57606a;">{inviteLabel(invite.status, invite.expiresAt)} · expires {new Date(invite.expiresAt).toLocaleString()}</div>
					</div>
					<div style="display: flex; gap: 0.5rem;">
						<form method="POST" action="?/resendInvite" use:enhance>
							<input type="hidden" name="inviteId" value={invite.id} />
							<button type="submit" style="padding: 0.4rem 0.7rem; border-radius: 999px; border: 1px solid #0969da; background: none; cursor: pointer;">Resend</button>
						</form>
						{#if invite.status === 'pending'}
							<form method="POST" action="?/revokeInvite" use:enhance>
								<input type="hidden" name="inviteId" value={invite.id} />
								<button type="submit" style="padding: 0.4rem 0.7rem; border-radius: 999px; border: 1px solid #cf222e; color: #cf222e; background: none; cursor: pointer;">Revoke</button>
							</form>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</section>
</div>
