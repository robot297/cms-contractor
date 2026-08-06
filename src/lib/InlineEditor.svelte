<script lang="ts">
	import type { Snippet } from 'svelte';

	// A panel that opens in place, directly under the line it edits, rather than as
	// another card further down the page. Shared so every one of them is the same
	// width, inset and header treatment — they were hand-rolled per surface, and
	// drifted apart the moment one of them moved.
	let {
		title,
		onclose,
		actions,
		children
	}: {
		title: string;
		onclose: () => void;
		/** Extra controls in the header, to the left of the close button. */
		actions?: Snippet;
		children: Snippet;
	} = $props();
</script>

<section class="inline-editor">
	<div class="editor-head">
		<h2 class="editor-title">{title}</h2>
		<div class="editor-actions">
			{@render actions?.()}
			<button type="button" class="editor-x" aria-label="Close" onclick={onclose}>✕</button>
		</div>
	</div>
	{@render children()}
</section>

<style>
	/* Full width of whatever it's dropped into, so it tracks the viewport rather
	   than sizing to its own content. */
	.inline-editor {
		display: grid;
		gap: 0.7rem;
		width: 100%;
		min-width: 0;
		/* The app sets no global border-box, so `width: 100%` here would be the
		   container's width PLUS this padding and border — which is precisely how
		   much it overflowed by. */
		box-sizing: border-box;
		padding: 0.8rem;
		border: 1px solid var(--line-strong);
		border-radius: 12px;
		background: var(--surface-sunken);
	}
	.editor-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.editor-title {
		margin: 0;
		font-size: 0.8rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--fg-muted);
	}
	.editor-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.editor-x {
		border: none;
		background: none;
		font-size: 1.05rem;
		line-height: 1;
		color: var(--fg-muted);
		cursor: pointer;
		padding: 0.1rem 0.25rem;
	}
	.editor-x:hover {
		color: var(--fg);
	}
</style>
