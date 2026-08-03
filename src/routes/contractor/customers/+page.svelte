<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { goto, invalidateAll } from '$app/navigation';
	import { customerContactSchema, formatPhone, normalizePreferredContact } from '$lib/crm';
	import ContactComposer from '$lib/ContactComposer.svelte';
	import TagPicker from '$lib/TagPicker.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Trial capacity, from the contractor layout. Only set while a trial is live —
	// paid and comped subscriptions are uncapped, so this is null for them.
	const atCustomerLimit = $derived(data.billing.limits?.customer.atLimit ?? false);

	const isLinked = (c: { userId: string | null }) => c.userId != null;

	const AVATAR_MAX = 256;

	let savingAvatarId: string | null = $state(null);

	// Customer invites live here (moved off the dashboard). They're a side errand
	// rather than part of browsing the directory, so they sit behind an icon button
	// next to "Add customer" and open in their own modal.
	let invitesDialog: HTMLDialogElement | undefined = $state();
	let confirmingDeleteInviteId: string | null = $state(null);
	function inviteLabel(status: string, expiresAt: Date): string {
		if (status === 'revoked') return 'Revoked';
		if (status === 'used') return 'Accepted';
		return new Date(expiresAt).getTime() > Date.now() ? 'Active' : 'Expired';
	}

	// --- Camera capture ----------------------------------------------------
	let cameraDialog: HTMLDialogElement | undefined = $state();
	let cameraVideo: HTMLVideoElement | undefined = $state();
	let cameraCustomerId: string | null = $state(null);
	let cameraError = $state('');
	let cameraStream: MediaStream | undefined;
	// 'choose' shows the options first; 'camera' is the live capture view. The
	// camera is only started when the user explicitly picks "Take photo".
	let cameraMode: 'choose' | 'camera' = $state('choose');
	const cameraCustomer = $derived(
		cameraCustomerId ? (data.customers.find((c) => c.id === cameraCustomerId) ?? null) : null
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

	async function saveAvatar(customerId: string, dataUrl: string) {
		savingAvatarId = customerId;
		try {
			const body = new FormData();
			body.set('id', customerId);
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
	async function onAvatarPick(customerId: string, e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		closeCamera();
		const img = await loadImage(file);
		const dataUrl = toAvatarDataUrl(img);
		if (dataUrl) await saveAvatar(customerId, dataUrl);
	}

	/** Open the photo modal on its chooser — does NOT turn the camera on yet. */
	function openCamera(customerId: string) {
		cameraCustomerId = customerId;
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
			await tick(); // let the <video> render before attaching the stream
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

	/** Clear a customer's photo back to the initials placeholder. */
	async function removeAvatar(customerId: string) {
		savingAvatarId = customerId;
		try {
			const body = new FormData();
			body.set('id', customerId);
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
		if (!cameraVideo || !cameraCustomerId) return;
		const dataUrl = toAvatarDataUrl(cameraVideo);
		const customerId = cameraCustomerId;
		closeCamera();
		if (dataUrl) await saveAvatar(customerId, dataUrl);
	}

	// --- Add modal ---------------------------------------------------------
	let addDialog: HTMLDialogElement | undefined = $state();

	// An empty directory opens the add form on arrival. There is no "no customers
	// yet" message any more, so an empty page would otherwise be blank — and the
	// getting-started guide only sends a contractor here while they have none, which
	// makes this the same moment as arriving from the tutorial. Stops happening for
	// good the instant they have one customer.
	onMount(() => {
		if (data.customers.length > 0) return;
		addError = '';
		openedFromEmpty = true;
		addDialog?.showModal();
	});
	// True when the add form opened because the directory was empty — the same moment
	// the getting-started guide sends someone here. On success we hand them back to
	// the dashboard so the next tutorial step is in front of them.
	let openedFromEmpty = $state(false);
	let addError = $state('');

	// --- Per-card interaction ---------------------------------------------
	let editingId: string | null = $state(null);
	let confirmingArchiveId: string | null = $state(null);
	// Which contact row is expanded to show full details + quick actions.
	let expandedId: string | null = $state(null);
	// Which expanded card's gear (⚙) menu is open — one at a time.
	let gearOpenId: string | null = $state(null);
	// Which expanded card is showing its message composer (hidden until "Contact").
	let contactOpenId: string | null = $state(null);
	function toggleExpanded(id: string) {
		expandedId = expandedId === id ? null : id;
		confirmingArchiveId = null;
		gearOpenId = null;
		contactOpenId = null;
	}

	// --- Live search (debounced) + suggestions ----------------------------
	let query = $state('');
	let debounced = $state('');
	let searchFocused = $state(false);

	$effect(() => {
		const q = query;
		const t = setTimeout(() => (debounced = q), 200);
		return () => clearTimeout(t);
	});

	const term = $derived(debounced.trim().toLowerCase());
	const filtered = $derived.by(() => {
		if (term === '') return data.customers;
		return data.customers.filter(
			(c) => c.name.toLowerCase().includes(term) || c.email.includes(term)
		);
	});
	// Live (un-debounced) suggestions so the dropdown feels instant while typing.
	const suggestions = $derived.by(() => {
		const raw = query.trim().toLowerCase();
		if (raw === '') return [];
		const out: string[] = [];
		for (const c of data.customers) {
			if (c.name.toLowerCase().includes(raw) && !out.includes(c.name)) out.push(c.name);
			if (out.length >= 5) break;
		}
		return out.filter((n) => n.toLowerCase() !== raw);
	});

	// --- Alphabetical grouping + A–Z jump rail ----------------------------
	const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
	function letterOf(name: string): string {
		const ch = name.trim().charAt(0).toUpperCase();
		return /[A-Z]/.test(ch) ? ch : '#';
	}
	const groups = $derived.by(() => {
		const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
		const buckets: Record<string, typeof data.customers> = {};
		for (const c of sorted) {
			(buckets[letterOf(c.name)] ??= []).push(c);
		}
		return Object.entries(buckets)
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([letter, items]) => ({ letter, items }));
	});
	const presentLetters = $derived(new Set(groups.map((g) => g.letter)));
	function jumpTo(letter: string, behavior: ScrollBehavior = 'smooth') {
		document.getElementById(`sec-${letter}`)?.scrollIntoView({ behavior, block: 'start' });
	}
	// Dock-style magnification: the hovered letter is largest, neighbours taper off.
	let railHover: number | null = $state(null);
	// The rail element, so touch/mouse position can be mapped to a letter index.
	let railNav: HTMLElement | undefined = $state();
	// Map a pointer's Y onto a letter and magnify it. Child transforms don't
	// reflow, so the nav's own box stays stable — no feedback loop as letters
	// grow. `jump` is true while actively scrubbing (touch drag / mouse-down).
	function railAt(clientY: number, jump: boolean) {
		if (!railNav) return;
		const r = railNav.getBoundingClientRect();
		const frac = (clientY - r.top) / r.height;
		const i = Math.max(0, Math.min(ALPHABET.length - 1, Math.round(frac * (ALPHABET.length - 1))));
		railHover = i;
		if (jump && presentLetters.has(ALPHABET[i])) jumpTo(ALPHABET[i], 'auto');
	}
	function railScale(i: number): number {
		if (railHover === null) return 1;
		const d = Math.abs(i - railHover);
		if (d === 0) return 2;
		if (d === 1) return 1.6;
		if (d === 2) return 1.3;
		if (d === 3) return 1.12;
		return 1;
	}
	// Push neighbours away from the hovered letter so the enlarged glyphs don't
	// collide — the dock "spread" that makes the magnified letter easy to hit.
	function railShift(i: number): number {
		if (railHover === null) return 0;
		const d = Math.abs(i - railHover);
		if (d === 0) return 0;
		const push = d === 1 ? 9 : d === 2 ? 15 : d === 3 ? 18 : 19;
		return Math.sign(i - railHover) * push;
	}

	function liveFormatPhone(e: Event & { currentTarget: HTMLInputElement }) {
		e.currentTarget.value = formatPhone(e.currentTarget.value);
	}

	/** Client-side pre-check with the same Zod schema the server enforces. */
	function firstError(formData: FormData): string | null {
		const result = customerContactSchema.safeParse({
			name: formData.get('name')?.toString(),
			email: formData.get('email')?.toString(),
			phone: formData.get('phone')?.toString(),
			address: formData.get('address')?.toString(),
			notes: formData.get('notes')?.toString(),
			tags: formData.get('tags')?.toString()
		});
		return result.success ? null : result.error.issues[0].message;
	}

	const fieldStyle =
		'padding: 0.5rem; border-radius: 8px; border: 1px solid #d0d7de; font-size: 1rem;';
	// Gear (⚙) menu that holds Edit / Send app invite / Archive.
	// Sizing only — the gold look comes from the shared `.icon-btn` class.
	const gearBtn = 'width: 2.3rem; height: 2.3rem; font-size: 1.55rem;';
	const menuItem =
		'display: block; width: 100%; text-align: left; padding: 0.55rem 0.8rem; border: none; background: none; cursor: pointer; font-size: 0.9rem; color: inherit;';
</script>

<svelte:head>
	<title>Customer directory</title>
</svelte:head>

<div style="background: #f6f8fa; min-height: 100%;">
	<div
		style="max-width: 860px; margin: 0 auto; padding: 1.25rem 1rem 2rem; display: grid; gap: 1rem;"
	>
		<header
			style="display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap;"
		>
			<h1 class="page-title" style="margin: 0;">Customers</h1>
			<span style="font-size: 0.85rem; color: #57606a;"
				>{data.customers.length} {data.customers.length === 1 ? 'contact' : 'contacts'}</span
			>
		</header>

		<!-- Search + add, pinned to the top of the directory while scrolling -->
		<div
			style="position: sticky; top: 0; z-index: 20; background: #f6f8fa; padding: 0.4rem 0 0.6rem; display: flex; gap: 0.6rem; align-items: center; flex-wrap: nowrap;"
		>
			<div style="position: relative; flex: 1; min-width: 220px;">
				<span
					style="position: absolute; left: 0.85rem; top: 50%; transform: translateY(-50%); color: #8c959f; font-size: 0.95rem; pointer-events: none;"
					>🔍</span
				>
				<input
					value={query}
					oninput={(e) => (query = e.currentTarget.value)}
					onfocus={() => (searchFocused = true)}
					onblur={() => setTimeout(() => (searchFocused = false), 150)}
					placeholder="Search"
					style="width: 100%; box-sizing: border-box; padding: 0.6rem 2.2rem 0.6rem 2.4rem; border-radius: 999px; border: 1px solid #d0d7de; background: #fff; font-size: 1rem; box-shadow: 0 1px 2px rgba(27, 31, 36, 0.05);"
				/>
				{#if query}
					<button
						type="button"
						aria-label="Clear search"
						onmousedown={() => (query = '')}
						style="position: absolute; right: 0.6rem; top: 50%; transform: translateY(-50%); border: none; background: none; color: #8c959f; cursor: pointer; font-size: 0.95rem; line-height: 1; padding: 0.2rem;"
						>✕</button
					>
				{/if}
				{#if searchFocused && suggestions.length > 0}
					<ul
						style="position: absolute; z-index: 30; left: 0; right: 0; margin: 0.25rem 0 0; padding: 0.25rem; list-style: none; background: #fff; border: 1px solid #d0d7de; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.12);"
					>
						{#each suggestions as name (name)}
							<li>
								<button
									type="button"
									onmousedown={() => (query = name)}
									style="width: 100%; text-align: left; padding: 0.45rem 0.6rem; border: none; background: none; border-radius: 8px; cursor: pointer;"
									>🔍&nbsp;&nbsp;{name}</button
								>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
			{#if data.invites.length > 0}
				<div style="position: relative; flex-shrink: 0;">
					<button
						type="button"
						title="Customer invites"
						aria-label="Customer invites ({data.invites.length})"
						onclick={() => {
							confirmingDeleteInviteId = null;
							invitesDialog?.showModal();
						}}
						class="icon-btn"
						style="width: 2.9rem; height: 2.9rem; font-size: 1.4rem;">✉️</button
					>
					<span class="invite-badge" aria-hidden="true">{data.invites.length}</span>
				</div>
			{/if}
			<button
				type="button"
				title="Add customer"
				aria-label="Add customer"
				onclick={() => {
					addError = '';
					addDialog?.showModal();
				}}
				class="icon-btn"
				style="flex-shrink: 0; width: 2.9rem; height: 2.9rem; font-size: 1.75rem;">＋</button
			>
		</div>

		<!-- Directory: grouped list on the left, A–Z jump rail on the right -->
		<div style="display: flex; gap: 0.5rem; align-items: flex-start;">
			<section style="flex: 1; min-width: 0; display: grid; gap: 1.25rem;">
				<!-- Only the no-match case gets a message. An empty directory speaks for
				     itself, and arriving here with none opens the add form anyway. -->
				{#if filtered.length === 0 && term !== ''}
					<p style="color: #57606a;">No customers match “{debounced}”.</p>
				{/if}

				{#each groups as group (group.letter)}
					<div
						id={`sec-${group.letter}`}
						style="display: grid; gap: 0.5rem; scroll-margin-top: 84px;"
					>
						<h2
							style="position: sticky; top: 52px; z-index: 5; margin: 0; padding: 0.15rem 0.1rem; font-size: 0.85rem; font-weight: 800; color: #0969da; background: #f6f8fa; letter-spacing: 0.03em;"
						>
							{group.letter}
						</h2>

						{#each group.items as c (c.id)}
							{@const expanded = expandedId === c.id}
							<article class="card">
								<!-- Contact row -->
								<div
									style="display: flex; align-items: center; gap: 0.7rem; padding: 0.65rem 0.8rem;"
								>
									<button
										type="button"
										onclick={() => openCamera(c.id)}
										title="Take or upload a photo"
										aria-label="Set customer photo"
										style="border: none; background: none; padding: 0; cursor: pointer; flex-shrink: 0; position: relative;"
									>
										{#if c.avatar}
											<img
												src={c.avatar}
												alt={c.name}
												style="width: 46px; height: 46px; border-radius: 999px; object-fit: cover; border: 1px solid #d0d7de; display: block; opacity: {savingAvatarId ===
												c.id
													? '0.5'
													: '1'};"
											/>
										{:else}
											<span
												style="width: 46px; height: 46px; border-radius: 999px; border: 1px solid #d0d7de; background: linear-gradient(135deg, #e7edf3, #f6f8fa); color: #445; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1.1rem; opacity: {savingAvatarId ===
												c.id
													? '0.5'
													: '1'};">{c.name.charAt(0).toUpperCase()}</span
											>
										{/if}
										<span
											style="position: absolute; right: -2px; bottom: -2px; width: 18px; height: 18px; border-radius: 999px; background: #0969da; color: #fff; font-size: 0.6rem; display: flex; align-items: center; justify-content: center; border: 1px solid #fff;"
											>📷</span
										>
									</button>

									<button
										type="button"
										onclick={() => toggleExpanded(c.id)}
										aria-expanded={expanded}
										style="flex: 1; min-width: 0; text-align: left; border: none; background: none; cursor: pointer; padding: 0; display: grid; gap: 0.1rem;"
									>
										<span
											style="font-weight: 700; font-size: 1rem; color: #1f2328; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
											>{c.name}</span
										>
										<span
											style="font-size: 0.82rem; color: #8c959f; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
											>{c.phone ?? c.email}</span
										>
										<!-- Tags at a glance, without expanding the row. -->
										{#if c.tags.length > 0}
											<span class="tag-chips" style="margin-top: 0.1rem;">
												{#each c.tags as tag (tag)}<span class="tag-chip">{tag}</span>{/each}
											</span>
										{/if}
									</button>

									{#if isLinked(c)}
										<span
											title="Customer has joined"
											style="font-size: 0.72rem; color: #1a7f37; background: #e6f4ea; border: 1px solid #4ea866; border-radius: 999px; padding: 0.05rem 0.5rem; white-space: nowrap;"
											>Linked</span
										>
									{/if}
									<span
										style="color: #8c959f; font-size: 0.8rem; flex-shrink: 0; transition: transform 0.15s; transform: rotate({expanded
											? 90
											: 0}deg);">▸</span
									>
								</div>

								{#if expanded}
									<div
										style="border-top: 1px solid #eef1f4; padding: 0.8rem; display: grid; gap: 0.75rem;"
									>
										{#if editingId === c.id}
											<!-- Edit mode -->
											<form
												method="POST"
												action="?/editCustomer"
												use:enhance={({ formData, cancel }) => {
													const err = firstError(formData);
													if (err) {
														addError = '';
														alert(err);
														cancel();
														return;
													}
													return async ({ result, update }) => {
														await update();
														if (result.type === 'success') editingId = null;
													};
												}}
												style="display: grid; gap: 0.5rem;"
											>
												<input type="hidden" name="id" value={c.id} />
												<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
													<input
														name="name"
														value={c.name}
														required
														style="flex: 1; min-width: 120px; {fieldStyle}"
													/>
													<input
														name="email"
														type="email"
														value={c.email}
														readonly={isLinked(c)}
														title={isLinked(c)
															? 'Email is locked once the customer has joined'
															: ''}
														style="flex: 1; min-width: 140px; {fieldStyle} background: {isLinked(c)
															? '#f6f8fa'
															: '#fff'};"
													/>
												</div>
												<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
													<input
														name="phone"
														type="tel"
														value={c.phone ?? ''}
														oninput={liveFormatPhone}
														placeholder="Phone"
														style="flex: 1; min-width: 120px; {fieldStyle}"
													/>
													<input
														name="address"
														value={c.address ?? ''}
														placeholder="Address"
														style="flex: 2; min-width: 160px; {fieldStyle}"
													/>
												</div>
												<TagPicker value={c.tags} />
												<label
													style="display: grid; gap: 0.2rem; font-size: 0.85rem; color: #57606a;"
												>
													Preferred contact method
													<select name="preferredContact" style={fieldStyle}>
														<option
															value="email"
															selected={normalizePreferredContact(c.preferredContact) === 'email'}
															>Email</option
														>
														<option
															value="call"
															selected={normalizePreferredContact(c.preferredContact) === 'call'}
															>Call</option
														>
														<option
															value="text"
															selected={normalizePreferredContact(c.preferredContact) === 'text'}
															>Text</option
														>
													</select>
												</label>
												<textarea
													name="notes"
													rows="2"
													placeholder="Project details / notes"
													style="{fieldStyle} resize: vertical;">{c.notes ?? ''}</textarea
												>
												{#if form?.action === 'edit' && 'id' in form && form.id === c.id && form.message}
													<p style="margin: 0; color: #cf222e; font-size: 0.85rem;">
														{form.message}
													</p>
												{/if}
												<div style="display: flex; gap: 0.5rem;">
													<button
														type="submit"
														style="padding: 0.45rem 0.9rem; border-radius: 999px; border: 1px solid #0969da; background: #0969da; color: #fff; cursor: pointer;"
														>Save</button
													>
													<button
														type="button"
														onclick={() => (editingId = null)}
														style="padding: 0.45rem 0.9rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer;"
														>Cancel</button
													>
												</div>
											</form>
										{:else}
											<!-- Contact details -->
											<div style="display: grid; gap: 0.3rem; font-size: 0.9rem;">
												<div style="word-break: break-word;">
													<span style="color: #8c959f;">Email</span> · {c.email}
												</div>
												{#if c.phone}
													<div><span style="color: #8c959f;">Phone</span> · {c.phone}</div>
												{/if}
												{#if c.address}
													<div style="word-break: break-word;">
														<span style="color: #8c959f;">Address</span> · {c.address}
													</div>
												{/if}
											</div>

											{#if c.tags.length > 0}
												<div class="tag-chips">
													{#each c.tags as tag (tag)}<span class="tag-chip">{tag}</span>{/each}
												</div>
											{/if}

											{#if c.notes}
												<p
													style="margin: 0; font-size: 0.9rem; color: #57606a; white-space: pre-wrap;"
												>
													{c.notes}
												</p>
											{/if}

											{#if confirmingArchiveId === c.id}
												<div
													style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; background: #fff8f8; border: 1px solid #ffd7d5; border-radius: 10px; padding: 0.5rem 0.7rem;"
												>
													<span
														style="font-size: 0.85rem; color: #57606a; flex: 1; min-width: 160px;"
														>Archive {c.name}? They’ll be hidden, not deleted.</span
													>
													<form
														method="POST"
														action="?/archiveCustomer"
														use:enhance={() =>
															async ({ update }) => {
																confirmingArchiveId = null;
																await update();
															}}
													>
														<input type="hidden" name="id" value={c.id} />
														<button
															type="submit"
															style="padding: 0.35rem 0.75rem; border-radius: 999px; border: 1px solid #cf222e; background: #cf222e; color: #fff; cursor: pointer;"
															>Yes, archive</button
														>
													</form>
													<button
														type="button"
														onclick={() => (confirmingArchiveId = null)}
														style="padding: 0.35rem 0.75rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer;"
														>Cancel</button
													>
												</div>
											{:else}
												<!-- Contact (💬) + manage (⚙️) actions, bottom-right like the dashboard -->
												<div
													style="display: flex; justify-content: flex-end; align-items: center; gap: 0.4rem; border-top: 1px solid #eef1f4; padding-top: 0.7rem;"
												>
													<!-- Message: opens the composer in a popover, defaulting to the
													     customer's preferred channel. -->
													<div style="position: relative;">
														<button
															type="button"
															title="Message customer"
															aria-label="Message customer"
															aria-expanded={contactOpenId === c.id}
															onclick={() => (contactOpenId = contactOpenId === c.id ? null : c.id)}
															class="icon-btn"
															style={gearBtn}>💬</button
														>
														{#if contactOpenId === c.id}
															<!-- Dimmed click-away scrim so the composer is the focus. -->
															<button
																type="button"
																aria-label="Close message composer"
																onclick={() => (contactOpenId = null)}
																class="contact-scrim"
															></button>
															<div class="contact-pop up">
																<ContactComposer
																	customer={c}
																	rows={2}
																	onsent={() => (contactOpenId = null)}
																	onclose={() => (contactOpenId = null)}
																/>
															</div>
														{/if}
													</div>

													<div style="position: relative;">
														<button
															type="button"
															title="Manage customer"
															aria-label="Manage customer"
															aria-expanded={gearOpenId === c.id}
															onclick={() => (gearOpenId = gearOpenId === c.id ? null : c.id)}
															class="icon-btn"
															style={gearBtn}>⚙️</button
														>
														{#if gearOpenId === c.id}
															<!-- click-away backdrop -->
															<button
																type="button"
																aria-label="Close menu"
																onclick={() => (gearOpenId = null)}
																style="position: fixed; inset: 0; z-index: 10; background: transparent; border: none; cursor: default;"
															></button>
															<div
																style="position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; min-width: 180px; background: #fff; border: 1px solid #d0d7de; border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); overflow: hidden; display: grid;"
															>
																<button
																	type="button"
																	onclick={() => {
																		editingId = c.id;
																		confirmingArchiveId = null;
																		gearOpenId = null;
																	}}
																	style={menuItem}>Edit</button
																>
																{#if !isLinked(c)}
																	<form
																		method="POST"
																		action="?/sendInvite"
																		use:enhance={() => {
																			gearOpenId = null;
																			return async ({ update }) => await update();
																		}}
																	>
																		<input type="hidden" name="id" value={c.id} />
																		<button type="submit" style={menuItem}>Send app invite</button>
																	</form>
																{/if}
																<button
																	type="button"
																	onclick={() => {
																		confirmingArchiveId = c.id;
																		gearOpenId = null;
																	}}
																	style="{menuItem} color: #cf222e; border-top: 1px solid #eaeef2;"
																	>Archive</button
																>
															</div>
														{/if}
													</div>
												</div>
											{/if}
										{/if}
									</div>
								{/if}
							</article>
						{/each}
					</div>
				{/each}
			</section>

			<!-- A–Z jump rail with dock-style magnification -->
			{#if data.customers.length > 0}
				<nav
					aria-label="Jump to letter"
					bind:this={railNav}
					onpointerdown={(e) => {
						railNav?.setPointerCapture?.(e.pointerId);
						railAt(e.clientY, true);
					}}
					onpointermove={(e) => railAt(e.clientY, e.pointerType !== 'mouse' || e.buttons > 0)}
					onpointerup={() => (railHover = null)}
					onpointercancel={() => (railHover = null)}
					onpointerleave={() => (railHover = null)}
					style="position: sticky; top: 84px; display: flex; flex-direction: column; gap: 3px; flex-shrink: 0; padding: 0.25rem 0.35rem; touch-action: none;"
				>
					{#each ALPHABET as letter, i (letter)}
						{@const present = presentLetters.has(letter)}
						<button
							type="button"
							tabindex="-1"
							aria-hidden="true"
							style="border: none; background: none; font-size: 0.72rem; font-weight: 700; line-height: 1.05; padding: 0.1rem 0.35rem; border-radius: 4px; pointer-events: none; cursor: {present
								? 'pointer'
								: 'default'}; color: {present
								? '#0969da'
								: '#c9d1d9'}; transform: translateY({railShift(i)}px) scale({railScale(
								i
							)}); transform-origin: center center; transition: transform 0.12s ease-out; will-change: transform;"
							>{letter}</button
						>
					{/each}
				</nav>
			{/if}
		</div>
	</div>
</div>

<!-- Customer-invites modal, opened from the ✉️ button beside "Add customer" -->
<dialog
	bind:this={invitesDialog}
	style="border: none; border-radius: 16px; padding: 0; max-width: 520px; width: 92vw; box-shadow: 0 12px 40px rgba(0,0,0,0.2);"
>
	<div style="display: grid; gap: 0.8rem; padding: 1.25rem;">
		<div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
			<h2 style="margin: 0; font-size: 1.1rem;">Customer invites</h2>
			<button
				type="button"
				onclick={() => invitesDialog?.close()}
				aria-label="Close"
				style="border: none; background: none; font-size: 1.2rem; cursor: pointer; color: #57606a;"
				>✕</button
			>
		</div>

		{#if data.invites.length === 0}
			<p style="margin: 0; color: #57606a; font-size: 0.9rem;">
				No invites yet. Send one from a customer’s ⚙ menu.
			</p>
		{:else}
			<div class="invite-list">
				{#each data.invites as invite (invite.id)}
					<div class="invite-row">
						<div style="min-width: 0;">
							<strong style="word-break: break-word;">{invite.customerEmail}</strong>
							<div style="font-size: 0.82rem; color: #57606a;">
								{inviteLabel(invite.status, invite.expiresAt)} · expires {new Date(
									invite.expiresAt
								).toLocaleDateString()}
							</div>
						</div>
						<div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
							{#if confirmingDeleteInviteId === invite.id}
								<span style="font-size: 0.85rem; color: #57606a;">Delete this invite?</span>
								<form
									method="POST"
									action="?/deleteInvite"
									use:enhance={() =>
										async ({ update }) => {
											confirmingDeleteInviteId = null;
											await update();
										}}
								>
									<input type="hidden" name="inviteId" value={invite.id} />
									<button
										type="submit"
										style="padding: 0.4rem 0.7rem; border-radius: 999px; border: 1px solid #cf222e; background: #cf222e; color: #fff; cursor: pointer;"
										>Yes, delete</button
									>
								</form>
								<button
									type="button"
									onclick={() => (confirmingDeleteInviteId = null)}
									style="padding: 0.4rem 0.7rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer;"
									>Cancel</button
								>
							{:else}
								<form method="POST" action="?/resendInvite" use:enhance>
									<input type="hidden" name="inviteId" value={invite.id} />
									<button type="submit" class="invite-action">Resend</button>
								</form>
								{#if invite.status === 'pending'}
									<form method="POST" action="?/revokeInvite" use:enhance>
										<input type="hidden" name="inviteId" value={invite.id} />
										<button type="submit" class="invite-action danger">Revoke</button>
									</form>
								{/if}
								<button
									type="button"
									title="Delete invite"
									aria-label="Delete invite"
									onclick={() => (confirmingDeleteInviteId = invite.id)}
									style="border: none; background: none; cursor: pointer; font-size: 1rem; line-height: 1; color: #cf222e; padding: 0.2rem 0.35rem;"
									>🗑</button
								>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</dialog>

<!-- Add-customer modal -->
<dialog
	bind:this={addDialog}
	style="border: none; border-radius: 16px; padding: 0; max-width: 480px; width: 92vw; box-shadow: 0 12px 40px rgba(0,0,0,0.2);"
>
	<form
		method="POST"
		action="?/addCustomer"
		use:enhance={({ formData, cancel }) => {
			const err = firstError(formData);
			if (err) {
				addError = err;
				cancel();
				return;
			}
			addError = '';
			return async ({ result, update }) => {
				// "Add & create order" answers with a redirect to the order form; let the
				// default handling follow it rather than closing the dialog here.
				if (result.type === 'redirect') return update();
				await update();
				if (result.type !== 'success') return;
				addDialog?.close();
				if (openedFromEmpty) {
					openedFromEmpty = false;
					await goto(resolve('/contractor'));
				}
			};
		}}
		style="display: grid; gap: 0.6rem; padding: 1.25rem;"
	>
		<div style="display: flex; justify-content: space-between; align-items: center;">
			<h2 style="margin: 0; font-size: 1.1rem;">Add a customer</h2>
			<button
				type="button"
				onclick={() => addDialog?.close()}
				style="border: none; background: none; font-size: 1.2rem; cursor: pointer; color: #57606a;"
				>✕</button
			>
		</div>
		<label style="display: grid; gap: 0.2rem; font-size: 0.85rem; color: #57606a;">
			Name
			<input name="name" required style={fieldStyle} />
		</label>
		<label style="display: grid; gap: 0.2rem; font-size: 0.85rem; color: #57606a;">
			Email
			<input
				name="email"
				type="email"
				required
				inputmode="email"
				autocomplete="email"
				style={fieldStyle}
			/>
		</label>
		<label style="display: grid; gap: 0.2rem; font-size: 0.85rem; color: #57606a;">
			Phone
			<input
				name="phone"
				type="tel"
				inputmode="tel"
				autocomplete="tel"
				oninput={liveFormatPhone}
				placeholder="(555) 123-4567"
				style={fieldStyle}
			/>
		</label>
		<label style="display: grid; gap: 0.2rem; font-size: 0.85rem; color: #57606a;">
			Address
			<input name="address" autocomplete="street-address" style={fieldStyle} />
		</label>
		<TagPicker />
		<label style="display: grid; gap: 0.2rem; font-size: 0.85rem; color: #57606a;">
			Preferred contact method
			<select name="preferredContact" style={fieldStyle}>
				<option value="email" selected>Email</option>
				<option value="call">Call</option>
				<option value="text">Text</option>
			</select>
		</label>
		<label style="display: grid; gap: 0.2rem; font-size: 0.85rem; color: #57606a;">
			Project details / notes
			<textarea name="notes" rows="3" style="{fieldStyle} resize: vertical;"></textarea>
		</label>
		{#if atCustomerLimit}
			<p class="limit-note">
				Your trial covers {data.billing.limits?.customer.limit} customers and you have {data.billing
					.limits?.customer.used}. Archive a customer you're no longer working with to free a space
				— nothing is deleted — or
				<a href={resolve('/contractor/billing')}>subscribe for unlimited</a>.
			</p>
		{/if}
		{#if addError || (form?.action === 'add' && form?.message)}
			<p style="margin: 0; color: #cf222e; font-size: 0.85rem;">{addError || form?.message}</p>
		{/if}
		<!-- Two ways out. Most customers are added because there's work to book, so
		     "Add & create order" saves finding them again on the orders screen; the
		     `next` value is what the action keys the redirect off. -->
		<div class="add-actions">
			<button type="button" onclick={() => addDialog?.close()} class="add-cancel">Cancel</button>
			<button type="submit" name="next" value="order" class="add-secondary"
				>Add &amp; create order</button
			>
			<button type="submit" class="add-primary">Add customer</button>
		</div>
	</form>
</dialog>

<!-- Camera capture modal -->
<dialog
	bind:this={cameraDialog}
	onclose={stopCamera}
	style="border: none; border-radius: 16px; padding: 0; max-width: 460px; width: 92vw; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);"
>
	<div style="display: grid; gap: 0.9rem; padding: 1.25rem;">
		<div style="display: flex; justify-content: space-between; align-items: center;">
			<h2 style="margin: 0; font-size: 1.1rem;">
				{cameraCustomer ? `${cameraCustomer.name}’s photo` : 'Customer photo'}
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
			<!-- Chooser: preview + options, no camera activity yet -->
			<div style="display: flex; flex-direction: column; align-items: center; gap: 0.9rem;">
				{#if cameraCustomer?.avatar}
					<img
						src={cameraCustomer.avatar}
						alt={cameraCustomer.name}
						style="width: 96px; height: 96px; border-radius: 999px; object-fit: cover; border: 1px solid #d0d7de;"
					/>
				{:else}
					<span
						style="width: 96px; height: 96px; border-radius: 999px; border: 1px solid #d0d7de; background: linear-gradient(135deg, #e7edf3, #f6f8fa); color: #445; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 2rem;"
						>{cameraCustomer?.name.charAt(0).toUpperCase() ?? '?'}</span
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
							onchange={(e) => cameraCustomerId && onAvatarPick(cameraCustomerId, e)}
							style="display: none;"
						/>
					</label>
					{#if cameraCustomer?.avatar}
						<button
							type="button"
							onclick={() => cameraCustomerId && removeAvatar(cameraCustomerId)}
							style="{choiceBtn} border: 1px solid #ffd7d5; background: none; color: #cf222e;"
							>Remove photo</button
						>
					{/if}
				</div>
			</div>
		{:else}
			<!-- Live camera view -->
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
							onchange={(e) => cameraCustomerId && onAvatarPick(cameraCustomerId, e)}
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
	/* Count on the ✉️ invites button, so the badge carries the number the old
	   always-visible panel header used to. */
	.invite-badge {
		position: absolute;
		top: -0.25rem;
		right: -0.25rem;
		min-width: 1.05rem;
		height: 1.05rem;
		padding: 0 0.25rem;
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		background: var(--yellow);
		border: 1.5px solid #14171c;
		color: #14171c;
		font-size: 0.68rem;
		font-weight: 800;
		line-height: 1;
		pointer-events: none;
	}
	.invite-list {
		display: grid;
		gap: 0.5rem;
		max-height: 60vh;
		overflow-y: auto;
	}
	.invite-row {
		padding: 0.7rem 0.85rem;
		border-radius: 12px;
		background: var(--surface-sunken);
		border: 1px solid var(--line);
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.invite-action {
		padding: 0.4rem 0.7rem;
		border-radius: 999px;
		border: 1px solid var(--line-strong);
		background: var(--surface);
		color: var(--fg);
		font-weight: 600;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.invite-action:hover {
		background: var(--surface-sunken);
	}
	.invite-action.danger {
		color: #cf222e;
		border-color: #f0c0c4;
	}
	:global(:root[data-theme='dark']) .invite-action.danger {
		color: #ff8f8a;
		border-color: #6b2f33;
	}

	/* Shown inside the add modal when a trial has run out of customer slots.
	   Informative, not a block — the server is what refuses. */
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

	/* Add-customer footer. Wraps rather than squeezing: three buttons don't fit on
	   one line on a phone, and this modal is reached from the getting-started guide
	   where mobile is the likely case. */
	.add-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: flex-end;
	}
	.add-actions button {
		padding: 0.55rem 1rem;
		border-radius: 999px;
		cursor: pointer;
		font-family: inherit;
		font-size: 0.88rem;
	}
	/* Cancel is the way out, not a third choice — plain text, no fill or border, so
	   it carries none of the visual weight of the two submits beside it. */
	.add-cancel {
		border: none;
		background: none;
		color: var(--fg-muted);
		padding: 0.55rem 0.4rem;
		font-size: 0.85rem;
		margin-right: auto;
	}
	.add-cancel:hover {
		color: var(--fg);
	}
	/* Same weight as the primary, different fill: this is an equally valid finish,
	   not a lesser one. */
	.add-secondary {
		border: 1px solid #0969da;
		background: transparent;
		color: #0969da;
		font-weight: 600;
	}
	.add-secondary:hover {
		background: rgba(9, 105, 218, 0.08);
	}
	.add-primary {
		border: 1px solid #0969da;
		background: #0969da;
		color: #fff;
		font-weight: 600;
	}
	.add-primary:hover {
		background: #0860c4;
	}
	.add-actions button:focus-visible {
		outline: 2px solid var(--yellow);
		outline-offset: 2px;
	}
	@media (max-width: 420px) {
		/* The two submits stack full-width; Cancel drops below them as a compact text
		   link rather than a third slab. Selectors are (0,2,0) so they can't be
		   outranked by the base rules — media queries add no specificity. */
		.add-actions .add-secondary,
		.add-actions .add-primary {
			flex: 1 1 100%;
		}
		.add-actions .add-cancel {
			order: 1;
			flex: 0 0 auto;
			margin: 0.1rem auto 0;
		}
	}
	/* Dark: the transparent secondary needs a lighter blue to stay legible. */
	:global(:root[data-theme='dark']) .add-secondary {
		border-color: #58a6ff;
		color: #58a6ff;
	}
	:global(:root[data-theme='dark']) .add-secondary:hover {
		background: rgba(88, 166, 255, 0.12);
	}
</style>
