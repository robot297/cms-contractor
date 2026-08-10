<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { slide } from 'svelte/transition';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { customerLocation, PROJECT_TYPES } from '$lib/crm';
	import TagPicker from '$lib/TagPicker.svelte';
	import ContactComposer from '$lib/ContactComposer.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Trial capacity, from the contractor layout. Null once they're on a paid or
	// comped subscription, which are uncapped.
	const atOrderLimit = $derived(data.billing.limits?.order.atLimit ?? false);

	type OrderView = (typeof data.orders)[number];
	type NoteView = (typeof data.notesByOrder)[string][number];

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
	// Which order's overflow (⋯) menu is open, and which has its note field open.
	let menuOpenId: string | null = $state(null);
	let noteOpenId: string | null = $state(null);
	// The lifecycle filter is a single button that opens a small menu.
	let viewMenuOpen = $state(false);
	// Close & reset the note field after it's submitted.
	const noteThenClose =
		() =>
		async ({ update }: { update: () => Promise<void> }) => {
			noteOpenId = null;
			await update();
		};

	// Contact dialog, driven off the already-loaded customer directory. The body
	// is the shared ContactComposer (message + channel picker).
	let customerDialog: HTMLDialogElement | undefined = $state();
	let customerDetail: (typeof data.customers)[number] | null = $state(null);
	// The project of the order the composer was opened from, so `{{project}}`
	// resolves in email templates.
	let contactProject = $state<string | null>(null);
	// And the order itself, so a successful send is recorded on its timeline.
	let contactOrderId = $state<string | null>(null);
	// The customer's contact details (email/phone/address/notes), folded behind the
	// ⓘ next to their name — composing is the dialog's job; the details are lookup.
	let contactInfoOpen = $state(false);
	function openContact(
		id: string | null,
		project: string | null = null,
		orderId: string | null = null
	) {
		customerDetail = id ? (data.customers.find((c) => c.id === id) ?? null) : null;
		contactProject = project;
		contactOrderId = orderId;
		contactInfoOpen = false;
		if (customerDetail) customerDialog?.showModal();
	}

	// New order modal
	let newOrderDialog: HTMLDialogElement | undefined = $state();
	let projectType = $state('');

	/** "Dana Whitfield — Austin, TX", falling back to the bare name. */
	function customerLabel(c: {
		name: string;
		address: string | null;
		city: string | null;
		state: string | null;
	}): string {
		const where = customerLocation(c);
		return where ? `${c.name} — ${where}` : c.name;
	}

	// Still used by the inline "add note" input on each order card; the new-order
	// modal now uses the token-driven `.field` class instead.
	const field = 'padding: 0.5rem; border-radius: 8px; border: 1px solid #d0d7de; font-size: 1rem;';

	function openNewOrder() {
		projectType = '';
		newOrderDialog?.showModal();
	}

	// Open the create form on arrival in the two cases where the page has nothing
	// else to offer:
	//   - ?customer=… — "Add & create order" just made that customer and sent us here
	//     to book the work (the select preselects them via `data.presetCustomerId`).
	//   - no orders at all — which is exactly when the getting-started guide's
	//     "Create an order" step points here, mirroring the customers directory.
	// Needs a customer to exist, or the form has nothing to pick from.
	onMount(() => {
		if (data.customers.length === 0) return;
		if (data.presetCustomerId || data.orders.length === 0) newOrderDialog?.showModal();
	});

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

	const iconBtn = 'width: 2.5rem; height: 2.5rem; font-size: 1.7rem;';
	const menuItem =
		'display: block; width: 100%; text-align: left; padding: 0.55rem 0.8rem; border: none; background: none; cursor: pointer; font-size: 0.9rem; color: inherit;';
</script>

<svelte:head>
	<title>Orders</title>
</svelte:head>

