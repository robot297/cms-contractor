<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { slide } from 'svelte/transition';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { customerLocation, portalInfoFor, PROJECT_TYPES, type PortalInfo } from '$lib/crm';
	import TagPicker from '$lib/TagPicker.svelte';
	import ContactPanel from '$lib/ContactPanel.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Trial capacity, from the contractor layout. Null once they're on a paid or
	// comped subscription, which are uncapped.
	const atOrderLimit = $derived(data.billing.limits?.order.atLimit ?? false);

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

	// The lifecycle filter is a single button that opens a small menu.
	let viewMenuOpen = $state(false);

	// Contact dialog, driven off the already-loaded customer directory. The body
	// is the shared ContactComposer (message + channel picker).
	let customerDialog: HTMLDialogElement | undefined = $state();
	let customerDetail: (typeof data.customers)[number] | null = $state(null);
	// The project of the order the composer was opened from, so `{{project}}`
	// resolves in email templates.
	let contactProject = $state<string | null>(null);
	// And the order itself, so a successful send is recorded on its timeline.
	let contactOrderId = $state<string | null>(null);
	// Whether this order's customer has a portal — the Chat tab only works when a
	// reply has somewhere to land, exactly as on the dashboard and order workspace.
	let contactCanChat = $state(false);
	// The customer being contacted, and where they stand with the portal — so the
	// Chat tab can offer (or report) an invite when they aren't linked yet.
	let contactCustomerId = $state<string | null>(null);
	let contactPortal = $state<PortalInfo | null>(null);
	// The customer's contact details (email/phone/address/notes), folded behind the
	// ⓘ next to their name — composing is the dialog's job; the details are lookup.
	let contactInfoOpen = $state(false);
	function openContact(
		id: string | null,
		project: string | null = null,
		orderId: string | null = null,
		linked = false
	) {
		customerDetail = id ? (data.customers.find((c) => c.id === id) ?? null) : null;
		contactProject = project;
		contactOrderId = orderId;
		contactCanChat = linked;
		contactCustomerId = id;
		contactPortal = portalInfoFor({ linked, customerId: id, invites: data.invites });
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

	// Which tone the shared `.status-pill` (app.css) wears for a given state:
	// on track, waiting on somebody, or stopped. This used to be three literal
	// colour triples built into an inline style here — the colours now live with
	// every other status pill in the app, and this function is only the mapping.
	function statusTone(state: string): 'ok' | 'wait' | 'stop' {
		switch (state) {
			case 'In Progress':
			case 'Work Scheduled':
			case 'Parts Ordered':
			case 'Work Complete':
				return 'ok';
			case 'Work Cancelled':
				return 'stop';
			default:
				// Inquiry, Quote Sent, Deposit/Final Payment Pending, On Hold / Archived
				return 'wait';
		}
	}

	// Sizing shared with the dashboard cards, so the action buttons match across
	// both surfaces. The gold look comes from the shared `.icon-btn` class.
	const iconBtn = 'width: 2.3rem; height: 2.3rem; font-size: 1.55rem;';
</script>

<svelte:head>
	<title>Orders</title>
</svelte:head>

<div class="orders-page">
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
			{@const tone = statusTone(order.state)}
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
						<!-- Tags are deliberately NOT here. They are working notes a
						     contractor writes for one job ("awaiting deposit", "cedar"), and
						     a list is for finding the job — a run of chips under every row
						     made the list longer and told you nothing that helped you pick.
						     They live on the order itself, where the job is the subject. -->
					</div>

					<div style="display: flex; gap: 0.4rem; align-items: center; flex-shrink: 0;">
						<!-- A waiting conversation is signalled by the count on the 💬 button in
						     the action row, the same as the dashboard — not a second badge here. -->
						<span class="status-pill {tone}">{order.state}</span>
					</div>
				</div>

				<!-- Follow-up dates are deliberately absent here: due ones surface on the
				     dashboard, which is where a contractor acts on them. Internal notes,
				     snooze and delete live on the order detail page — this list stays a
				     list, and its two actions (message, open) match the dashboard cards. -->

				<!-- Action bar: the same two icon buttons as the dashboard, right-aligned —
				     message the customer, and open the order. Invite, delete and notes are
				     all on the order detail page now. -->
				<div class="action-bar">
					<a
						href={resolve(`/contractor/orders/${order.id}`)}
						title="View order details"
						aria-label="View order details"
						class="icon-btn"
						style="{iconBtn} flex-shrink: 0; text-decoration: none;">📋</a
					>
					{#if order.customerId}
						<button
							type="button"
							title="Message {order.customerName}"
							aria-label="Message {order.customerName}"
							onclick={() =>
								openContact(order.customerId, order.projectName, order.id, order.customerLinked)}
							class="icon-btn"
							style={iconBtn}
							>💬{#if (data.unread[order.id] ?? 0) > 0}<span class="btn-count" aria-hidden="true"
									>{data.unread[order.id]}</span
								>{/if}</button
						>
					{/if}
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
			<ContactPanel
				contact={c}
				project={contactProject}
				orderId={contactOrderId}
				conversations={contactCanChat && contactOrderId
					? [
							{
								orderId: contactOrderId,
								projectName: contactProject,
								thread: data.threads[contactOrderId] ?? []
							}
						]
					: []}
				canChat={contactCanChat}
				customerId={contactCustomerId}
				portal={contactPortal}
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
		color: var(--on-yellow);
		font-weight: 800;
	}
	.view-option.selected .view-count {
		background: rgba(20, 23, 28, 0.12);
		border-color: rgba(20, 23, 28, 0.25);
		color: #14171c;
	}

	/* Action row: the two icon buttons pinned right, matching the dashboard cards. */
	.action-bar {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.85rem;
	}
	/* The shared .icon-btn is not positioned, so the unread count needs an anchor.
	   Scoped to the action bar — the same treatment the dashboard gives its 💬. */
	.action-bar .icon-btn {
		position: relative;
		overflow: visible;
	}
	/* How many messages are waiting, on the button that opens the conversation —
	   the same badge the dashboard's 💬 carries, so the two surfaces read alike. */
	.btn-count {
		position: absolute;
		top: -0.2rem;
		right: -0.2rem;
		min-width: 1.1rem;
		height: 1.1rem;
		padding: 0 0.22rem;
		box-sizing: border-box;
		display: grid;
		place-items: center;
		border-radius: 999px;
		border: 2px solid var(--surface);
		background: var(--danger);
		color: #fff;
		font-size: 0.66rem;
		font-weight: 800;
		line-height: 1;
	}

	@media (max-width: 560px) {
		/* Reclaim the width the desktop chrome was spending. A 1rem page gutter plus
		   1.2rem of card padding put 2.2rem between the screen edge and the project
		   name; the cards then sat 1rem apart with 0.85rem between their own rows.
		   None of that is legibility on a 360px screen — it is why four orders
		   filled a phone. */
		.orders-page {
			padding: 0.75rem 0.6rem 2rem;
			gap: 0.6rem;
		}
		.orders-page :global(.card) {
			padding: 0.85rem;
			border-radius: 14px;
			gap: 0.55rem;
		}
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
		color: var(--on-yellow);
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
		color: var(--on-yellow);
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
	.orders-page {
		max-width: 860px;
		margin: 0 auto;
		padding: 1rem;
		display: grid;
		gap: 1rem;
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
	   Project leads, customer + city underneath. Unread customer messages ride as a
	   count on the 💬 button in the action row (see .btn-count above), the same as
	   the dashboard cards. */

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
