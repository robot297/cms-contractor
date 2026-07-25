<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { formatPhone, tierLabel, TRADES, type SubcontractorTier } from '$lib/crm';
	import type { PageData } from './$types';

	const label = (tier: string) => tierLabel(tier as SubcontractorTier);

	let { data }: { data: PageData } = $props();

	// Live client-side search over the loaded roster (no round-trip).
	let q = $state('');
	const filtered = $derived(
		data.subcontractors.filter((s) => {
			const term = q.trim().toLowerCase();
			if (!term) return true;
			return (
				s.name.toLowerCase().includes(term) ||
				s.email.includes(term) ||
				(s.trade ?? '').toLowerCase().includes(term) ||
				(s.company ?? '').toLowerCase().includes(term)
			);
		})
	);

	let showAdd = $state(false);
	let editingId = $state<string | null>(null);
	let expandedId = $state<string | null>(null);
	// Which card's "Manage" menu is open (one at a time).
	let menuOpenId = $state<string | null>(null);
	// Destructive actions require an explicit confirm before firing.
	let confirmArchiveId = $state<string | null>(null);
	let confirmRevokeId = $state<string | null>(null);
	// Optional detail sections stay collapsed until toggled, to keep the card calm.
	let notesOpenId = $state<string | null>(null);
	let ordersOpenId = $state<string | null>(null);

	/** Collapse a card and clear any open menu / pending confirm tied to it. */
	function toggleCard(id: string) {
		expandedId = expandedId === id ? null : id;
		menuOpenId = null;
		confirmArchiveId = null;
		confirmRevokeId = null;
		notesOpenId = null;
		ordersOpenId = null;
	}

	// Progressive phone formatting as the contractor types.
	function onPhoneInput(e: Event) {
		const el = e.currentTarget as HTMLInputElement;
		el.value = formatPhone(el.value);
	}

	function toDateInput(d: string | Date | null): string {
		if (!d) return '';
		const date = typeof d === 'string' ? new Date(d) : d;
		return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
	}

	const tierChip = (tier: string) => (tier === 'trusted' ? 'chip-trusted' : 'chip-guest');
	const statusChip = (status: string) =>
		status === 'linked' ? 'chip-linked' : status === 'invited' ? 'chip-invited' : 'chip-unlinked';
</script>

<svelte:head><title>Subcontractors · Contractor CRM</title></svelte:head>

<svelte:window onkeydown={(e) => e.key === 'Escape' && showAdd && (showAdd = false)} />

