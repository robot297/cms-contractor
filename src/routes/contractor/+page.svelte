<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { QUICK_UPDATE_STATES } from '$lib/crm';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type View = 'follow-ups' | 'active';
	let view = $state<View>('follow-ups');
	let showNotifications = $state(false);
	let confirmingDeleteOrderId: string | null = $state(null);
	let confirmingDeleteInviteId: string | null = $state(null);

	let newOrderDialog: HTMLDialogElement | undefined = $state();
	let orderCustomerQuery = $state('');

	const unread = $derived(data.notifications.filter((n) => n.unread).length);
	const highPending = $derived(
		data.notifications.filter((n) => n.unread && n.priority === 'high').length
	);
	const visibleOrders = $derived(
		view === 'follow-ups' ? data.orders.filter((o) => o.needsAttention) : data.orders
	);
	const orderCustomers = $derived.by(() => {
		const q = orderCustomerQuery.trim().toLowerCase();
		if (q === '') return data.customers;
		return data.customers.filter((c) => c.name.toLowerCase().includes(q) || c.email.includes(q));
	});

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
		<h1 style="margin: 0;">Follow-ups</h1>
		<div style="display: flex; gap: 0.5rem; align-items: center;">
			<button
				type="button"
				onclick={() => newOrderDialog?.showModal()}
				style="padding: 0.45rem 0.95rem; border-radius: 999px; border: 1px solid #0969da; background: #0969da; color: #fff; cursor: pointer; font-weight: 600;"
				>＋ New Order</button
			>

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
						style="position: absolute; right: 0; top: calc(100% + 0.4rem); z-index: 20; width: min(340px, 90vw); background: #fff; border: 1px solid #d0d7de; border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,0.15); padding: 0.75rem; display: grid; gap: 0.6rem; max-height: 60vh; overflow: auto;"
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
		</div>
	</header>

	<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
		<button
			type="button"
			onclick={() => (view = 'follow-ups')}
			style="padding: 0.5rem 0.75rem; border-radius: 999px; border: 1px solid #d0d7de; background: {view ===
			'follow-ups'
				? '#0969da'
				: '#f6f8fa'}; color: {view === 'follow-ups' ? '#fff' : 'inherit'};"
			>Today’s follow-ups</button
		>
		<button
			type="button"
			onclick={() => (view = 'active')}
			style="padding: 0.5rem 0.75rem; border-radius: 999px; border: 1px solid #d0d7de; background: {view ===
			'active'
				? '#0969da'
				: '#f6f8fa'}; color: {view === 'active' ? '#fff' : 'inherit'};">All active orders</button
		>
	</div>

	<!-- Orders -->
	<section style="display: grid; gap: 0.75rem;">
		{#if visibleOrders.length === 0}
			<p style="color: #57606a;">No {view === 'follow-ups' ? 'follow-ups' : 'orders'} right now.</p>
		{/if}
		{#each visibleOrders as order (order.id)}
			<article
				style="border: 1px solid #d0d7de; border-radius: 16px; padding: 1rem; display: grid; gap: 0.75rem;"
			>
				<div style="display: flex; justify-content: space-between; gap: 1rem; align-items: center;">
					<div>
						<strong>{order.customerName}</strong>
						<div style="font-size: 0.9rem; color: #57606a;">
							{order.state} · customer sees “{order.customerVisibleState}”
						</div>
					</div>
					<div style="display: flex; gap: 0.5rem; align-items: center;">
						{#if order.needsAttention}
							<span style="font-size: 0.85rem; color: #cf222e;">Needs attention</span>
						{/if}
						<button
							type="button"
							title="Delete order"
							aria-label="Delete order"
							onclick={() => (confirmingDeleteOrderId = order.id)}
							style="border: none; background: none; cursor: pointer; font-size: 1rem; line-height: 1; color: #cf222e; padding: 0.2rem 0.35rem; border-radius: 6px;"
							>🗑</button
						>
					</div>
				</div>

				{#if confirmingDeleteOrderId === order.id}
					<div
						style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; background: #fff8f8; border: 1px solid #ffd7d5; border-radius: 10px; padding: 0.5rem 0.7rem;"
					>
						<span style="font-size: 0.85rem; color: #57606a; flex: 1; min-width: 160px;"
							>Delete this order? This permanently removes its timeline and can’t be undone.</span
						>
						<form
							method="POST"
							action="?/deleteOrder"
							use:enhance={() =>
								async ({ update }) => {
									confirmingDeleteOrderId = null;
									await update();
								}}
						>
							<input type="hidden" name="orderId" value={order.id} />
							<button
								type="submit"
								style="padding: 0.35rem 0.75rem; border-radius: 999px; border: 1px solid #cf222e; background: #cf222e; color: #fff; cursor: pointer;"
								>Yes, delete</button
							>
						</form>
						<button
							type="button"
							onclick={() => (confirmingDeleteOrderId = null)}
							style="padding: 0.35rem 0.75rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer;"
							>Cancel</button
						>
					</div>
				{/if}

				<form
					method="POST"
					action="?/quickUpdate"
					use:enhance
					style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;"
				>
					<input type="hidden" name="orderId" value={order.id} />
					<select
						name="state"
						style="padding: 0.5rem; border-radius: 8px; border: 1px solid #d0d7de;"
					>
						{#each QUICK_UPDATE_STATES as s (s)}
							<option value={s} selected={s === order.state}>{s}</option>
						{/each}
					</select>
					<input
						name="note"
						placeholder="Optional note"
						style="flex: 1; min-width: 120px; padding: 0.5rem; border-radius: 8px; border: 1px solid #d0d7de;"
					/>
					<button
						type="submit"
						style="padding: 0.5rem 0.9rem; border-radius: 999px; border: 1px solid #0969da; background: #0969da; color: #fff; cursor: pointer;"
						>Quick update</button
					>
				</form>

				{#if order.customerId}
					<form
						method="POST"
						action="?/sendInvite"
						use:enhance
						style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;"
					>
						<input type="hidden" name="customerId" value={order.customerId} />
						<span style="flex: 1; min-width: 140px; font-size: 0.9rem; color: #57606a;"
							>{order.customerEmail}</span
						>
						<button
							type="submit"
							style="padding: 0.5rem 0.9rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer;"
							>Invite customer</button
						>
					</form>
				{/if}
			</article>
		{/each}
	</section>

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
								style="border: none; background: none; cursor: pointer; font-size: 1rem; line-height: 1; color: #cf222e; padding: 0.2rem 0.35rem; border-radius: 6px;"
								>🗑</button
							>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</section>
</div>

<!-- New order modal: pick a customer to open an order for -->
<dialog
	bind:this={newOrderDialog}
	style="border: none; border-radius: 16px; padding: 0; max-width: 480px; width: 92vw; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);"
>
	<div style="display: grid; gap: 0.75rem; padding: 1.25rem;">
		<div style="display: flex; justify-content: space-between; align-items: center;">
			<h2 style="margin: 0; font-size: 1.1rem;">New order</h2>
			<button
				type="button"
				onclick={() => newOrderDialog?.close()}
				style="border: none; background: none; font-size: 1.2rem; cursor: pointer; color: #57606a;"
				>✕</button
			>
		</div>

		{#if data.customers.length === 0}
			<p style="margin: 0; color: #57606a;">
				You have no customers yet.
				<a href={resolve('/contractor/customers')} style="color: #0969da;">Add a customer</a> first, then
				start an order for them.
			</p>
		{:else}
			<input
				value={orderCustomerQuery}
				oninput={(e) => (orderCustomerQuery = e.currentTarget.value)}
				placeholder="Search your customers"
				style="padding: 0.5rem; border-radius: 8px; border: 1px solid #d0d7de;"
			/>
			<div style="display: grid; gap: 0.4rem; max-height: 50vh; overflow: auto;">
				{#each orderCustomers as c (c.id)}
					<form
						method="POST"
						action="?/createOrder"
						use:enhance={() =>
							async ({ result, update }) => {
								await update();
								if (result.type === 'success') {
									orderCustomerQuery = '';
									newOrderDialog?.close();
								}
							}}
					>
						<input type="hidden" name="customerId" value={c.id} />
						<button
							type="submit"
							style="width: 100%; text-align: left; padding: 0.6rem 0.75rem; border-radius: 10px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer; display: flex; justify-content: space-between; gap: 0.75rem; align-items: center;"
						>
							<span><strong>{c.name}</strong> · {c.email}</span>
							<span style="color: #0969da; white-space: nowrap;">Create order →</span>
						</button>
					</form>
				{/each}
				{#if orderCustomers.length === 0}
					<p style="margin: 0; color: #57606a; font-size: 0.9rem;">
						No customers match that search.
					</p>
				{/if}
			</div>
		{/if}
	</div>
</dialog>
