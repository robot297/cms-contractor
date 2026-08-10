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
	<input
		class="new"
		bind:value={draft}
		placeholder={all.length ? 'New tag' : 'Add a tag'}
		aria-label="New tag"
		onkeydown={onKeydown}
		onblur={commit}
	/>
</div>

<style>
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
		color: #14171c;
	}
	.chip:focus-visible {
		outline: 2px solid var(--yellow-deep);
		outline-offset: 2px;
	}
	.new {
		flex: 1 1 7rem;
		min-width: 6rem;
		box-sizing: border-box;
		padding: 0.25rem 0.5rem;
		border: none;
		border-bottom: 1.5px dashed var(--line-strong);
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
		border-bottom-color: var(--yellow-deep);
	}
</style>
