<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { PROJECT_TYPES, QUICK_UPDATE_STATES } from '$lib/crm';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Seed the filter from the URL once; the contractor toggles it thereafter.
	let filter = $state<'all' | 'due'>(untrack(() => (data.initialFilter === 'due' ? 'due' : 'all')));
	const visibleOrders = $derived(
		filter === 'due' ? data.orders.filter((o) => o.followUpDue) : data.orders
	);
	const dueCount = $derived(data.orders.filter((o) => o.followUpDue).length);

	let confirmingDeleteOrderId: string | null = $state(null);

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

	const field = 'padding: 0.5rem; border-radius: 8px; border: 1px solid #d0d7de; font-size: 1rem;';
	const pill =
		'padding: 0.4rem 0.75rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer; font-size: 0.85rem;';
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

	<div style="display: flex; gap: 0.5rem;">
		<button
			type="button"
			onclick={() => (filter = 'all')}
			style="{pill} {filter === 'all'
				? 'background: #0969da; color: #fff; border-color: #0969da;'
				: ''}">All orders</button
		>
		<button
			type="button"
			onclick={() => (filter = 'due')}
			style="{pill} {filter === 'due'
				? 'background: #0969da; color: #fff; border-color: #0969da;'
				: ''}">Follow-ups due{dueCount > 0 ? ` (${dueCount})` : ''}</button
		>
	</div>

	<section style="display: grid; gap: 0.75rem;">
		{#if visibleOrders.length === 0}
			<p style="color: #57606a;">
				{filter === 'due' ? 'Nothing due right now.' : 'No orders yet — start one with New Order.'}
			</p>
		{/if}

		{#each visibleOrders as order (order.id)}
			<article
				style="border: 1px solid #d0d7de; border-radius: 16px; padding: 1rem; display: grid; gap: 0.65rem;"
			>
				<div style="display: flex; justify-content: space-between; gap: 1rem; align-items: start;">
					<div>
						<strong>{order.projectName ?? 'Untitled project'}</strong>
						{#if order.projectType}<span style="color: #57606a;"> · {order.projectType}</span>{/if}
						<div style="font-size: 0.9rem; color: #57606a;">
							{order.customerName} · {order.state} · customer sees “{order.customerVisibleState}”
						</div>
					</div>
					<div style="display: flex; gap: 0.5rem; align-items: center;">
						{#if order.followUpDue}
							<span
								style="font-size: 0.75rem; color: #9a6700; border: 1px solid #d4a72c; border-radius: 999px; padding: 0.05rem 0.5rem;"
								>Follow up</span
							>
						{/if}
						<button
							type="button"
							title="Delete order"
							aria-label="Delete order"
							onclick={() => (confirmingDeleteOrderId = order.id)}
							style="border: none; background: none; cursor: pointer; font-size: 1rem; line-height: 1; color: #cf222e; padding: 0.2rem 0.35rem;"
							>🗑</button
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
				<div
					style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; font-size: 0.9rem;"
				>
					<span style="color: #57606a;"
						>Follow-up: <strong>{fmtDate(order.nextFollowUpAt)}</strong></span
					>
					<form
						method="POST"
						action="?/setFollowUp"
						use:enhance
						style="display: flex; gap: 0.35rem; align-items: center;"
					>
						<input type="hidden" name="orderId" value={order.id} />
						<input
							type="date"
							name="date"
							value={toDateInput(order.nextFollowUpAt)}
							style={field}
						/>
						<button type="submit" style={pill}>Set</button>
					</form>
					<form method="POST" action="?/snoozeFollowUp" use:enhance>
						<input type="hidden" name="orderId" value={order.id} />
						<button type="submit" name="preset" value="1d" style={pill}>+1d</button>
					</form>
					<form method="POST" action="?/snoozeFollowUp" use:enhance>
						<input type="hidden" name="orderId" value={order.id} />
						<button type="submit" name="preset" value="3d" style={pill}>+3d</button>
					</form>
					<form method="POST" action="?/snoozeFollowUp" use:enhance>
						<input type="hidden" name="orderId" value={order.id} />
						<button type="submit" name="preset" value="1w" style={pill}>+1w</button>
					</form>
					{#if order.nextFollowUpAt}
						<form method="POST" action="?/clearFollowUp" use:enhance>
							<input type="hidden" name="orderId" value={order.id} />
							<button type="submit" style="{pill} color: #cf222e;">Clear</button>
						</form>
					{/if}
				</div>

				<!-- Quick status update -->
				<form
					method="POST"
					action="?/quickUpdate"
					use:enhance
					style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;"
				>
					<input type="hidden" name="orderId" value={order.id} />
					<select name="state" style={field}>
						{#each QUICK_UPDATE_STATES as s (s)}
							<option value={s} selected={s === order.state}>{s}</option>
						{/each}
					</select>
					<input name="note" placeholder="Add note" style="flex: 1; min-width: 120px; {field}" />
					<button
						type="submit"
						style="padding: 0.5rem 0.9rem; border-radius: 999px; border: 1px solid #0969da; background: #0969da; color: #fff; cursor: pointer;"
						>Update</button
					>
				</form>

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

				{#if order.customerId}
					<form method="POST" action="?/sendInvite" use:enhance>
						<input type="hidden" name="customerId" value={order.customerId} />
						<button type="submit" style={pill}>Invite Customer ({order.customerEmail})</button>
					</form>
				{/if}
			</article>
		{/each}
	</section>
</div>

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