<!-- Shared renderer for an order's internal-note history (used by the desktop
     disclosure and the mobile add-note panel). -->
{#snippet notesList(notes: NoteView[])}
	<div style="display: grid; gap: 0.4rem;">
		{#each notes as note (note.id)}
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
{/snippet}

<div style="max-width: 860px; margin: 0 auto; padding: 1rem; display: grid; gap: 1rem;">
	<header style="display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
		<h1 class="page-title" style="margin: 0;">Orders</h1>
		<button
			type="button"
			onclick={openNewOrder}
			style="padding: 0.45rem 0.95rem; border-radius: 999px; border: 1px solid #0969da; background: #0969da; color: #fff; cursor: pointer; font-weight: 600;"
			>＋ New Order</button
		>
	</header>

	<div class="view-filter">
		<button
			type="button"
			class="view-trigger"
			aria-expanded={viewMenuOpen}
			onclick={() => (viewMenuOpen = !viewMenuOpen)}
		>
			{VIEW_LABELS[view]}
			<span class="view-count">{buckets[view].length}</span>
			<span class="view-caret" aria-hidden="true">▾</span>
		</button>
		{#if viewMenuOpen}
			<!-- click-away backdrop -->
			<button
				type="button"
				aria-label="Close filter menu"
				onclick={() => (viewMenuOpen = false)}
				class="menu-scrim"
			></button>
			<div class="view-menu">
				{#each VIEWS as key (key)}
					<button
						type="button"
						class="view-option"
						class:selected={view === key}
						aria-current={view === key}
						onclick={() => {
							view = key;
							viewMenuOpen = false;
						}}
					>
						<span>{VIEW_LABELS[key]}</span>
						<span class="view-count">{buckets[key].length}</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<section style="display: grid; gap: 0.75rem;">
		{#if visibleOrders.length === 0}
			<!-- Just states the fact, centred. The instruction to use New Order is gone:
			     the button is right there, and with no orders the create form opens on
			     arrival anyway. -->
			<p class="empty-orders">
				{view === 'active'
					? 'No active orders found.'
					: view === 'completed'
						? 'No completed orders yet.'
						: 'No cancelled orders.'}
			</p>
		{/if}

		{#each visibleOrders as order (order.id)}
			{@const badge = statusBadge(order.state)}
			{@const where = customerLocation({
				city: order.customerCity,
				state: order.customerState,
				address: order.customerAddress
			})}
			<article class="card">
				<!-- Header: project name leads, customer + city underneath; status on the right -->
				<div style="display: flex; justify-content: space-between; gap: 1rem; align-items: start;">
					<div style="display: grid; gap: 0.15rem; min-width: 0;">
						<a href={resolve(`/contractor/orders/${order.id}`)} class="card-title">
							{order.projectName ??
								'Untitled project'}{#if typeSuffix(order.projectName, order.projectType)}<span
									class="card-type"
								>
									· {typeSuffix(order.projectName, order.projectType)}</span
								>{/if}
						</a>
						<div class="card-sub">
							{order.customerName}{#if where}
								· {where}{/if}
						</div>
						{#if order.tags.length > 0}
							<div class="tag-chips" style="margin-top: 0.15rem;">
								{#each order.tags as tag (tag)}<span class="tag-chip">{tag}</span>{/each}
							</div>
						{/if}
					</div>

					<div style="display: flex; gap: 0.4rem; align-items: center; flex-shrink: 0;">
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

				<!-- Follow-up dates are deliberately absent here: due ones surface on the
				     dashboard, which is where a contractor acts on them. -->
				<div style="display: grid; gap: 0.5rem;">
					{#if noteOpenId === order.id}
						<div class="note-panel" transition:slide={{ duration: 220 }}>
							<!-- Mobile: the disclosure below is hidden, so the note history lives
							     here alongside the add field once "Add note" is pressed. -->
							{#if (data.notesByOrder[order.id] ?? []).length > 0}
								<div class="notes-history-mobile">
									{@render notesList(data.notesByOrder[order.id])}
								</div>
							{/if}
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
								<button type="submit" class="primary-btn">Add</button>
							</form>
						</div>
					{/if}
				</div>

				{#if (data.notesByOrder[order.id] ?? []).length > 0}
					<details class="notes-disclosure" style="font-size: 0.85rem;">
						<summary style="cursor: pointer; color: #57606a;"
							>Internal notes ({data.notesByOrder[order.id].length})</summary
						>
						<div style="margin-top: 0.4rem;">
							{@render notesList(data.notesByOrder[order.id])}
						</div>
					</details>
				{/if}

				<!-- Action bar: explicit details link on the left, icon buttons on the right -->
				<div class="action-bar" style="display: flex; gap: 0.7rem; align-items: center;">
					<a
						href={resolve(`/contractor/orders/${order.id}`)}
						class="view-details-link"
						style="margin-right: auto; font-size: 0.9rem; font-weight: 600; color: #0969da; text-decoration: none; white-space: nowrap;"
						>View order details →</a
					>
					{#if order.customerId}
						<button
							type="button"
							title="Contact customer"
							aria-label="Contact customer"
							onclick={() => openContact(order.customerId, order.projectName, order.id)}
							class="icon-btn"
							style={iconBtn}>✉️</button
						>
					{/if}
					<button
						type="button"
						title="Add note"
						aria-label="Add note"
						aria-expanded={noteOpenId === order.id}
						onclick={() => (noteOpenId = noteOpenId === order.id ? null : order.id)}
						class="icon-btn {noteOpenId === order.id ? 'on' : ''}"
						style={iconBtn}>📝</button
					>
					<div style="position: relative;">
						<button
							type="button"
							title="More actions"
							aria-label="More actions"
							aria-expanded={menuOpenId === order.id}
							onclick={() => (menuOpenId = menuOpenId === order.id ? null : order.id)}
							class="icon-btn"
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
								style="position: absolute; right: 0; bottom: calc(100% + 6px); z-index: 20; min-width: 180px; background: #fff; border: 1px solid #d0d7de; border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); overflow: hidden; display: grid;"
							>
								<a
									href={resolve(`/contractor/orders/${order.id}`)}
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
									style="{menuItem} color: #cf222e; border-top: 1px solid #eaeef2;"
									>Delete order</button
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
				<div style="display: flex; align-items: center; gap: 0.5rem; min-width: 0;">
					<h2 style="margin: 0; font-size: 1.1rem; overflow-wrap: anywhere;">{c.name}</h2>
					<button
						type="button"
						class="info-btn"
						class:on={contactInfoOpen}
						title="Customer details"
						aria-label="Customer details"
						aria-expanded={contactInfoOpen}
						onclick={() => (contactInfoOpen = !contactInfoOpen)}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.2"
							stroke-linecap="round"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="10" />
							<line x1="12" y1="11" x2="12" y2="16.5" />
							<circle cx="12" cy="7.5" r="0.5" fill="currentColor" />
						</svg>
					</button>
				</div>
				<button
					type="button"
					onclick={() => customerDialog?.close()}
					style="border: none; background: none; font-size: 1.2rem; cursor: pointer; color: #57606a;"
					>✕</button
				>
			</div>
			{#if contactInfoOpen}
				<div class="contact-info" transition:slide={{ duration: 180 }}>
					<div style="word-break: break-word;">
						<span style="color: #57606a;">Email:</span>
						{c.email}
					</div>
					{#if c.phone}<div><span style="color: #57606a;">Phone:</span> {c.phone}</div>{/if}
					{#if c.address}<div><span style="color: #57606a;">Address:</span> {c.address}</div>{/if}
					{#if c.notes}
						<div style="margin-top: 0.3rem; color: #57606a; white-space: pre-wrap;">{c.notes}</div>
					{/if}
					<a
						href={resolve('/contractor/customers')}
						style="justify-self: start; font-size: 0.85rem; color: #0969da;"
						>Manage in customers →</a
					>
				</div>
			{/if}
			<ContactComposer
				customer={c}
				project={contactProject}
				orderId={contactOrderId}
				onsent={() => customerDialog?.close()}
			/>
		</div>
	{/if}
</dialog>

<!-- New order modal -->
<dialog bind:this={newOrderDialog} class="neworder">
	<div class="neworder-body">
		<div style="display: flex; justify-content: space-between; align-items: center;">
			<h2 style="margin: 0; font-size: 1.1rem;">New order</h2>
			<button
				type="button"
				onclick={() => newOrderDialog?.close()}
				style="border: none; background: none; font-size: 1.2rem; cursor: pointer; color: #57606a;"
				>✕</button
			>
		</div>

		{#if atOrderLimit}
			<p class="limit-note">
				Your trial covers {data.billing.limits?.order.limit} orders and you have {data.billing
					.limits?.order.used}. Delete an order you no longer need to free a space, or
				<a href={resolve('/contractor/billing')}>subscribe for unlimited</a>.
			</p>
		{/if}

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
				<label class="fieldset">
					Project name
					<input name="projectName" required class="field" />
				</label>

				<!-- One selector, no search box. The list is a contractor's own directory,
				     so it's short enough to scroll — and on a phone the native picker is
				     a better control than a filter box plus a dropdown. Shows where the
				     job is rather than an email, which is what tells two customers apart
				     at a glance. -->
				<label class="fieldset">
					Customer
					<select name="customerId" required class="field picker">
						<option value="" disabled selected={!data.presetCustomerId}>Choose a customer…</option>
						{#each data.customers as c (c.id)}
							<option value={c.id} selected={c.id === data.presetCustomerId}
								>{customerLabel(c)}</option
							>
						{/each}
					</select>
				</label>

				<label class="fieldset">
					Project type
					<select name="projectType" bind:value={projectType} required class="field picker">
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
						class="field"
					/>
				{/if}

				<TagPicker />

				{#if form?.action === 'create' && form?.message}
					<p style="margin: 0; color: #cf222e; font-size: 0.85rem;">{form.message}</p>
				{/if}

				<div class="neworder-actions">
					<button type="button" onclick={() => newOrderDialog?.close()} class="no-cancel"
						>Cancel</button
					>
					<button type="submit" class="no-submit">Create order</button>
				</div>
			</form>
		{/if}
	</div>
</dialog>

<style>
	/* ---------------------------------------------------- Lifecycle filter
	   Trigger + menu are token-driven (no inline color literals) so light and
	   dark both come out right instead of relying on the global interception
	   rules, which left the selected row a bright light-blue on dark. */
	.view-filter {
		position: relative;
		align-self: start;
	}
	.view-trigger {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.4rem 0.8rem;
		border-radius: 999px;
		border: 1px solid var(--line-strong);
		background: var(--surface);
		color: var(--fg);
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow: var(--pop-shadow-sm);
	}
	.view-trigger:hover {
		background: var(--surface-sunken);
	}
	.view-caret {
		color: var(--fg-muted);
		font-size: 0.75rem;
	}
	/* The count sits in its own chip so it reads as metadata, not part of the label. */
	.view-count {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--fg-muted);
		background: var(--surface-sunken);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.05rem 0.45rem;
	}
	.menu-scrim {
		position: fixed;
		inset: 0;
		z-index: 10;
		background: transparent;
		border: none;
		cursor: default;
	}
	.view-menu {
		position: absolute;
		left: 0;
		top: calc(100% + 6px);
		z-index: 20;
		min-width: 210px;
		display: grid;
		gap: 0.1rem;
		padding: 0.25rem;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-radius: 12px;
		box-shadow: var(--card-shadow);
	}
	.view-option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		width: 100%;
		text-align: left;
		padding: 0.5rem 0.6rem;
		border: none;
		border-radius: 8px;
		background: none;
		color: var(--fg);
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}
	.view-option:hover {
		background: var(--surface-sunken);
	}
	/* Selected row uses the app's safety-yellow accent — legible in both themes,
	   unlike the old light-blue wash. */
	.view-option.selected {
		background: var(--yellow);
		color: #14171c;
		font-weight: 800;
	}
	.view-option.selected .view-count {
		background: rgba(20, 23, 28, 0.12);
		border-color: rgba(20, 23, 28, 0.25);
		color: #14171c;
	}

	/* Active state for a toggle icon button (e.g. the note ✎ while its panel is
	   open) — a filled accent so it's clearly "on". */
	.icon-btn.on {
		background: #ece7fb;
		color: #4b2fa8;
	}
	.icon-btn.on:hover {
		background: #e2daf7;
	}
	/* Submit inside the add-note panel. Was an inline blue fill that leaned on the
	   `[style*='background: #0969da']` interception in app.css to become the theme
	   button — which never fired here, leaving one stray blue button on the page.
	   Drawn from the tokens directly instead, so it matches by construction. */
	.primary-btn {
		padding: 0.5rem 1rem;
		border-radius: 999px;
		border: none;
		/* Pinned dark: yellow stays light in both themes. */
		background: var(--yellow);
		color: #14171c;
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow: var(--pop-shadow-sm);
	}
	.primary-btn:hover {
		background: var(--yellow-deep);
	}

	/* The expanded add-note area, visually grouped so it reads as belonging to
	   the note button that opened it. */
	.note-panel {
		display: grid;
		gap: 0.5rem;
		background: #faf9ff;
		border: 1px solid #e4defb;
		border-radius: 10px;
		padding: 0.7rem;
		box-shadow: 0 2px 10px rgba(75, 47, 168, 0.07);
	}

	/* The mobile-only note history inside the add-note panel is hidden on wider
	   screens, where the disclosure below the card handles browsing instead. */
	.notes-history-mobile {
		display: none;
	}

	@media (max-width: 560px) {
		/* Declutter the card on phones: the standalone "View order details" link
		   is redundant (the customer name and the ⋯ menu both open the order),
		   and the notes disclosure gives way to the add-note panel. */
		.view-details-link {
			display: none;
		}
		/* With the details link gone, keep the icon buttons pinned to the right. */
		.action-bar {
			justify-content: flex-end;
		}
		.notes-disclosure {
			display: none;
		}
		.notes-history-mobile {
			display: block;
		}
	}

	/* Dark theme — override the hardcoded light surfaces above so they read
	   correctly under [data-theme='dark']. Only touches color-bearing rules;
	   layout/display rules above are theme-agnostic. */
	:global(:root[data-theme='dark']) .icon-btn.on {
		background: #2e2a44;
		border-color: #4a3f6b;
		color: #cabff5;
	}
	:global(:root[data-theme='dark']) .icon-btn.on:hover {
		background: #373251;
	}
	:global(:root[data-theme='dark']) .note-panel {
		background: var(--surface-sunken);
		border-color: var(--line);
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
	}

	/* ------------------------------------------------- Contact dialog details
	   The ⓘ beside the customer's name; the detail rows it reveals sit in a quiet
	   inset panel above the composer. */
	.info-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.7rem;
		height: 1.7rem;
		padding: 0;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		background: none;
		color: var(--fg-muted);
		cursor: pointer;
		transition:
			color 0.12s ease,
			background 0.12s ease,
			border-color 0.12s ease;
	}
	.info-btn:hover {
		color: var(--fg);
		background: var(--surface-sunken);
	}
	.info-btn.on,
	.info-btn.on:hover {
		background: var(--yellow);
		border-color: var(--yellow);
		color: #14171c;
	}
	.info-btn:focus-visible {
		outline: 2px solid var(--yellow);
		outline-offset: 2px;
	}
	.contact-info {
		display: grid;
		gap: 0.4rem;
		font-size: 0.9rem;
		padding: 0.7rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--surface-sunken);
	}

	/* Shown in the new-order modal when a trial has run out of order slots. */
	.limit-note {
		margin: 0;
		padding: 0.6rem 0.75rem;
		border-radius: 8px;
		border: 1.5px solid var(--yellow-deep);
		background: color-mix(in srgb, var(--yellow) 18%, var(--surface));
		color: var(--fg);
		font-size: 0.83rem;
		line-height: 1.5;
	}
	.limit-note a {
		color: inherit;
		font-weight: 700;
	}

	/* Empty list: centred in the view rather than hugging the top-left, so a page
	   with nothing on it reads as deliberate instead of broken. */
	.empty-orders {
		margin: 0;
		padding: 3rem 1rem;
		text-align: center;
		color: var(--fg-muted);
		font-size: 0.95rem;
	}

	/* ------------------------------------------------------- New order modal
	   Sized to the viewport, not to its content. The customer <select> lists
	   "Name · email@address", and inside a grid label that long option text sets
	   the column's max-content width — which is what pushed this dialog wider than
	   a phone screen. `min-width: 0` stops the intrinsic width winning, and
	   `width: 100%` + border-box keeps padding inside the box. */
	.neworder {
		border: none;
		border-radius: 16px;
		padding: 0;
		width: min(92vw, 480px);
		max-width: min(92vw, 480px);
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
	}
	.neworder-body {
		display: grid;
		gap: 0.7rem;
		padding: 1.25rem;
		box-sizing: border-box;
		/* Short screens — and the on-screen keyboard — leave very little height, so
		   scroll the form rather than clipping the submit button off the bottom. */
		max-height: min(85dvh, 40rem);
		overflow-y: auto;
	}
	.neworder-body :global(label) {
		min-width: 0;
	}
	.neworder-body :global(input),
	.neworder-body :global(select) {
		width: 100%;
		min-width: 0;
		max-width: 100%;
		box-sizing: border-box;
	}

	.neworder-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
		flex-wrap: wrap;
	}
	.neworder-actions button {
		padding: 0.55rem 1.1rem;
		border-radius: 999px;
		cursor: pointer;
		font-family: inherit;
		font-size: 0.9rem;
	}
	/* Cancel is the way out, not a peer of the submit — no fill, no border. */
	.no-cancel {
		border: none;
		background: none;
		color: var(--fg-muted);
		padding: 0.55rem 0.4rem;
		margin-right: auto;
	}
	.no-cancel:hover {
		color: var(--fg);
	}
	/* Same treatment as the page's other primary actions: yellow fill, no border.
	   (This was the page's one leftover blue button — the class escapes the
	   inline-style interception in app.css.) */
	.no-submit {
		border: none;
		background: var(--yellow);
		color: #14171c;
		font-weight: 700;
		box-shadow: var(--pop-shadow-sm);
	}
	.no-submit:hover {
		background: var(--yellow-deep);
	}
	.neworder-actions button:focus-visible {
		outline: 2px solid var(--yellow);
		outline-offset: 2px;
	}
	@media (max-width: 420px) {
		/* (0,2,0) selectors — media queries add no specificity, so a bare `.no-submit`
		   here would lose to the rules above. */
		.neworder-actions .no-submit {
			flex: 1 1 100%;
		}
		.neworder-actions .no-cancel {
			order: 1;
			flex: 0 0 auto;
			margin: 0.1rem auto 0;
		}
	}

	/* ---------------------------------------------------------- Order card head
	   Project leads, customer + city underneath. */
	.card-title {
		font-size: 1.25rem;
		font-weight: 800;
		line-height: 1.2;
		color: inherit;
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.card-title:hover {
		text-decoration: underline;
		text-decoration-color: var(--yellow-deep);
		text-decoration-thickness: 2px;
		text-underline-offset: 3px;
	}
	/* The type rides the title but shouldn't compete with it. */
	.card-type {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--fg-muted);
	}
	.card-sub {
		font-size: 0.9rem;
		color: var(--fg-muted);
		overflow-wrap: anywhere;
	}

	/* --------------------------------------------------- New order modal fields
	   Token-driven, so they follow the theme instead of the hardcoded greys the
	   old inline style used (which stayed light-on-light in dark mode). */
	.fieldset {
		display: grid;
		gap: 0.3rem;
		min-width: 0;
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--fg-muted);
	}
	.field {
		width: 100%;
		min-width: 0;
		max-width: 100%;
		box-sizing: border-box;
		/* 44px lands on the usual minimum comfortable tap target. */
		min-height: 2.75rem;
		padding: 0.55rem 0.7rem;
		border-radius: 10px;
		border: 1px solid var(--field-border);
		background: var(--field-bg);
		color: var(--fg);
		font-family: inherit;
		font-size: 1rem;
		text-transform: none;
		letter-spacing: normal;
		font-weight: 400;
	}
	.field:focus-visible {
		outline: none;
		border-color: var(--yellow-deep);
		box-shadow: 0 0 0 3px rgba(255, 204, 0, 0.22);
		background: var(--field-bg-focus);
	}
	/* Native select, restyled: keeps the OS picker on mobile (the right control on
	   a phone) while losing the default chrome. The chevron is a data-URI so it
	   needs no asset, in a mid-grey that reads on both themes. */
	.picker {
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5 6 6.5l5-5' stroke='%238b949e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 0.85rem center;
		padding-right: 2.2rem;
		cursor: pointer;
	}
</style>
