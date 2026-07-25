<script lang="ts">
	import { enhance } from '$app/forms';
	import { afterNavigate } from '$app/navigation';
	import { formatBytes, MAX_ATTACHMENT_BYTES, QUICK_UPDATE_STATES } from '$lib/crm';
	import ContactComposer from '$lib/ContactComposer.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const order = $derived(data.order);
	const customer = $derived(data.customer);

	// Back link follows where you came from: the dashboard sends you back to the
	// dashboard, the orders list back to orders. Falls back to Orders on a direct
	// load / refresh.
	let backTo = $state({ href: '/contractor/orders', label: 'Orders' });
	afterNavigate((nav) => {
		const from = nav.from?.url.pathname;
		if (from === '/contractor') backTo = { href: '/contractor', label: 'Dashboard' };
		else if (from?.startsWith('/contractor/orders')) backTo = { href: '/contractor/orders', label: 'Orders' };
	});

	let confirmingDelete = $state(false);
	// Status editing hides behind a "Change" toggle under the badge.
	let statusOpen = $state(false);
	const statusThenClose = () =>
		async ({ update }: { update: () => Promise<void> }) => {
			statusOpen = false;
			await update();
		};
	// Follow-up controls collapse behind a single snooze (⏰) button.
	let snoozeOpen = $state(false);
	// Customer contact (email/call) popover, mirroring the dashboard cards.
	let contactOpen = $state(false);
	// The subcontractor picker hides behind a + button.
	let assignOpen = $state(false);
	// Attachment rules (types + size) live in an info modal, off the main flow.
	let infoDialog: HTMLDialogElement | undefined = $state();
	const assignThenClose = () =>
		async ({ update }: { update: () => Promise<void> }) => {
			assignOpen = false;
			await update();
		};
	// The timeline's note input is hidden until the + button reveals it.
	let noteOpen = $state(false);
	// Close the snooze popover once a follow-up change is submitted.
	const snoozeThenClose = () =>
		async ({ update }: { update: () => Promise<void> }) => {
			snoozeOpen = false;
			await update();
		};
	// Close & reset the note field after a note is added.
	const noteThenClose = () =>
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
	const card =
		'background: #fff; border: 1px solid #e2e6ea; border-radius: 16px; padding: 1.1rem 1.2rem; display: grid; gap: 0.75rem; box-shadow: 0 1px 2px rgba(27, 31, 36, 0.05), 0 4px 12px rgba(27, 31, 36, 0.06);';
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

