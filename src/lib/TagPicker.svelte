<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { parseTags } from '$lib/crm';

	/**
	 * Pick tags: every tag this contractor uses is a chip, filled when it's on this
	 * record. Click to toggle. Type to make a new one. That is the whole control.
	 *
	 * An earlier version had selected chips, a datalist, an Add button, a separate
	 * suggestion list AND a manage mode — five affordances for one small field.
	 * Retiring a tag is global, destructive and rare, so it lives on the settings
	 * page rather than inside every tag field on six surfaces.
	 *
	 * PICKING and MAKING are two different acts, and putting the text field inline
	 * among the chips made them look like one: the input wrapped into the middle of
	 * the row wherever the chips happened to run out, so the control read as a bag
	 * of mixed things rather than "here are your tags, and here is how to add one".
	 * They are now two rows, divided by a hairline — chips above, the new-tag field
	 * below.
	 *
	 * Submits one comma-separated hidden input, so server actions that already call
	 * `parseTags(form.get('tags'))` need no change.
	 */
	let { name = 'tags', value = [] }: { name?: string; value?: string[] } = $props();

	// Seeded once on purpose: a reload mid-edit must not discard unsaved choices.
	let selected = $state<string[]>(untrack(() => [...value]));
	let draft = $state('');

	const vocabulary = $derived(
		((page.data as { contractorTags?: string[] }).contractorTags ?? []) as string[]
	);
	// Everything known, plus anything just typed that isn't saved anywhere yet.
	const all = $derived(
		[...new Set([...vocabulary, ...selected])].sort((a, b) => a.localeCompare(b))
	);
	/** Whether the draft would actually add anything, which is what the Add button is for. */
	const draftAdds = $derived(parseTags(draft).some((t) => !selected.includes(t)));

	function toggle(tag: string) {
		selected = selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag];
	}

	function commit() {
		for (const t of parseTags(draft)) if (!selected.includes(t)) selected = [...selected, t];
		draft = '';
	}

	function onKeydown(e: KeyboardEvent) {
		// Enter adds the tag; it must never submit the form this sits inside.
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			commit();
		}
	}
</script>

<input type="hidden" {name} value={selected.join(', ')} />

<div class="picker">
	{#if all.length}
		<div class="tags">
			{#each all as tag (tag)}
				<button
					type="button"
					class="chip"
					class:on={selected.includes(tag)}
					aria-pressed={selected.includes(tag)}
					onclick={() => toggle(tag)}
				>
					{tag}
				</button>
			{/each}
		</div>
	{/if}

	<!-- Making a tag, kept apart from choosing one. The Add button only appears once
	     there is something to add, so the resting state is a single quiet field. -->
	<div class="add" class:alone={all.length === 0}>
		<span class="add-mark" aria-hidden="true">+</span>
		<input
			class="new"
			bind:value={draft}
			placeholder={all.length ? 'New tag' : 'Add your first tag'}
			aria-label="New tag"
			onkeydown={onKeydown}
			onblur={commit}
		/>
		{#if draftAdds}
			<button type="button" class="add-go" onclick={commit}>Add</button>
		{/if}
	</div>
</div>

<style>
	.picker {
		display: grid;
		gap: 0.55rem;
		min-width: 0;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		align-items: center;
		min-width: 0;
	}
	.chip {
		padding: 0.25rem 0.65rem;
		border-radius: 999px;
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.76rem;
		font-weight: 700;
		cursor: pointer;
		transition:
			background 0.1s ease,
			color 0.1s ease,
			border-color 0.1s ease;
	}
	.chip:hover {
		border-color: var(--fg-muted);
		color: var(--fg);
	}
	/* On this record: the app's safety-yellow fill. Label pinned dark, because
	   yellow stays light in both themes. */
	.chip.on {
		background: var(--yellow);
		border-color: transparent;
		color: var(--on-yellow);
	}
	.chip:focus-visible {
		outline: 2px solid var(--yellow-deep);
		outline-offset: 2px;
	}

	/* The new-tag row. A hairline above it does the separating, so the two halves
	   read as one control rather than as two stacked fields. */
	.add {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
		padding-top: 0.5rem;
		border-top: 1px solid var(--line);
	}
	.add.alone {
		padding-top: 0;
		border-top: none;
	}
	.add-mark {
		flex: none;
		font-size: 0.9rem;
		font-weight: 800;
		line-height: 1;
		color: var(--fg-muted);
	}
	.new {
		flex: 1 1 auto;
		min-width: 0;
		box-sizing: border-box;
		padding: 0.2rem 0;
		border: none;
		background: none;
		color: var(--fg);
		font-family: inherit;
		font-size: 0.8rem;
	}
	.new::placeholder {
		color: var(--fg-muted);
	}
	.new:focus {
		outline: none;
	}
	/* The row, not the input, shows focus — the input has no border of its own. */
	.add:focus-within .add-mark {
		color: var(--yellow-deep);
	}
	.add-go {
		flex: none;
		padding: 0.2rem 0.7rem;
		border: none;
		border-radius: 999px;
		background: var(--yellow);
		color: var(--on-yellow);
		font-family: inherit;
		font-size: 0.72rem;
		font-weight: 800;
		cursor: pointer;
	}
	.add-go:hover {
		background: var(--yellow-deep);
	}
</style>
