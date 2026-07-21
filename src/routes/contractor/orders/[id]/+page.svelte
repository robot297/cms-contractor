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

	const STATUS_COLORS: Record<string, { bg: string; border: string; fg: string }> = {
		'Work Complete': { bg: '#e6f4ea', border: '#79c98d', fg: '#1a7f37' },
		'Work Cancelled': { bg: '#f6f8fa', border: '#d0d7de', fg: '#57606a' },
		'On Hold / Archived': { bg: '#f6f8fa', border: '#d0d7de', fg: '#57606a' },
		'In Progress': { bg: '#ddf4ff', border: '#54aeff', fg: '#0969da' },
		'Work Scheduled': { bg: '#ddf4ff', border: '#54aeff', fg: '#0969da' }
	};
	const DEFAULT_STATUS_COLOR = { bg: '#fff8e6', border: '#d4a72c', fg: '#9a6700' };
	const badge = $derived(STATUS_COLORS[order.state] ?? DEFAULT_STATUS_COLOR);

	const field = 'padding: 0.5rem; border-radius: 8px; border: 1px solid #d0d7de; font-size: 1rem;';
	const pill =
		'padding: 0.4rem 0.75rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer; font-size: 0.85rem;';
	const primaryBtn =
		'padding: 0.55rem 1rem; border-radius: 999px; border: 1px solid #0969da; background: #0969da; color: #fff; cursor: pointer; font-weight: 500;';
	const card =
		'border: 1px solid #d0d7de; border-radius: 16px; padding: 1rem 1.1rem; display: grid; gap: 0.75rem;';
	const sectionTitle = 'margin: 0; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: #8c959f;';
</script>

<svelte:head>
	<title>{order.projectName ?? 'Order'}</title>
</svelte:head>

<div style="max-width: 760px; margin: 0 auto; padding: 1rem; display: grid; gap: 1rem;">
	<a href="/contractor/orders" style="color: #0969da; font-size: 0.9rem; text-decoration: none;"
		>← Orders</a
	>

	<!-- Header -->
	<header style="display: flex; justify-content: space-between; gap: 1rem; align-items: start;">
		<div style="display: grid; gap: 0.25rem;">
			<h1 style="margin: 0; font-size: 1.4rem;">{order.projectName ?? 'Untitled project'}</h1>
			{#if order.projectType}<span style="color: #57606a;">{order.projectType}</span>{/if}
		</div>
		<span
			style="font-size: 0.82rem; font-weight: 600; white-space: nowrap; color: {badge.fg}; background: {badge.bg}; border: 1px solid {badge.border}; border-radius: 999px; padding: 0.2rem 0.7rem;"
			>{order.state}</span
		>
	</header>

	{#if form?.message}
		<p style="margin: 0; color: #cf222e; font-size: 0.9rem;">{form.message}</p>
	{/if}

	<!-- Customer -->
	<section style={card}>
		<h2 style={sectionTitle}>Customer</h2>
		{#if customer}
			<div style="display: grid; gap: 0.3rem; font-size: 0.95rem;">
				<strong>{customer.name}</strong>
				<div><span style="color: #57606a;">Email:</span> {customer.email}</div>
				{#if customer.phone}<div><span style="color: #57606a;">Phone:</span> {customer.phone}</div>{/if}
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
					<button type="submit" style={pill}>Invite customer ({customer.email})</button>
				</form>
			{/if}
		{:else}
			<p style="margin: 0; color: #57606a;">No customer linked to this order.</p>
		{/if}
	</section>

	<!-- Status -->
	<section style={card}>
		<h2 style={sectionTitle}>Update status</h2>
		<form
			method="POST"
			action="?/updateStatus"
			use:enhance
			style="display: grid; gap: 0.6rem;"
		>
			<div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
				<select name="state" aria-label="Order status" style={field}>
					{#each QUICK_UPDATE_STATES as s (s)}
						<option value={s} selected={s === order.state}>{s}</option>
					{/each}
				</select>
				<button type="submit" style={primaryBtn}>Save status</button>
			</div>
			<input
				name="note"
				placeholder="Optional note to record with this change"
				style={field}
			/>
		</form>
	</section>

	<!-- Follow-up -->
	<section style={card}>
		<h2 style={sectionTitle}>Follow-up</h2>
		<div style="display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; font-size: 0.9rem;">
			<span style="color: #57606a;"
				>Next: <strong style="color: #1f2328;">{fmtDate(order.nextFollowUpAt)}</strong></span
			>
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
			<span style="width: 1px; height: 20px; background: #d0d7de;"></span>
			<form
				method="POST"
				action="?/setFollowUp"
				use:enhance
				style="display: flex; gap: 0.35rem; align-items: center;"
			>
				<input type="date" name="date" value={toDateInput(order.nextFollowUpAt)} style={field} />
				<button type="submit" style={pill}>Set date</button>
			</form>
			{#if order.nextFollowUpAt}
				<form method="POST" action="?/clearFollowUp" use:enhance>
					<button type="submit" style="{pill} color: #cf222e;">Clear</button>
				</form>
			{/if}
		</div>
	</section>

	<!-- Attachments -->
	<section style={card}>
		<h2 style={sectionTitle}>Attachments</h2>

		<form
			method="POST"
			action="?/uploadAttachment"
			enctype="multipart/form-data"
			use:enhance
			style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;"
		>
			<input
				type="file"
				name="file"
				accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
				required
				style="font-size: 0.9rem;"
			/>
			<button type="submit" style={primaryBtn}>Upload</button>
			<span style="font-size: 0.78rem; color: #8c959f;"
				>Images or PDF · max {formatBytes(MAX_ATTACHMENT_BYTES)}</span
			>
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
								style="color: #0969da; text-decoration: none; word-break: break-word;">{att.filename}</a
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
		{/if}
		<div style="display: grid; gap: 0.5rem;">
			{#each data.timeline as entry (entry.id)}
				<div
					style="padding: 0.65rem 0.75rem; border-radius: 10px; background: {entry.internal
						? '#fffdf5'
						: '#f6f8fa'}; border: 1px solid {entry.internal ? '#f0e6c0' : '#eaeef2'}; display: grid; gap: 0.2rem;"
				>
					<div style="display: flex; justify-content: space-between; gap: 0.5rem; align-items: baseline;">
						<strong style="font-size: 0.92rem;">{entry.title}</strong>
						{#if entry.internal}
							<span style="font-size: 0.7rem; color: #9a6700;">internal</span>
						{/if}
					</div>
					{#if entry.detail}<div style="font-size: 0.9rem; color: #57606a; white-space: pre-wrap;">
							{entry.detail}
						</div>{/if}
					<div style="font-size: 0.75rem; color: #8c959f;">
						{new Date(entry.createdAt).toLocaleString()} · {entry.authorRole}
					</div>
				</div>
			{/each}
		</div>
	</section>

	<!-- Danger zone -->
	<section style={card}>
		<h2 style={sectionTitle}>Danger zone</h2>
		{#if confirmingDelete}
			<div
				style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; background: #fff8f8; border: 1px solid #ffd7d5; border-radius: 10px; padding: 0.6rem 0.75rem;"
			>
				<span style="font-size: 0.88rem; color: #57606a; flex: 1; min-width: 180px;"
					>Delete this order and its entire timeline? This can’t be undone.</span
				>
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
