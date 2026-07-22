<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatBytes, MAX_ATTACHMENT_BYTES, QUICK_UPDATE_STATES } from '$lib/crm';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const order = $derived(data.order);
	const customer = $derived(data.customer);

	let confirmingDelete = $state(false);

	function toDateInput(d: Date | string | null): string {
		if (!d) return '';
		return new Date(d).toISOString().slice(0, 10);
	}
	function fmtDate(d: Date | string | null): string {
		return d ? new Date(d).toLocaleDateString() : '—';
	}
	const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

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
		<a href="/contractor/orders" style="color: #0969da; font-size: 0.9rem; text-decoration: none;"
			>← Orders</a
		>

		<!-- Header: customer name leads, project is the subtitle -->
		<header class="order-head">
			<div style="display: grid; gap: 0.3rem; min-width: 0;">
				<h1 style="margin: 0; font-size: 1.5rem; line-height: 1.15;">{order.customerName}</h1>
				<span style="color: #57606a; font-weight: 600;"
					>{order.projectName ?? 'Untitled project'}{#if typeSuffix(order.projectName, order.projectType)} · {typeSuffix(
							order.projectName,
							order.projectType
						)}{/if}</span
				>
			</div>
			<span
				style="font-size: 0.82rem; font-weight: 700; white-space: nowrap; color: {badge.fg}; background: {badge.bg}; border: 1px solid {badge.border}; border-radius: 999px; padding: 0.25rem 0.8rem;"
				>{order.state}</span
			>
		</header>

		{#if form?.message}
			<p
				style="margin: 0; color: #cf222e; font-size: 0.9rem; background: #ffebe9; border: 1px solid #ffd7d5; border-radius: 10px; padding: 0.6rem 0.8rem;"
			>
				{form.message}
			</p>
		{/if}

		<div class="detail-grid">
			<!-- Main column: the working surface — status, follow-up, activity -->
			<div class="col">
				<!-- Status -->
				<section style={card}>
					<h2 style={sectionTitle}>Update status</h2>
					<form method="POST" action="?/updateStatus" use:enhance style="display: grid; gap: 0.6rem;">
						<div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
							<select name="state" aria-label="Order status" style="flex: 1; min-width: 180px; {field}">
								{#each QUICK_UPDATE_STATES as s (s)}
									<option value={s} selected={s === order.state}>{s}</option>
								{/each}
							</select>
							<button type="submit" style={primaryBtn}>Save status</button>
						</div>
						<input name="note" placeholder="Optional note to record with this change" style={field} />
					</form>
				</section>

				<!-- Follow-up -->
				<section style={card}>
					<h2 style={sectionTitle}>Follow-up</h2>
					<div style="font-size: 0.95rem;">
						Next: <strong style="color: {order.followUpDue ? '#cf222e' : '#1f2328'};"
							>{fmtDate(order.nextFollowUpAt)}</strong
						>
						{#if order.followUpDue}
							<span
								style="font-size: 0.72rem; font-weight: 700; color: #cf222e; background: #ffebe9; border: 1px solid #e5534b; border-radius: 999px; padding: 0.1rem 0.5rem; margin-left: 0.3rem;"
								>Needs update</span
							>
						{/if}
					</div>
					<div style="display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center;">
						<form method="POST" action="?/snoozeFollowUp" use:enhance>
							<input type="hidden" name="preset" value="1d" />
							<button type="submit" style={pill}>+1 day</button>
						</form>
						<form method="POST" action="?/snoozeFollowUp" use:enhance>
							<input type="hidden" name="preset" value="3d" />
							<button type="submit" style={pill}>+3 days</button>
						</form>
						<form method="POST" action="?/snoozeFollowUp" use:enhance>
							<input type="hidden" name="preset" value="1w" />
							<button type="submit" style={pill}>+1 week</button>
						</form>
						{#if order.nextFollowUpAt}
							<form method="POST" action="?/clearFollowUp" use:enhance>
								<button type="submit" style="{pill} color: #cf222e;">Clear</button>
							</form>
						{/if}
					</div>
					<form
						method="POST"
						action="?/setFollowUp"
						use:enhance
						style="display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap;"
					>
						<input
							type="date"
							name="date"
							value={toDateInput(order.nextFollowUpAt)}
							style="flex: 1; min-width: 150px; {field}"
						/>
						<button type="submit" style={pill}>Set date</button>
					</form>
				</section>

				<!-- Timeline + add note -->
				<section style={card}>
					<h2 style={sectionTitle}>Timeline</h2>
					<form
						method="POST"
						action="?/addNote"
						use:enhance
						style="display: flex; gap: 0.5rem; align-items: center;"
					>
						<input name="note" placeholder="Add an internal note…" required style="flex: 1; {field}" />
						<button type="submit" style={primaryBtn}>Add note</button>
					</form>

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
					<h2 style={sectionTitle}>Customer</h2>
					{#if customer}
						<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
							<a
								href={`mailto:${customer.email}`}
								style="padding: 0.5rem 0.9rem; border-radius: 999px; border: 1px solid #0969da; background: #0969da; color: #fff; text-decoration: none; font-weight: 500;"
								>✉ Email</a
							>
							{#if customer.phone}
								<a
									href={telHref(customer.phone)}
									style="padding: 0.5rem 0.9rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; color: inherit; text-decoration: none;"
									>📞 Call</a
								>
							{/if}
						</div>
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
						{#if order.customerId}
							<form method="POST" action="?/sendInvite" use:enhance>
								<input type="hidden" name="customerId" value={order.customerId} />
								<button type="submit" style="{pill} width: 100%;">Invite customer</button>
							</form>
						{/if}
					{:else}
						<p style="margin: 0; color: #57606a;">No customer linked to this order.</p>
					{/if}
				</section>

				<!-- Assigned subcontractors -->
				<section style={card}>
					<h2 style={sectionTitle}>Assigned subcontractors</h2>
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

					{#if data.availableSubs.length > 0}
						<form
							method="POST"
							action="?/assignSub"
							use:enhance
							style="display: flex; gap: 0.5rem; flex-wrap: wrap;"
						>
							<select
								name="subcontractorId"
								required
								style="flex: 1; min-width: 160px; padding: 0.5rem; border: 1px solid #d0d7de; border-radius: 8px;"
							>
								<option value="" disabled selected>Assign a subcontractor…</option>
								{#each data.availableSubs as sub (sub.id)}
									<option value={sub.id}>
										{sub.name}{sub.trade ? ` — ${sub.trade}` : ''} ({sub.tier === 'trusted'
											? 'Trusted'
											: 'Guest'})
									</option>
								{/each}
							</select>
							<button type="submit" style={pill}>Assign</button>
						</form>
					{:else if data.assignedSubs.length > 0}
						<p style="margin: 0; color: #57606a; font-size: 0.82rem;">
							All your subcontractors are assigned to this job.
						</p>
					{:else}
						<p style="margin: 0; color: #57606a; font-size: 0.82rem;">
							Add subcontractors in the <a href="/contractor/subcontractors">Subcontractors</a> page to
							assign them here.
						</p>
					{/if}
				</section>

				<!-- Attachments -->
				<section style={card}>
					<h2 style={sectionTitle}>Attachments</h2>

					<form
						method="POST"
						action="?/uploadAttachment"
						enctype="multipart/form-data"
						use:enhance
						style="display: grid; gap: 0.4rem;"
					>
						<input
							type="file"
							name="file"
							accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
							required
							style="font-size: 0.85rem;"
						/>
						<div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
							<button type="submit" style={primaryBtn}>Upload</button>
							<span style="font-size: 0.75rem; color: #8c959f;"
								>Images or PDF · max {formatBytes(MAX_ATTACHMENT_BYTES)}</span
							>
						</div>
					</form>

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
