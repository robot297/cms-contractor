<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { US_STATES } from '$lib/crm';

	/**
	 * ZIP-led address entry.
	 *
	 * A five-digit ZIP is the one part of an address people type right every time,
	 * and it determines the other two. So the ZIP is the only address field on
	 * offer by default: city and state fill in from it and then sit beside it as a
	 * read-only strip, with an Edit button for the cases the lookup gets wrong —
	 * a ZIP that straddles two towns, or one it can't place at all.
	 *
	 * That strip is doing two jobs. It shows the answer, and — while it is still
	 * empty — it is the thing that tells the contractor an answer is coming, which
	 * is what an autofill that silently filled two fields further down the form
	 * never managed to say.
	 *
	 * Renders the same `city` / `state` / `postalCode` inputs the form actions
	 * already read, so it drops into any customer form without a server change.
	 */

	let {
		city: initialCity = '',
		state: initialState = '',
		postalCode: initialPostalCode = '',
		labels = false,
		fieldStyle = ''
	}: {
		city?: string | null;
		state?: string | null;
		postalCode?: string | null;
		/** Render visible field labels (the add modal) rather than placeholders. */
		labels?: boolean;
		/** The host form's shared input styling, so these match their neighbours. */
		fieldStyle?: string;
	} = $props();

	// Seeded once and then owned locally — `untrack` says so rather than leaving
	// it to look like a missed reactive read. The host renders one of these per
	// customer, keyed, so a prop never changes under a live instance; if one did,
	// adopting it mid-edit would throw away what was being typed.
	let postalCode = $state(untrack(() => initialPostalCode ?? ''));
	let city = $state(untrack(() => initialCity ?? ''));
	let stateCode = $state(untrack(() => initialState ?? ''));

	/**
	 * Whether city/state are open for typing. Starts closed — including for a
	 * customer who already has an address, where the strip reads as a summary of
	 * what is on file. Once opened it stays open: someone who has taken the fields
	 * over does not want them shutting again mid-edit.
	 */
	let editing = $state(false);
	/** True while the values on show are the lookup's rather than the contractor's. */
	let fromZip = $state(false);
	let status: '' | 'looking' | 'unknown' = $state('');

	const summary = $derived([city, stateCode].filter(Boolean).join(', '));

	type ZipPlace = { city: string; state: string };
	// Module-level and deliberately not reactive: nothing renders from it, and one
	// cache shared by every instance means the edit form doesn't re-ask for a ZIP
	// the add form already looked up.
	const zipCache: Record<string, ZipPlace | null> = {};

	async function fetchZip(code: string): Promise<ZipPlace | null> {
		if (Object.hasOwn(zipCache, code)) return zipCache[code];
		try {
			const res = await fetch(resolve(`/api/zip/${code}`));
			const place = res.ok ? ((await res.json()) as ZipPlace) : null;
			// Only a definite "no such ZIP" is worth remembering. A 503 means the
			// lookup was unavailable just then, which the next attempt may not hit.
			if (res.ok || res.status === 404) zipCache[code] = place;
			return place;
		} catch {
			return null;
		}
	}

	async function onZipInput(e: Event & { currentTarget: HTMLInputElement }) {
		// Digits and one optional +4 dash; anything else is a typo, not an input.
		postalCode = e.currentTarget.value.replace(/[^\d-]/g, '').slice(0, 10);
		const code = postalCode.slice(0, 5);
		status = '';
		if (!/^\d{5}$/.test(code)) return;
		// Never overwrite an address the contractor typed or that came off a record.
		if (!fromZip && (city !== '' || stateCode !== '')) return;

		if (!Object.hasOwn(zipCache, code)) status = 'looking';
		const place = await fetchZip(code);
		// They may have typed on while that was in flight; a stale answer must not
		// land in the fields.
		if (postalCode.slice(0, 5) !== code) return;
		if (!place) {
			status = 'unknown';
			// No answer means no strip worth showing — hand them the fields instead
			// of leaving them looking at a line that says nothing.
			editing = true;
			return;
		}
		status = '';
		city = place.city;
		stateCode = place.state;
		fromZip = true;
	}

	/** The moment either field is touched by hand, the lookup stops owning it. */
	function takeOver() {
		fromZip = false;
	}
</script>

