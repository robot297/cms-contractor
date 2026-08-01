<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { formatBytes, MAX_ATTACHMENT_BYTES, QUICK_UPDATE_STATES } from '$lib/crm';
	import ContactComposer from '$lib/ContactComposer.svelte';
	import TagPicker from '$lib/TagPicker.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Tags edit in place on the header rather than behind a separate screen.
	let editingTags = $state(false);

	// Two panels only. Subcontractors got its own card and attachments moved behind
	// an icon button, which left the tab strip carrying just the two views you
	// genuinely switch between.
	let tab = $state<'timeline' | 'customer'>('timeline');
	const TABS = $derived([
		{ id: 'timeline' as const, label: 'Timeline', count: data.timeline.length },
		{ id: 'customer' as const, label: 'Customer', count: null }
	]);

	// Attachments editor card, opened from the prompt beside tags and subcontractors.
	let filesOpen = $state(false);

	const order = $derived(data.order);
	const customer = $derived(data.customer);

	// Back link follows where you came from: the dashboard sends you back to the
	// dashboard, the orders list back to orders. Falls back to Orders on a direct
	// load / refresh.
	let backTo = $state<{ href: '/contractor' | '/contractor/orders'; label: string }>({
		href: '/contractor/orders',
		label: 'Orders'
	});
	afterNavigate((nav) => {
		const from = nav.from?.url.pathname;
		if (from === '/contractor') backTo = { href: '/contractor', label: 'Dashboard' };
		else if (from?.startsWith('/contractor/orders'))
			backTo = { href: '/contractor/orders', label: 'Orders' };
	});

	let confirmingDelete = $state(false);
	// Status editing hides behind a "Change" toggle under the badge. The draft is
	// re-seeded from the saved state each time the popover opens, so "Save" only
	// becomes active once the picked state actually differs from what's stored.
	let statusOpen = $state(false);
	let statusDraft = $state(untrack(() => data.order.state));
	let statusNote = $state('');
	const statusDirty = $derived(statusDraft !== order.state);
	function toggleStatus() {
		if (!statusOpen) {
			statusDraft = order.state;
			statusNote = '';
		}
		statusOpen = !statusOpen;
	}
	const statusThenClose =
		() =>
		async ({ update }: { update: () => Promise<void> }) => {
			statusOpen = false;
			statusNote = '';
			await update();
		};
	// Follow-up controls collapse behind a single snooze (⏰) button.
	let snoozeOpen = $state(false);
	// Customer contact (email/call) popover, mirroring the dashboard cards.
	let contactOpen = $state(false);
	// The subcontractor editor card stays behind a prompt until asked for. It stays
	// open while you toggle people on and off — closing after each pick would make
	// assigning two subs a four-tap job.
	let assignOpen = $state(false);
	// Attachment rules (types + size) live in an info modal, off the main flow.
	let infoDialog: HTMLDialogElement | undefined = $state();
	// The timeline's note input is hidden until the + button reveals it.
	let noteOpen = $state(false);
	// Close the snooze popover once a follow-up change is submitted.
	const snoozeThenClose =
		() =>
		async ({ update }: { update: () => Promise<void> }) => {
			snoozeOpen = false;
			await update();
		};
	// Close & reset the note field after a note is added.
	const noteThenClose =
		() =>
		async ({ update }: { update: () => Promise<void> }) => {
			noteOpen = false;
			await update();
		};

	function toDateInput(d: Date | string | null): string {
		if (!d) return '';
		return new Date(d).toISOString().slice(0, 10);
	}
	function fmtDate(d: Date | string | null): string {
		return d ? new Date(d).toLocaleDateString() : '—';
	}

	// Status badge colour by health: green = on track / done, amber = waiting or
	// stuck, red = cancelled. Mirrors the orders list.
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
				return STATUS_WAIT;
		}
	}
	const badge = $derived(statusBadge(order.state));

	const field = 'padding: 0.5rem; border-radius: 8px; border: 1px solid #d0d7de; font-size: 1rem;';
	const pill =
		'padding: 0.4rem 0.75rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer; font-size: 0.85rem;';
	const primaryBtn =
		'padding: 0.55rem 1rem; border-radius: 999px; border: 1px solid #0969da; background: #0969da; color: #fff; cursor: pointer; font-weight: 500;';
	const sectionTitle =
		'margin: 0; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: #8c959f;';

	// Show the project type only when the name doesn't already say it, so
	// "Poolside Pergola" + type "Pergola" reads as one line, not "… · Pergola".
	function typeSuffix(name: string | null, type: string | null): string | null {
		if (!type) return null;
		if (name && name.toLowerCase().includes(type.toLowerCase())) return null;
		return type;
	}
