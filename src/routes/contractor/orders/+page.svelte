<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { PROJECT_TYPES } from '$lib/crm';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type OrderView = (typeof data.orders)[number];

	// Which lifecycle bucket is shown. Active is the working list; completed and
	// cancelled orders move out of the way into their own views.
	const VIEWS = ['active', 'completed', 'cancelled'] as const;
	const VIEW_LABELS = { active: 'Active', completed: 'Completed', cancelled: 'Cancelled' } as const;
	let view = $state<(typeof VIEWS)[number]>(untrack(() => data.initialView ?? 'active'));

	// Sort by follow-up attention: overdue first, upcoming next, no-date last.
	function byAttention(a: OrderView, b: OrderView): number {
		const av = a.nextFollowUpAt ? new Date(a.nextFollowUpAt).getTime() : Infinity;
		const bv = b.nextFollowUpAt ? new Date(b.nextFollowUpAt).getTime() : Infinity;
		return av - bv;
	}

	const buckets = $derived.by(() => {
		const active: OrderView[] = [];
		const completed: OrderView[] = [];
		const cancelled: OrderView[] = [];
		for (const o of data.orders) {
			if (o.state === 'Work Complete') completed.push(o);
			else if (o.state === 'Work Cancelled') cancelled.push(o);
			else active.push(o);
		}
		// data.orders arrives newest-first — right for the completed/cancelled
		// archives; the active list is re-sorted by follow-up urgency instead.
		active.sort(byAttention);
		return { active, completed, cancelled };
	});
	const visibleOrders = $derived(buckets[view]);

	let confirmingDeleteOrderId: string | null = $state(null);
	// Which order's follow-up "Snooze" menu is expanded (one at a time).
	let snoozeOpenId: string | null = $state(null);
	// Which order's overflow (⋯) menu is open, and which has its note field open.
	let menuOpenId: string | null = $state(null);
	let noteOpenId: string | null = $state(null);
	// Close the snooze menu once a follow-up change is submitted.
	const snoozeThenClose = () =>
		async ({ update }: { update: () => Promise<void> }) => {
			snoozeOpenId = null;
			await update();
		};
	// Close & reset the note field after it's submitted.
	const noteThenClose = () =>
		async ({ update }: { update: () => Promise<void> }) => {
			noteOpenId = null;
			await update();
		};

	// Contact dialog, driven off the already-loaded customer directory.
	let customerDialog: HTMLDialogElement | undefined = $state();
	let customerDetail: (typeof data.customers)[number] | null = $state(null);
	function openContact(id: string | null) {
		customerDetail = id ? (data.customers.find((c) => c.id === id) ?? null) : null;
		if (customerDetail) customerDialog?.showModal();
	}
	// Digits-only form of a phone number for a tel: link.
	const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

	// New order modal
	let newOrderDialog: HTMLDialogElement | undefined = $state();
	let projectType = $state('');
	let customerQuery = $state('');
	const modalCustomers = $derived.by(() => {
		const q = customerQuery.trim().toLowerCase();
		if (q === '') return data.customers;
		return data.customers.filter((c) => c.name.toLowerCase().includes(q) || c.email.includes(q));
	});

	function openNewOrder() {
		projectType = '';
		customerQuery = '';
		newOrderDialog?.showModal();
	}

	function toDateInput(d: Date | string | null): string {
		if (!d) return '';
		return new Date(d).toISOString().slice(0, 10);
	}
	function fmtDate(d: Date | string | null): string {
		return d ? new Date(d).toLocaleDateString() : '—';
	}

	// Show the project type only when the name doesn't already say it, so
	// "Poolside Pergola" + type "Pergola" reads as one line, not "… · Pergola".
	function typeSuffix(name: string | null, type: string | null): string | null {
		if (!type) return null;
		if (name && name.toLowerCase().includes(type.toLowerCase())) return null;
		return type;
	}

	// Status badge colour by health: green = on track / done, amber = waiting or
	// stuck, red = cancelled.
	const STATUS_GO = { bg: '#e6f4ea', border: '#4ea866', fg: '#1a7f37' };
	const STATUS_WAIT = { bg: '#fff4d6', border: '#d4a72c', fg: '#8a5a00' };
	const STATUS_STOP = { bg: '#ffebe9', border: '#e5534b', fg: '#cf222e' };
	function statusBadge(state: string) {
		switch (state) {
			case 'In Progress':
			case 'Work Scheduled':
			case 'Parts Ordered':
			case 'Work Complete':
				return STATUS_GO;
			case 'Work Cancelled':
				return STATUS_STOP;
			default:
				// Inquiry, Quote Sent, Deposit/Final Payment Pending, On Hold / Archived
				return STATUS_WAIT;
		}
	}

	const field = 'padding: 0.5rem; border-radius: 8px; border: 1px solid #d0d7de; font-size: 1rem;';
	const pill =
		'padding: 0.4rem 0.75rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer; font-size: 0.85rem;';
	const primaryBtn =
		'padding: 0.5rem 0.9rem; border-radius: 999px; border: 1px solid #0969da; background: #0969da; color: #fff; cursor: pointer; font-weight: 500;';
	const iconBtn =
		'width: 2.4rem; height: 2.4rem; display: inline-flex; align-items: center; justify-content: center; border: 2px solid #111; background: #fff; border-radius: 12px; cursor: pointer; font-size: 1.2rem; line-height: 1; box-shadow: 2px 2px 0 #111;';
	const menuItem =
		'display: block; width: 100%; text-align: left; padding: 0.55rem 0.8rem; border: none; background: none; cursor: pointer; font-size: 0.9rem; color: inherit;';
