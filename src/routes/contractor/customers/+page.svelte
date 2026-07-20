<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { customerContactSchema, formatPhone } from '$lib/crm';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const isLinked = (c: { userId: string | null }) => c.userId != null;

	const AVATAR_MAX = 256;

	let savingAvatarId: string | null = $state(null);

	// --- Camera capture ----------------------------------------------------
	let cameraDialog: HTMLDialogElement | undefined = $state();
	let cameraVideo: HTMLVideoElement | undefined = $state();
	let cameraCustomerId: string | null = $state(null);
	let cameraError = $state('');
	let cameraStream: MediaStream | undefined;

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

	async function openCamera(customerId: string) {
		cameraCustomerId = customerId;
		cameraError = '';
		cameraDialog?.showModal();
		if (!navigator.mediaDevices?.getUserMedia) {
			cameraError = 'This device has no camera access. Upload a photo instead.';
			return;
		}
		try {
			cameraStream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'environment' },
				audio: false
			});
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
		cameraDialog?.close();
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
	let addError = $state('');

	// --- Per-card interaction ---------------------------------------------
	let editingId: string | null = $state(null);
	let confirmingArchiveId: string | null = $state(null);

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
</script>

<svelte:head>
	<title>Customer directory</title>
</svelte:head>

<div style="max-width: 860px; margin: 0 auto; padding: 1rem; display: grid; gap: 1rem;">
	<h1 style="margin: 0;">Customers</h1>

	<div
		style="display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: space-between; align-items: center;"
	>
		<!-- Live search -->
		<div style="position: relative; flex: 1; min-width: 220px;">
			<input
				value={query}
				oninput={(e) => (query = e.currentTarget.value)}
				onfocus={() => (searchFocused = true)}
				onblur={() => setTimeout(() => (searchFocused = false), 150)}
				placeholder="Search by name or email"
				style="width: 100%; box-sizing: border-box; padding: 0.5rem; border-radius: 8px; border: 1px solid #d0d7de;"
			/>
			{#if searchFocused && suggestions.length > 0}
				<ul
					style="position: absolute; z-index: 10; left: 0; right: 0; margin: 0.25rem 0 0; padding: 0.25rem; list-style: none; background: #fff; border: 1px solid #d0d7de; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.12);"
				>
					{#each suggestions as name (name)}
						<li>
							<button
								type="button"
								onmousedown={() => (query = name)}
								style="width: 100%; text-align: left; padding: 0.45rem 0.6rem; border: none; background: none; border-radius: 6px; cursor: pointer;"
								>{name}</button
							>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
		<button
			type="button"
			onclick={() => {
				addError = '';
				addDialog?.showModal();
			}}
			style="padding: 0.55rem 1rem; border-radius: 999px; border: 1px solid #0969da; background: #0969da; color: #fff; cursor: pointer; font-weight: 600;"
			>＋ Add customer</button
		>
	</div>

	<!-- Directory -->
	<section style="display: grid; gap: 0.75rem;">
		{#if filtered.length === 0}
			<p style="color: #57606a;">
				{#if term !== ''}
					No customers match “{debounced}”.
				{:else}
					No customers yet. Add your first customer with the button above.
				{/if}
			</p>
		{/if}

		{#each filtered as c (c.id)}
			<article
				style="border: 1px solid #d0d7de; border-radius: 16px; padding: 1rem; display: grid; gap: 0.6rem;"
			>
				<div style="display: flex; justify-content: space-between; gap: 1rem; align-items: center;">
					<div style="display: flex; gap: 0.65rem; align-items: center; min-width: 0;">
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
									style="width: 44px; height: 44px; border-radius: 999px; object-fit: cover; border: 1px solid #d0d7de; display: block; opacity: {savingAvatarId ===
									c.id
										? '0.5'
										: '1'};"
								/>
							{:else}
								<span
									style="width: 44px; height: 44px; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; color: #57606a; display: flex; align-items: center; justify-content: center; font-weight: 600; opacity: {savingAvatarId ===
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
						<strong style="overflow: hidden; text-overflow: ellipsis;">{c.name}</strong>
					</div>
					<div style="display: flex; gap: 0.5rem; align-items: center;">
						{#if isLinked(c)}
							<span
								style="font-size: 0.75rem; color: #1a7f37; border: 1px solid #1a7f37; border-radius: 999px; padding: 0.05rem 0.5rem;"
								>Linked</span
							>
						{/if}
						<button
							type="button"
							title="Archive customer"
							aria-label="Archive customer"
							onclick={() => {
								confirmingArchiveId = c.id;
								if (editingId === c.id) editingId = null;
							}}
							style="border: none; background: none; cursor: pointer; font-size: 1rem; line-height: 1; color: #cf222e; padding: 0.2rem 0.35rem; border-radius: 6px;"
							>🗑</button
						>
					</div>
				</div>

				{#if confirmingArchiveId === c.id}
					<div
						style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; background: #fff8f8; border: 1px solid #ffd7d5; border-radius: 10px; padding: 0.5rem 0.7rem;"
					>
						<span style="font-size: 0.85rem; color: #57606a; flex: 1; min-width: 160px;"
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
				{/if}

				{#if c.tags.length > 0}
					<div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
						{#each c.tags as tag (tag)}
							<span
								style="font-size: 0.75rem; background: #ddf4ff; color: #0969da; border-radius: 999px; padding: 0.1rem 0.55rem;"
								>{tag}</span
							>
						{/each}
					</div>
				{/if}

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
								title={isLinked(c) ? 'Email is locked once the customer has joined' : ''}
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
						<input
							name="tags"
							value={c.tags.join(', ')}
							placeholder="Tags (comma-separated)"
							style={fieldStyle}
						/>
						<textarea
							name="notes"
							rows="2"
							placeholder="Project details / notes"
							style="{fieldStyle} resize: vertical;">{c.notes ?? ''}</textarea
						>
						{#if form?.action === 'edit' && 'id' in form && form.id === c.id && form.message}
							<p style="margin: 0; color: #cf222e; font-size: 0.85rem;">{form.message}</p>
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
					<!-- Read-only view -->
					<div style="display: grid; gap: 0.2rem; font-size: 0.9rem; color: #57606a;">
						<div>{c.email}</div>
						{#if c.phone}<div>{c.phone}</div>{/if}
						{#if c.address}<div>{c.address}</div>{/if}
					</div>
					{#if c.notes}
						<p style="margin: 0; font-size: 0.9rem; white-space: pre-wrap;">{c.notes}</p>
					{/if}

					<div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
						<button
							type="button"
							onclick={() => {
								editingId = c.id;
								confirmingArchiveId = null;
							}}
							style="padding: 0.4rem 0.85rem; border-radius: 999px; border: 1px solid #0969da; color: #0969da; background: none; cursor: pointer;"
							>Edit</button
						>

						{#if !isLinked(c)}
							<form method="POST" action="?/sendInvite" use:enhance>
								<input type="hidden" name="id" value={c.id} />
								<button
									type="submit"
									style="padding: 0.4rem 0.85rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer;"
									>Send invite</button
								>
							</form>
						{/if}
					</div>
				{/if}
			</article>
		{/each}
	</section>
</div>

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
				await update();
				if (result.type === 'success') addDialog?.close();
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
		<label style="display: grid; gap: 0.2rem; font-size: 0.85rem; color: #57606a;">
			Tags (comma-separated)
			<input name="tags" placeholder="kitchen, repeat, referral" style={fieldStyle} />
		</label>
		<label style="display: grid; gap: 0.2rem; font-size: 0.85rem; color: #57606a;">
			Project details / notes
			<textarea name="notes" rows="3" style="{fieldStyle} resize: vertical;"></textarea>
		</label>
		{#if addError || (form?.action === 'add' && form?.message)}
			<p style="margin: 0; color: #cf222e; font-size: 0.85rem;">{addError || form?.message}</p>
		{/if}
		<div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
			<button
				type="button"
				onclick={() => addDialog?.close()}
				style="padding: 0.55rem 1rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer;"
				>Cancel</button
			>
			<button
				type="submit"
				style="padding: 0.55rem 1.1rem; border-radius: 999px; border: 1px solid #0969da; background: #0969da; color: #fff; cursor: pointer; font-weight: 600;"
				>Add customer</button
			>
		</div>
	</form>
</dialog>

<!-- Camera capture modal -->
<dialog
	bind:this={cameraDialog}
	onclose={stopCamera}
	style="border: none; border-radius: 16px; padding: 0; max-width: 460px; width: 92vw; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);"
>
	<div style="display: grid; gap: 0.75rem; padding: 1.25rem;">
		<div style="display: flex; justify-content: space-between; align-items: center;">
			<h2 style="margin: 0; font-size: 1.1rem;">Customer photo</h2>
			<button
				type="button"
				onclick={closeCamera}
				style="border: none; background: none; font-size: 1.2rem; cursor: pointer; color: #57606a;"
				>✕</button
			>
		</div>

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

		<div style="display: flex; gap: 0.5rem; justify-content: flex-end; flex-wrap: wrap;">
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
</dialog>
