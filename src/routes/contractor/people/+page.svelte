<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { goto, invalidateAll } from '$app/navigation';
	import {
		customerContactSchema,
		formatPhone,
		normalizePreferredContact,
		portalInfoFor,
		preferredContactLabel
	} from '$lib/crm';
	import { importSummaryLine, type ImportSummary } from '$lib/contact-import';
	import { toast } from '$lib/toast.svelte';
	import AddressFields from '$lib/AddressFields.svelte';
	import AlphaRail from '$lib/AlphaRail.svelte';
	import { smoothScrollIntoView } from '$lib/smooth-scroll';
	import ContactDialog from '$lib/ContactDialog.svelte';
	import ContactImport from '$lib/ContactImport.svelte';
	import {
		PERSON_ROLES,
		roleLabel,
		searchPeople,
		type DirectoryPerson,
		type PersonRole
	} from '$lib/people';
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
	// The PERSON whose photo is being set, by directory key — not a record id. A
	// face belongs to the human, and the save writes it to every record they hold.
	let cameraPersonKey: string | null = $state(null);
	let cameraError = $state('');
	let cameraStream: MediaStream | undefined;
	// 'choose' shows the options first; 'camera' is the live capture view. The
	// camera is only started when the user explicitly picks "Take photo".
	let cameraMode: 'choose' | 'camera' = $state('choose');
	const cameraPerson = $derived(
		cameraPersonKey ? (data.people.find((p) => p.key === cameraPersonKey) ?? null) : null
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

	async function saveAvatar(person: DirectoryPerson, dataUrl: string) {
		savingAvatarId = person.key;
		try {
			const body = new FormData();
			// Every record this person holds, so one face cannot drift into three.
			if (person.customer) body.set('customerId', person.customer.id);
			if (person.crew) body.set('crewId', person.crew.id);
			if (person.sub) body.set('subId', person.sub.id);
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
	async function onAvatarPick(person: DirectoryPerson, e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		closeCamera();
		const img = await loadImage(file);
		const dataUrl = toAvatarDataUrl(img);
		if (dataUrl) await saveAvatar(person, dataUrl);
	}

	/** Open the photo modal on its chooser — does NOT turn the camera on yet. */
	function openCamera(person: DirectoryPerson) {
		cameraPersonKey = person.key;
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
	async function removeAvatar(person: DirectoryPerson) {
		savingAvatarId = person.key;
		try {
			const body = new FormData();
			if (person.customer) body.set('customerId', person.customer.id);
			if (person.crew) body.set('crewId', person.crew.id);
			if (person.sub) body.set('subId', person.sub.id);
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
		const person = cameraPerson;
		if (!cameraVideo || !person) return;
		const dataUrl = toAvatarDataUrl(cameraVideo);
		closeCamera();
		if (dataUrl) await saveAvatar(person, dataUrl);
	}

	// --- Add modal ---------------------------------------------------------
	let addDialog: HTMLDialogElement | undefined = $state();

	// An empty directory opens the add form on arrival. There is no "no customers
	// yet" message any more, so an empty page would otherwise be blank — and the
	// getting-started guide only sends a contractor here while they have none, which
	// makes this the same moment as arriving from the tutorial. Stops happening for
	// good the instant they have one customer.
	onMount(() => {
		if (data.people.length > 0) return;
		addError = '';
		openedFromEmpty = true;
		addDialog?.showModal();
	});
	// True when the add form opened because the directory was empty — the same moment
	// the getting-started guide sends someone here. On success we hand them back to
	// the dashboard so the next tutorial step is in front of them.
	let openedFromEmpty = $state(false);
	let addError = $state('');
	// What the add form is creating. One form for all three, because the fields a
	// customer needs are a superset of the others' — a crew member is a name, a
	// number and what they do, and asking for a service address to record one is
	// how the old split directory made you answer questions you had no answer to.
	let addRole = $state<PersonRole>('customer');

	// --- Contact import ----------------------------------------------------
	let importDialog: HTMLDialogElement | undefined = $state();
	// The dialog's contents are mounted only while it is open, so reopening it
	// always starts back at "where are these contacts coming from" rather than on
	// the review list from last time.
	let importOpen = $state(false);
	// Existing emails, so the review list can flag someone already on file rather
	// than offering them and failing on the duplicate check.
	const existingEmails = $derived(
		data.people.map((p) => p.email).filter((e): e is string => Boolean(e))
	);
	// Trial headroom, so the dialog can warn before a long list runs into the cap.
	const importRemaining = $derived(
		data.billing.limits
			? Math.max(0, data.billing.limits.customer.limit - data.billing.limits.customer.used)
			: null
	);

	/** Hand over from the add form. One modal at a time, so this closes that one. */
	function openImport() {
		addDialog?.close();
		// That form is no longer the one being answered, so its "send them back to
		// the dashboard afterwards" errand doesn't carry over to a later add.
		openedFromEmpty = false;
		importOpen = true;
		importDialog?.showModal();
	}

	function onImported(summary: ImportSummary) {
		importDialog?.close();
		const detail = importSummaryLine(summary);
		if (summary.imported === 0) {
			toast.show('Nothing was imported', { detail: detail || undefined });
			return;
		}
		toast.success(`Imported ${summary.imported} ${summary.imported === 1 ? 'person' : 'people'}`, {
			detail: detail || undefined
		});
	}

	// --- Per-card interaction ---------------------------------------------
	// Editing opens a full-screen overlay over the card rather than expanding inside
	// it — a whole form never had the room in a directory card, least of all on a
	// phone. `editingId` is the person being edited, by directory key.
	let editingId: string | null = $state(null);
	function openEdit(id: string) {
		editingId = id;
		confirmingArchiveId = null;
	}
	let confirmingArchiveId: string | null = $state(null);
	// Which contact row is expanded to show full details + quick actions.
	let expandedId: string | null = $state(null);
	// Which expanded card is showing its message composer (hidden until "Contact").
	let contactOpenId: string | null = $state(null);
	// The open pane is tabbed so it stays about one screenful: three stacked
	// panels plus notes ran well past the fold on a phone. Every card opens on
	// its first tab, like the subcontractor profile.
	let detailTab: 'details' | 'work' | 'roles' | 'account' | 'notes' = $state('details');

	function toggleExpanded(id: string) {
		expandedId = expandedId === id ? null : id;
		confirmingArchiveId = null;
		contactOpenId = null;
		detailTab = 'details';
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
	// One search over everyone. Company and on-site role are in it deliberately —
	// "who do I have from Acme" and "who are my framers" are real questions, and
	// they are the ones that used to need the other directory.
	const filtered = $derived(searchPeople(data.people, term));
	// Live (un-debounced) suggestions so the dropdown feels instant while typing.
	const suggestions = $derived.by(() => {
		const raw = query.trim().toLowerCase();
		if (raw === '') return [];
		const out: string[] = [];
		for (const c of data.people) {
			if (c.name.toLowerCase().includes(raw) && !out.includes(c.name)) out.push(c.name);
			if (out.length >= 5) break;
		}
		return out.filter((n) => n.toLowerCase() !== raw);
	});

	// --- Alphabetical grouping + A–Z jump rail (rail itself is AlphaRail) ---
	function letterOf(name: string): string {
		const ch = name.trim().charAt(0).toUpperCase();
		return /[A-Z]/.test(ch) ? ch : '#';
	}
	const groups = $derived.by(() => {
		const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
		const buckets: Record<string, typeof data.people> = {};
		for (const c of sorted) {
			(buckets[letterOf(c.name)] ??= []).push(c);
		}
		return Object.entries(buckets)
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([letter, items]) => ({ letter, items }));
	});
	const presentLetters = $derived(new Set(groups.map((g) => g.letter)));
	/** The rail's own element, so a touch on it never reads as "user took over". */
	let railEl: HTMLElement | undefined = $state();
	function jumpTo(letter: string) {
		const el = document.getElementById(`sec-${letter}`);
		// Clears the page's sticky chrome, the same offset the rail sticks at —
		// otherwise the letter you jumped to lands underneath the search bar.
		if (el) smoothScrollIntoView(el, { offset: 84, ignore: railEl });
	}

	/**
	 * What this customer has running, in one phrase.
	 *
	 * "2 active · Back deck" says more than "5 orders": the count that matters on a
	 * directory is the work in flight, and the name of the newest job is what makes
	 * a row recognisable when several customers share a surname.
	 */
	function jobSummary(j: { active: number; total: number; latest: string | null } | null): string {
		if (!j || j.total === 0) return 'None yet';
		const head = j.active > 0 ? `${j.active} active` : `${j.total} finished`;
		return j.latest ? `${head} · ${j.latest}` : head;
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
			city: formData.get('city')?.toString(),
			state: formData.get('state')?.toString(),
			postalCode: formData.get('postalCode')?.toString(),
			notes: formData.get('notes')?.toString()
		});
		return result.success ? null : result.error.issues[0].message;
	}

	/** "Austin, TX" from the captured fields — the profile pane's City row. */
	function cityState(c: { city: string | null; state: string | null }): string {
		return [c.city, c.state].filter(Boolean).join(', ');
	}

	/** How this customer prefers to be reached, for the Contact panel. */
	function preferredLabel(value: string | null | undefined): string {
		return preferredContactLabel(normalizePreferredContact(value));
	}

	/**
	 * Where the customer stands with the portal. A pending invite that has already
	 * lapsed is reported as expired rather than pending — "invite sent" is not a
	 * useful thing to read about a link that no longer opens.
	 */
	function portalStatus(c: { id: string; userId: string | null }): string {
		if (isLinked(c)) return 'Linked';

		const pending = data.invites.find((i) => i.customerId === c.id && i.status === 'pending');
		if (!pending) return 'Not linked yet';
		return new Date(pending.expiresAt).getTime() > Date.now() ? 'Invite pending' : 'Invite expired';
	}

	/**
	 * Live jobs on this person's row, whichever side of the job they are on: the
	 * ones they are the customer FOR plus the ones they are assigned TO. One number
	 * because the tab asks one question — is anything running for this person — and
	 * splitting it into two badges would make the reader do the addition.
	 */
	function workCount(p: DirectoryPerson): number {
		return (p.jobs?.active ?? 0) + p.jobCount;
	}

	/** Why somebody would hold this role, said in the fewest words that mean it. */
	function roleBlurb(role: PersonRole): string {
		if (role === 'customer') return 'You work for them — orders, invoices, the portal.';
		if (role === 'crew') return 'They work with you on site.';
		return 'A business you engage — tier, insurance, their own portal.';
	}

	/**
	 * Notes, from whichever record carries them.
	 *
	 * Three tables each have a notes column and a person can hold all three. Rather
	 * than three note panes, the profile shows what is written about the PERSON,
	 * labelled by where it came from only when there is more than one.
	 */
	function personNotes(p: DirectoryPerson): string {
		const parts = [
			p.customer?.notes ? { from: 'As a customer', text: p.customer.notes } : null,
			p.crew?.notes ? { from: 'As crew', text: p.crew.notes } : null,
			p.sub?.notes ? { from: 'As a subcontractor', text: p.sub.notes } : null
		].filter((n): n is { from: string; text: string } => n !== null);
		if (parts.length === 0) return '';
		if (parts.length === 1) return parts[0].text;
		return parts.map((n) => `${n.from}: ${n.text}`).join('\n\n');
	}

	/** Short, readable date for the Account panel. */
	function fmtDay(d: string | Date): string {
		const date = typeof d === 'string' ? new Date(d) : d;
		return Number.isNaN(date.getTime())
			? '—'
			: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	// `width: 100%; box-sizing: border-box` is load-bearing, not decoration: an
	// <input> carries an intrinsic default width of roughly 20 characters, so
	// without these it refuses to shrink below ~180px and pushes its container
	// wider than the phone. That is what put a horizontal scrollbar on the
	// city/state/ZIP row. Every control below wants to fill its cell anyway.
	const fieldStyle =
		'width: 100%; box-sizing: border-box; padding: 0.5rem; border-radius: 8px; border: 1px solid #d0d7de; font-size: 1rem;';
</script>

<svelte:head>
	<title>People</title>
</svelte:head>

<div style="background: #f6f8fa; min-height: 100%;">
	<div class="page-shell">
		<header>
			<h1 class="page-title" style="margin: 0;">People</h1>
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
						style="width: 2.9rem; height: 2.9rem; font-size: 1.65rem;">✉️</button
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

		<!-- Directory: the list on the left, A–Z jump rail on the right -->
		<div class="directory">
			<section class="dir-list">
				<!-- Only the no-match case gets a message. An empty directory speaks for
				     itself, and arriving here with none opens the add form anyway. -->
				{#if filtered.length === 0 && term !== ''}
					<p style="color: #57606a;">Nobody matches “{debounced}”.</p>
				{/if}

				{#each groups as group (group.letter)}
					<!-- On a phone this is a grid of one column with a heading above it. On
					     a desktop the wrapper dissolves (`display: contents`) and every card
					     in the directory joins ONE grid.

					     That is the whole fix for how this page looked at width. A grid per
					     letter meant a letter holding two contacts left two empty columns
					     before the next letter began on a fresh row — so a directory of
					     twenty people rendered as a dozen ragged part-rows with holes down
					     the right-hand side. One grid packs continuously; the letters are
					     marked on the cards that start them instead of by breaking the row.

					     The wrapper generates no box when it dissolves, so it can't be a
					     scroll target — the A–Z rail's anchor moves to the first card. -->
					<div class="letter-group">
						<h2 class="letter-head">{group.letter}</h2>

						{#each group.items as c, i (c.key)}
							{@const expanded = expandedId === c.key}
							<!-- The shared `.card` padding is zeroed out here: the row inside brings
							     its own, and the two together made a collapsed contact twice as tall
							     as the name it shows.
							
							     An open contact takes the whole row: left in one column of a
							     multi-column grid it would stretch its collapsed neighbours to
							     match a full profile's height. -->
							<article
								id={i === 0 ? `sec-${group.letter}` : undefined}
								class="card contact-card"
								class:span-all={expanded}
								class:starts-letter={i === 0}
								style={i === 0 ? `--letter: '${group.letter}'` : undefined}
							>
								<!-- Contact row. A photo, a name, what this person is to the contractor,
								     and nothing else. Email, phone, where they are and what is running for
								     them all used to sit here as a three-fact block under every name; on a
								     directory, whose job is FINDING somebody, each of those lines is a
								     person fewer on screen. They are one click down, in the profile. -->
								<div class="contact-row">
									<button
										type="button"
										class="avatar-btn"
										class:saving={savingAvatarId === c.key}
										onclick={() => openCamera(c)}
										title="Take or upload a photo"
										aria-label="Set photo for {c.name}"
									>
										{#if c.avatar}
											<img class="avatar" src={c.avatar} alt={c.name} />
										{:else}
											<span class="avatar fallback">{c.name.charAt(0).toUpperCase()}</span>
										{/if}
										<!-- The camera hint waits for a hover where there is one to wait for;
										     on a touch screen it stays put, since there is nothing else to
										     say the photo is a control. -->
										<span class="avatar-cam" aria-hidden="true">📷</span>
									</button>

									<button
										type="button"
										class="contact-open"
										onclick={() => toggleExpanded(c.key)}
										aria-expanded={expanded}
									>
										<span class="contact-name">{c.name}</span>
										<!-- What this person IS to the contractor, which is the one thing a
										     merged directory has to say out loud: the same row can be a
										     customer, a hand, and a firm you engage, and which of those is
										     true changes what the profile below offers. Chips rather than a
										     subtitle, because it is a set and sets read as chips. -->
										<span class="role-chips">
											{#each c.roles as role (role)}
												<span class="role-chip {role}">{roleLabel(role)}</span>
											{/each}
										</span>
									</button>

									<!-- Reaching somebody is the errand a directory exists for, so it does
									     not wait behind an expand: the composer opens from the row itself,
									     open or closed. It used to live in the profile's action strip,
									     which meant two clicks and a card's worth of scrolling to say one
									     sentence to somebody whose name you could already see. -->
									<div class="row-contact">
										<!-- Only where there is something to reach them ON. A crew hand can be
										     a name and nothing else, and a composer with every channel greyed
										     out is a button that lies about what it does. -->
										{#if c.email || c.phone}
											<button
												type="button"
												title="Message {c.name}"
												aria-label="Message {c.name}"
												aria-expanded={contactOpenId === c.key}
												onclick={() => (contactOpenId = contactOpenId === c.key ? null : c.key)}
												class="icon-btn row-btn chat-btn">💬</button
											>
										{/if}
										{#if contactOpenId === c.key}
											<!-- Chat, the invite and the conversation picker all belong to the
											     CUSTOMER record: a thread hangs off an order, and only a customer
											     has one. Somebody who is only crew still gets email, text and
											     call — the panel drops the tab it cannot honour rather than
											     offering a dead one. -->
											<ContactDialog
												contact={{
													name: c.name,
													email: c.email ?? '',
													phone: c.phone,
													preferredContact: c.customer?.preferredContact ?? 'email'
												}}
												conversations={c.customer ? (data.conversations[c.customer.id] ?? []) : []}
												canChat={c.customer ? isLinked(c.customer) : false}
												customerId={c.customer?.id ?? null}
												portal={c.customer
													? portalInfoFor({
															linked: isLinked(c.customer),
															customerId: c.customer.id,
															invites: data.invites
														})
													: null}
												onsent={() => (contactOpenId = null)}
												onclose={() => (contactOpenId = null)}
											/>
										{/if}
									</div>

									<!-- The open/close control. It was a bare ▸ glyph — the same weight as
									     punctuation, with no hit area of its own and nothing saying it could
									     be pressed. As a button with the app's own icon chrome it reads as
									     the control it always was, and it says which way it is going. -->
									<button
										type="button"
										class="icon-btn row-btn toggle-btn"
										class:on={expanded}
										aria-expanded={expanded}
										aria-label={expanded ? `Hide ${c.name}'s details` : `Show ${c.name}'s details`}
										title={expanded ? 'Hide details' : 'Show details'}
										onclick={() => toggleExpanded(c.key)}
									>
										<span class="chev" class:open={expanded} aria-hidden="true">▸</span>
									</button>
								</div>

								{#if expanded}
									<div class="detail">
										{#if editingId === c.key && c.customer}
											{@const cust = c.customer}
											<!-- Edit mode: a full-screen overlay so the form has the whole screen to breathe
											     rather than a directory card's width. The card underneath stays put. -->
											<div
												class="edit-overlay"
												role="dialog"
												aria-modal="true"
												aria-label="Edit {cust.name}"
											>
												<button
													type="button"
													class="edit-backdrop"
													aria-label="Close edit"
													onclick={() => (editingId = null)}
												></button>
												<div class="edit-sheet">
													<div class="edit-sheet-head">
														<h2 class="edit-sheet-title">Edit {cust.name}</h2>
														<button
															type="button"
															class="edit-sheet-x"
															aria-label="Close"
															onclick={() => (editingId = null)}>✕</button
														>
													</div>
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
														<input type="hidden" name="id" value={cust.id} />
														<!-- Placeholders stand in for labels on this form, so the
												     required marker rides along in them. -->
														<input
															name="name"
															value={cust.name}
															required
															aria-required="true"
															placeholder="Name *"
															aria-label="Name"
															style={fieldStyle}
														/>
														<!-- Email gets its own row rather than sharing one with the name:
												     addresses are long, and half a row truncated them. It carries the
												     same field styling as every other input — the locked state is
												     said in words below, since the old grey fill never survived the
												     shared input rule in app.css. -->
														<input
															name="email"
															type="email"
															value={cust.email}
															readonly={isLinked(cust)}
															required
															aria-required="true"
															placeholder="Email *"
															aria-label="Email"
															title={isLinked(cust)
																? 'Email is locked once the customer has joined'
																: ''}
															style={fieldStyle}
														/>
														{#if isLinked(cust)}
															<p style="margin: -0.2rem 0 0; font-size: 0.78rem; color: #8c959f;">
																Locked — {cust.name} has joined with this address.
															</p>
														{/if}
														<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
															<input
																name="phone"
																type="tel"
																inputmode="tel"
																autocomplete="tel"
																value={cust.phone ?? ''}
																oninput={liveFormatPhone}
																placeholder="Phone"
																style={fieldStyle}
															/>
															<input
																name="address"
																value={cust.address ?? ''}
																placeholder="Street address"
																autocomplete="street-address"
																style={fieldStyle}
															/>
														</div>
														<!-- Same ZIP-led address as the add form: what's on file shows as
												     a summary until they ask to change it. -->
														<AddressFields
															city={cust.city}
															state={cust.state}
															postalCode={cust.postalCode}
															{fieldStyle}
														/>
														<label
															style="display: grid; gap: 0.2rem; font-size: 0.85rem; color: #57606a;"
														>
															Preferred contact method
															<select name="preferredContact" style={fieldStyle}>
																<option
																	value="email"
																	selected={normalizePreferredContact(cust.preferredContact) ===
																		'email'}>Email</option
																>
																<option
																	value="call"
																	selected={normalizePreferredContact(cust.preferredContact) ===
																		'call'}>Call</option
																>
																<option
																	value="text"
																	selected={normalizePreferredContact(cust.preferredContact) ===
																		'text'}>Text</option
																>
															</select>
														</label>
														<textarea
															name="notes"
															rows="2"
															placeholder="Project details / notes"
															style="{fieldStyle} resize: vertical;">{cust.notes ?? ''}</textarea
														>
														{#if form?.action === 'edit' && 'id' in form && form.id === cust.id && form.message}
															<p style="margin: 0; color: #cf222e; font-size: 0.85rem;">
																{form.message}
															</p>
														{/if}
														<!-- Same footer as the Add-customer modal: Save is the yellow
														     primary, Cancel is a quiet text way-out beside it. -->
														<div class="add-actions">
															<button
																type="button"
																onclick={() => (editingId = null)}
																class="add-cancel">Cancel</button
															>
															<button type="submit" class="add-save">Save changes</button>
														</div>
													</form>
												</div>
											</div>
										{:else if editingId === c.key && c.crew}
											{@const crew = c.crew}
											<!-- Crew edit, inline rather than in the full-screen sheet: a crew
											     record is five fields, and a modal for five fields is a modal for
											     the sake of one. A person who is ALSO a customer edits through the
											     sheet above, which carries the address the portal needs. -->
											<form
												method="POST"
												action="?/editCrew"
												use:enhance={() =>
													async ({ result, update }) => {
														await update({ reset: false });
														if (result.type === 'success') editingId = null;
													}}
												class="crew-form"
											>
												<input type="hidden" name="id" value={crew.id} />
												<label
													>Name<input
														class="field-input"
														name="name"
														value={crew.name}
														required
													/></label
												>
												<label
													>Role<input
														class="field-input"
														name="role"
														value={crew.role ?? ''}
														placeholder="Framer, helper, operator…"
													/></label
												>
												<label
													>Company <span class="opt">(optional)</span><input
														class="field-input"
														name="company"
														value={crew.company ?? ''}
													/></label
												>
												<label
													>Phone<input
														class="field-input"
														name="phone"
														type="tel"
														value={crew.phone ?? ''}
														oninput={liveFormatPhone}
													/></label
												>
												<label
													>Email <span class="opt">(optional)</span><input
														class="field-input"
														name="email"
														type="email"
														value={crew.email ?? ''}
													/></label
												>
												{#if form?.action === 'edit' && form?.message}
													<p class="form-error wide" role="alert">{form.message}</p>
												{/if}
												<div class="add-actions wide">
													<button
														type="button"
														class="add-cancel"
														onclick={() => (editingId = null)}>Cancel</button
													>
													<button type="submit" class="add-save">Save changes</button>
												</div>
											</form>
										{:else}
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
													<!-- What they are working on. A tab rather than a third block on
													     the Details pane, because it is the answer to a different
													     question — Details is who they are, this is what is live — and
													     because a count belongs on a tab, where it is legible without
													     opening anything. -->
													<button
														type="button"
														role="tab"
														class="tab"
														class:active={detailTab === 'work'}
														aria-selected={detailTab === 'work'}
														onclick={() => (detailTab = 'work')}
														>Work{#if workCount(c) > 0}<span
																class="tab-count"
																aria-label="{workCount(c)} live {workCount(c) === 1
																	? 'job'
																	: 'jobs'}">{workCount(c)}</span
															>{/if}</button
													>
													<!-- What this person is to the contractor, and the controls that
													     change it. Its own tab rather than a strip on the Details pane:
													     adding a role CREATES a record, which is not something to put
													     next to a phone number. -->
													<button
														type="button"
														role="tab"
														class="tab"
														class:active={detailTab === 'roles'}
														aria-selected={detailTab === 'roles'}
														onclick={() => (detailTab = 'roles')}>Roles</button
													>
													{#if c.customer}
														<button
															type="button"
															role="tab"
															class="tab"
															class:active={detailTab === 'account'}
															aria-selected={detailTab === 'account'}
															onclick={() => (detailTab = 'account')}>Account</button
														>
													{/if}
													{#if personNotes(c)}
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
											</div>

											<!-- Facts in titled panels, the same treatment as a subcontractor
											     profile: grouped by the question being asked, values flush right,
											     and the grid refilling to one column on a phone. -->
											{#if detailTab === 'details'}
												<div class="profile">
													<div class="fact-group">
														<!-- Edit rides on the Contact header rather than opposite the
														     tabs. Opposite the tabs it was on show from every tab,
														     offering to edit details while you were looking at roles or
														     a message thread; here it is on the one pane it acts on, and
														     sits against the fields it opens for editing.

														     It edits whichever record carries the detail: the customer
														     one where there is one, since that is the record holding the
														     address, otherwise the crew record. -->
														<div class="fact-head">
															<span class="fact-icon" aria-hidden="true">✉</span>Contact
															{#if c.customer || c.crew}
																<button
																	type="button"
																	class="cta ghost pane-edit"
																	onclick={() => openEdit(c.key)}>Edit</button
																>
															{/if}
														</div>
														<dl class="fact-list">
															<div class="fact">
																<dt>Email</dt>
																<dd>
																	{#if c.email}<a href="mailto:{c.email}">{c.email}</a>{:else}<span
																			class="unset">Not set</span
																		>{/if}
																</dd>
															</div>
															<div class="fact">
																<dt>Phone</dt>
																<dd>
																	<!-- Display form keeps its punctuation, the href doesn't. -->
																	{#if c.phone}<a href="tel:{c.phone.replace(/[^\d+]/g, '')}"
																			>{c.phone}</a
																		>{:else}<span class="unset">Not set</span>{/if}
																</dd>
															</div>
															{#if c.company}
																<div class="fact">
																	<dt>Company</dt>
																	<dd>{c.company}</dd>
																</div>
															{/if}
															{#if c.customer}
																<div class="fact">
																	<dt>Prefers</dt>
																	<dd>{preferredLabel(c.customer.preferredContact)}</dd>
																</div>
															{/if}
														</dl>
													</div>

													{#if c.customer}
														{@const cust = c.customer}
														<div class="fact-group">
															<div class="fact-head">
																<span class="fact-icon" aria-hidden="true">📍</span>Location
															</div>
															<dl class="fact-list">
																<div class="fact">
																	<dt>Street</dt>
																	<dd>
																		{#if cust.address}{cust.address}{:else}<span class="unset"
																				>Not set</span
																			>{/if}
																	</dd>
																</div>
																<div class="fact">
																	<dt>City</dt>
																	<dd>
																		{#if cityState(cust)}{cityState(cust)}{:else}<span class="unset"
																				>Not set</span
																			>{/if}
																	</dd>
																</div>
																<div class="fact">
																	<dt>ZIP</dt>
																	<dd>
																		{#if cust.postalCode}{cust.postalCode}{:else}<span class="unset"
																				>Not set</span
																			>{/if}
																	</dd>
																</div>
															</dl>
														</div>
													{/if}
												</div>
											{:else if detailTab === 'work'}
												<div class="profile">
													<!-- Work cuts both ways for one person: the jobs they are the
													     customer FOR, and the jobs they are ON. A row that carries both
													     is exactly the case the split directory could not show. -->
													<div class="fact-group">
														<div class="fact-head">
															<span class="fact-icon" aria-hidden="true">🔨</span>Work
														</div>
														<dl class="fact-list">
															{#if c.customer}
																{@const jobs = data.customerJobs[c.customer.id] ?? []}
																<!-- One row per job, each a link straight to it. It used to be
																     the one-line summary — "2 active · Back deck" — which told
																     you work existed and then made you go and find it in Orders.
																     The count is on the tab already; this is the way through.

																     Project name leads, state trails, matching the order list
																     and the order page. Falls back to the summary phrase when
																     there is nothing to link to. -->
																<div class="fact jobs-fact">
																	<dt>Their jobs</dt>
																	<dd>
																		{#if jobs.length > 0}
																			<ul class="job-links">
																				{#each jobs as job (job.id)}
																					<li>
																						<a
																							class="job-link"
																							href={resolve(`/contractor/orders/${job.id}`)}
																						>
																							<span class="job-name"
																								>{job.projectName ?? 'Untitled job'}</span
																							>
																							<span class="job-state" class:live={job.active}
																								>{job.state}</span
																							>
																						</a>
																					</li>
																				{/each}
																			</ul>
																		{:else}
																			{jobSummary(c.jobs)}
																		{/if}
																	</dd>
																</div>
															{/if}
															{#if c.crew || c.sub}
																<div class="fact">
																	<dt>On site</dt>
																	<dd>
																		{c.jobCount === 0
																			? 'No live jobs'
																			: `${c.jobCount} ${c.jobCount === 1 ? 'job' : 'jobs'}`}
																	</dd>
																</div>
															{/if}
															{#if c.role}
																<div class="fact">
																	<dt>{c.sub ? 'Trade' : 'Role'}</dt>
																	<dd>{c.role}</dd>
																</div>
															{/if}
														</dl>
													</div>
												</div>
											{:else if detailTab === 'roles'}
												<div class="profile">
													<div class="fact-group wide">
														<div class="fact-head">
															<span class="fact-icon" aria-hidden="true">🏷</span>What they are to
															you
														</div>
														<div class="roles-pane">
															<p class="roles-note">
																Somebody can be more than one. Each role is its own record —
																removing one archives it and leaves the others alone.
															</p>
															<ul class="role-list">
																{#each PERSON_ROLES as role (role)}
																	{@const held = c.roles.includes(role)}
																	{@const recordId =
																		role === 'customer'
																			? (c.customer?.id ?? null)
																			: role === 'crew'
																				? (c.crew?.id ?? null)
																				: (c.sub?.id ?? null)}
																	<li class="role-row" class:on={held}>
																		<!-- Held or not, said once. The chip alone could not carry it:
																		     every row shows every role, so the chip is the NAME of the
																		     thing, not the answer. -->
																		<span class="role-mark" aria-hidden="true"
																			>{held ? '✓' : ''}</span
																		>
																		<span class="role-row-name">
																			<span class="role-chip {role}">{roleLabel(role)}</span>
																			<span class="role-why">{roleBlurb(role)}</span>
																		</span>
																		<span class="role-action">
																			{#if held && recordId}
																				<!-- Two-step, like every other destructive control here: the
																			     record survives, but it drops out of the directory and
																			     out of every picker that offers it. -->
																				{#if confirmingArchiveId === `${c.key}:${role}`}
																					<form
																						method="POST"
																						action="?/removeRole"
																						use:enhance={() =>
																							async ({ update }) => {
																								confirmingArchiveId = null;
																								await update();
																							}}
																						class="role-confirm"
																					>
																						<input type="hidden" name="role" value={role} />
																						<input type="hidden" name="id" value={recordId} />
																						<button type="submit" class="cta danger"
																							>Archive it</button
																						>
																					</form>
																					<button
																						type="button"
																						class="cta ghost"
																						onclick={() => (confirmingArchiveId = null)}
																						>Keep</button
																					>
																				{:else}
																					<button
																						type="button"
																						class="cta ghost quiet"
																						onclick={() =>
																							(confirmingArchiveId = `${c.key}:${role}`)}
																						>Remove</button
																					>
																				{/if}
																			{:else}
																				<!-- Adding a role creates its record from what is already on
																			     file. Customer and subcontractor are both identified by
																			     their email, so neither can be added to somebody the
																			     address book gave no address for. -->
																				{#if role !== 'crew' && !c.email}
																					<span class="role-blocked">Needs an email</span>
																				{:else}
																					<form method="POST" action="?/addRole" use:enhance>
																						<input type="hidden" name="role" value={role} />
																						<input type="hidden" name="name" value={c.name} />
																						<input
																							type="hidden"
																							name="email"
																							value={c.email ?? ''}
																						/>
																						<input
																							type="hidden"
																							name="phone"
																							value={c.phone ?? ''}
																						/>
																						<input
																							type="hidden"
																							name="company"
																							value={c.company ?? ''}
																						/>
																						<button type="submit" class="cta ghost">Add</button>
																					</form>
																				{/if}
																			{/if}
																		</span>
																	</li>
																{/each}
															</ul>
															{#if form?.action === 'role' && form?.message}
																<p class="form-error" role="alert">{form.message}</p>
															{/if}
														</div>
													</div>

													{#if c.sub}
														{@const sub = c.sub}
														<!-- The subcontractor extras. Read-only here: a tier decides what
														     somebody can see of a job, and insurance is a compliance fact —
														     both belong on the page that is about the engagement, next to
														     the invite that grants the portal. -->
														<div class="fact-group wide">
															<div class="fact-head">
																<span class="fact-icon" aria-hidden="true">🛡</span>Engagement
															</div>
															<dl class="fact-list">
																<div class="fact">
																	<dt>Access</dt>
																	<dd>
																		{sub.tier === 'trusted'
																			? 'Trusted subcontractor'
																			: 'Guest contractor'}
																		{#if sub.userId}· portal{/if}
																	</dd>
																</div>
																<div class="fact">
																	<dt>License #</dt>
																	<dd>
																		{#if sub.licenseNumber}{sub.licenseNumber}{:else}<span
																				class="unset">Not on file</span
																			>{/if}
																	</dd>
																</div>
																<div class="fact">
																	<dt>Insurer</dt>
																	<dd>
																		{#if sub.insuranceCarrier}{sub.insuranceCarrier}{:else}<span
																				class="unset">Not on file</span
																			>{/if}
																	</dd>
																</div>
																<div class="fact">
																	<dt>Insured to</dt>
																	<dd>
																		{#if sub.insuranceExpiresAt}{fmtDay(
																				sub.insuranceExpiresAt
																			)}{:else}<span class="unset">Not on file</span>{/if}
																	</dd>
																</div>
															</dl>
															<div class="row-actions">
																<a class="cta ghost" href={resolve('/contractor/subcontractors')}
																	>Manage engagement →</a
																>
															</div>
														</div>
													{/if}
												</div>
											{:else if detailTab === 'account' && c.customer}
												{@const cust = c.customer}
												<div class="profile">
													<div class="fact-group">
														<div class="fact-head">
															<span class="fact-icon" aria-hidden="true">👤</span>Account
														</div>
														<dl class="fact-list">
															<div class="fact">
																<dt>Portal</dt>
																<dd>{portalStatus(cust)}</dd>
															</div>
															<div class="fact">
																<dt>Added</dt>
																<dd>{fmtDay(cust.createdAt)}</dd>
															</div>
															<div class="fact">
																<dt>Updated</dt>
																<dd>{fmtDay(cust.updatedAt)}</dd>
															</div>
														</dl>
													</div>
												</div>
											{:else if detailTab === 'notes'}
												<p class="notes-pane">{personNotes(c)}</p>
											{/if}
										{/if}
									</div>
								{/if}
							</article>
						{/each}
					</div>
				{/each}
			</section>

			<!-- A–Z jump rail with dock-style magnification (shared with the
			     subcontractor directory). -->
			{#if data.people.length > 0}
				<AlphaRail present={presentLetters} onjump={jumpTo} onrail={(el) => (railEl = el)} />
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

<!-- Contact-import modal. Wider than the add form: it shows a list to review,
     not a form to fill in. -->
<dialog
	bind:this={importDialog}
	onclose={() => (importOpen = false)}
	style="border: none; border-radius: 16px; padding: 0; max-width: 560px; width: 94vw; box-shadow: 0 12px 40px rgba(0,0,0,0.2);"
>
	{#if importOpen}
		<ContactImport
			{existingEmails}
			remaining={importRemaining}
			action="?/importPeople"
			noun="person"
			onclose={() => importDialog?.close()}
			onimported={onImported}
			kinds={[
				// Customer first, so it is the default: this is the directory a
				// contractor fills from their phone on day one, and most of those names
				// are people they work FOR.
				{ id: 'customer', label: 'Customer', emailRequired: true },
				// Crew need no address — a labourer may only ever be a name and a mobile
				// number, and refusing to record them until somebody invents an email
				// would be the app being wrong about the world.
				{ id: 'crew', label: 'Crew', emailRequired: false },
				{ id: 'sub', label: 'Subcontractor', emailRequired: true }
			]}
		/>
	{/if}
</dialog>

<!-- Add-customer modal -->
<dialog
	bind:this={addDialog}
	style="border: none; border-radius: 16px; padding: 0; max-width: 480px; width: 92vw; box-shadow: 0 12px 40px rgba(0,0,0,0.2);"
>
	<form
		method="POST"
		action={addRole === 'customer' ? '?/addCustomer' : '?/addRole'}
		use:enhance={({ formData, cancel }) => {
			// The customer schema is the only one this pre-check knows, and it is the
			// only one whose fields are all on screen. Crew and subcontractor answers
			// are checked on the server, where their own schemas live.
			const err = addRole === 'customer' ? firstError(formData) : null;
			if (err) {
				addError = err;
				cancel();
				return;
			}
			addError = '';
			return async ({ result, update }) => {
				// With "Create an order for them next" ticked the action answers with a
				// redirect to the order form; let the default handling follow it rather
				// than closing the dialog here.
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
			<h2 style="margin: 0; font-size: 1.1rem;">Add someone</h2>
			<button
				type="button"
				onclick={() => addDialog?.close()}
				style="border: none; background: none; font-size: 1.2rem; cursor: pointer; color: #57606a;"
				>✕</button
			>
		</div>
		<!-- The other way to add someone, offered where adding someone is already the
		     task. Typing a customer in and importing a batch of them are the same
		     errand, so the import belongs in front of this form rather than behind
		     its own button in the directory header. -->
		<button type="button" class="add-import" onclick={openImport}> Import from my contacts </button>
		<!-- What they are to you, answered first, because it decides what the rest of
		     this form even asks. Not a decision about which directory to file them
		     in — there is one — and it can be added to later without retyping any of
		     this. -->
		<div class="add-roles" role="radiogroup" aria-label="What are they to you">
			{#each PERSON_ROLES as role (role)}
				<label class="kind" class:on={addRole === role}>
					<input
						class="kind-radio"
						type="radio"
						name="role"
						value={role}
						checked={addRole === role}
						onchange={() => (addRole = role)}
					/>
					<span>{roleLabel(role)}</span>
				</label>
			{/each}
		</div>
		<!-- Says what the asterisks mean before the first one appears. -->
		<p class="req-legend"><span class="req" aria-hidden="true">*</span> Required</p>
		<label style="display: grid; gap: 0.2rem; font-size: 0.85rem; color: #57606a;">
			<span>Name <span class="req" aria-hidden="true">*</span></span>
			<input name="name" required aria-required="true" style={fieldStyle} />
		</label>
		<label style="display: grid; gap: 0.2rem; font-size: 0.85rem; color: #57606a;">
			<span>
				Email
				{#if addRole === 'crew'}<span class="opt">(optional)</span>{:else}<span
						class="req"
						aria-hidden="true">*</span
					>{/if}
			</span>
			<!-- Required for a customer and for a subcontractor, who are both
			     IDENTIFIED by their address — it is the invite channel and the
			     uniqueness key. Crew are not. -->
			<input
				name="email"
				type="email"
				required={addRole !== 'crew'}
				aria-required={addRole !== 'crew'}
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
				style={fieldStyle}
			/>
		</label>
		{#if addRole === 'customer'}
			<!-- Where the work happens, and how they want to hear from you. Asked only
			     of a customer: it is the address an order defaults its site to and the
			     channel the portal invite goes down. -->
			<label style="display: grid; gap: 0.2rem; font-size: 0.85rem; color: #57606a;">
				Street address
				<input name="address" autocomplete="street-address" style={fieldStyle} />
			</label>
			<AddressFields labels {fieldStyle} />
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
		{:else}
			<label style="display: grid; gap: 0.2rem; font-size: 0.85rem; color: #57606a;">
				{addRole === 'sub' ? 'Trade' : 'Role on site'}
				<input
					name="workRole"
					placeholder={addRole === 'sub' ? 'Electrical, concrete…' : 'Framer, helper, operator…'}
					style={fieldStyle}
				/>
			</label>
			<label style="display: grid; gap: 0.2rem; font-size: 0.85rem; color: #57606a;">
				Company <span class="opt">(optional)</span>
				<input name="company" style={fieldStyle} />
			</label>
			{#if addRole === 'sub'}
				<p class="req-legend">
					Tier, licence and insurance are set on the subcontractor page — an address book carries
					none of them, so this starts as a guest contractor.
				</p>
			{/if}
		{/if}
		{#if atCustomerLimit && addRole === 'customer'}
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
		<!-- One save button, with the follow-on offered as a choice above it rather
		     than as a second button beside it. Most customers are added because
		     there's work to book, so the option is worth surfacing — but it's a
		     detail of the save, not a rival to it. An unchecked checkbox submits
		     nothing, so `next=order` reaches the action only when it's ticked,
		     which is exactly what that action already keys its redirect off. -->
		{#if addRole === 'customer'}
			<label class="add-also">
				<input type="checkbox" name="next" value="order" />
				<span>Create an order for them next</span>
			</label>
		{/if}
		<div class="add-actions">
			<button type="button" onclick={() => addDialog?.close()} class="add-cancel">Cancel</button>
			<button type="submit" class="add-save">Add {roleLabel(addRole).toLowerCase()}</button>
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
				{cameraPerson ? `${cameraPerson.name}’s photo` : 'Photo'}
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
				{#if cameraPerson?.avatar}
					<img
						src={cameraPerson.avatar}
						alt={cameraPerson.name}
						style="width: 96px; height: 96px; border-radius: 999px; object-fit: cover; border: 1px solid #d0d7de;"
					/>
				{:else}
					<span
						style="width: 96px; height: 96px; border-radius: 999px; border: 1px solid #d0d7de; background: linear-gradient(135deg, #e7edf3, #f6f8fa); color: #445; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 2rem;"
						>{cameraPerson?.name.charAt(0).toUpperCase() ?? '?'}</span
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
							onchange={(e) => cameraPerson && onAvatarPick(cameraPerson, e)}
							style="display: none;"
						/>
					</label>
					{#if cameraPerson?.avatar}
						<button
							type="button"
							onclick={() => cameraPerson && removeAvatar(cameraPerson)}
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
							onchange={(e) => cameraPerson && onAvatarPick(cameraPerson, e)}
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
	/* Contacts inside one letter, across as many columns as the viewport holds.
	   `min()` against 100% keeps a single column below the card's own minimum
	   rather than overflowing the page. */ /* ------------------------------------------------------------- Directory
	   The list and the A–Z rail beside it. */
	.directory {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}
	.dir-list {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 1.25rem;
	}

	/* Phone: one column per letter, with the letter as a heading above it. */
	.letter-group {
		display: grid;
		gap: var(--page-gap);
		align-items: start;
	}
	/* The A–Z rail's scroll target, at every width — the anchor lives on the first
	   card of a letter rather than on its heading, because the heading stops being
	   a box on desktop and a `display: contents` element cannot be scrolled to.
	   The margin clears the sticky search bar above it. */
	.contact-card[id] {
		scroll-margin-top: 96px;
	}
	.letter-head {
		position: sticky;
		top: 52px;
		z-index: 5;
		margin: 0;
		padding: 0.3rem 0.1rem 0.2rem;
		border-bottom: 1px solid var(--line);
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--fg-muted);
		background: var(--paper);
	}

	/* Desktop: one grid for the whole directory. The per-letter wrappers and their
	   headings both stop existing as boxes — the headings because a full-width row
	   is exactly what fragments the packing, the wrappers because they were the
	   fragmentation. */
	@media (min-width: 900px) {
		.dir-list {
			/* Narrower tracks than the 21rem the three-fact cards needed: a row that is
			   a name and a face fits a much tighter column, and the point of taking the
			   detail out is to get more of the directory on screen at once. */
			grid-template-columns: repeat(auto-fill, minmax(min(16rem, 100%), 1fr));
			gap: var(--page-gap);
			align-items: start;
		}
		.letter-group {
			display: contents;
		}
		.letter-head {
			display: none;
		}
		/* An open contact takes the whole row: left in one column it would stretch
		   every collapsed neighbour to the height of a full profile. */
		.contact-card.span-all {
			grid-column: 1 / -1;
		}
		/* The letter, on the card that starts it. Replaces the heading that used to
		   break the row — the boundary is still visible, it just no longer costs a
		   row of empty columns to show. */
		.contact-card.starts-letter {
			position: relative;
		}
		.contact-card.starts-letter::before {
			content: var(--letter);
			position: absolute;
			top: -0.55rem;
			left: 0.6rem;
			z-index: 1;
			padding: 0 0.4rem;
			border-radius: 999px;
			background: var(--brand);
			color: var(--on-brand);
			font-size: 0.62rem;
			font-weight: 600;
			letter-spacing: 0.08em;
			line-height: 1.5;
		}
	}

	/* Was an inline `padding: 0; gap: 0`. As a class it can also carry the
	   `min-width: 0` a grid item needs to let long names ellipsize instead of
	   widening their column. */
	/* Token-driven, and one weight step down. Both of these were inline with
	   hardcoded colours — #1f2328 and #8c959f — which is why the directory stayed
	   near-black on a dark card until app.css intercepted it. */
	.contact-name {
		font-size: 1rem;
		font-weight: 600;
		color: var(--fg);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* One line per customer: photo, name, portal state, chevron. */
	.contact-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0.6rem;
	}
	/* The name is the row's target — it takes the slack so the pill and the chevron
	   stay pinned right however long the name is. */
	.contact-open {
		flex: 1;
		min-width: 0;
		display: grid;
		/* The chips are a second line under the name, not part of it — set on the
		   name's own baseline they read as a suffix to it. */
		gap: 0.22rem;
		text-align: left;
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
	}
	.linked-pill {
		flex-shrink: 0;
		font-size: 0.72rem;
		padding: 0.05rem 0.5rem;
	}

	/* The photo, and the control that sets it. 34px rather than the 46px it was:
	   the row is one line now, and an avatar taller than the name it labels is the
	   thing setting the row height. Tokenised on the way past — these were inline
	   #d0d7de / #e7edf3 / #0969da literals, which is why the directory's faces kept
	   their light-mode chrome on a dark card. */
	.avatar-btn {
		position: relative;
		flex: none;
		border: none;
		background: none;
		padding: 0;
		line-height: 0;
		cursor: pointer;
	}
	.avatar {
		width: 34px;
		height: 34px;
		border-radius: 999px;
		border: 1px solid var(--line-strong);
		object-fit: cover;
		display: block;
		transition: opacity 0.15s ease;
	}
	.avatar.fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, var(--surface-sunken), var(--surface));
		color: var(--fg-muted);
		font-size: 0.88rem;
		font-weight: 700;
		line-height: 1;
	}
	/* Mid-upload. */
	.avatar-btn.saving .avatar {
		opacity: 0.5;
	}
	.avatar-cam {
		position: absolute;
		right: -3px;
		bottom: -3px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 15px;
		height: 15px;
		border-radius: 999px;
		border: 1px solid var(--surface);
		background: var(--brand);
		color: var(--on-brand);
		font-size: 0.52rem;
		line-height: 1;
	}
	/* Where there is a pointer, the hint waits for it — a badge on every face in a
	   list of eighty is eighty pieces of chrome for a control almost nobody uses
	   twice. Touch devices keep it, having no hover to reveal it with. */
	@media (hover: hover) {
		.avatar-cam {
			opacity: 0;
			transition: opacity 0.15s ease;
		}
		.avatar-btn:hover .avatar-cam,
		.avatar-btn:focus-visible .avatar-cam {
			opacity: 1;
		}
	}
	/* ---------------------------------------------------------------- Roles
	   What somebody is to this contractor, wherever it is shown. One chip
	   treatment across the row, the roles pane and the add form, because they are
	   the same three words meaning the same three things — and colour-coded, since
	   a directory of forty people is scanned rather than read. */
	.role-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		align-items: center;
	}
	.role-chip {
		display: inline-block;
		padding: 0.02rem 0.42rem;
		border-radius: 999px;
		border: 1px solid transparent;
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.01em;
		white-space: nowrap;
		text-transform: uppercase;
	}
	/* Yellow is the contractor's own colour, so it marks the people the work is
	   FOR; the crew and the firms they hire take the two quieter tones. */
	.role-chip.customer {
		background: color-mix(in srgb, var(--brand) 22%, var(--surface));
		border-color: color-mix(in srgb, var(--brand) 45%, var(--surface));
		color: var(--fg);
	}
	.role-chip.crew {
		background: var(--surface-sunken);
		border-color: var(--line-strong);
		color: var(--fg-muted);
	}
	.role-chip.sub {
		background: color-mix(in srgb, var(--who-subcontractor, var(--fg-muted)) 16%, var(--surface));
		border-color: color-mix(in srgb, var(--who-subcontractor, var(--fg-muted)) 38%, var(--surface));
		color: var(--fg);
	}

	/* The roles pane: one row per role, held or not, with the control that changes
	   it. Every row is present whether or not they hold it — a directory that hides
	   the roles somebody could have makes adding one a thing you have to know
	   about. */
	/* Rows on hairlines, inside the group's own border — the same idiom as a
	   fact-list two panes over. They were bordered, filled, rounded boxes stacked
	   inside an already-bordered group: a card in a card in a card, which is what
	   made this pane look busier than the ones either side of it. */
	.roles-pane {
		display: grid;
		padding: 0 0.7rem;
	}
	.roles-note {
		margin: 0;
		padding: 0.5rem 0 0.15rem;
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--fg-muted);
	}
	.role-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
	}
	/* Three columns: the tick, what the role is, and the control that changes it —
	   so the chips line up down the pane and every button lands on the same right
	   edge instead of wherever its label happened to end. */
	.role-row {
		display: grid;
		grid-template-columns: 1rem minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.6rem;
		padding: 0.55rem 0;
		border-top: 1px solid var(--line);
	}
	.role-row:first-child {
		border-top: none;
	}
	.role-mark {
		font-size: 0.85rem;
		font-weight: 800;
		line-height: 1;
		text-align: center;
		color: var(--brand-deep);
	}
	.role-row-name {
		min-width: 0;
		display: grid;
		gap: 0.18rem;
		justify-items: start;
	}
	/* A role they do not hold is still listed — hiding it would make adding one a
	   thing you have to know about — so it is dimmed rather than absent. */
	.role-row:not(.on) .role-chip {
		opacity: 0.5;
	}
	.role-why {
		font-size: 0.78rem;
		line-height: 1.45;
		color: var(--fg-muted);
	}
	.role-action {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.3rem;
	}
	/* A step down from a pane's own buttons: these sit on a 0.78rem line of
	   explanation, and at full size they were the loudest thing in the pane. */
	.role-action .cta {
		padding: 0.26rem 0.7rem;
		font-size: 0.76rem;
	}
	.role-blocked {
		font-size: 0.76rem;
		font-weight: 700;
		white-space: nowrap;
		color: var(--fg-muted);
	}
	.role-confirm {
		display: inline-flex;
	}

	/* Buttons inside the panes. Small, quiet, and the same shape the subcontractor
	   profile uses for the equivalent row of actions. */
	.cta {
		padding: 0.35rem 0.8rem;
		border-radius: 999px;
		border: 1px solid transparent;
		background: var(--brand);
		color: var(--on-brand);
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 700;
		text-decoration: none;
		cursor: pointer;
	}
	.cta.ghost {
		background: var(--surface);
		border-color: var(--line-strong);
		color: var(--fg);
	}
	.cta.ghost:hover {
		border-color: var(--fg-muted);
	}
	.cta.quiet {
		color: var(--fg-muted);
	}
	.cta.danger {
		background: var(--danger);
		border-color: var(--danger);
		color: #fff;
	}
	.row-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		padding: 0 0.7rem 0.7rem;
	}

	/* The crew edit form, inline in the open card. */
	.crew-form {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
		gap: 0.6rem;
		align-items: end;
		font-size: 0.85rem;
		color: var(--fg-muted);
	}
	.crew-form label {
		display: grid;
		gap: 0.2rem;
		min-width: 0;
	}
	.crew-form .wide {
		grid-column: 1 / -1;
	}
	.opt {
		font-size: 0.78rem;
		color: var(--fg-muted);
	}
	.form-error {
		margin: 0;
		padding: 0 0 0.5rem;
		color: var(--danger);
		font-size: 0.85rem;
		font-weight: 600;
	}
	.notes-pane {
		margin: 0;
		padding: 0.2rem 0.7rem 0.7rem;
		white-space: pre-wrap;
		font-size: 0.9rem;
		line-height: 1.6;
		color: var(--fg);
	}
	/* Rides in the Contact panel's header strip, pushed to its right edge. Sized
	   down to match the header's own type — a full-height CTA in a 0.42rem-padded
	   strip would set the height of the whole bar. */
	.pane-edit {
		margin-left: auto;
		align-self: center;
		white-space: nowrap;
		padding: 0.1rem 0.5rem;
		font-size: 0.72rem;
	}

	/* The add form's role picker: the same segmented pills the import review list
	   uses, so choosing what somebody becomes looks the same in both places. */
	.add-roles {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.kind {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.7rem;
		border: 1.5px solid var(--line-strong);
		border-radius: 999px;
		background: var(--surface);
		color: var(--fg-muted);
		font-size: 0.78rem;
		font-weight: 700;
		cursor: pointer;
	}
	.kind:hover {
		border-color: var(--fg-muted);
		color: var(--fg);
	}
	.kind.on {
		background: var(--brand);
		border-color: transparent;
		color: var(--on-brand);
	}
	.kind:focus-within {
		outline: 2px solid var(--brand-deep);
		outline-offset: 1px;
	}
	.kind-radio {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		border: 0;
		clip-path: inset(50%);
		overflow: hidden;
		white-space: nowrap;
	}

	/* The two controls that live on a collapsed row. Sized between the pane's 2rem
	   buttons and the bar's: the row is one line, and a full-size icon button would
	   be taller than the name beside it. */
	.row-contact {
		position: relative;
		flex-shrink: 0;
	}
	.row-btn {
		width: 1.9rem;
		height: 1.9rem;
		font-size: 0.95rem;
		flex-shrink: 0;
	}
	/* The one control on the row that DOES something rather than revealing
	   something. It was the same size as the disclosure beside it, which made the
	   errand the directory exists for look like a sibling of "show me more". */
	.chat-btn {
		width: 2.3rem;
		height: 2.3rem;
		font-size: 1.25rem;
	}
	/* The chevron turns rather than the button, so the button's own border stays
	   square to the row while the glyph points the way it is going to open. */
	.toggle-btn .chev {
		display: block;
		font-size: 0.72rem;
		line-height: 1;
		transition: transform 0.15s ease;
	}
	.toggle-btn .chev.open {
		transform: rotate(90deg);
	}
	.contact-card {
		padding: 0;
		gap: 0;
		min-width: 0;
	}
	/* Directory cards: not plain white — a faint top-lit wash over the shared
	   .card and a soft raise on hover, matching the subcontractor roster so both
	   directories read as one system. */
	article.card {
		background: linear-gradient(
			180deg,
			var(--surface) 55%,
			color-mix(in srgb, var(--surface-sunken) 60%, var(--surface))
		);
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}
	article.card:hover {
		border-color: var(--line-strong);
		box-shadow:
			0 1px 2px rgba(27, 31, 36, 0.05),
			0 8px 22px rgba(27, 31, 36, 0.1);
	}
	:global(:root[data-theme='dark']) article.card:hover {
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
	}

	/* ------------------------------------------------------- Expanded profile
	   Same treatment as the subcontractor profile pane, deliberately: both are
	   "open a contact and read their facts", and they were drifting into two
	   different languages for the same job. Recessed pane, white panels with a
	   titled band, hairline rows, values flush right. Token-driven, so dark needs
	   no override block. */
	.detail {
		border-top: 1px solid var(--line);
		background: var(--surface-inset);
		padding: 0.85rem;
		display: grid;
		gap: 0.85rem;
	}
	/* Tabs left, actions right, sharing one underline — the same band and the same
	   tab treatment as the subcontractor profile. */
	.tab-row {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		/* Generous, and wrapping rather than compressing: on a narrow card the
		   actions drop under the tabs instead of crowding the last one. */
		gap: 0.5rem 1.75rem;
		flex-wrap: wrap;
		border-bottom: 1px solid var(--line);
	}
	.tabs {
		display: flex;
		gap: 0.25rem;
	}
	.tab {
		padding: 0.4rem 0.7rem;
		border: none;
		background: none;
		color: var(--fg-muted);
		font-family: inherit;
		font-weight: 700;
		font-size: 0.82rem;
		cursor: pointer;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
	}
	.tab:hover {
		color: var(--fg);
	}
	.tab.active {
		color: var(--fg);
		border-bottom-color: var(--fg);
	}
	/* The count on the Work tab. Quiet by default and inked in when the tab is
	   selected — it is inventory ("two jobs are live"), not a notification, and a
	   badge that shouts teaches the eye to skip every badge on the page. */
	.tab-count {
		margin-left: 0.3rem;
		padding: 0 0.32rem;
		border-radius: 999px;
		background: var(--surface-sunken);
		border: 1px solid var(--line-strong);
		font-size: 0.68rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		color: var(--fg-muted);
	}
	.tab.active .tab-count {
		background: color-mix(in srgb, var(--brand) 24%, var(--surface));
		border-color: color-mix(in srgb, var(--brand) 45%, var(--surface));
		color: var(--fg);
	}
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
	/* One size, one weight, one alignment for every value — present or absent. */
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
	.unset {
		color: var(--fg-muted);
		font-weight: 500;
	}

	/* A list of jobs is taller than a one-line value, so this row stops trying to
	   sit its label and value on one baseline and puts the label above instead. */
	.jobs-fact {
		flex-direction: column;
		align-items: stretch;
		gap: 0.3rem;
	}
	.jobs-fact dd {
		text-align: left;
	}
	.job-links {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.2rem;
	}
	/* The whole row is the target, not just the name — a link the width of the
	   panel is a great deal easier to hit than four words of project title. The
	   underline the panel gives its links is dropped for the same reason: this
	   already reads as a row you can press. */
	.job-link {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.6rem;
		padding: 0.3rem 0.45rem;
		border-radius: 8px;
		border-bottom: none !important;
		background: var(--surface-sunken);
	}
	.job-link:hover {
		background: color-mix(in srgb, var(--brand) 10%, var(--surface-sunken));
	}
	.job-name {
		min-width: 0;
		font-size: 0.85rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	/* Where the job stands. Muted when it is finished, inked when it is live —
	   the same "live work first" reading the tab count uses. */
	.job-state {
		flex-shrink: 0;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--fg-muted);
	}
	.job-state.live {
		color: var(--brand);
	}
	/* Notes are prose, so they keep their left edge and their line breaks. */
	.notes-body {
		margin: 0;
		padding: 0.55rem 0.7rem;
		font-size: 0.88rem;
		line-height: 1.45;
		color: var(--fg);
		white-space: pre-wrap;
	}

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
		background: var(--brand);
		border: 1.5px solid #14171c;
		color: var(--on-brand);
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
		border: 1.5px solid var(--brand-deep);
		background: color-mix(in srgb, var(--brand) 18%, var(--surface));
		color: var(--fg);
		font-size: 0.83rem;
		line-height: 1.5;
	}
	.limit-note a {
		color: inherit;
		font-weight: 700;
	}

	/* Required-field marker and its legend. Red and bold so it survives being one
	   character wide; hidden from screen readers everywhere, which get the real
	   signal from `required` / `aria-required` on the input itself. */
	.req {
		color: var(--danger);
		font-weight: 700;
	}
	.req-legend {
		margin: -0.15rem 0 0.15rem;
		font-size: 0.78rem;
		color: var(--fg-muted);
	}

	/* The import hand-off, at the top of the add form. Outlined and full width so
	   it reads as the alternative to filling this in, not as its submit. */
	.add-import {
		width: 100%;
		padding: 0.5rem 0.9rem;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		background: var(--surface);
		color: var(--fg);
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 700;
		text-transform: none;
		letter-spacing: normal;
		cursor: pointer;
	}
	.add-import:hover {
		background: var(--surface-sunken);
		border-color: var(--fg-muted);
	}
	.add-import:focus-visible {
		outline: 2px solid var(--fg);
		outline-offset: 2px;
	}

	/* The follow-on, offered as a choice rather than as a second save button. Full
	   row so the whole strip is tappable, not just the 16px box. */
	.add-also {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.15rem;
		padding: 0.5rem 0.65rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--surface-sunken);
		font-size: 0.85rem;
		color: var(--fg);
		cursor: pointer;
	}
	.add-also input {
		width: 1rem;
		height: 1rem;
		accent-color: var(--brand-deep);
		cursor: pointer;
		flex: none;
	}

	/* Add-customer footer: one save, with the way out beside it. */
	.add-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		justify-content: flex-end;
	}
	.add-actions button {
		padding: 0.55rem 1.1rem;
		border-radius: 999px;
		cursor: pointer;
		font-family: inherit;
		font-size: 0.88rem;
	}
	/* Cancel is the way out, not a second choice — plain text, no fill or border,
	   so it carries none of the visual weight of the submit beside it. */
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
	/* Pinned dark on yellow: yellow stays light in both themes. */
	.add-actions .add-save {
		border: 1px solid transparent;
		background: var(--brand);
		color: var(--on-brand);
		font-weight: 700;
		box-shadow: var(--pop-shadow-sm);
	}
	.add-actions .add-save:hover {
		background: var(--brand-deep);
	}
	/* Outlined in the foreground colour, not yellow: a yellow ring on a yellow
	   button is no ring at all. */
	.add-actions button:focus-visible {
		outline: 2px solid var(--fg);
		outline-offset: 2px;
	}
	@media (max-width: 420px) {
		/* Save goes full-width where the thumb is; Cancel drops below it as a
		   compact text link. Selectors are (0,2,0) so they can't be outranked by
		   the base rules — media queries add no specificity. */
		.add-actions .add-save {
			flex: 1 1 100%;
		}
		.add-actions .add-cancel {
			order: 1;
			flex: 0 0 auto;
			margin: 0.1rem auto 0;
		}
	}

	/* --------------------------------------------------------- Edit overlay
	   Editing a customer opens over the whole screen instead of expanding the card:
	   a directory card never had the width for a full form, least of all on a phone.
	   A sticky header sits over a scrolling form. */
	.edit-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: stretch;
		justify-content: center;
	}
	.edit-backdrop {
		position: absolute;
		inset: 0;
		border: none;
		background: rgba(20, 23, 28, 0.55);
		cursor: pointer;
	}
	.edit-sheet {
		position: relative;
		z-index: 1;
		width: 100%;
		max-width: 640px;
		max-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--surface);
		box-shadow: var(--card-shadow);
		overflow: hidden;
	}
	/* On wider screens it's a tall centred panel with room either side, not an
	   unreadably wide form stretched across the display. */
	@media (min-width: 700px) {
		.edit-sheet {
			max-height: 92dvh;
			margin: auto;
			border-radius: 16px;
		}
	}
	.edit-sheet-head {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.9rem 1.1rem;
		border-bottom: 1px solid var(--line);
		background: var(--surface);
	}
	.edit-sheet-title {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 800;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.edit-sheet-x {
		flex: none;
		border: none;
		background: none;
		font-size: 1.2rem;
		line-height: 1;
		color: var(--fg-muted);
		cursor: pointer;
		padding: 0.2rem 0.35rem;
	}
	.edit-sheet-x:hover {
		color: var(--fg);
	}
	/* The form is the scrollable body beneath the header. */
	.edit-sheet > form {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 1rem 1.1rem 1.25rem;
	}
	/* Save/Cancel stay pinned to the foot of the sheet so they're reachable without
	   scrolling to the end of a long form; the fields scroll under them. */
	.edit-sheet .add-actions {
		position: sticky;
		bottom: 0;
		margin-top: 0.5rem;
		padding: 0.85rem 0 0.35rem;
		background: var(--surface);
		border-top: 1px solid var(--line);
	}
	/* Group the pair together at the right rather than flinging Cancel to the far
	   left — across a 640px sheet the split reads as two stranded buttons. */
	.edit-sheet .add-cancel {
		margin-right: 0;
	}
</style>