<div style="background: #f6f8fa; min-height: 100%;">
	<div class="page">
		<a href={backTo.href} style="color: #0969da; font-size: 0.9rem; text-decoration: none;"
			>← {backTo.label}</a
		>

		<!-- Header: customer name leads, project is the subtitle -->
		<header class="order-head">
			<div style="display: grid; gap: 0.3rem; min-width: 0;">
				<h1 class="order-title">{order.customerName}</h1>
				<span style="color: #57606a; font-weight: 600;"
					>{order.projectName ?? 'Untitled project'}{#if typeSuffix(order.projectName, order.projectType)} · {typeSuffix(
							order.projectName,
							order.projectType
						)}{/if}</span
				>
			</div>
			<div style="display: grid; gap: 0.4rem; justify-items: end; flex-shrink: 0;">
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
						onclick={() => (statusOpen = !statusOpen)}
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
							<select name="state" aria-label="Order status" style="{field} width: 100%;">
								{#each QUICK_UPDATE_STATES as s (s)}
									<option value={s} selected={s === order.state}>{s}</option>
								{/each}
							</select>
							<button type="submit" style="{primaryBtn} width: 100%;">Save status</button>
						</form>
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

		<div class="detail-grid">
			<!-- Main column: the working surface — follow-up, activity -->
			<div class="col">
				<!-- Follow-up: one snooze (⏰) button opens presets + a date picker -->
				<section style={card}>
					<div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;">
						<div style="font-size: 0.95rem;">
							<span style="color: #8c959f;">Follow-up:</span>
							<strong style="color: {order.followUpDue ? '#cf222e' : '#1f2328'};"
								>{fmtDate(order.nextFollowUpAt)}</strong
							>
						</div>
						<div style="position: relative; flex-shrink: 0;">
							<button
								type="button"
								class="icon-btn"
								style="width: 2.5rem; height: 2.5rem; font-size: 1.6rem;"
								title="Snooze or set follow-up"
								aria-label="Snooze or set follow-up"
								aria-expanded={snoozeOpen}
								onclick={() => (snoozeOpen = !snoozeOpen)}>⏰</button
							>
							{#if snoozeOpen}
								<!-- click-away backdrop -->
								<button
									type="button"
									aria-label="Close follow-up options"
									onclick={() => (snoozeOpen = false)}
									style="position: fixed; inset: 0; z-index: 10; background: transparent; border: none; cursor: default;"
								></button>
								<div
									style="position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; min-width: 230px; background: #fff; border: 1px solid #d0d7de; border-radius: 12px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); padding: 0.6rem; display: grid; gap: 0.5rem;"
								>
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
				</section>

				<!-- Timeline: the + button reveals the note input -->
				<section style={card}>
					<div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
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
						<div style="display: grid; gap: 0.5rem;">
							{#each data.timeline as entry (entry.id)}
								<div
									style="padding: 0.65rem 0.75rem; border-radius: 10px; background: {entry.internal
										? '#fffdf5'
										: '#f6f8fa'}; border: 1px solid {entry.internal
										? '#f0e6c0'
										: '#eaeef2'}; display: grid; gap: 0.2rem;"
								>
									<div
										style="display: flex; justify-content: space-between; gap: 0.5rem; align-items: baseline;"
									>
										<strong style="font-size: 0.92rem;">{entry.title}</strong>
										{#if entry.internal}
											<span style="font-size: 0.7rem; color: #9a6700;">internal</span>
										{/if}
									</div>
									{#if entry.detail}<div
											style="font-size: 0.9rem; color: #57606a; white-space: pre-wrap;"
										>
											{entry.detail}
										</div>{/if}
									<div style="font-size: 0.75rem; color: #8c959f;">
										{new Date(entry.createdAt).toLocaleString()} · {entry.authorRole}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</section>
			</div>

			<!-- Side column: who / what / files / danger -->
			<div class="col">
				<!-- Customer -->
				<section style={card}>
					<div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
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
										<!-- click-away backdrop -->
										<button
											type="button"
											aria-label="Close contact menu"
											onclick={() => (contactOpen = false)}
											style="position: fixed; inset: 0; z-index: 10; background: transparent; border: none; cursor: default;"
										></button>
										<div class="contact-pop">
											<ContactComposer
												customer={{
													name: customer.name,
													email: customer.email,
													phone: customer.phone,
													preferredContact: customer.preferredContact
												}}
												rows={2}
												onsent={() => (contactOpen = false)}
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
													<button type="submit" class="invite-link">🔗 Invite customer to portal</button>
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
								<span style="color: #57606a;">Email:</span> {customer.email}
							</div>
							{#if customer.phone}<div>
									<span style="color: #57606a;">Phone:</span> {customer.phone}
								</div>{/if}
							{#if customer.address}<div>
									<span style="color: #57606a;">Address:</span> {customer.address}
								</div>{/if}
							{#if customer.tags.length > 0}
								<div style="display: flex; gap: 0.35rem; flex-wrap: wrap; margin-top: 0.2rem;">
									{#each customer.tags as tag (tag)}
										<span
											style="font-size: 0.75rem; background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 999px; padding: 0.1rem 0.55rem;"
											>{tag}</span
										>
									{/each}
								</div>
							{/if}
						</div>
					{:else}
						<p style="margin: 0; color: #57606a;">No customer linked to this order.</p>
					{/if}
				</section>

				<!-- Assigned subcontractors -->
				<section style={card}>
					<div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
						<h2 style={sectionTitle}>Assigned subcontractors</h2>
						{#if data.availableSubs.length > 0}
							<button
								type="button"
								class="icon-btn {assignOpen ? 'on' : ''}"
								style="width: 2.2rem; height: 2.2rem; font-size: {assignOpen ? '1.15rem' : '1.55rem'};"
								title={assignOpen ? 'Hide' : 'Assign a subcontractor'}
								aria-label={assignOpen ? 'Hide subcontractor picker' : 'Assign a subcontractor'}
								aria-expanded={assignOpen}
								onclick={() => (assignOpen = !assignOpen)}>{assignOpen ? '✕' : '＋'}</button
							>
						{/if}
					</div>

					{#if assignOpen && data.availableSubs.length > 0}
						<div style="display: grid; gap: 0.4rem;">
							<span style="font-size: 0.78rem; color: #8c959f;">Tap a subcontractor to assign them</span>
							{#each data.availableSubs as sub (sub.id)}
								<form method="POST" action="?/assignSub" use:enhance={assignThenClose}>
									<input type="hidden" name="subcontractorId" value={sub.id} />
									<button type="submit" class="sub-pick">
										<span class="sub-pick-avatar" aria-hidden="true"
											>{sub.name.slice(0, 1).toUpperCase()}</span
										>
										<span style="min-width: 0; flex: 1;">
											<strong style="display: block; font-size: 0.92rem;">{sub.name}</strong>
											<span style="color: #57606a; font-size: 0.8rem;"
												>{sub.trade ?? 'Trade not set'} · {sub.tier === 'trusted'
													? 'Trusted'
													: 'Guest'}</span
											>
										</span>
										<span class="sub-pick-add" aria-hidden="true">＋</span>
									</button>
								</form>
							{/each}
						</div>
					{/if}

					{#if data.assignedSubs.length === 0}
						<p style="margin: 0; color: #57606a; font-size: 0.9rem;">
							No subcontractors assigned yet.
						</p>
					{:else}
						<div style="display: grid; gap: 0.5rem;">
							{#each data.assignedSubs as sub (sub.id)}
								<div
									style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; border: 1px solid #d0d7de; border-radius: 10px; padding: 0.5rem 0.7rem;"
								>
									<div style="min-width: 0;">
										<strong>{sub.name}</strong>
										<div style="color: #57606a; font-size: 0.82rem;">
											{sub.trade ?? 'Trade not set'} · {sub.tier === 'trusted' ? 'Trusted' : 'Guest'}
										</div>
									</div>
									<form method="POST" action="?/unassignSub" use:enhance>
										<input type="hidden" name="subcontractorId" value={sub.id} />
										<button
											type="submit"
											style="border: 1px solid #cf222e; color: #cf222e; background: #fff; border-radius: 8px; padding: 0.3rem 0.7rem; font-weight: 600; cursor: pointer; font-size: 0.82rem;"
											>Remove</button
										>
									</form>
								</div>
							{/each}
						</div>
					{/if}

					{#if data.availableSubs.length === 0 && data.assignedSubs.length > 0}
						<p style="margin: 0; color: #57606a; font-size: 0.82rem;">
							All your subcontractors are assigned to this job.
						</p>
					{:else if data.availableSubs.length === 0}
						<p style="margin: 0; color: #57606a; font-size: 0.82rem;">
							Add subcontractors in the <a href="/contractor/subcontractors">Subcontractors</a> page to
							assign them here.
						</p>
					{/if}
				</section>

				<!-- Attachments -->
				<section style={card}>
					<div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;">
						<h2 style={sectionTitle}>Attachments</h2>
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
							<ul style="margin: 0; padding-left: 1.1rem; font-size: 0.9rem; color: #57606a; display: grid; gap: 0.3rem;">
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
								{@const href = `/contractor/orders/${order.id}/attachment/${att.id}`}
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

				<!-- Danger zone -->
				<section style={card}>
					<h2 style={sectionTitle}>Danger zone</h2>
					{#if confirmingDelete}
						<div
							style="display: grid; gap: 0.5rem; background: #fff8f8; border: 1px solid #ffd7d5; border-radius: 10px; padding: 0.6rem 0.75rem;"
						>
							<span style="font-size: 0.88rem; color: #57606a;"
								>Delete this order and its entire timeline? This can’t be undone.</span
							>
							<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
								<form method="POST" action="?/deleteOrder" use:enhance>
									<button
										type="submit"
										style="padding: 0.4rem 0.85rem; border-radius: 999px; border: 1px solid #cf222e; background: #cf222e; color: #fff; cursor: pointer;"
										>Yes, delete</button
									>
								</form>
								<button
									type="button"
									onclick={() => (confirmingDelete = false)}
									style="padding: 0.4rem 0.85rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer;"
									>Cancel</button
								>
							</div>
						</div>
					{:else}
						<button
							type="button"
							onclick={() => (confirmingDelete = true)}
							style="justify-self: start; padding: 0.45rem 0.9rem; border-radius: 999px; border: 1px solid #cf222e; background: #fff; color: #cf222e; cursor: pointer;"
							>Delete order</button
						>
					{/if}
				</section>
			</div>
		</div>
	</div>
</div>

<style>
	.page {
		max-width: 1040px;
		margin: 0 auto;
		padding: 1.25rem 1rem 2.5rem;
		display: grid;
		gap: 1rem;
	}
	.order-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: start;
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
	/* Contact composer popover anchored to the 💬 button, with an invite action
	   tucked under the composer. */
	.contact-pop {
		position: absolute;
		right: 0;
		top: calc(100% + 6px);
		z-index: 20;
		width: 280px;
		max-width: 82vw;
		background: #fff;
		border: 1px solid #d0d7de;
		border-radius: 12px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
		padding: 0.75rem;
		display: grid;
		gap: 0.6rem;
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
	.order-title {
		margin: 0;
		font-family: 'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif;
		font-size: 1.5rem;
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
	/* Tap-to-assign subcontractor rows: full-width, big touch targets, with a
	   purple accent that ties into the icon buttons. */
	.sub-pick {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.65rem;
		text-align: left;
		padding: 0.55rem 0.65rem;
		border: 1px solid #e2e6ea;
		border-radius: 12px;
		background: #fff;
		cursor: pointer;
		transition:
			border-color 0.1s ease,
			background 0.1s ease;
	}
	.sub-pick:hover,
	.sub-pick:focus-visible {
		border-color: #c9b8f0;
		background: #faf7ff;
		outline: none;
	}
	.sub-pick:active {
		background: #efe6ff;
	}
	.sub-pick-avatar {
		flex-shrink: 0;
		width: 2rem;
		height: 2rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		background: #efe6ff;
		color: #5b3fa8;
		font-weight: 800;
		font-size: 0.85rem;
	}
	.sub-pick-add {
		flex-shrink: 0;
		width: 1.7rem;
		height: 1.7rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
		background: #efe6ff;
		color: #5b3fa8;
		font-size: 1.1rem;
	}

	/* Two-column working layout on desktop; single column when it gets tight. */
	.detail-grid {
		display: grid;
		gap: 1rem;
		align-items: start;
		grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
	}
	.col {
		display: grid;
		gap: 1rem;
		align-content: start;
		min-width: 0;
	}
	@media (max-width: 800px) {
		.detail-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
