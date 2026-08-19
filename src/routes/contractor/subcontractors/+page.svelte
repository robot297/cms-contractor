<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { formatPhone, tierLabel, TRADES, type SubcontractorTier } from '$lib/crm';
	import AlphaRail from '$lib/AlphaRail.svelte';
	import ContactPanel from '$lib/ContactPanel.svelte';
	import IdScanner from '$lib/IdScanner.svelte';
	import TagPicker from '$lib/TagPicker.svelte';
	import type { SubcontractorScanFields } from '$lib/id-scan';
	import type { PageData } from './$types';

	const label = (tier: string) => tierLabel(tier as SubcontractorTier);

	let { data }: { data: PageData } = $props();

	// Trial capacity, from the contractor layout. Null on paid/comped (uncapped).
	const atSubLimit = $derived(data.billing.limits?.subcontractor.atLimit ?? false);

	type SubRow = (typeof data.subcontractors)[number];

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

	// --- Phone-book directory: grouped sections + A–Z jump rail ------------
	// Same lookup the customers page has, with one extra dial: group by the
	// person (letter sections) or by the company they trade under. Subs with no
	// company collect in an "Independent" section at the end.
	let groupBy = $state<'name' | 'company'>('name');
	const INDEPENDENT = 'Independent';
	function letterOf(text: string): string {
		const ch = text.trim().charAt(0).toUpperCase();
		return /[A-Z]/.test(ch) ? ch : '#';
	}
	type SubGroup = { key: string; label: string; letter: string; items: SubRow[] };
	const groups = $derived.by((): SubGroup[] => {
		const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
		if (groupBy === 'name') {
			const buckets: Record<string, SubRow[]> = {};
			for (const s of sorted) (buckets[letterOf(s.name)] ??= []).push(s);
			return Object.entries(buckets)
				.sort((a, b) => a[0].localeCompare(b[0]))
				.map(([letter, items]) => ({ key: letter, label: letter, letter, items }));
		}
		const buckets: Record<string, SubRow[]> = {};
		for (const s of sorted) (buckets[s.company?.trim() || INDEPENDENT] ??= []).push(s);
		return Object.entries(buckets)
			.sort(([a], [b]) => (a === INDEPENDENT ? 1 : b === INDEPENDENT ? -1 : a.localeCompare(b)))
			.map(([company, items]) => ({
				key: `co-${company}`,
				label: company,
				letter: company === INDEPENDENT ? '#' : letterOf(company),
				items
			}));
	});
	const presentLetters = $derived(new Set(groups.map((g) => g.letter)));
	// In company mode several sections can share a letter — jump to the first.
	function jumpTo(letter: string) {
		const target = groups.find((g) => g.letter === letter);
		if (target)
			document.getElementById(`sub-sec-${target.key}`)?.scrollIntoView({ block: 'start' });
	}

	// Seeded once per page load (untrack: closing it must not spring back open).
	// `data.openAdd` is now only ever true for an explicit `?new` — see the note in
	// +page.server.ts. Still never auto-opens at the trial limit: a form they can't
	// submit is a worse greeting than the roster itself.
	let showAdd = $state(untrack(() => data.openAdd && !atSubLimit));
	let editingId = $state<string | null>(null);
	let expandedId = $state<string | null>(null);
	// Which card's "Manage" menu is open (one at a time).
	let menuOpenId = $state<string | null>(null);
	// Destructive actions require an explicit confirm before firing.
	let confirmArchiveId = $state<string | null>(null);
	let confirmRevokeId = $state<string | null>(null);
	// The detail pane is tabbed; each card opens on its first tab.
	let detailTab = $state<'details' | 'orders' | 'notes'>('details');
	// Which card's link-status tooltip is currently pinned open (mobile tap).
	let statusTipId = $state<string | null>(null);
	// Same, for the trusted medal.
	let trustTipId = $state<string | null>(null);
	// Which card's contact composer popover is open.
	let contactOpenId = $state<string | null>(null);

	// --- ID Scan: fill a form off the card instead of typing it ---------------
	// Which form the scanner is open for: 'add', or a subcontractor's id.
	let scannerFor = $state<'add' | string | null>(null);
	// The add form's scannable fields are bound, so a scan lands in them directly.
	let addPrefill = $state({ name: '', address: '', licenseNumber: '', licenseExpiresAt: '' });
	// The edit form's are keyed by subcontractor, and read as an override of the
	// saved value — so a scan replaces what's shown and nothing is written until
	// the contractor saves.
	let editPrefill = $state<Record<string, SubcontractorScanFields>>({});

	/**
	 * Take what the contractor kept on the confirm sheet. Blank fields are left
	 * alone rather than blanked out: clearing a row on the confirm sheet is how
	 * you say "don't touch this one".
	 */
	function applyScan(fields: SubcontractorScanFields) {
		if (scannerFor === 'add') {
			addPrefill = {
				name: fields.name ?? addPrefill.name,
				address: fields.address ?? addPrefill.address,
				licenseNumber: fields.licenseNumber ?? addPrefill.licenseNumber,
				licenseExpiresAt: fields.licenseExpiresAt ?? addPrefill.licenseExpiresAt
			};
		} else if (scannerFor) {
			const current = editPrefill[scannerFor];
			editPrefill[scannerFor] = {
				name: fields.name ?? current?.name ?? null,
				address: fields.address ?? current?.address ?? null,
				licenseNumber: fields.licenseNumber ?? current?.licenseNumber ?? null,
				licenseExpiresAt: fields.licenseExpiresAt ?? current?.licenseExpiresAt ?? null
			};
		}
	}

	/** Collapse a card and clear any open menu / pending confirm tied to it. */
	function toggleCard(id: string) {
		expandedId = expandedId === id ? null : id;
		menuOpenId = null;
		confirmArchiveId = null;
		confirmRevokeId = null;
		statusTipId = null;
		trustTipId = null;
		detailTab = 'details';
	}

	/** Human label for a subcontractor's account-link status. */
	function statusLabel(status: string): string {
		return status === 'linked'
			? 'Linked — has an account'
			: status === 'invited'
				? 'Invite pending'
				: 'Not linked yet';
	}

	// Progressive phone formatting as the contractor types.
	function onPhoneInput(e: Event) {
		const el = e.currentTarget as HTMLInputElement;
		el.value = formatPhone(el.value);
	}

	/**
	 * An expiry as a status rather than a bare date — a lapsed certificate or a
	 * lapsed trade licence are the two facts on this profile that can stop a sub
	 * going on a job, and "exp 2026-02-14" makes the reader do that arithmetic
	 * themselves. Shared by both so they can't drift apart.
	 */
	function expiryStatus(d: string | Date | null): { label: string; tone: string } {
		if (!d) return { label: 'Not on file', tone: 'none' };
		const date = typeof d === 'string' ? new Date(d) : d;
		if (Number.isNaN(date.getTime())) return { label: 'Not on file', tone: 'none' };
		const on = date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
		const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
		if (days < 0) return { label: `Expired ${on}`, tone: 'bad' };
		if (days <= 30)
			return { label: `${days === 0 ? 'Expires today' : `${days}d left`} · ${on}`, tone: 'warn' };
		return { label: on, tone: 'ok' };
	}

	function toDateInput(d: string | Date | null): string {
		if (!d) return '';
		const date = typeof d === 'string' ? new Date(d) : d;
		return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
	}

	// --- Avatar photo (take / upload / remove) — mirrors the customer directory ---
	const AVATAR_MAX = 256;
	let savingAvatarId: string | null = $state(null);
	let cameraDialog: HTMLDialogElement | undefined = $state();
	let cameraVideo: HTMLVideoElement | undefined = $state();
	let cameraSubId: string | null = $state(null);
	let cameraError = $state('');
	let cameraStream: MediaStream | undefined;
	// 'choose' shows the options first; 'camera' is the live capture view.
	let cameraMode: 'choose' | 'camera' = $state('choose');
	const cameraSub = $derived(
		cameraSubId ? (data.subcontractors.find((s) => s.id === cameraSubId) ?? null) : null
	);

	/** Downscale a source (image or video frame) to a small JPEG data URL. */
	function toAvatarDataUrl(source: HTMLImageElement | HTMLVideoElement): string | null {
		const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
		const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
		if (!sw || !sh) return null;
		const scale = Math.min(1, AVATAR_MAX / Math.max(sw, sh));
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(sw * scale));
		canvas.height = Math.max(1, Math.round(sh * scale));
		const ctx = canvas.getContext('2d');
		if (!ctx) return null;
		ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
		return canvas.toDataURL('image/jpeg', 0.8);
	}

	async function persistAvatar(id: string, dataUrl: string) {
		savingAvatarId = id;
		try {
			const body = new FormData();
			body.set('id', id);
			body.set('avatar', dataUrl);
			const res = await fetch('?/setAvatar', {
				method: 'POST',
				headers: { 'x-sveltekit-action': 'true' },
				body
			});
			if (!res.ok) throw new Error('Upload failed');
			await invalidateAll();
		} catch {
			alert('Sorry — that photo could not be saved.');
		} finally {
			savingAvatarId = null;
		}
	}

	function loadImage(file: File): Promise<HTMLImageElement> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => {
				URL.revokeObjectURL(img.src);
				resolve(img);
			};
			img.onerror = () => {
				URL.revokeObjectURL(img.src);
				reject(new Error('Could not read image'));
			};
			img.src = URL.createObjectURL(file);
		});
	}

	/** File-picker fallback (desktop, or when the camera is unavailable). */
	async function onAvatarPick(id: string, e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		closeCamera();
		const img = await loadImage(file);
		const dataUrl = toAvatarDataUrl(img);
		if (dataUrl) await persistAvatar(id, dataUrl);
	}

	/** Open the photo modal on its chooser — does NOT turn the camera on yet. */
	function openCamera(id: string) {
		cameraSubId = id;
		cameraError = '';
		cameraMode = 'choose';
		cameraDialog?.showModal();
	}

	/** Explicitly start the live camera once the user chooses "Take photo". */
	async function startCamera() {
		cameraError = '';
		cameraMode = 'camera';
		if (!navigator.mediaDevices?.getUserMedia) {
			cameraError = 'This device has no camera access. Upload a photo instead.';
			return;
		}
		try {
			cameraStream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'environment' },
				audio: false
			});
			await tick();
			if (cameraVideo) cameraVideo.srcObject = cameraStream;
		} catch {
			cameraError = 'Camera permission was denied or unavailable. Upload a photo instead.';
		}
	}

	function stopCamera() {
		cameraStream?.getTracks().forEach((t) => t.stop());
		cameraStream = undefined;
		if (cameraVideo) cameraVideo.srcObject = null;
	}

	function closeCamera() {
		stopCamera();
		cameraMode = 'choose';
		cameraDialog?.close();
	}

	/** Clear a subcontractor's photo back to the initials placeholder. */
	async function removeAvatar(id: string) {
		savingAvatarId = id;
		try {
			const body = new FormData();
			body.set('id', id);
			body.set('avatar', '');
			const res = await fetch('?/setAvatar', {
				method: 'POST',
				headers: { 'x-sveltekit-action': 'true' },
				body
			});
			if (!res.ok) throw new Error('Remove failed');
			closeCamera();
			await invalidateAll();
		} catch {
			alert('Sorry — that photo could not be removed.');
		} finally {
			savingAvatarId = null;
		}
	}

	async function capturePhoto() {
		if (!cameraVideo || !cameraSubId) return;
		const dataUrl = toAvatarDataUrl(cameraVideo);
		const id = cameraSubId;
		closeCamera();
		if (dataUrl) await persistAvatar(id, dataUrl);
	}

	const tierChip = (tier: string) => (tier === 'trusted' ? 'chip-trusted' : 'chip-guest');
