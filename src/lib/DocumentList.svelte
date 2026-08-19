<script lang="ts">
	/**
	 * One row shape for a Document, used by all three surfaces.
	 *
	 * The three portals each hand-rolled their own list, which is how they came to
	 * disagree about what a document row even shows — one had provenance, one had
	 * a thumbnail, none had both. What is genuinely per-surface (who may delete,
	 * what the badge says) comes in as snippets; what is not (the thumbnail, the
	 * name, the size and date, opening in the shared viewer) lives here.
	 *
	 * Nothing in here links at a document's bytes: the name and the thumbnail are
	 * BUTTONS that hand the document to the viewer. An <a> would navigate, which
	 * is the bug the viewer exists to fix.
	 */
	import type { Snippet } from 'svelte';
	import {
		documentExtLabel,
		documentHref,
		formatBytes,
		splitFilename,
		type DocumentRef
	} from '$lib/crm';

	type Doc = DocumentRef & {
		size: number;
		createdAt: Date | string;
		uploadedByRole?: string;
		note?: string | null;
		tags?: string[];
		/** Null until the contractor has opened this order's documents. */
		readByContractorAt?: Date | string | null;
	};

	let {
		documents,
		onopen,
		empty = 'No documents yet.',
		badge,
		trailing
	}: {
		documents: Doc[];
		onopen: (doc: DocumentRef) => void;
		empty?: string;
		/** Per-row context the surface owns — provenance, an unread marker. */
		badge?: Snippet<[Doc]>;
		/** Per-row controls the surface owns — delete, withdraw, edit. */
		trailing?: Snippet<[Doc]>;
	} = $props();

	const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
	const openDoc = (d: Doc) => onopen({ id: d.id, filename: d.filename, mimeType: d.mimeType });
</script>

{#if documents.length === 0}
	<p class="empty">{empty}</p>
{:else}
	<ul class="docs">
		{#each documents as d (d.id)}
			{@const parts = splitFilename(d.filename)}
			<li class="row">
				<button type="button" class="thumb-btn" onclick={() => openDoc(d)} tabindex="-1">
					{#if d.mimeType.startsWith('image/')}
						<img class="thumb" src={documentHref(d.id)} alt="" loading="lazy" />
					{:else}
						<span class="thumb as-ext" aria-hidden="true"
							>{documentExtLabel(d.filename, d.mimeType)}</span
						>
					{/if}
				</button>

				<div class="body">
					<!-- Truncated in the MIDDLE, not the end: the extension is the part that
					     tells you what a file is, and "invoice-for-the-kitchen-jo…" with the
					     ".pdf" chopped off is the one truncation that loses information. The
					     stem shrinks, the extension never does. -->
					<button type="button" class="name" title={d.filename} onclick={() => openDoc(d)}>
						<span class="stem">{parts.stem}</span><span class="ext">{parts.ext}</span>
					</button>
					<div class="meta">
						{formatBytes(d.size)} · {dateFmt.format(new Date(d.createdAt))}
					</div>
					{#if d.note}
						<p class="note">{d.note}</p>
					{/if}
					{#if d.tags && d.tags.length > 0}
						<div class="tags">
							{#each d.tags as tag (tag)}
								<span class="tag">{tag}</span>
							{/each}
						</div>
					{/if}
					{#if badge}{@render badge(d)}{/if}
				</div>

				{#if trailing}
					<div class="trailing">{@render trailing(d)}</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.empty {
		margin: 0;
		color: var(--fg-muted);
		font-size: 0.9rem;
	}
	.docs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		/* minmax(0, 1fr), not the default `auto`: a grid track sized to `auto` takes
		   its item's MAX-content width, so one long unbroken filename widened the
		   row past the card, past the page, and gave the whole document a
		   horizontal scrollbar. The row's own `min-width: 0` is the same fix one
		   level down. */
		grid-template-columns: minmax(0, 1fr);
		gap: 0.5rem;
		/* The list is itself a grid item in the card above it, and would take its
		   own max-content width there for exactly the same reason. */
		min-width: 0;
	}
	.row {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		min-width: 0;
		padding: 0.5rem 0.65rem;
		border: 1px solid var(--line);
		border-radius: 10px;
	}
	.thumb-btn {
		flex-shrink: 0;
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
		line-height: 0;
	}
	.thumb {
		width: 44px;
		height: 44px;
		object-fit: cover;
		border-radius: 8px;
		border: 1px solid var(--line);
		display: block;
	}
	.thumb.as-ext {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--surface-sunken);
		font-size: 0.65rem;
		font-weight: 800;
		letter-spacing: 0.03em;
		color: var(--fg-muted);
		line-height: 1;
	}
	.body {
		flex: 1;
		min-width: 0;
	}
	.name {
		display: flex;
		align-items: baseline;
		max-width: 100%;
		min-width: 0;
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-weight: 600;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.stem {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ext {
		flex-shrink: 0;
	}
	.name:hover,
	.name:focus-visible {
		text-decoration: underline;
	}
	.meta {
		font-size: 0.75rem;
		color: var(--fg-muted);
	}
	.note {
		margin: 0.25rem 0 0;
		font-size: 0.8rem;
		color: var(--fg-muted);
		overflow-wrap: anywhere;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-top: 0.25rem;
	}
	.tag {
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: var(--surface-sunken);
		border: 1px solid var(--line);
		font-size: 0.7rem;
		color: var(--fg-muted);
	}
	.trailing {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
</style>