</script>

<svelte:head>
	<title>{order.projectName ?? 'Order'}</title>
</svelte:head>

<div class="order-shell">
	<div class="page">
		<a href={resolve(backTo.href)} style="color: #0969da; font-size: 0.9rem; text-decoration: none;"
			>← {backTo.label}</a
		>

		<header class="order-head">
			<!-- Title row: project leads, customer beneath, status across from both. -->
			<div class="head-top">
				<div class="head-main">
					<h1 class="order-title">
						{order.projectName ??
							'Untitled project'}{#if typeSuffix(order.projectName, order.projectType)}<span
								class="order-type"
							>
								· {typeSuffix(order.projectName, order.projectType)}</span
							>{/if}
					</h1>
					<span class="order-sub">{order.customerName}</span>
				</div>
				<!-- Status and its editor on one row, mirroring the follow-up line below. -->
				<div class="statusline">
					<span
						style="font-size: 0.82rem; font-weight: 700; white-space: nowrap; color: {badge.fg}; background: {badge.bg}; border: 1px solid {badge.border}; border-radius: 999px; padding: 0.25rem 0.8rem;"
						>{order.state}</span
					>
					<div style="position: relative;">
						<button
							type="button"
							class="icon-btn {statusOpen ? 'on' : ''}"
							aria-expanded={statusOpen}
							title="Change status"
							aria-label="Change status"
							onclick={toggleStatus}
							style="width: 1.9rem; height: 1.9rem; font-size: 1.05rem;">⚙️</button
						>
						{#if statusOpen}
							<!-- click-away backdrop -->
							<button
								type="button"
								aria-label="Close status editor"
								onclick={() => (statusOpen = false)}
								style="position: fixed; inset: 0; z-index: 10; background: transparent; border: none; cursor: default;"
							></button>
							<form
								method="POST"
								action="?/updateStatus"
								use:enhance={statusThenClose}
								style="position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; min-width: 240px; background: #fff; border: 1px solid #d0d7de; border-radius: 12px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); padding: 0.6rem; display: grid; gap: 0.5rem;"
							>
								<select
									name="state"
									aria-label="Order status"
									bind:value={statusDraft}
									style="{field} width: 100%;"
								>
									{#each QUICK_UPDATE_STATES as s (s)}
										<option value={s}>{s}</option>
									{/each}
								</select>
								<!-- Optional annotation recorded as an internal note alongside the
								     status change, so the "why" lands in the timeline too. -->
								<input
									name="note"
									bind:value={statusNote}
									placeholder="Internal note (optional)"
									style="{field} width: 100%; box-sizing: border-box; font-size: 0.85rem;"
								/>
								<button
									type="submit"
									class="save-status"
									disabled={!statusDirty}
									title={statusDirty ? 'Save status' : 'Pick a different status first'}
									style="{primaryBtn} width: 100%;">Save status</button
								>
							</form>
						{/if}
					</div>
				</div>
			</div>

			<!-- Tags, subcontractors and files. Each opens a card below rather than
			     expanding inline, so the editing surface has room on a phone. -->
			<div class="attrs">
				<button type="button" class="attr" onclick={() => (editingTags = !editingTags)}>
					{#if order.tags.length > 0}
						{#each order.tags as tag (tag)}<span class="tag-chip">{tag}</span>{/each}
					{:else}
						<span class="attr-add">+ Add tags</span>
					{/if}
				</button>

				<button type="button" class="attr" onclick={() => (assignOpen = !assignOpen)}>
					{#if data.assignedSubs.length > 0}
						{#each data.assignedSubs as sub (sub.id)}
							<span class="subchip on" class:guest={sub.tier !== 'trusted'}>{sub.name}</span>
						{/each}
					{:else}
						<span class="attr-add">+ Add subcontractors</span>
					{/if}
				</button>

				<button type="button" class="attr" onclick={() => (filesOpen = !filesOpen)}>
					<span class="attr-add"
						>📎 {data.attachments.length > 0
							? `${data.attachments.length} file${data.attachments.length === 1 ? '' : 's'}`
							: 'Add files'}</span
					>
				</button>
			</div>

			<!-- Follow-up, reduced from a full-width card to a line in the header:
			     it's a date you glance at, not a surface you work in. The ⏰ still
			     opens the same snooze/set/clear controls. -->
			<div class="followup">
				<span class="followup-label">Follow-up</span>
				<strong class:due={order.followUpDue}>{fmtDate(order.nextFollowUpAt)}</strong>
				<div style="position: relative;">
					<button
						type="button"
						class="icon-btn"
						style="width: 1.9rem; height: 1.9rem; font-size: 1.05rem;"
						title="Snooze or set follow-up"
						aria-label="Snooze or set follow-up"
						aria-expanded={snoozeOpen}
						onclick={() => (snoozeOpen = !snoozeOpen)}>⏰</button
					>
					{#if snoozeOpen}
						<button
							type="button"
							aria-label="Close follow-up options"
							onclick={() => (snoozeOpen = false)}
							style="position: fixed; inset: 0; z-index: 10; background: transparent; border: none; cursor: default;"
						></button>
						<div class="followup-pop">
							<div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
								<form method="POST" action="?/snoozeFollowUp" use:enhance={snoozeThenClose}>
									<input type="hidden" name="preset" value="1d" />
									<button type="submit" style={pill}>+1 day</button>
								</form>
								<form method="POST" action="?/snoozeFollowUp" use:enhance={snoozeThenClose}>
									<input type="hidden" name="preset" value="3d" />
									<button type="submit" style={pill}>+3 days</button>
								</form>
								<form method="POST" action="?/snoozeFollowUp" use:enhance={snoozeThenClose}>
									<input type="hidden" name="preset" value="1w" />
									<button type="submit" style={pill}>+1 week</button>
								</form>
							</div>
							<form
								method="POST"
								action="?/setFollowUp"
								use:enhance={snoozeThenClose}
								style="display: flex; gap: 0.4rem; align-items: center;"
							>
								<input
									type="date"
									name="date"
									value={toDateInput(order.nextFollowUpAt)}
									style="flex: 1; min-width: 0; {field}"
								/>
								<button type="submit" style={pill}>Set</button>
							</form>
							{#if order.nextFollowUpAt}
								<form method="POST" action="?/clearFollowUp" use:enhance={snoozeThenClose}>
									<button type="submit" style="{pill} width: 100%; color: #cf222e;"
										>Clear follow-up</button
									>
								</form>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		</header>

		{#if form?.message}
			<p
				style="margin: 0; color: #cf222e; font-size: 0.9rem; background: #ffebe9; border: 1px solid #ffd7d5; border-radius: 10px; padding: 0.6rem 0.8rem;"
			>
				{form.message}
			</p>
		{/if}

		<!-- Tabs. The detail page used to stack six full-width cards, which meant
		     scrolling past the customer and the files to reach the timeline. One panel
		     at a time keeps the working surface at the top of the screen. -->
		{#if editingTags}
			<section class="card editor">
				<div class="editor-head">
					<h2 style={sectionTitle}>Tags</h2>
					<button
						type="button"
						class="editor-x"
						aria-label="Close"
						onclick={() => (editingTags = false)}>✕</button
					>
				</div>
				<form
					method="POST"
					action="?/setTags"
					use:enhance={() =>
						async ({ update }) => {
							editingTags = false;
							await update();
						}}
					class="editor-form"
				>
					<TagPicker value={order.tags} />
					<button type="submit" class="editor-save">Save tags</button>
				</form>
			</section>
		{/if}

		{#if assignOpen}
			<section class="card editor">
				<div class="editor-head">
					<h2 style={sectionTitle}>Subcontractors</h2>
					<button
						type="button"
						class="editor-x"
						aria-label="Close"
						onclick={() => (assignOpen = false)}>✕</button
					>
				</div>

				{#if data.assignedSubs.length === 0 && data.availableSubs.length === 0}
					<p class="editor-note">
						You haven't added any subcontractors yet — set them up on the <a
							href={resolve('/contractor/subcontractors')}>Subcontractors</a
						> page, then put them on jobs from here.
					</p>
				{:else}
					<p class="editor-note">Tap a name to put them on this job, or take them off.</p>
					<div class="editor-chips">
						{#each data.assignedSubs as sub (sub.id)}
							<form method="POST" action="?/unassignSub" use:enhance>
								<input type="hidden" name="subcontractorId" value={sub.id} />
								<button
									type="submit"
									class="subchip on"
									class:guest={sub.tier !== 'trusted'}
									aria-pressed="true"
									title={`${sub.trade ?? 'Trade not set'} · ${sub.tier === 'trusted' ? 'Trusted' : 'Guest'}`}
								>
									{sub.name}
								</button>
							</form>
						{/each}
						{#each data.availableSubs as sub (sub.id)}
							<form method="POST" action="?/assignSub" use:enhance>
								<input type="hidden" name="subcontractorId" value={sub.id} />
								<button
									type="submit"
									class="subchip"
									aria-pressed="false"
									title={`${sub.trade ?? 'Trade not set'} · ${sub.tier === 'trusted' ? 'Trusted' : 'Guest'}`}
								>
									{sub.name}
								</button>
							</form>
						{/each}
					</div>
				{/if}
			</section>
		{/if}

		{#if filesOpen}
			<section class="card editor">
				<div class="editor-head">
					<h2 style={sectionTitle}>Attachments</h2>
					<button
						type="button"
						class="editor-x"
						aria-label="Close"
						onclick={() => (filesOpen = false)}>✕</button
					>
				</div>
				<div
					style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;"
				>
					<form
						method="POST"
						action="?/uploadAttachment"
						enctype="multipart/form-data"
						use:enhance
						style="display: flex; gap: 0.4rem; align-items: center;"
					>
						<!-- Styled trigger for a hidden file input; picking a file uploads it. -->
						<label
							style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.8rem; border-radius: 999px; border: 1px solid #d0d7de; background: #fff; cursor: pointer; font-weight: 600; font-size: 0.85rem; white-space: nowrap;"
						>
							📎 Add file
							<input
								type="file"
								name="file"
								accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
								required
								onchange={(e) => e.currentTarget.form?.requestSubmit()}
								style="position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;"
							/>
						</label>
						<button
							type="button"
							class="icon-btn"
							style="width: 2rem; height: 2rem; font-size: 1.2rem;"
							title="Attachment rules"
							aria-label="Attachment rules"
							onclick={() => infoDialog?.showModal()}>ℹ️</button
						>
					</form>
				</div>

				<dialog
					bind:this={infoDialog}
					style="border: none; border-radius: 16px; padding: 0; max-width: 380px; width: 92vw; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);"
				>
					<div style="padding: 1.1rem 1.2rem; display: grid; gap: 0.6rem;">
						<h3 style="margin: 0; font-size: 1rem;">Attachment rules</h3>
						<ul
							style="margin: 0; padding-left: 1.1rem; font-size: 0.9rem; color: #57606a; display: grid; gap: 0.3rem;"
						>
							<li>Accepted files: PNG, JPEG, WebP, GIF, or PDF.</li>
							<li>Up to {formatBytes(MAX_ATTACHMENT_BYTES)} per file.</li>
						</ul>
						<form method="dialog" style="justify-self: end;">
							<button type="submit" style={pill}>Got it</button>
						</form>
					</div>
				</dialog>

				{#if data.attachments.length === 0}
					<p style="margin: 0; color: #57606a; font-size: 0.9rem;">No attachments yet.</p>
				{:else}
					<div style="display: grid; gap: 0.5rem;">
						{#each data.attachments as att (att.id)}
							{@const href = resolve(`/contractor/orders/${order.id}/attachment/${att.id}`)}
							<div
								style="display: flex; gap: 0.75rem; align-items: center; padding: 0.5rem 0.65rem; border: 1px solid #eaeef2; border-radius: 10px;"
							>
								{#if att.mimeType.startsWith('image/')}
									<a {href} target="_blank" rel="noopener" style="flex-shrink: 0;">
										<img
											src={href}
											alt={att.filename}
											style="width: 44px; height: 44px; object-fit: cover; border-radius: 8px; border: 1px solid #eaeef2; display: block;"
										/>
									</a>
								{:else}
									<div
										style="width: 44px; height: 44px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: 8px; background: #f6f8fa; border: 1px solid #eaeef2; font-size: 1.1rem;"
									>
										📄
									</div>
								{/if}
								<div style="flex: 1; min-width: 0;">
									<a
										{href}
										target="_blank"
										rel="noopener"
										style="color: #0969da; text-decoration: none; word-break: break-word;"
										>{att.filename}</a
									>
									<div style="font-size: 0.75rem; color: #8c959f;">
										{formatBytes(att.size)} · {new Date(att.createdAt).toLocaleDateString()}
									</div>
								</div>
								<form method="POST" action="?/deleteAttachment" use:enhance>
									<input type="hidden" name="attachmentId" value={att.id} />
									<button
										type="submit"
										title="Delete attachment"
										aria-label="Delete attachment"
										style="border: none; background: none; cursor: pointer; color: #8c959f; font-size: 1rem; padding: 0.2rem 0.35rem;"
										>🗑</button
									>
								</form>
							</div>
						{/each}
					</div>
				{/if}
			</section>
		{/if}

		<div class="card panel">
			<div class="tabs" role="tablist" aria-label="Order sections">
				{#each TABS as t (t.id)}
					<button
						type="button"
						role="tab"
						id={`tab-${t.id}`}
						aria-selected={tab === t.id}
						aria-controls={`panel-${t.id}`}
						class="tab"
						class:on={tab === t.id}
						onclick={() => (tab = t.id)}
					>
						{t.label}{#if t.count !== null}<span class="tab-count">{t.count}</span>{/if}
					</button>
				{/each}
			</div>

			<div class="panel-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
				{#if tab === 'timeline'}
					<div
						style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;"
					>
						<h2 style={sectionTitle}>Timeline</h2>
						<button
							type="button"
							class="icon-btn"
							style="width: 2.3rem; height: 2.3rem; font-size: 1.65rem;"
							title="Add note"
							aria-label="Add note"
							aria-expanded={noteOpen}
							onclick={() => (noteOpen = !noteOpen)}>＋</button
						>
					</div>
					{#if noteOpen}
						<form
							method="POST"
							action="?/addNote"
							use:enhance={noteThenClose}
							style="display: flex; gap: 0.5rem; align-items: center;"
						>
							<input
								name="note"
								placeholder="Add an internal note…"
								required
								style="flex: 1; {field}"
							/>
							<button type="submit" style={primaryBtn}>Add</button>
						</form>
					{/if}

					{#if data.timeline.length === 0}
						<p style="margin: 0; color: #57606a; font-size: 0.9rem;">No activity yet.</p>
					{:else}
						<ol class="timeline">
							{#each data.timeline as entry (entry.id)}
								<li class="tl-entry" class:internal={entry.internal}>
									<div class="tl-head">
										<strong class="tl-title">{entry.title}</strong>
										{#if entry.internal}<span class="tl-tag">internal</span>{/if}
									</div>
									{#if entry.detail}<div class="tl-detail">{entry.detail}</div>{/if}
									<div class="tl-meta">
										{new Date(entry.createdAt).toLocaleString()} · {entry.authorRole}
									</div>
								</li>
							{/each}
						</ol>
					{/if}
				{:else if tab === 'customer'}
					<div
						style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;"
					>
						<h2 style={sectionTitle}>Customer</h2>
						{#if customer}
							<div style="display: flex; gap: 0.5rem; align-items: center;">
								<!-- Contact (email / call) behind one button, like the dashboard -->
								<div style="position: relative;">
									<button
										type="button"
										class="icon-btn"
										style="width: 2.3rem; height: 2.3rem; font-size: 1.45rem;"
										title="Contact customer"
										aria-label="Contact customer"
										aria-expanded={contactOpen}
										onclick={() => (contactOpen = !contactOpen)}>💬</button
									>
									{#if contactOpen}
										<!-- Dimmed click-away scrim so the composer is the focus. -->
										<button
											type="button"
											aria-label="Close contact menu"
											onclick={() => (contactOpen = false)}
											class="contact-scrim"
										></button>
										<div class="contact-pop">
											<ContactComposer
												customer={{
													name: customer.name,
													email: customer.email,
													phone: customer.phone,
													preferredContact: customer.preferredContact
												}}
												project={order.projectName}
												rows={2}
												onsent={() => (contactOpen = false)}
												onclose={() => (contactOpen = false)}
											/>
											{#if order.customerId}
												<form
													method="POST"
													action="?/sendInvite"
													use:enhance={() => {
														contactOpen = false;
														return async ({ update }) => await update();
													}}
												>
													<input type="hidden" name="customerId" value={order.customerId} />
													<button type="submit" class="invite-link"
														>🔗 Invite customer to portal</button
													>
												</form>
											{/if}
										</div>
									{/if}
								</div>
							</div>
						{/if}
					</div>
					{#if customer}
						<div style="display: grid; gap: 0.3rem; font-size: 0.9rem;">
							<div style="word-break: break-word;">
								<span style="color: #57606a;">Email:</span>
								{customer.email}
							</div>
							{#if customer.phone}<div>
									<span style="color: #57606a;">Phone:</span>
									{customer.phone}
								</div>{/if}
							{#if customer.address}<div>
									<span style="color: #57606a;">Address:</span>
									{customer.address}
								</div>{/if}
						</div>
					{:else}
						<p style="margin: 0; color: #57606a;">No customer linked to this order.</p>
					{/if}
				{/if}
			</div>
		</div>

		<!-- Deleting an order is rare and irreversible, so it sits quietly at the foot
		     of the page as a plain link — no card, no heading. It only grows teeth once
		     you ask for it. -->
		<div class="footer-danger">
			{#if confirmingDelete}
				<div class="danger-confirm" role="alert">
					<span>Delete this order and its entire timeline? This can’t be undone.</span>
					<span class="danger-actions">
						<form method="POST" action="?/deleteOrder" use:enhance>
							<button type="submit" class="danger-yes">Yes, delete</button>
						</form>
						<button type="button" class="danger-no" onclick={() => (confirmingDelete = false)}
							>Cancel</button
						>
					</span>
				</div>
			{:else}
				<button type="button" class="danger-link" onclick={() => (confirmingDelete = true)}
					>Delete this order</button
				>
			{/if}
		</div>
	</div>
</div>

<style>
	/* Page canvas. In light this is the familiar sunken grey; in dark it has to be
	   *darker* than the cards sitting on it (the old #f6f8fa literal got remapped
	   to a raised grey, so cards read as holes punched into the page). */
	.order-shell {
		background: var(--surface-sunken);
		min-height: 100%;
	}
	.page {
		max-width: 1040px;
		margin: 0 auto;
		padding: 1.25rem 1rem 2.5rem;
		display: grid;
		gap: 1rem;
	}
	/* Header. The title row is always two columns — project + customer on the left,
	   status across from them on the right — because the status is *about* the title
	   and reads as a caption to it. The prompts and follow-up sit full width below,
	   where they have room to wrap on a phone. */
	.order-head {
		display: grid;
		gap: 0.6rem;
	}
	.head-top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.head-main {
		display: grid;
		gap: 0.15rem;
		min-width: 0;
	}

	/* Toggle icon button in its open state — filled accent so the "hide" (✕)
	   state is clearly on. */
	.icon-btn.on {
		background: #ece7fb;
		color: #4b2fa8;
	}
	.icon-btn.on:hover {
		background: #e2daf7;
	}
	/* ------------------------------------------------------------- Timeline
	   A rail with a dot per entry. Everything is token-driven; the internal
	   (contractor-only) entries carry a warm amber tint that has a dark
	   counterpart instead of the old cream-on-dark literals. */
	.timeline {
		list-style: none;
		margin: 0;
		padding: 0 0 0 0.9rem;
		display: grid;
		gap: 0.5rem;
		border-left: 2px solid var(--line);
	}
	.tl-entry {
		position: relative;
		padding: 0.65rem 0.75rem;
		border-radius: 10px;
		background: var(--surface-sunken);
		border: 1px solid var(--line);
		display: grid;
		gap: 0.2rem;
	}
	/* The dot on the rail, aligned with the entry's title line. */
	.tl-entry::before {
		content: '';
		position: absolute;
		left: -1.24rem;
		top: 0.95rem;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 999px;
		background: var(--line-strong);
		/* Ring in the card colour so the dot punches through the rail cleanly. */
		border: 2px solid var(--surface);
		box-sizing: content-box;
	}
	.tl-entry.internal {
		background: #fffdf5;
		border-color: #f0e6c0;
	}
	.tl-entry.internal::before {
		background: #d4a72c;
	}
	.tl-title {
		font-size: 0.92rem;
		color: var(--fg);
	}
	.tl-head {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		align-items: baseline;
	}
	.tl-tag {
		flex-shrink: 0;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #9a6700;
	}
	.tl-detail {
		font-size: 0.9rem;
		color: var(--fg-muted);
		white-space: pre-wrap;
	}
	.tl-meta {
		font-size: 0.75rem;
		color: var(--fg-muted);
	}

	/* Status "Save" stays inert until a different state is picked. The accent is
	   greyed out (not just dimmed) so "nothing to save" reads without hovering. */
	.save-status:disabled {
		cursor: not-allowed;
		filter: grayscale(1);
		opacity: 0.5;
		box-shadow: none;
		transform: none;
	}

	.invite-link {
		width: 100%;
		text-align: left;
		padding: 0.5rem 0.6rem;
		border: none;
		border-top: 1px solid #eaeef2;
		background: none;
		cursor: pointer;
		font-size: 0.88rem;
		color: #0969da;
		font-weight: 600;
	}
	.invite-link:hover {
		background: #f6f8fa;
		border-radius: 8px;
	}
	/* The order title should read as a title but stay subtle — no chunky yellow
	   hero box, and a normal-weight font instead of the heavy display face. */
	.order-sub {
		font-size: 0.92rem;
		font-weight: 600;
		color: var(--fg-muted);
		overflow-wrap: anywhere;
	}
	/* The project type rides the title without competing with it. */
	.order-type {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--fg-muted);
	}
	.order-title {
		margin: 0;
		font-family: 'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif;
		font-size: 1.5rem;
		overflow-wrap: anywhere;
		font-weight: 700;
		line-height: 1.2;
		letter-spacing: -0.01em;
		text-transform: none;
		color: #1f2328;
		background: none;
		border: none;
		border-radius: 0;
		box-shadow: none;
		padding: 0;
		display: block;
	}

	/* ---------------------------------------------------------------- Tabs
	   The strip lives inside the panel card and underlines the active tab — the
	   same treatment as the subcontractor detail pane — so it reads as one object
	   rather than buttons floating above a box. Scrolls sideways on narrow screens
	   instead of wrapping to two rows and shoving the content down. */
	.panel {
		min-width: 0;
		gap: 0;
		padding: 0;
		overflow: hidden;
	}
	.tabs {
		display: flex;
		gap: 0.15rem;
		overflow-x: auto;
		scrollbar-width: none;
		padding: 0 0.5rem;
		border-bottom: 1px solid var(--line);
		background: var(--surface-sunken);
	}
	.tabs::-webkit-scrollbar {
		display: none;
	}
	.tab {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.8rem 0.85rem;
		border: none;
		background: none;
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		white-space: nowrap;
		cursor: pointer;
		border-bottom: 3px solid transparent;
		margin-bottom: -1px;
	}
	.tab:hover {
		color: var(--fg);
	}
	.tab.on {
		color: var(--fg);
		border-bottom-color: var(--yellow-deep);
	}
	.tab:focus-visible {
		outline: 2px solid var(--yellow);
		outline-offset: -3px;
	}
	.tab-count {
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: var(--line);
		color: var(--fg-muted);
		font-size: 0.7rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	/* Pinned dark: yellow stays light in both themes. */
	.tab.on .tab-count {
		background: var(--yellow);
		color: #14171c;
	}
	.subchip {
		padding: 0.25rem 0.65rem;
		border-radius: 999px;
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.76rem;
		font-weight: 700;
		cursor: pointer;
	}
	.subchip:hover {
		border-color: var(--fg-muted);
		color: var(--fg);
	}
	/* On the job. Label pinned dark: yellow stays light in both themes. */
	.subchip.on {
		background: var(--yellow);
		border-color: #14171c;
		color: #14171c;
	}
	/* A Guest sees the job with the customer's details redacted, so they read as a
	   dashed fill rather than a solid one — visible without needing a legend. */
	.subchip.on.guest {
		background: repeating-linear-gradient(
			-45deg,
			var(--yellow) 0,
			var(--yellow) 5px,
			transparent 5px,
			transparent 10px
		);
		border-style: dashed;
	}
	.subchip:focus-visible {
		outline: 2px solid var(--yellow-deep);
		outline-offset: 2px;
	}

	/* ------------------------------------------------- Order attributes
	   Tags, subcontractors and files. Each carries a visible border at rest — a
	   hover-only outline is invisible on a phone, which left three bare phrases
	   floating with nothing to say they were tappable. */
	.attrs {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		margin-top: 0.2rem;
	}
	.attr {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
		max-width: 100%;
		min-width: 0;
		/* 2.25rem keeps the tap target close to the 44px guideline once the border
		   and line-height are counted. */
		min-height: 2.25rem;
		padding: 0.35rem 0.7rem;
		border: 1.5px solid var(--line);
		border-radius: 999px;
		background: var(--surface);
		font: inherit;
		line-height: 1.3;
		text-align: left;
		cursor: pointer;
	}
	.attr:hover {
		border-color: var(--fg-muted);
	}
	.attr:focus-visible {
		outline: 2px solid var(--yellow);
		outline-offset: 1px;
	}
	.attr-add {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--fg-muted);
		white-space: nowrap;
	}
	.attr:hover .attr-add {
		color: var(--fg);
	}

	/* ----------------------------------------------------- Editor cards
	   Opening either prompt gives a real card rather than an inline expansion, so
	   the chips have room to wrap properly on a phone. */
	.editor {
		gap: 0.7rem;
	}
	.editor-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.editor-x {
		border: none;
		background: none;
		font-size: 1.05rem;
		line-height: 1;
		color: var(--fg-muted);
		cursor: pointer;
		padding: 0.1rem 0.25rem;
	}
	.editor-x:hover {
		color: var(--fg);
	}
	.editor-note {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--fg-muted);
	}
	.editor-form {
		display: grid;
		gap: 0.8rem;
		justify-items: start;
	}
	.editor-save {
		padding: 0.5rem 1rem;
		border-radius: 999px;
		border: 2px solid var(--pop-line);
		background: var(--yellow);
		/* Pinned dark: yellow stays light in both themes. */
		color: #14171c;
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		cursor: pointer;
		box-shadow: var(--pop-shadow-sm);
	}
	.editor-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	/* ------------------------------------------------------------ Phones */
	@media (max-width: 560px) {
		.page {
			padding: 1rem 0.75rem 2rem;
		}
		/* Long project names shouldn't push the header sideways. */
		.order-title {
			font-size: 1.25rem;
			overflow-wrap: anywhere;
		}
		.panel-body,
		.editor {
			padding: 0.9rem;
		}
		.tabs {
			padding: 0 0.25rem;
		}
		.tab {
			padding: 0.7rem 0.6rem;
			font-size: 0.78rem;
		}
		/* The status sits beside a wrapping title, so keep it top-aligned and let
		   the badge shrink rather than shove the title. */
		.statusline {
			flex-shrink: 0;
		}
	}

	@media (max-width: 480px) {
		/* Full-width targets on a phone rather than a ragged wrap. */
		.editor-save {
			width: 100%;
		}
	}

	/* -------------------------------------------------------- Delete order
	   A quiet link at the foot of the page rather than a titled card. */
	.footer-danger {
		display: flex;
		justify-content: center;
		padding-top: 0.25rem;
	}
	.danger-link {
		border: none;
		background: none;
		padding: 0.3rem 0.5rem;
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 700;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.danger-link:hover {
		color: var(--danger);
	}
	.danger-confirm {
		display: grid;
		gap: 0.5rem;
		justify-items: center;
		text-align: center;
		padding: 0.7rem 0.9rem;
		border: 1.5px solid var(--danger);
		border-radius: 12px;
		background: color-mix(in srgb, var(--danger) 8%, var(--surface));
		font-size: 0.85rem;
		color: var(--fg);
	}
	.danger-actions {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		justify-content: center;
	}
	.danger-confirm button {
		padding: 0.35rem 0.85rem;
		border-radius: 999px;
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 700;
		cursor: pointer;
	}
	.danger-yes {
		border: 1px solid var(--danger);
		background: var(--danger);
		color: #fff;
	}
	.danger-no {
		border: none;
		background: none;
		color: var(--fg-muted);
	}
	.danger-no:hover {
		color: var(--fg);
	}

	.panel-body {
		display: grid;
		gap: 0.85rem;
		padding: 1.1rem 1.2rem;
		min-width: 0;
	}

	/* Status badge and its ⚙️ on one line, matching the follow-up row beneath it. */
	.statusline {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	/* ----------------------------------------------------------- Follow-up
	   A line in the header rather than a card of its own. */
	.followup {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		color: var(--fg-muted);
	}
	.followup-label {
		font-weight: 700;
	}
	.followup strong {
		color: var(--fg);
		font-weight: 700;
	}
	.followup strong.due {
		color: var(--danger);
	}
	.followup-pop {
		position: absolute;
		right: 0;
		top: calc(100% + 6px);
		z-index: 20;
		min-width: 230px;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-radius: 12px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
		padding: 0.6rem;
		display: grid;
		gap: 0.5rem;
	}

	/* Dark theme */
	:global(:root[data-theme='dark']) .order-shell {
		/* Sit the canvas *below* the cards in elevation. */
		background: var(--paper);
	}
	:global(:root[data-theme='dark']) .tl-entry.internal {
		background: #2a2415;
		border-color: #4a3f22;
	}
	:global(:root[data-theme='dark']) .tl-entry.internal::before {
		background: #e3b341;
	}
	:global(:root[data-theme='dark']) .tl-tag {
		color: #e3b341;
	}
	:global(:root[data-theme='dark']) .icon-btn.on {
		background: #2e2a44;
		border-color: #4a3f6b;
		color: #cabff5;
	}
	:global(:root[data-theme='dark']) .icon-btn.on:hover {
		background: #383352;
	}
	:global(:root[data-theme='dark']) .invite-link {
		border-top-color: var(--line);
	}
	:global(:root[data-theme='dark']) .invite-link:hover {
		background: var(--surface-sunken);
	}
	:global(:root[data-theme='dark']) .order-title {
		color: var(--fg);
	}
</style>