</script>

<svelte:head><title>Subcontractors · Contractor CRM</title></svelte:head>

<svelte:window onkeydown={(e) => e.key === 'Escape' && showAdd && (showAdd = false)} />

<!-- Account-link status as a small icon with a hover/tap tooltip. -->
{#snippet statusBadge(sub: SubRow)}
	<span class="status status-{sub.status}">
		<button
			type="button"
			class="status-icon"
			title={statusLabel(sub.status)}
			aria-label={statusLabel(sub.status)}
			onclick={() => (statusTipId = statusTipId === sub.id ? null : sub.id)}
		>
			{#if sub.status === 'linked'}
				<svg
					viewBox="0 0 24 24"
					width="15"
					height="15"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M9 17H7A5 5 0 0 1 7 7h2" />
					<path d="M15 7h2a5 5 0 0 1 0 10h-2" />
					<line x1="8" y1="12" x2="16" y2="12" />
				</svg>
			{:else if sub.status === 'invited'}
				<svg
					viewBox="0 0 24 24"
					width="15"
					height="15"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<circle cx="12" cy="12" r="9" />
					<path d="M12 8v4l2.5 1.5" />
				</svg>
			{:else}
				<svg
					viewBox="0 0 24 24"
					width="15"
					height="15"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M9 17H7A5 5 0 0 1 7 7" />
					<path d="M15 7h2a5 5 0 0 1 4 8" />
					<line x1="8" y1="12" x2="12" y2="12" />
					<line x1="3" y1="3" x2="21" y2="21" />
				</svg>
			{/if}
		</button>
		<span class="status-tip" class:show={statusTipId === sub.id}>{statusLabel(sub.status)}</span>
	</span>
{/snippet}

<!-- Tier on the collapsed card is a mark, not a word: a green medal means Trusted,
     and its absence means Guest. The full Guest/Trusted tag lives in the profile
     pane, where there's room to say what the tier actually grants. -->
{#snippet trustedMedal(sub: SubRow)}
	<span class="status medal">
		<button
			type="button"
			class="status-icon"
			title={tierLabel('trusted')}
			aria-label={tierLabel('trusted')}
			onclick={() => (trustTipId = trustTipId === sub.id ? null : sub.id)}
		>
			<svg
				viewBox="0 0 24 24"
				width="15"
				height="15"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<circle cx="12" cy="9" r="6" fill="currentColor" fill-opacity="0.16" />
				<path d="M8.6 14.4 7.2 21.5 12 19l4.8 2.5-1.4-7.1" />
			</svg>
		</button>
		<span class="status-tip" class:show={trustTipId === sub.id}>{tierLabel('trusted')}</span>
	</span>
{/snippet}

<!-- Geometry deliberately mirrors the customers directory — same full-bleed
     sunken page, same column padding and gaps, same sticky search row and pill
     field — so moving between the two directories doesn't feel like moving
     between two apps. Colors stay tokenised rather than copied across as hex,
     which is the one place the two files differ on purpose. -->
<div class="page">
	<div class="wrap">
		<header class="head">
			<h1 class="page-title">Subcontractors</h1>
			<!-- Only once there is something to count. "0 subcontractors" beside the
			     heading is a label restating the empty state below it, and it is the
			     first thing a brand-new contractor reads on this page. -->
			{#if data.subcontractors.length > 0}
				<span class="count"
					>{data.subcontractors.length}
					{data.subcontractors.length === 1 ? 'subcontractor' : 'subcontractors'}</span
				>
			{/if}
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
			<!-- The directory's one dial, folded into a single icon square so the search
		     field keeps the row (matching the customers page): 👤 = sections by
		     person, 🏢 = by company. The icon shows the current mode. -->
			<button
				type="button"
				class="icon-btn add-btn mode-btn"
				aria-pressed={groupBy === 'company'}
				aria-label="Group directory by company"
				title={groupBy === 'company'
					? 'Grouped by company — tap for individuals'
					: 'Grouped by individual — tap for companies'}
				onclick={() => (groupBy = groupBy === 'company' ? 'name' : 'company')}
				>{groupBy === 'company' ? '👥' : '👤'}</button
			>
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
					<p class="empty-line">No subcontractors found</p>
					<!-- The offer the auto-opening form used to make, as an offer. Hidden at
					     the trial limit, where the form would refuse the submission anyway. -->
					{#if !atSubLimit}
						<button type="button" class="empty-cta" onclick={() => (showAdd = true)}>
							Add one now
						</button>
					{/if}
				{:else}
					<p class="empty-line">No subcontractors match “{q}”.</p>
				{/if}
			</div>
		{/if}

		<!-- Directory: grouped sections on the left, A–Z jump rail on the right. -->
		<div class="directory">
			<div class="dir-main">
				{#each groups as group (group.key)}
					<section class="dir-sec" id={`sub-sec-${group.key}`}>
						<h2 class="dir-label">{group.label}</h2>
						<div class="grid">
							{#each group.items as s (s.id)}
								<article class="card" class:trusted={s.tier === 'trusted'}>
									<div class="card-top">
										<button
											type="button"
											class="avatar-btn"
											onclick={() => openCamera(s.id)}
											title="Take or upload a photo"
											aria-label="Set subcontractor photo"
										>
											{#if s.avatar}
												<img
													class="avatar"
													class:saving={savingAvatarId === s.id}
													src={s.avatar}
													alt={s.name}
												/>
											{:else}
												<div class="avatar placeholder" class:saving={savingAvatarId === s.id}>
													{s.name.slice(0, 1).toUpperCase()}
												</div>
											{/if}
											<span class="avatar-cam">📷</span>
										</button>
										<div class="who">
											<div class="name-row">
												<strong>{s.name}</strong>
												{@render statusBadge(s)}
												{#if s.tier === 'trusted'}{@render trustedMedal(s)}{/if}
											</div>
											<div class="meta">{s.company ?? s.trade ?? 'No company set'}</div>
											<!-- Tier and tags live in the expanded profile only — on the collapsed
										     card they crowded the one line that answers "who is this". -->
										</div>
										<div class="card-actions">
											<!-- Message the subcontractor (email / text / call) -->
											<div style="position: relative;">
												<button
													type="button"
													class="icon-btn"
													title="Message subcontractor"
													aria-label="Message subcontractor"
													aria-expanded={contactOpenId === s.id}
													onclick={() => (contactOpenId = contactOpenId === s.id ? null : s.id)}
													>💬</button
												>
												{#if contactOpenId === s.id}
													<button
														type="button"
														class="contact-scrim"
														aria-label="Close message composer"
														onclick={() => (contactOpenId = null)}
													></button>
													<div class="contact-pop">
														<ContactPanel
															contact={{
																name: s.name,
																email: s.email,
																phone: s.phone,
																preferredContact: 'email'
															}}
															onsent={() => (contactOpenId = null)}
															onclose={() => (contactOpenId = null)}
														/>
													</div>
												{/if}
											</div>
											<!-- Open the profile / ID-card detail view -->
											<button
												type="button"
												class="icon-btn"
												class:on={expandedId === s.id}
												title={expandedId === s.id ? 'Hide profile' : 'View profile'}
												aria-label={expandedId === s.id ? 'Hide profile' : 'View profile'}
												aria-expanded={expandedId === s.id}
												onclick={() => toggleCard(s.id)}
											>
												<svg
													viewBox="0 0 24 24"
													width="18"
													height="18"
													fill="none"
													stroke="currentColor"
													stroke-width="1.8"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"
												>
													<rect x="3" y="5" width="18" height="14" rx="2" />
													<circle cx="9" cy="11" r="1.8" />
													<path d="M6.5 16c0-1.4 1.1-2.3 2.5-2.3s2.5 0.9 2.5 2.3" />
													<line x1="14.5" y1="10.5" x2="18" y2="10.5" />
													<line x1="14.5" y1="14" x2="18" y2="14" />
												</svg>
											</button>
										</div>
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
															if (result.type === 'success') {
																editingId = null;
																delete editPrefill[s.id];
															}
														}}
												>
													<input type="hidden" name="id" value={s.id} />
													<!-- Re-scanning replaces what's shown; nothing is written until Save. -->
													<button
														type="button"
														class="scan-btn"
														onclick={() => (scannerFor = s.id)}
													>
														<span aria-hidden="true">📷</span> Scan their ID
													</button>
													<div class="fields">
														<label
															>Name<input
																name="name"
																value={editPrefill[s.id]?.name ?? s.name}
																required
															/></label
														>
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
															>Phone<input
																name="phone"
																value={s.phone ?? ''}
																oninput={onPhoneInput}
															/></label
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
															>License #<input
																name="licenseNumber"
																value={editPrefill[s.id]?.licenseNumber ?? s.licenseNumber ?? ''}
															/></label
														>
														<label
															>License expires<input
																name="licenseExpiresAt"
																type="date"
																value={editPrefill[s.id]?.licenseExpiresAt ??
																	toDateInput(s.licenseExpiresAt)}
															/></label
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
														<label
															>Address<input
																name="address"
																value={editPrefill[s.id]?.address ?? s.address ?? ''}
															/></label
														>
														<div class="wide">
															<TagPicker value={s.tags} />
														</div>
														<label class="wide"
															>Notes<textarea name="notes" rows="2">{s.notes ?? ''}</textarea
															></label
														>
													</div>
													<div class="row-actions">
														<button class="btn primary" type="submit">Save</button>
														<button
															class="btn ghost"
															type="button"
															onclick={() => {
																editingId = null;
																delete editPrefill[s.id];
															}}>Cancel</button
														>
													</div>
												</form>
											{:else}
												<!-- ---------- Read-only profile (tabbed) ---------- -->
												<div class="tab-row">
													<div class="tabs" role="tablist">
														<button
															type="button"
															role="tab"
															class="tab"
															class:active={detailTab === 'details'}
															aria-selected={detailTab === 'details'}
															onclick={() => (detailTab = 'details')}>Details</button
														>
														<button
															type="button"
															role="tab"
															class="tab"
															class:active={detailTab === 'orders'}
															aria-selected={detailTab === 'orders'}
															onclick={() => (detailTab = 'orders')}
															>Orders ({s.assignedOrders.length})</button
														>
														{#if s.notes}
															<button
																type="button"
																role="tab"
																class="tab"
																class:active={detailTab === 'notes'}
																aria-selected={detailTab === 'notes'}
																onclick={() => (detailTab = 'notes')}>Notes</button
															>
														{/if}
													</div>

													<!-- Management sits at the top of the pane, opposite the tabs, rather
								     than as a "Manage ▾" button at the foot of the card: down there the
								     menu opened past the bottom of the viewport on any card below the
								     fold, and nothing repositioned it as the page scrolled. -->
													<div class="manage">
														<button
															type="button"
															class="icon-btn manage-btn"
															class:on={menuOpenId === s.id}
															aria-haspopup="menu"
															aria-expanded={menuOpenId === s.id}
															title="Manage {s.name}"
															aria-label="Manage {s.name}"
															onclick={() => (menuOpenId = menuOpenId === s.id ? null : s.id)}
															>⚙</button
														>
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
																		<input
																			type="hidden"
																			name="inviteId"
																			value={s.pendingInviteId}
																		/>
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
												</div>

												{#if detailTab === 'details'}
													<!-- Three panels across the pane rather than one list hugging the left
								     edge: the facts group the way someone asks for them — how do I
								     reach them, what do they do, are they covered — and the grid
								     refills to one column on a phone. -->
													{@const ins = expiryStatus(s.insuranceExpiresAt)}
													{@const lic = expiryStatus(s.licenseExpiresAt)}
													<div class="profile">
														<div class="fact-group">
															<div class="fact-head">
																<span class="fact-icon" aria-hidden="true">✉</span>Contact
															</div>
															<dl class="fact-list">
																<div class="fact">
																	<dt>Email</dt>
																	<dd><a href="mailto:{s.email}">{s.email}</a></dd>
																</div>
																<div class="fact">
																	<dt>Phone</dt>
																	<dd>
																		<!-- Same normalization as ContactComposer: the display form keeps
													     its punctuation, the href doesn't. -->
																		{#if s.phone}<a href="tel:{s.phone.replace(/[^\d+]/g, '')}"
																				>{s.phone}</a
																			>{:else}<span class="unset">Not set</span>{/if}
																	</dd>
																</div>
																<div class="fact">
																	<dt>Address</dt>
																	<dd>
																		{#if s.address}{s.address}{:else}<span class="unset"
																				>Not set</span
																			>{/if}
																	</dd>
																</div>
															</dl>
														</div>

														<div class="fact-group">
															<div class="fact-head">
																<span class="fact-icon" aria-hidden="true">🛠</span>Trade
															</div>
															<dl class="fact-list">
																<div class="fact">
																	<dt>Trade</dt>
																	<dd>
																		{#if s.trade}{s.trade}{:else}<span class="unset">Not set</span
																			>{/if}
																	</dd>
																</div>
																<div class="fact">
																	<dt>Company</dt>
																	<dd>
																		{#if s.company}{s.company}{:else}<span class="unset"
																				>Not set</span
																			>{/if}
																	</dd>
																</div>
																<div class="fact">
																	<dt>Tier</dt>
																	<!-- The tag the collapsed card no longer carries, spelled out in
																     full where the reader came looking for it. -->
																	<dd>
																		<span class="chip {tierChip(s.tier)}">{label(s.tier)}</span>
																	</dd>
																</div>
																<div class="fact">
																	<dt>Account</dt>
																	<dd>{statusLabel(s.status)}</dd>
																</div>
															</dl>
														</div>

														<div class="fact-group">
															<div class="fact-head">
																<span class="fact-icon" aria-hidden="true">🛡</span>Credentials
															</div>
															<dl class="fact-list">
																<div class="fact">
																	<dt>License #</dt>
																	<dd>
																		{#if s.licenseNumber}{s.licenseNumber}{:else}<span class="unset"
																				>Not on file</span
																			>{/if}
																	</dd>
																</div>
																<div class="fact">
																	<dt>Licensed to</dt>
																	<dd>
																		{#if lic.tone === 'none'}<span class="unset">{lic.label}</span
																			>{:else}<span class="ins-pill {lic.tone}">{lic.label}</span
																			>{/if}
																	</dd>
																</div>
																<div class="fact">
																	<dt>Carrier</dt>
																	<dd>
																		{#if s.insuranceCarrier}{s.insuranceCarrier}{:else}<span
																				class="unset">Not on file</span
																			>{/if}
																	</dd>
																</div>
																<div class="fact">
																	<dt>Insured to</dt>
																	<dd>
																		<!-- Absent reads exactly like the rows above it; only a real
													     date earns the pill. -->
																		{#if ins.tone === 'none'}<span class="unset">{ins.label}</span
																			>{:else}<span class="ins-pill {ins.tone}">{ins.label}</span
																			>{/if}
																	</dd>
																</div>
															</dl>
														</div>

														{#if s.tags.length}
															<div class="fact-group wide">
																<div class="fact-head">
																	<span class="fact-icon" aria-hidden="true">🏷</span>Tags
																</div>
																<div class="tag-chips">
																	{#each s.tags as t (t)}<span class="tag-chip">{t}</span>{/each}
																</div>
															</div>
														{/if}
													</div>
												{:else if detailTab === 'orders'}
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
												{:else if s.notes}
													<p class="notes-reveal">{s.notes}</p>
												{/if}

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
														<button
															class="btn ghost"
															type="button"
															onclick={() => (confirmRevokeId = null)}>No</button
														>
													</div>
												{/if}

												{#if confirmArchiveId === s.id}
													<div class="confirm-banner">
														<span class="confirm"
															>Archive {s.name}? They’ll be hidden from your roster.</span
														>
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
														<button
															class="btn ghost"
															type="button"
															onclick={() => (confirmArchiveId = null)}>No</button
														>
													</div>
												{/if}
											{/if}
										</div>
									{/if}
								</article>
							{/each}
						</div>
					</section>
				{/each}
			</div>
			{#if data.subcontractors.length > 0}
				<AlphaRail present={presentLetters} onjump={jumpTo} />
			{/if}
		</div>
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
			<!-- The card in their hand already carries the name and the address. -->
			<button type="button" class="scan-btn" onclick={() => (scannerFor = 'add')}>
				<span aria-hidden="true">📷</span> Scan their ID
			</button>
			{#if atSubLimit}
				<p class="limit-note">
					Your trial covers {data.billing.limits?.subcontractor.limit} subcontractors and you have {data
						.billing.limits?.subcontractor.used}. Archive one you're no longer working with to free
					a space — nothing is deleted — or
					<a href={resolve('/contractor/billing')}>subscribe for unlimited</a>.
				</p>
			{/if}
			<form
				method="POST"
				action="?/addSubcontractor"
				use:enhance={() =>
					async ({ update, result }) => {
						await update();
						if (result.type === 'success') {
							showAdd = false;
							// The scan lives only as long as the form it filled.
							addPrefill = { name: '', address: '', licenseNumber: '', licenseExpiresAt: '' };
						}
					}}
			>
				<div class="fields">
					<label>
						<span class="lbl">Name <span class="req" aria-hidden="true">*</span></span>
						<input name="name" required placeholder="Jordan Rivera" bind:value={addPrefill.name} />
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
					<label class="wide">
						<span class="lbl">Address</span>
						<input
							name="address"
							placeholder="2300 West Broad Street, Richmond, VA 23269"
							bind:value={addPrefill.address}
						/>
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
						<input
							name="licenseNumber"
							placeholder="EC-100420"
							bind:value={addPrefill.licenseNumber}
						/>
					</label>
					<label>
						<span class="lbl">License expires</span>
						<input name="licenseExpiresAt" type="date" bind:value={addPrefill.licenseExpiresAt} />
					</label>
					<label>
						<span class="lbl">Insurance carrier</span>
						<input name="insuranceCarrier" placeholder="Acme Mutual" />
					</label>
					<label>
						<span class="lbl">Insurance expires</span>
						<input name="insuranceExpiresAt" type="date" />
					</label>
					<div>
						<TagPicker />
					</div>
				</div>
				<div class="row-actions end">
					<button class="btn ghost" type="button" onclick={() => (showAdd = false)}>Cancel</button>
					<button class="btn primary" type="submit">Add subcontractor</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- ID Scan: reads the card and hands the fields to whichever form asked. -->
{#if scannerFor}
	<IdScanner
		visionConfigured={data.idScan.visionConfigured}
		devTools={data.idScan.devTools}
		onapply={applyScan}
		onclose={() => (scannerFor = null)}
	/>
{/if}

<!-- Camera / photo capture modal -->
<dialog
	bind:this={cameraDialog}
	onclose={stopCamera}
	style="border: none; border-radius: 16px; padding: 0; max-width: 460px; width: 92vw; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);"
>
	<div style="display: grid; gap: 0.9rem; padding: 1.25rem;">
		<div style="display: flex; justify-content: space-between; align-items: center;">
			<h2 style="margin: 0; font-size: 1.1rem;">
				{cameraSub ? `${cameraSub.name}’s photo` : 'Subcontractor photo'}
			</h2>
			<button
				type="button"
				onclick={closeCamera}
				style="border: none; background: none; font-size: 1.2rem; cursor: pointer; color: #57606a;"
				>✕</button
			>
		</div>

		{#if cameraMode === 'choose'}
			{@const choiceBtn =
				'box-sizing: border-box; width: 100%; display: block; text-align: center; padding: 0.65rem 1rem; border-radius: 999px; font-size: 1rem; font-weight: 600; line-height: 1.2; cursor: pointer;'}
			<div style="display: flex; flex-direction: column; align-items: center; gap: 0.9rem;">
				{#if cameraSub?.avatar}
					<img
						src={cameraSub.avatar}
						alt={cameraSub.name}
						style="width: 96px; height: 96px; border-radius: 999px; object-fit: cover; border: 1px solid #d0d7de;"
					/>
				{:else}
					<span
						style="width: 96px; height: 96px; border-radius: 999px; border: 1px solid #d0d7de; background: linear-gradient(135deg, #e7edf3, #f6f8fa); color: #445; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 2rem;"
						>{cameraSub?.name.charAt(0).toUpperCase() ?? '?'}</span
					>
				{/if}

				<div style="display: grid; gap: 0.5rem; width: 100%;">
					<button
						type="button"
						onclick={startCamera}
						style="{choiceBtn} border: 1px solid #0969da; background: #0969da; color: #fff;"
						>📸 Take photo</button
					>
					<label style="{choiceBtn} border: 1px solid #d0d7de; background: #f6f8fa;">
						⬆ Upload photo
						<input
							type="file"
							accept="image/*"
							onchange={(e) => cameraSubId && onAvatarPick(cameraSubId, e)}
							style="display: none;"
						/>
					</label>
					{#if cameraSub?.avatar}
						<button
							type="button"
							onclick={() => cameraSubId && removeAvatar(cameraSubId)}
							style="{choiceBtn} border: 1px solid #ffd7d5; background: none; color: #cf222e;"
							>Remove photo</button
						>
					{/if}
				</div>
			</div>
		{:else}
			{#if cameraError}
				<p style="margin: 0; color: #cf222e; font-size: 0.9rem;">{cameraError}</p>
			{:else}
				<video
					bind:this={cameraVideo}
					autoplay
					playsinline
					muted
					style="width: 100%; max-height: 60vh; border-radius: 12px; background: #000;"
				></video>
			{/if}

			<div style="display: flex; gap: 0.5rem; justify-content: space-between; flex-wrap: wrap;">
				<button
					type="button"
					onclick={() => {
						stopCamera();
						cameraError = '';
						cameraMode = 'choose';
					}}
					style="padding: 0.55rem 1rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer;"
					>← Back</button
				>
				<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
					<label
						style="padding: 0.55rem 1rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer;"
					>
						Upload instead
						<input
							type="file"
							accept="image/*"
							onchange={(e) => cameraSubId && onAvatarPick(cameraSubId, e)}
							style="display: none;"
						/>
					</label>
					{#if !cameraError}
						<button
							type="button"
							onclick={capturePhoto}
							style="padding: 0.55rem 1.1rem; border-radius: 999px; border: 1px solid #0969da; background: #0969da; color: #fff; cursor: pointer; font-weight: 600;"
							>📸 Capture</button
						>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</dialog>

<style>
	/* Full-bleed sunken ground behind the centred column, so the white cards have
	   something to lift off — the customers directory does the same, in hex. */
	.page {
		background: var(--surface-sunken);
		min-height: 100%;
	}
	.wrap {
		max-width: 860px;
		margin: 0 auto;
		padding: 1.25rem 1rem 2rem;
		/* The gap sets the space under the title, so the search row below carries
		   no margin of its own to keep in sync. */
		display: grid;
		gap: 1rem;
	}
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	/* Balances the title the way the customers header does, and answers "how many
	   trade partners do I have" without opening anything. */
	.count {
		font-size: 0.85rem;
		color: var(--fg-muted);
	}
	/* Sticky like the customers page's search bar, so the lookup and the group
	   toggle ride along while scrolling the directory. */
	.search-row {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		gap: 0.6rem;
		align-items: center;
		flex-wrap: nowrap;
		padding: 0.4rem 0 0.6rem;
		background: var(--surface-sunken);
	}
	/* The grouping toggle shares the add button's square; emoji-sized glyph. */
	.mode-btn {
		font-size: 1.2rem;
	}

	/* Directory shell: sections left, jump rail right. */
	.directory {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}
	.dir-main {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 1.25rem;
	}
	.dir-sec {
		display: grid;
		gap: 0.5rem;
		scroll-margin-top: 84px;
	}
	/* Section band: a letter in Individual mode, a company name in Company mode.
	   Sticks just under the search bar. Overrides the global uppercase h2 so
	   company names keep their own casing. */
	.dir-label {
		position: sticky;
		top: 52px;
		z-index: 5;
		margin: 0;
		padding: 0.15rem 0.1rem;
		/* Sticks over the page ground, so it has to be the page ground. */
		background: var(--surface-sunken);
		font-size: 0.85rem;
		font-weight: 800;
		letter-spacing: 0.03em;
		text-transform: none;
		color: var(--fg-muted);
		overflow-wrap: anywhere;
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
	/* Pill, matching the customers lookup — the two searches sat side by side in
	   the nav looking like different controls. */
	.search {
		width: 100%;
		box-sizing: border-box;
		padding: 0.6rem 2.2rem 0.6rem 2.4rem;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		font-size: 1rem;
		background: var(--field-bg-focus);
		box-shadow: 0 1px 2px rgba(27, 31, 36, 0.05);
	}
	.search:focus {
		outline: none;
		border-color: var(--yellow-deep);
		box-shadow: 0 0 0 3px rgba(255, 204, 0, 0.22);
		background: var(--field-bg-focus);
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
	/* Global `.card` provides surface styling; the card's own children supply
	   their padding, so cancel the global padding here. */
	/* Not plain white: a faint top-lit wash over the shared .card, a tier accent
	   down the left edge (yellow = trusted, hairline = guest), and a soft raise
	   on hover so the rows feel like objects rather than outlined regions. */
	.card {
		padding: 0;
		border-left: 3px solid var(--line-strong);
		background: linear-gradient(
			180deg,
			var(--surface) 55%,
			color-mix(in srgb, var(--surface-sunken) 60%, var(--surface))
		);
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}
	.card.trusted {
		border-left-color: var(--yellow);
	}
	.card:hover {
		border-color: var(--line-strong);
		box-shadow:
			0 1px 2px rgba(27, 31, 36, 0.05),
			0 8px 22px rgba(27, 31, 36, 0.1);
	}
	.card.trusted:hover {
		border-left-color: var(--yellow-deep);
	}
	:global(:root[data-theme='dark']) .card:hover {
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
	}
	.card-top {
		display: flex;
		gap: 0.8rem;
		align-items: center;
		padding: 0.9rem;
	}
	/* Clickable avatar → opens the photo (take / upload / remove) modal. */
	.avatar-btn {
		position: relative;
		flex-shrink: 0;
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
		line-height: 0;
	}
	.avatar {
		width: 46px;
		height: 46px;
		border-radius: 50%;
		object-fit: cover;
		border: 1px solid #d0d7de;
		flex-shrink: 0;
		display: block;
	}
	.avatar.saving {
		opacity: 0.5;
	}
	.avatar.placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, #e7edf3, #f6f8fa);
		color: #44506b;
		font-weight: 700;
		font-size: 1.1rem;
	}
	.avatar-cam {
		position: absolute;
		right: -2px;
		bottom: -2px;
		width: 18px;
		height: 18px;
		border-radius: 999px;
		background: #0969da;
		color: #fff;
		font-size: 0.6rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid #fff;
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
	/* Right-side icon actions on the card header: message + expand. */
	.card-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
	}
	.card-actions .icon-btn {
		width: 2.1rem;
		height: 2.1rem;
		font-size: 1.05rem;
	}
	/* The profile (ID-card) button reads as "active" while its detail is open. */
	.card-actions .icon-btn.on {
		background: #ece7fb;
		border-color: #cdbff0;
		color: #4b2fa8;
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
		background: var(--ok-bg);
		border-color: var(--ok-line);
		color: var(--ok-fg);
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
	/* Account-link status: a small colored icon with a hover/tap tooltip. */
	.status {
		position: relative;
		display: inline-flex;
	}
	.status-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: none;
		padding: 0.1rem;
		cursor: pointer;
		border-radius: 6px;
	}
	.status-linked {
		color: var(--ok-fg);
	}
	.status-invited {
		color: #b5730a;
	}
	.status-unlinked {
		color: #97a0ab;
	}
	/* Trusted medal — same icon+tooltip mechanics as the link status beside it,
	   in the green the Trusted chip already uses. Shared token rather than a
	   repeated literal, so "the green the chip uses" stays true by construction. */
	.medal {
		color: var(--ok-fg);
	}
	.status-tip {
		position: absolute;
		top: calc(100% + 6px);
		left: 50%;
		transform: translateX(-50%);
		z-index: 30;
		white-space: nowrap;
		background: #1f2328;
		color: #fff;
		font-size: 0.72rem;
		font-weight: 600;
		padding: 0.25rem 0.5rem;
		border-radius: 6px;
		opacity: 0;
		visibility: hidden;
		transition: opacity 0.12s ease;
		pointer-events: none;
	}
	.status:hover .status-tip,
	.status-tip.show {
		opacity: 1;
		visibility: visible;
	}
	/* The open pane is a recessed area under the card head, so the white fact
	   panels sitting in it have something to lift off. */
	.detail {
		border-top: 1px solid var(--line);
		background: var(--surface-inset);
		padding: 0.9rem;
		display: grid;
		gap: 0.85rem;
	}
	/* Profile facts, grouped into panels that refill the pane at any width:
	   auto-fit means three across on a desktop card, two on a tablet, one on a
	   phone, with no breakpoint to keep in sync. Token-driven, so dark needs no
	   override block of its own. */
	.profile {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.6rem;
		align-items: start;
		margin: 0;
	}
	.profile .wide {
		grid-column: 1 / -1;
	}
	/* Each group is a panel with a titled band rather than a heading floating over
	   loose text: the band, the hairline rows and the flush-right values are what
	   make it read as a spec sheet instead of a list. */
	.fact-group {
		display: grid;
		align-content: start;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 12px;
		overflow: hidden;
	}
	.fact-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
		padding: 0.42rem 0.7rem;
		background: var(--surface-sunken);
		border-bottom: 1px solid var(--line);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.01em;
		color: var(--fg-muted);
	}
	.fact-icon {
		font-size: 0.8rem;
		line-height: 1;
		opacity: 0.75;
	}
	.fact-list {
		margin: 0;
		padding: 0 0.7rem;
	}
	/* Label left, value hard right, hairline between — the pair spans the panel
	   instead of both hugging the left edge with dead space beside them. */
	.fact {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.4rem 0;
		border-bottom: 1px solid var(--line);
	}
	.fact:last-child {
		border-bottom: none;
	}
	.profile dt {
		flex-shrink: 0;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--fg-muted);
		font-weight: 700;
	}
	/* One size, one weight, one alignment for every value in the pane — including
	   the ones that are absent. Mixed sizes read as mixed importance. */
	.profile dd {
		margin: 0;
		min-width: 0;
		font-size: 0.85rem;
		line-height: 1.35;
		font-weight: 600;
		text-align: right;
		word-break: break-word;
	}
	.profile dd a {
		color: inherit;
		text-decoration: none;
		border-bottom: 1px solid var(--line-strong);
	}
	.profile dd a:hover {
		border-bottom-color: currentColor;
	}
	/* An absent fact is stated, not dashed: "—" reads as data the reader has to
	   decode, and these are fields worth noticing the gap in. Same size and
	   position as a filled value; only the weight and color step back. */
	.unset {
		color: var(--fg-muted);
		font-weight: 500;
	}
	.profile .tag-chips {
		padding: 0.55rem 0.7rem;
	}
	/* Insurance expiry carries its own urgency — the only value in the pane that
	   earns a pill. Colors pinned rather than tokenised: these are status
	   reds/ambers/greens, not surfaces. */
	.ins-pill {
		display: inline-block;
		padding: 0.05rem 0.5rem;
		border-radius: 999px;
		border: 1px solid transparent;
		font-size: 0.8rem;
		font-weight: 700;
		white-space: nowrap;
	}
	/* The three insurance states use the app's status palette rather than their own
	   literals. They previously restated it — and had already drifted, with an
	   amber border one shade off every other warning in the app. Tokens also mean
	   these finally have a dark treatment; before, the pale fills stayed pale. */
	.ins-pill.ok {
		color: var(--ok-fg);
		background: var(--ok-bg);
		border-color: var(--ok-line);
	}
	.ins-pill.warn {
		color: var(--wait-fg);
		background: var(--wait-bg);
		border-color: var(--wait-line);
	}
	.ins-pill.bad {
		color: var(--stop-fg);
		background: var(--stop-bg);
		border-color: var(--stop-line);
	}
	/* Tabs on the left, the ⚙ opposite them, sharing one underline. */
	.tab-row {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.5rem;
		border-bottom: 1px solid var(--line);
	}
	.manage-btn {
		width: 2rem;
		height: 2rem;
		font-size: 1rem;
		margin-bottom: 0.25rem;
	}
	.tabs {
		display: flex;
		gap: 0.25rem;
	}
	.tab {
		padding: 0.4rem 0.7rem;
		border: none;
		background: none;
		color: #57606a;
		font-weight: 700;
		font-size: 0.82rem;
		cursor: pointer;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
	}
	.tab:hover {
		color: #1f2328;
	}
	.tab.active {
		color: #1f2328;
		border-bottom-color: #1f2328;
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
	/* Full-width rows with the state pinned right, so this tab fills the pane the
	   same way the Details panels do. */
	.assigned li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		background: var(--surface-sunken);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 0.4rem 0.6rem;
	}
	.muted {
		color: #888;
		margin: 0;
	}
	/* The scan entry point, on both the add and edit forms. Reads as an offer
	   above the fields rather than as a submit next to Save — it fills the form,
	   it doesn't complete it. */
	.scan-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		align-self: start;
		margin: 0.6rem 0 0.9rem;
		padding: 0.45rem 0.85rem;
		border: 1px dashed var(--line-strong);
		border-radius: 999px;
		background: var(--surface-sunken);
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 700;
		cursor: pointer;
	}
	.scan-btn:hover {
		border-style: solid;
		border-color: var(--yellow-deep);
		color: inherit;
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
		color: var(--fg-muted);
	}
	.fields input,
	.fields select,
	.fields textarea {
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--field-border);
		border-radius: 9px;
		font-size: 0.95rem;
		font-weight: 500;
		text-transform: none;
		background: var(--field-bg);
		color: #1f2328;
		transition:
			border-color 0.12s ease,
			box-shadow 0.12s ease,
			background 0.12s ease;
	}
	.fields input::placeholder,
	.fields textarea::placeholder {
		color: #b3b9c2;
	}
	.fields input:focus,
	.fields select:focus,
	.fields textarea:focus {
		outline: none;
		border-color: var(--yellow-deep);
		box-shadow: 0 0 0 3px rgba(255, 204, 0, 0.22);
		background: var(--field-bg-focus);
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
		border-bottom: 1px solid var(--line);
		font-size: 0.72rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fg-muted);
	}
	.group-label:first-child {
		margin-top: 0;
	}
	.opt {
		font-size: 0.62rem;
		font-weight: 700;
		color: var(--fg-muted);
		background: var(--surface-sunken);
		border-radius: 999px;
		padding: 0.05rem 0.45rem;
		text-transform: none;
		letter-spacing: 0;
	}
	/* The required asterisk keeps its red in both themes; #cf222e goes muddy on a
	   dark surface, so dark gets the lighter red used elsewhere in the app. */
	.req {
		color: #cf222e;
		font-weight: 900;
	}
	:global(:root[data-theme='dark']) .req {
		color: #ff8f8a;
	}
	.form-note {
		grid-column: 1 / -1;
		margin: -0.25rem 0 0.1rem;
		font-size: 0.78rem;
		font-weight: 500;
		color: var(--fg-muted);
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
	/* `.row-actions form` lived here for the read-only pane's inline action forms;
	   those moved into the ⚙ menu, and only the edit form and the modal use this
	   row now — both of which are the form, not a container of them. */
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
		/* Hung from the gear's right edge: it opens at the top of the pane, so it
		   has the whole card below it and never runs off the viewport. */
		right: 0;
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
	/* The app's button language: pill, bold outline, soft pop shadow. Primary is
	   the safety-yellow sticker every other primary in the app uses — text and
	   border pinned dark, since yellow stays light in both themes. Token-driven,
	   so dark needs no override (and can't silently outrank `.primary`). */
	.btn {
		padding: 0.5rem 0.9rem;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		background: var(--surface);
		color: var(--fg);
		font-family: inherit;
		font-weight: 700;
		cursor: pointer;
		font-size: 0.85rem;
		box-shadow: var(--pop-shadow-sm);
	}
	.btn:hover {
		background: var(--surface-sunken);
	}
	.btn.primary {
		background: var(--yellow);
		border-color: transparent;
		color: var(--on-yellow);
	}
	.btn.primary:hover {
		background: var(--yellow-deep);
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
		background: var(--surface);
		color: #cf222e;
		border-color: #cf222e;
	}
	.btn.danger.ghost:hover {
		background: color-mix(in srgb, #cf222e 10%, var(--surface));
	}
	/* Ghost is the way out, not a peer of the submit: no fill, no shadow. */
	.btn.ghost {
		background: transparent;
		box-shadow: none;
	}
	.empty {
		display: grid;
		justify-items: center;
		gap: 0.75rem;
		border: 1.5px dashed var(--line-strong);
		border-radius: 12px;
		padding: 1.5rem;
		text-align: center;
		color: var(--fg-muted);
		font-weight: 600;
		margin-bottom: 1rem;
	}
	.empty-line {
		margin: 0;
	}
	/* Styled here rather than reaching for `.primary-btn`: that class is defined
	   per-page in the two orders views, not globally, so using it here would have
	   rendered a bare browser button. */
	.empty-cta {
		padding: 0.55rem 1.1rem;
		border-radius: 10px;
		border: 1px solid var(--yellow-deep);
		background: var(--yellow);
		/* Yellow is light in both themes, so its text is pinned dark rather than
		   following a token that flips. */
		color: var(--on-yellow);
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 800;
		cursor: pointer;
		box-shadow: var(--pop-shadow-sm);
	}
	.empty-cta:hover {
		background: var(--yellow-deep);
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
	/* Token-driven rather than hardcoded light: this is a plain div, so it never
	   got the global dark `dialog` treatment the add-customer modal rides on, and
	   dark mode painted light text onto a white card. */
	.modal {
		position: relative;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 16px;
		box-shadow: 0 20px 48px rgba(0, 0, 0, 0.35);
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
		background: var(--surface-sunken);
		color: var(--fg-muted);
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
	}
	.modal-close:hover {
		background: var(--line);
		color: var(--fg);
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
		color: var(--fg-muted);
		font-size: 0.85rem;
		font-weight: 500;
		line-height: 1.4;
	}
	.row-actions.end {
		justify-content: flex-end;
		margin-top: 1rem;
		padding-top: 0.9rem;
		border-top: 1px solid var(--line);
	}
	@media (max-width: 560px) {
		/* `.profile` isn't listed here — its auto-fit track already collapses to a
		   single column once the panels can't hold their 220px minimum. */
		.fields {
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

	/* Dark theme
	   Appended dark-only overrides. These map the hardcoded light colors above
	   onto the global dark tokens; light rules remain untouched. */
	/* Fields are token-driven above; dark only needs the text color. Border and
	   background stay out so the yellow focus ring can't be outranked. */
	:global(:root[data-theme='dark']) .search,
	:global(:root[data-theme='dark']) .fields input,
	:global(:root[data-theme='dark']) .fields select,
	:global(:root[data-theme='dark']) .fields textarea {
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .fields input:disabled {
		background: var(--surface-sunken);
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .detail {
		border-top-color: var(--line);
	}
	:global(:root[data-theme='dark']) .tab {
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .tab:hover,
	:global(:root[data-theme='dark']) .tab.active {
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .tab.active {
		border-bottom-color: var(--fg);
	}
	:global(:root[data-theme='dark']) .profile dd {
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .profile dt,
	:global(:root[data-theme='dark']) .meta,
	:global(:root[data-theme='dark']) .meta.small,
	:global(:root[data-theme='dark']) .muted,
	:global(:root[data-theme='dark']) .hint {
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .tag {
		background: var(--surface-sunken);
		border-color: var(--line);
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .menu {
		background: var(--surface);
		border-color: var(--line);
	}
	:global(:root[data-theme='dark']) .menu-item {
		background: var(--surface);
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .menu-item:hover {
		background: var(--surface-sunken);
	}
	:global(:root[data-theme='dark']) .menu-item.danger {
		color: #f87171;
	}
	:global(:root[data-theme='dark']) .confirm-banner {
		background: #2a1416;
		border-color: #7a2a2f;
	}
	:global(:root[data-theme='dark']) .notes-reveal {
		background: var(--surface-sunken);
		border-color: var(--line);
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .avatar {
		border-color: var(--line);
	}
	:global(:root[data-theme='dark']) .avatar.placeholder {
		background: linear-gradient(135deg, #2a3038, #20242b);
		color: #c3c9d4;
	}
	:global(:root[data-theme='dark']) .card-actions .icon-btn.on {
		background: #2e2a44;
		border-color: #4a3f6b;
		color: #cabff5;
	}

	/* Shown in the add modal when a trial has run out of subcontractor slots. */
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
</style>