<div class="addr">
	<div class="addr-row">
		<label class="addr-zip">
			{#if labels}<span class="addr-label">ZIP</span>{/if}
			<input
				name="postalCode"
				value={postalCode}
				inputmode="numeric"
				autocomplete="postal-code"
				placeholder={labels ? '' : 'ZIP'}
				aria-label="ZIP code"
				oninput={onZipInput}
				style={fieldStyle}
			/>
		</label>

		{#if editing}
			<label class="addr-city">
				{#if labels}<span class="addr-label">City</span>{/if}
				<input
					name="city"
					bind:value={city}
					autocomplete="address-level2"
					placeholder={labels ? '' : 'City'}
					aria-label="City"
					oninput={takeOver}
					style={fieldStyle}
				/>
			</label>
			<label class="addr-state">
				{#if labels}<span class="addr-label">State</span>{/if}
				<select
					name="state"
					bind:value={stateCode}
					autocomplete="address-level1"
					aria-label="State"
					onchange={takeOver}
					style={fieldStyle}
				>
					<option value="">{labels ? '—' : 'State'}</option>
					{#each US_STATES as s (s.code)}
						<option value={s.code}>{s.code}</option>
					{/each}
				</select>
			</label>
		{:else}
			<!-- Closed: the answer, quieter and shorter than a field, plus the way in
			     to correct it. The values still submit — hidden inputs carry them. -->
			<input type="hidden" name="city" value={city} />
			<input type="hidden" name="state" value={stateCode} />
			<div class="addr-strip" class:is-empty={summary === ''}>
				<!-- Announced rather than described-by: two of these can be on the page
				     at once (the add modal over an open edit form), and a shared id
				     would point both at the same one. -->
				<span class="addr-value" aria-live="polite">
					{#if status === 'looking'}
						Looking up {postalCode.slice(0, 5)}…
					{:else if summary !== ''}
						{summary}
					{:else}
						City and state fill in from the ZIP
					{/if}
				</span>
				<button type="button" class="addr-edit" onclick={() => (editing = true)}>
					{summary === '' ? 'Enter manually' : 'Edit'}
				</button>
			</div>
		{/if}
	</div>

	{#if status === 'unknown'}
		<!-- A ZIP we can't place is still a perfectly valid ZIP to save, so this is
		     a note about the lookup and never a reason to block the form. -->
		<p class="addr-note" aria-live="polite">
			Couldn't place that ZIP — enter the city and state yourself.
		</p>
	{/if}
</div>

<style>
	.addr {
		display: grid;
		gap: 0.35rem;
	}
	/* ZIP first and narrow, its result immediately beside it: the two sit on one
	   line so the relationship between them is the layout, not a caption. */
	.addr-row {
		display: flex;
		gap: 0.5rem;
		align-items: end;
		flex-wrap: wrap;
	}
	/* Minimums sized so all three still share the row on a 360px phone
	   (78 + 110 + 72 + two 8px gaps = 276) rather than overflowing it. */
	.addr-zip {
		flex: 1;
		min-width: 78px;
	}
	.addr-city {
		flex: 2;
		min-width: 110px;
	}
	.addr-state {
		flex: 1;
		min-width: 72px;
	}
	.addr-zip,
	.addr-city,
	.addr-state {
		display: grid;
		gap: 0.2rem;
	}
	.addr-label {
		font-size: 0.85rem;
		color: var(--fg-muted);
	}

	/* The closed strip. Sunken and borderless where the inputs are white and
	   outlined — it should read as an answer, not as another thing to fill in. */
	.addr-strip {
		flex: 3;
		min-width: 190px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		box-sizing: border-box;
		min-height: 2.4rem;
		padding: 0.35rem 0.4rem 0.35rem 0.7rem;
		border: 1px dashed var(--line-strong);
		border-radius: 8px;
		background: var(--surface-sunken);
	}
	.addr-value {
		font-size: 0.92rem;
		font-weight: 600;
		color: var(--fg);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Nothing there yet: the line is a promise about what the ZIP will do, so it
	   carries the weight of a hint rather than of a value. */
	.addr-strip.is-empty .addr-value {
		font-weight: 400;
		font-size: 0.82rem;
		color: var(--fg-muted);
		white-space: normal;
	}
	.addr-edit {
		flex: none;
		padding: 0.3rem 0.6rem;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		background: var(--surface);
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.76rem;
		font-weight: 700;
		text-transform: none;
		letter-spacing: normal;
		cursor: pointer;
	}
	.addr-edit:hover {
		color: var(--fg);
		border-color: var(--fg-muted);
	}
	.addr-note {
		margin: 0;
		font-size: 0.78rem;
		color: var(--fg-muted);
	}
</style>