</script>

<svelte:head>
	<title>Orders</title>
</svelte:head>

<div style="max-width: 860px; margin: 0 auto; padding: 1rem; display: grid; gap: 1rem;">
	<header style="display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
		<h1 style="margin: 0;">Orders</h1>
		<button
			type="button"
			onclick={openNewOrder}
			style="padding: 0.45rem 0.95rem; border-radius: 999px; border: 1px solid #0969da; background: #0969da; color: #fff; cursor: pointer; font-weight: 600;"
			>＋ New Order</button
		>
	</header>

	<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
		{#each VIEWS as key (key)}
			<button
				type="button"
				onclick={() => (view = key)}
				style="{pill} {view === key
					? 'background: #0969da; color: #fff; border-color: #0969da;'
					: ''}">{VIEW_LABELS[key]} ({buckets[key].length})</button
			>
		{/each}
	</div>

	<section style="display: grid; gap: 0.75rem;">
		{#if visibleOrders.length === 0}
			<p style="color: #57606a;">
				{view === 'active'
					? 'No active orders — start one with New Order.'
					: view === 'completed'
						? 'No completed orders yet.'
						: 'No cancelled orders.'}
			</p>
		{/if}

		{#each visibleOrders as order (order.id)}
			{@const badge = statusBadge(order.state)}
			<article
				style="border: 1px solid #d0d7de; border-radius: 16px; padding: 1rem 1.1rem; display: grid; gap: 0.85rem;"
			>
				<!-- Header: customer name leads, project subtitle; health badges on the right -->
				<div style="display: flex; justify-content: space-between; gap: 1rem; align-items: start;">
					<div style="display: grid; gap: 0.15rem; min-width: 0;">
						<a
							href={`/contractor/orders/${order.id}`}
							style="font-size: 1.3rem; font-weight: 800; color: inherit; text-decoration: none; line-height: 1.15;"
						>
							{order.customerName}
						</a>
						<div style="font-size: 0.9rem; color: #57606a;">
							{order.projectName ?? 'Untitled project'}{#if typeSuffix(order.projectName, order.projectType)} · {typeSuffix(
									order.projectName,
									order.projectType
								)}{/if}
						</div>
					</div>

					<div style="display: flex; gap: 0.4rem; align-items: center; flex-shrink: 0;">
						{#if order.followUpDue}
							<span
								style="font-size: 0.72rem; color: #9a6700; background: #fff8e6; border: 1px solid #d4a72c; border-radius: 999px; padding: 0.1rem 0.55rem; white-space: nowrap;"
								>Due</span
							>
						{/if}
						<span
							style="font-size: 0.78rem; font-weight: 700; white-space: nowrap; color: {badge.fg}; background: {badge.bg}; border: 1.5px solid {badge.border}; border-radius: 999px; padding: 0.15rem 0.65rem;"
							>{order.state}</span
						>
					</div>
				</div>

				{#if confirmingDeleteOrderId === order.id}
					<div
						style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; background: #fff8f8; border: 1px solid #ffd7d5; border-radius: 10px; padding: 0.5rem 0.7rem;"
					>
						<span style="font-size: 0.85rem; color: #57606a; flex: 1; min-width: 160px;"
							>Delete this order? Its timeline is removed and can’t be undone.</span
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

				<!-- Follow-up -->
				<div style="display: grid; gap: 0.5rem;">
					<div
						style="display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; font-size: 0.9rem;"
					>
						<span style="color: #57606a;"
							>Next follow-up: <strong style="color: #1f2328;"
								>{fmtDate(order.nextFollowUpAt)}</strong
							></span
						>
						<button
							type="button"
							aria-expanded={snoozeOpenId === order.id}
							onclick={() => (snoozeOpenId = snoozeOpenId === order.id ? null : order.id)}
							style={pill}>Snooze ▾</button
						>
					</div>

					{#if snoozeOpenId === order.id}
						<div
							style="display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; background: #f6f8fa; border: 1px solid #eaeef2; border-radius: 10px; padding: 0.55rem 0.65rem;"
						>
							<form method="POST" action="?/snoozeFollowUp" use:enhance={snoozeThenClose}>
								<input type="hidden" name="orderId" value={order.id} />
								<button type="submit" name="preset" value="1d" style={pill}>+1 day</button>
							</form>
							<form method="POST" action="?/snoozeFollowUp" use:enhance={snoozeThenClose}>
								<input type="hidden" name="orderId" value={order.id} />
								<button type="submit" name="preset" value="3d" style={pill}>+3 days</button>
							</form>
							<form method="POST" action="?/snoozeFollowUp" use:enhance={snoozeThenClose}>
								<input type="hidden" name="orderId" value={order.id} />
								<button type="submit" name="preset" value="1w" style={pill}>+1 week</button>
							</form>
							<span style="width: 1px; height: 20px; background: #d0d7de;"></span>
							<form
								method="POST"
								action="?/setFollowUp"
								use:enhance={snoozeThenClose}
								style="display: flex; gap: 0.35rem; align-items: center;"
							>
								<input type="hidden" name="orderId" value={order.id} />
								<input
									type="date"
									name="date"
									value={toDateInput(order.nextFollowUpAt)}
									style={field}
								/>
								<button type="submit" style={pill}>Set date</button>
							</form>
							{#if order.nextFollowUpAt}
								<form method="POST" action="?/clearFollowUp" use:enhance={snoozeThenClose}>
									<input type="hidden" name="orderId" value={order.id} />
									<button type="submit" style="{pill} color: #cf222e;">Clear</button>
								</form>
							{/if}
						</div>
					{/if}

					{#if noteOpenId === order.id}
						<form
							method="POST"
							action="?/addNote"
							use:enhance={noteThenClose}
							style="display: flex; gap: 0.5rem; align-items: center;"
						>
							<input type="hidden" name="orderId" value={order.id} />
							<input
								name="note"
								placeholder="Add an internal note…"
								required
								style="flex: 1; min-width: 140px; {field}"
							/>
							<button type="submit" style={primaryBtn}>Add</button>
						</form>
					{/if}
				</div>

				{#if (data.notesByOrder[order.id] ?? []).length > 0}
					<details style="font-size: 0.85rem;">
						<summary style="cursor: pointer; color: #57606a;"
							>Internal notes ({data.notesByOrder[order.id].length})</summary
						>
						<div style="display: grid; gap: 0.4rem; margin-top: 0.4rem;">
							{#each data.notesByOrder[order.id] as note (note.id)}
								<div
									style="padding: 0.5rem 0.6rem; border-radius: 8px; background: #f6f8fa; border: 1px solid #eaeef2;"
								>
									<div style="white-space: pre-wrap;">{note.detail}</div>
									<div style="font-size: 0.75rem; color: #8c959f; margin-top: 0.2rem;">
										{new Date(note.createdAt).toLocaleString()} · internal
									</div>
								</div>
							{/each}
						</div>
					</details>
				{/if}

				<!-- Action bar: chunky icon buttons, bottom-right -->
				<div style="display: flex; gap: 0.5rem; justify-content: flex-end; align-items: center;">
					{#if order.customerId}
						<button
							type="button"
							title="Contact customer"
							aria-label="Contact customer"
							onclick={() => openContact(order.customerId)}
							style={iconBtn}>✉️</button
						>
					{/if}
					<button
						type="button"
						title="Add note"
						aria-label="Add note"
						aria-expanded={noteOpenId === order.id}
						onclick={() => (noteOpenId = noteOpenId === order.id ? null : order.id)}
						style={iconBtn}>📝</button
					>
					<div style="position: relative;">
						<button
							type="button"
							title="More actions"
							aria-label="More actions"
							aria-expanded={menuOpenId === order.id}
							onclick={() => (menuOpenId = menuOpenId === order.id ? null : order.id)}
							style={iconBtn}>⋯</button
						>
						{#if menuOpenId === order.id}
							<!-- click-away backdrop -->
							<button
								type="button"
								aria-label="Close menu"
								onclick={() => (menuOpenId = null)}
								style="position: fixed; inset: 0; z-index: 10; background: transparent; border: none; cursor: default;"
							></button>
							<!-- opens upward since the bar sits at the card bottom -->
							<div
								style="position: absolute; right: 0; bottom: calc(100% + 6px); z-index: 20; min-width: 180px; background: #fff; border: 2px solid #111; border-radius: 10px; box-shadow: 4px 4px 0 #111; overflow: hidden; display: grid;"
							>
								<a
									href={`/contractor/orders/${order.id}`}
									style="{menuItem} text-decoration: none;">View details</a
								>
								{#if order.customerId}
									<form
										method="POST"
										action="?/sendInvite"
										use:enhance={() => {
											menuOpenId = null;
											return async ({ update }) => await update();
										}}
									>
										<input type="hidden" name="customerId" value={order.customerId} />
										<button type="submit" style={menuItem}>Invite customer</button>
									</form>
								{/if}
								<button
									type="button"
									onclick={() => {
										confirmingDeleteOrderId = order.id;
										menuOpenId = null;
									}}
									style="{menuItem} color: #cf222e; border-top: 1px solid #eaeef2;">Delete order</button
								>
							</div>
						{/if}
					</div>
				</div>
			</article>
		{/each}
	</section>
</div>

<!-- Contact dialog -->
<dialog
	bind:this={customerDialog}
	style="border: none; border-radius: 16px; padding: 0; max-width: 420px; width: 92vw; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);"
>
	{#if customerDetail}
		{@const c = customerDetail}
		<div style="display: grid; gap: 0.7rem; padding: 1.25rem;">
			<div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
				<h2 style="margin: 0; font-size: 1.1rem;">{c.name}</h2>
				<button
					type="button"
					onclick={() => customerDialog?.close()}
					style="border: none; background: none; font-size: 1.2rem; cursor: pointer; color: #57606a;"
					>✕</button
				>
			</div>
			<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
				<a
					href={`mailto:${c.email}`}
					style="padding: 0.5rem 0.9rem; border-radius: 999px; border: 1px solid #0969da; background: #0969da; color: #fff; text-decoration: none; font-weight: 500;"
					>✉️ Email</a
				>
				{#if c.phone}
					<a
						href={telHref(c.phone)}
						style="padding: 0.5rem 0.9rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; color: inherit; text-decoration: none;"
						>📞 Call</a
					>
				{/if}
			</div>
			<div style="display: grid; gap: 0.4rem; font-size: 0.9rem;">
				<div style="word-break: break-word;">
					<span style="color: #57606a;">Email:</span> {c.email}
				</div>
				{#if c.phone}<div><span style="color: #57606a;">Phone:</span> {c.phone}</div>{/if}
				{#if c.address}<div><span style="color: #57606a;">Address:</span> {c.address}</div>{/if}
				{#if c.tags.length > 0}
					<div style="display: flex; gap: 0.35rem; flex-wrap: wrap; margin-top: 0.2rem;">
						{#each c.tags as tag (tag)}
							<span
								style="font-size: 0.75rem; background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 999px; padding: 0.1rem 0.55rem;"
								>{tag}</span
							>
						{/each}
					</div>
				{/if}
				{#if c.notes}
					<div style="margin-top: 0.3rem; color: #57606a; white-space: pre-wrap;">{c.notes}</div>
				{/if}
			</div>
			<a
				href={resolve('/contractor/customers')}
				style="justify-self: start; font-size: 0.85rem; color: #0969da;">Manage in customers →</a
			>
		</div>
	{/if}
</dialog>

<!-- New order modal -->
<dialog
	bind:this={newOrderDialog}
	style="border: none; border-radius: 16px; padding: 0; max-width: 480px; width: 92vw; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);"
>
	<div style="display: grid; gap: 0.7rem; padding: 1.25rem;">
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
				You have no customers yet. <a
					href={resolve('/contractor/customers')}
					style="color: #0969da;">Add a customer</a
				> first.
			</p>
		{:else}
			<form
				method="POST"
				action="?/createOrder"
				use:enhance={() =>
					async ({ result, update }) => {
						await update();
						if (result.type === 'success') newOrderDialog?.close();
					}}
				style="display: grid; gap: 0.7rem;"
			>
				<label style="display: grid; gap: 0.2rem; font-size: 0.85rem; color: #57606a;">
					Project name
					<input name="projectName" required style={field} />
				</label>

				<label style="display: grid; gap: 0.2rem; font-size: 0.85rem; color: #57606a;">
					Customer
					<input
						value={customerQuery}
						oninput={(e) => (customerQuery = e.currentTarget.value)}
						placeholder="Search customers"
						style={field}
					/>
					<select name="customerId" required style={field}>
						<option value="" disabled selected={!data.presetCustomerId}>Choose a customer…</option>
						{#each modalCustomers as c (c.id)}
							<option value={c.id} selected={c.id === data.presetCustomerId}
								>{c.name} · {c.email}</option
							>
						{/each}
					</select>
				</label>

				<label style="display: grid; gap: 0.2rem; font-size: 0.85rem; color: #57606a;">
					Project type
					<select name="projectType" bind:value={projectType} required style={field}>
						<option value="" disabled>Choose a type…</option>
						{#each PROJECT_TYPES as t (t)}
							<option value={t}>{t}</option>
						{/each}
						<option value="Other">Other…</option>
					</select>
				</label>
				{#if projectType === 'Other'}
					<input
						name="projectTypeOther"
						placeholder="Describe the structure"
						required
						style={field}
					/>
				{/if}

				{#if form?.action === 'create' && form?.message}
					<p style="margin: 0; color: #cf222e; font-size: 0.85rem;">{form.message}</p>
				{/if}

				<div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
					<button
						type="button"
						onclick={() => newOrderDialog?.close()}
						style="padding: 0.55rem 1rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer;"
						>Cancel</button
					>
					<button
						type="submit"
						style="padding: 0.55rem 1.1rem; border-radius: 999px; border: 1px solid #0969da; background: #0969da; color: #fff; cursor: pointer; font-weight: 600;"
						>Create order</button
					>
				</div>
			</form>
		{/if}
	</div>
</dialog>