<div class="wrap">
	<header class="head">
		<div>
			<h1 class="page-title">Subcontractors</h1>
			<p class="sub">Your trade partners — roster, tier, and job assignments.</p>
		</div>
	</header>

	<div class="search-row">
		<div class="search-field">
			<span class="search-icon" aria-hidden="true">🔍</span>
			<input
				class="search"
				type="search"
				placeholder="Search"
				aria-label="Search subcontractors"
				bind:value={q}
			/>
		</div>
		<button
			class="icon-btn add-btn"
			title="Add subcontractor"
			aria-label="Add subcontractor"
			onclick={() => (showAdd = true)}>＋</button
		>
	</div>

	{#if filtered.length === 0}
		<div class="empty">
			{#if data.subcontractors.length === 0}
				No subcontractors yet. Add your first trade partner to start assigning them to jobs.
			{:else}
				No subcontractors match “{q}”.
			{/if}
		</div>
	{/if}

	<div class="grid">
		{#each filtered as s (s.id)}
			<article class="card">
				<div class="card-top">
					{#if s.avatar}
						<img class="avatar" src={s.avatar} alt="" />
					{:else}
						<div class="avatar placeholder">{s.name.slice(0, 1).toUpperCase()}</div>
					{/if}
					<div class="who">
						<div class="name-row">
							<strong>{s.name}</strong>
							<span class="chip {tierChip(s.tier)}">{label(s.tier)}</span>
							<span class="chip {statusChip(s.status)}">{s.status}</span>
						</div>
						<div class="meta">
							{s.trade ?? 'Trade not set'}{s.company ? ` · ${s.company}` : ''}
						</div>
						<div class="meta small">{s.email}{s.phone ? ` · ${s.phone}` : ''}</div>
					</div>
					<button class="btn ghost" onclick={() => toggleCard(s.id)}>
						{expandedId === s.id ? 'Close' : 'Open'}
					</button>
				</div>

				{#if expandedId === s.id}
					<div class="detail">
						{#if editingId === s.id}
							<!-- ---------- Edit profile ---------- -->
							<form
								method="POST"
								action="?/editSubcontractor"
								use:enhance={() =>
									async ({ update, result }) => {
										await update({ reset: false });
										if (result.type === 'success') editingId = null;
									}}
							>
								<input type="hidden" name="id" value={s.id} />
								<div class="fields">
									<label>Name<input name="name" value={s.name} required /></label>
									<label>
										Email
										<input
											name="email"
											type="email"
											value={s.email}
											required
											disabled={s.status === 'linked'}
										/>
										{#if s.status === 'linked'}<span class="hint"
												>Locked — this sub has a linked login.</span
											>{/if}
									</label>
									<label
										>Phone<input name="phone" value={s.phone ?? ''} oninput={onPhoneInput} /></label
									>
									<label>
										Trade
										<input name="trade" value={s.trade ?? ''} list="trades" />
									</label>
									<label>Company<input name="company" value={s.company ?? ''} /></label>
									<label>
										Tier
										<select name="tier" value={s.tier}>
											<option value="guest">Guest Contractor</option>
											<option value="trusted">Trusted Subcontractor</option>
										</select>
									</label>
									<label
										>License #<input name="licenseNumber" value={s.licenseNumber ?? ''} /></label
									>
									<label
										>Insurance carrier<input
											name="insuranceCarrier"
											value={s.insuranceCarrier ?? ''}
										/></label
									>
									<label
										>Insurance expires<input
											name="insuranceExpiresAt"
											type="date"
											value={toDateInput(s.insuranceExpiresAt)}
										/></label
									>
									<label>Address<input name="address" value={s.address ?? ''} /></label>
									<label class="wide"
										>Tags<input
											name="tags"
											value={s.tags.join(', ')}
											placeholder="licensed, insured"
										/></label
									>
									<label class="wide"
										>Notes<textarea name="notes" rows="2">{s.notes ?? ''}</textarea></label
									>
								</div>
								<div class="row-actions">
									<button class="btn primary" type="submit">Save</button>
									<button class="btn ghost" type="button" onclick={() => (editingId = null)}
										>Cancel</button
									>
								</div>
							</form>
						{:else}
							<!-- ---------- Read-only profile ---------- -->
							<dl class="profile">
								<div>
									<dt>Tier</dt>
									<dd>{label(s.tier)}</dd>
								</div>
								<div>
									<dt>License #</dt>
									<dd>{s.licenseNumber ?? '—'}</dd>
								</div>
								<div>
									<dt>Insurance</dt>
									<dd>
										{s.insuranceCarrier ?? '—'}{s.insuranceExpiresAt
											? ` · exp ${toDateInput(s.insuranceExpiresAt)}`
											: ''}
									</dd>
								</div>
								<div>
									<dt>Address</dt>
									<dd>{s.address ?? '—'}</dd>
								</div>
								{#if s.tags.length}
									<div class="wide">
										<dt>Tags</dt>
										<dd>
											{#each s.tags as t (t)}<span class="tag">{t}</span>{/each}
										</dd>
									</div>
								{/if}
							</dl>

							<!-- Optional sections stay tucked away behind toggles to keep the card calm. -->
							<div class="reveals">
								<button
									type="button"
									class="reveal-btn"
									class:on={ordersOpenId === s.id}
									aria-expanded={ordersOpenId === s.id}
									onclick={() => (ordersOpenId = ordersOpenId === s.id ? null : s.id)}
								>
									<span class="chev">▸</span> Assigned orders ({s.assignedOrders.length})
								</button>
								{#if s.notes}
									<button
										type="button"
										class="reveal-btn icon-only"
										class:on={notesOpenId === s.id}
										title="Notes"
										aria-label={notesOpenId === s.id ? 'Hide notes' : 'Show notes'}
										aria-expanded={notesOpenId === s.id}
										onclick={() => (notesOpenId = notesOpenId === s.id ? null : s.id)}
									>
										📝
									</button>
								{/if}
							</div>

							{#if ordersOpenId === s.id}
								<div class="assigned">
									{#if s.assignedOrders.length === 0}
										<p class="muted">Not assigned to any orders yet.</p>
									{:else}
										<ul>
											{#each s.assignedOrders as o (o.id)}
												<li>
													<a href={resolve(`/contractor/orders/${o.id}`)}
														>{o.projectName ?? 'Untitled order'}</a
													>
													<span class="chip small">{o.state}</span>
												</li>
											{/each}
										</ul>
									{/if}
								</div>
							{/if}

							{#if notesOpenId === s.id && s.notes}
								<p class="notes-reveal">{s.notes}</p>
							{/if}

							<div class="row-actions">
								<!-- All management actions live behind one "Manage" menu so the card
								     isn't a wall of buttons. Destructive actions confirm first. -->
								<div class="manage">
									<button
										class="btn"
										aria-haspopup="menu"
										aria-expanded={menuOpenId === s.id}
										onclick={() => (menuOpenId = menuOpenId === s.id ? null : s.id)}
									>
										Manage ▾
									</button>
									{#if menuOpenId === s.id}
										<!-- click-away backdrop -->
										<button
											class="menu-scrim"
											type="button"
											aria-label="Close menu"
											onclick={() => (menuOpenId = null)}
										></button>
										<div class="menu" role="menu">
											<button
												class="menu-item"
												role="menuitem"
												onclick={() => {
													editingId = s.id;
													menuOpenId = null;
												}}>Edit profile</button
											>

											<form
												method="POST"
												action="?/setTier"
												use:enhance={() =>
													async ({ update }) => {
														menuOpenId = null;
														await update({ reset: false });
													}}
											>
												<input type="hidden" name="id" value={s.id} />
												<input
													type="hidden"
													name="tier"
													value={s.tier === 'trusted' ? 'guest' : 'trusted'}
												/>
												<button class="menu-item" role="menuitem" type="submit">
													Make {s.tier === 'trusted' ? 'Guest' : 'Trusted'}
												</button>
											</form>

											{#if s.status === 'unlinked'}
												<form
													method="POST"
													action="?/sendInvite"
													use:enhance={() =>
														async ({ update }) => {
															menuOpenId = null;
															await update();
														}}
												>
													<input type="hidden" name="id" value={s.id} />
													<button class="menu-item" role="menuitem" type="submit"
														>Send invite</button
													>
												</form>
											{:else if s.status === 'invited' && s.pendingInviteId}
												<form
													method="POST"
													action="?/resendInvite"
													use:enhance={() =>
														async ({ update }) => {
															menuOpenId = null;
															await update();
														}}
												>
													<input type="hidden" name="inviteId" value={s.pendingInviteId} />
													<button class="menu-item" role="menuitem" type="submit"
														>Resend invite</button
													>
												</form>
												<button
													class="menu-item danger"
													role="menuitem"
													onclick={() => {
														confirmRevokeId = s.id;
														menuOpenId = null;
													}}>Revoke invite…</button
												>
											{/if}

											<button
												class="menu-item danger"
												role="menuitem"
												onclick={() => {
													confirmArchiveId = s.id;
													menuOpenId = null;
												}}>Archive…</button
											>
										</div>
									{/if}
								</div>

								{#if s.status === 'linked'}
									<span class="chip chip-linked">Linked login</span>
								{/if}
							</div>

							<!-- Destructive confirms: an explicit "are you sure?" before firing. -->
							{#if confirmRevokeId === s.id && s.pendingInviteId}
								<div class="confirm-banner">
									<span class="confirm"
										>Revoke {s.name}’s pending invite? Their invite link stops working.</span
									>
									<form
										method="POST"
										action="?/revokeInvite"
										use:enhance={() =>
											async ({ update }) => {
												confirmRevokeId = null;
												await update();
											}}
									>
										<input type="hidden" name="inviteId" value={s.pendingInviteId} />
										<button class="btn danger" type="submit">Yes, revoke</button>
									</form>
									<button class="btn ghost" type="button" onclick={() => (confirmRevokeId = null)}
										>No</button
									>
								</div>
							{/if}

							{#if confirmArchiveId === s.id}
								<div class="confirm-banner">
									<span class="confirm">Archive {s.name}? They’ll be hidden from your roster.</span>
									<form
										method="POST"
										action="?/archiveSubcontractor"
										use:enhance={() =>
											async ({ update }) => {
												confirmArchiveId = null;
												await update();
											}}
									>
										<input type="hidden" name="id" value={s.id} />
										<button class="btn danger" type="submit">Yes, archive</button>
									</form>
									<button class="btn ghost" type="button" onclick={() => (confirmArchiveId = null)}
										>No</button
									>
								</div>
							{/if}
						{/if}
					</div>
				{/if}
			</article>
		{/each}
	</div>
</div>

<datalist id="trades">
	{#each TRADES as t (t)}<option value={t}></option>{/each}
</datalist>

<!-- ---------- Add-subcontractor modal ---------- -->
{#if showAdd}
	<div
		class="modal-backdrop"
		role="presentation"
		onclick={(e) => e.target === e.currentTarget && (showAdd = false)}
	>
		<div class="modal" role="dialog" aria-modal="true" aria-label="Add subcontractor" tabindex="-1">
			<button
				class="modal-close"
				type="button"
				title="Cancel"
				aria-label="Cancel"
				onclick={() => (showAdd = false)}>✕</button
			>
			<h2>Add subcontractor</h2>
			<p class="modal-sub">
				Add a trade partner to your roster — you can assign them to jobs afterward.
			</p>
			<form
				method="POST"
				action="?/addSubcontractor"
				use:enhance={() =>
					async ({ update, result }) => {
						await update();
						if (result.type === 'success') showAdd = false;
					}}
			>
				<div class="fields">
					<div class="group-label">Contact</div>
					<label>
						<span class="lbl">Name <span class="req" aria-hidden="true">*</span></span>
						<input name="name" required placeholder="Jordan Rivera" />
					</label>
					<label>
						<span class="lbl">Email <span class="req" aria-hidden="true">*</span></span>
						<input name="email" type="email" required placeholder="jordan@example.com" />
					</label>
					<label>
						<span class="lbl">Phone</span>
						<input name="phone" oninput={onPhoneInput} placeholder="(555) 123-4567" />
					</label>
					<label>
						<span class="lbl">Company</span>
						<input name="company" placeholder="Rivera Electric" />
					</label>

					<div class="group-label">Trade &amp; access</div>
					<label>
						<span class="lbl">Trade</span>
						<input name="trade" list="trades" placeholder="e.g. Electrical" />
					</label>
					<label>
						<span class="lbl">Tier</span>
						<select name="tier">
							<option value="guest">Guest Contractor</option>
							<option value="trusted">Trusted Subcontractor</option>
						</select>
					</label>
					<p class="form-note">
						Guests are read-only and never see customer contact details. Trusted subs get full order
						access.
					</p>

					<div class="group-label">Compliance <span class="opt">optional</span></div>
					<label>
						<span class="lbl">License #</span>
						<input name="licenseNumber" placeholder="EC-100420" />
					</label>
					<label>
						<span class="lbl">Insurance carrier</span>
						<input name="insuranceCarrier" placeholder="Acme Mutual" />
					</label>
					<label>
						<span class="lbl">Insurance expires</span>
						<input name="insuranceExpiresAt" type="date" />
					</label>
					<label>
						<span class="lbl">Tags</span>
						<input name="tags" placeholder="licensed, insured" />
					</label>
				</div>
				<div class="row-actions end">
					<button class="btn ghost" type="button" onclick={() => (showAdd = false)}>Cancel</button>
					<button class="btn primary" type="submit">Add subcontractor</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<style>
	.wrap {
		max-width: 860px;
		margin: 0 auto;
		padding: 1.5rem 1rem 3rem;
	}
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	h1 {
		margin: 0;
		font-size: 1.6rem;
	}
	.sub {
		margin: 0.2rem 0 0;
		color: #555;
		font-weight: 600;
	}
	.search-row {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		margin: 1rem 0;
	}
	.search-field {
		position: relative;
		flex: 1;
		min-width: 0;
	}
	.search-icon {
		position: absolute;
		left: 0.85rem;
		top: 50%;
		transform: translateY(-50%);
		pointer-events: none;
		font-size: 0.95rem;
		color: #8c959f;
	}
	.search {
		width: 100%;
		box-sizing: border-box;
		padding: 0.7rem 0.9rem 0.7rem 2.5rem;
		border: 1.5px solid #d9dde3;
		border-radius: 10px;
		font-size: 1rem;
	}
	.search:focus {
		outline: none;
		border-color: #a98be2;
		box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.16);
	}
	.add-btn {
		flex-shrink: 0;
		width: 2.9rem;
		height: 2.9rem;
		font-size: 1.75rem;
	}
	.grid {
		display: grid;
		gap: 0.9rem;
	}
	.card {
		border: 1px solid #e2e6ea;
		border-radius: 16px;
		background: #fff;
		box-shadow:
			0 1px 2px rgba(27, 31, 36, 0.05),
			0 4px 12px rgba(27, 31, 36, 0.06);
	}
	.card-top {
		display: flex;
		gap: 0.8rem;
		align-items: center;
		padding: 0.9rem;
	}
	.avatar {
		width: 46px;
		height: 46px;
		border-radius: 50%;
		object-fit: cover;
		border: 1px solid #d0d7de;
		flex-shrink: 0;
	}
	.avatar.placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, #e7edf3, #f6f8fa);
		color: #44506b;
		font-weight: 700;
	}
	.who {
		flex: 1;
		min-width: 0;
	}
	.name-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.meta {
		color: #444;
		font-weight: 600;
		font-size: 0.9rem;
		margin-top: 0.15rem;
	}
	.meta.small {
		font-size: 0.82rem;
		color: #777;
	}
	.chip {
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		border: 1px solid transparent;
	}
	.chip.small {
		font-size: 0.62rem;
	}
	.chip-trusted {
		background: #e6f4ea;
		border-color: #4ea866;
		color: #1a7f37;
	}
	.chip-guest {
		background: #f6f8fa;
		border-color: #d0d7de;
		color: #57606a;
	}
	.chip-linked {
		background: #ddf4ff;
		border-color: #54aeff;
		color: #0757ba;
	}
	.chip-invited {
		background: #fff4d6;
		border-color: #d4a72c;
		color: #8a5a00;
	}
	.chip-unlinked {
		background: #f6f8fa;
		border-color: #e4e8ee;
		color: #8c959f;
	}
	.detail {
		border-top: 1px solid #eef1f4;
		padding: 0.9rem;
		display: grid;
		gap: 1rem;
	}
	.profile {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem 1rem;
		margin: 0;
	}
	.profile .wide {
		grid-column: 1 / -1;
	}
	.profile dt {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: #777;
		font-weight: 800;
	}
	.profile dd {
		margin: 0;
		font-weight: 600;
	}
	.tag {
		display: inline-block;
		background: #f1f5f9;
		border: 1px solid #cbd5e1;
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
		margin: 0 0.25rem 0.25rem 0;
		font-size: 0.78rem;
		font-weight: 700;
	}
	/* Toggle row for the optional (notes / assigned orders) sections. */
	.reveals {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.reveal-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.7rem;
		border: 1.5px solid #d9dde3;
		border-radius: 999px;
		background: #fff;
		color: #1f2328;
		font-weight: 600;
		font-size: 0.82rem;
		cursor: pointer;
	}
	.reveal-btn:hover {
		background: #f6f8fa;
	}
	.reveal-btn.on {
		background: #eef1f5;
		border-color: #c7ccd4;
	}
	.reveal-btn.icon-only {
		padding: 0.35rem 0.55rem;
		font-size: 0.95rem;
		line-height: 1;
	}
	.reveal-btn .chev {
		color: #8b949e;
		font-size: 0.72rem;
		transition: transform 0.15s ease;
	}
	.reveal-btn.on .chev {
		transform: rotate(90deg);
	}
	.notes-reveal {
		margin: 0;
		white-space: pre-wrap;
		font-weight: 500;
		color: #444;
		font-size: 0.9rem;
		background: #f9fafb;
		border: 1px solid #eef1f4;
		border-radius: 10px;
		padding: 0.6rem 0.7rem;
	}
	.assigned ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.35rem;
	}
	.assigned li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.muted {
		color: #888;
		margin: 0;
	}
	.fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem 1rem;
	}
	.fields .wide {
		grid-column: 1 / -1;
	}
	.fields label {
		display: grid;
		gap: 0.3rem;
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: none;
		letter-spacing: normal;
		color: #57606a;
	}
	.fields input,
	.fields select,
	.fields textarea {
		padding: 0.6rem 0.7rem;
		border: 1.5px solid #d9dde3;
		border-radius: 9px;
		font-size: 0.95rem;
		font-weight: 500;
		text-transform: none;
		background: #fff;
		color: #1f2328;
		transition:
			border-color 0.12s ease,
			box-shadow 0.12s ease;
	}
	.fields input::placeholder,
	.fields textarea::placeholder {
		color: #b3b9c2;
	}
	.fields input:focus,
	.fields select:focus,
	.fields textarea:focus {
		outline: none;
		border-color: #a98be2;
		box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.16);
	}
	.fields input:disabled {
		background: #f4f5f7;
		color: #8c959f;
	}
	/* Section divider inside the field grid — turns a 10-field wall into
	   scannable groups. */
	.group-label {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin-top: 0.35rem;
		padding-bottom: 0.3rem;
		border-bottom: 1px solid #eef0f3;
		font-size: 0.72rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #8c959f;
	}
	.group-label:first-child {
		margin-top: 0;
	}
	.opt {
		font-size: 0.62rem;
		font-weight: 700;
		color: #8c959f;
		background: #f2f3f5;
		border-radius: 999px;
		padding: 0.05rem 0.45rem;
		text-transform: none;
		letter-spacing: 0;
	}
	.req {
		color: #cf222e;
		font-weight: 900;
	}
	.form-note {
		grid-column: 1 / -1;
		margin: -0.25rem 0 0.1rem;
		font-size: 0.78rem;
		font-weight: 500;
		color: #8c959f;
		line-height: 1.35;
	}
	.hint {
		font-weight: 600;
		text-transform: none;
		color: #999;
		font-size: 0.72rem;
	}
	.row-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.6rem;
	}
	.row-actions form {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.confirm {
		font-weight: 800;
	}
	/* "Manage" dropdown: one button opens the full action set. */
	.manage {
		position: relative;
	}
	.menu-scrim {
		position: fixed;
		inset: 0;
		z-index: 30;
		background: transparent;
		border: none;
		cursor: default;
	}
	.menu {
		position: absolute;
		left: 0;
		top: calc(100% + 6px);
		z-index: 40;
		min-width: 190px;
		background: #fff;
		border: 1px solid #d0d7de;
		border-radius: 12px;
		box-shadow: 0 8px 24px rgba(27, 31, 36, 0.16);
		padding: 0.3rem;
		display: grid;
		gap: 0.15rem;
	}
	.menu form {
		display: block;
	}
	.menu-item {
		width: 100%;
		text-align: left;
		padding: 0.5rem 0.6rem;
		border: none;
		border-radius: 7px;
		background: #fff;
		font-weight: 700;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.menu-item:hover {
		background: #f2f4f7;
	}
	.menu-item.danger {
		color: #b91c1c;
	}
	.menu-item.danger:hover {
		background: #fdecec;
	}
	/* Destructive confirm prompt, visually flagged in red. */
	.confirm-banner {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.6rem;
		padding: 0.55rem 0.7rem;
		border: 1px solid #f0c0c4;
		border-radius: 10px;
		background: #fff5f5;
	}
	.confirm-banner form {
		display: inline-flex;
	}
	/* Reorder arrows on collapsed template/roster rows. */
	.icon {
		width: 1.9rem;
		height: 1.9rem;
		border: 1.5px solid #d9dde3;
		border-radius: 8px;
		background: #fff;
		cursor: pointer;
		font-size: 0.9rem;
		line-height: 1;
	}
	.icon:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.btn {
		padding: 0.5rem 0.9rem;
		border: 1.5px solid #d0d7de;
		border-radius: 9px;
		background: #fff;
		color: #1f2328;
		font-weight: 600;
		cursor: pointer;
		font-size: 0.85rem;
	}
	.btn:hover {
		background: #f6f8fa;
	}
	.btn.primary {
		background: #0969da;
		border-color: #0969da;
		color: #fff;
	}
	.btn.primary:hover {
		background: #0757ba;
	}
	.btn.danger {
		background: #cf222e;
		border-color: #cf222e;
		color: #fff;
	}
	.btn.danger:hover {
		background: #b91c1c;
	}
	.btn.danger.ghost {
		background: #fff;
		color: #cf222e;
		border-color: #f0c0c4;
	}
	.btn.danger.ghost:hover {
		background: #fdeff0;
	}
	.btn.ghost {
		background: transparent;
	}
	.empty {
		border: 1.5px dashed #d0d7de;
		border-radius: 12px;
		padding: 1.5rem;
		text-align: center;
		color: #57606a;
		font-weight: 600;
		margin-bottom: 1rem;
	}
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		z-index: 100;
	}
	.modal {
		position: relative;
		background: #fff;
		border: 1px solid #d0d7de;
		border-radius: 16px;
		box-shadow: 0 20px 48px rgba(27, 31, 36, 0.28);
		padding: 1.25rem;
		width: 100%;
		max-width: 560px;
		max-height: 90dvh;
		overflow-y: auto;
	}
	.modal-close {
		position: absolute;
		top: 0.85rem;
		right: 0.85rem;
		width: 2rem;
		height: 2rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: 8px;
		background: #f2f3f5;
		color: #57606a;
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
	}
	.modal-close:hover {
		background: #e6e8eb;
		color: #1f2328;
	}
	.modal h2 {
		margin: 0 0 0.15rem;
		padding-right: 2.5rem;
		font-family: 'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif;
		font-size: 1.25rem;
		font-weight: 700;
		text-transform: none;
		letter-spacing: -0.01em;
	}
	.modal-sub {
		margin: 0 0 1.1rem;
		color: #57606a;
		font-size: 0.85rem;
		font-weight: 500;
		line-height: 1.4;
	}
	.row-actions.end {
		justify-content: flex-end;
		margin-top: 1rem;
		padding-top: 0.9rem;
		border-top: 1px solid #eef0f3;
	}
	@media (max-width: 560px) {
		.fields,
		.profile {
			grid-template-columns: 1fr;
		}
		/* Full-width, thumb-friendly actions; primary sits on top. */
		.modal .row-actions.end {
			flex-direction: column-reverse;
		}
		.modal .row-actions.end .btn {
			width: 100%;
		}
	}
</style>
