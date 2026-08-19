<script lang="ts">
	/**
	 * The one way a Document is opened, anywhere in the app.
	 *
	 * Exists because linking straight at the bytes replaces the page with a bare
	 * file and leaves the browser's back button as the only exit — which is not
	 * something a customer should have to work out. Nothing navigates: the file is
	 * rendered over the page and dismissed four ways (✕, backdrop, Escape, and the
	 * close on the fallback panel).
	 *
	 * The rule that matters more than the rendering: EVERY state carries a close,
	 * a download and an open-in-new-tab — including the state where nothing can be
	 * previewed. The failure this component exists to prevent is "no way out", not
	 * "ugly preview", so a viewer that renders nothing is still correct as long as
	 * you can leave it.
	 */
	import { documentHref, documentKind, splitFilename, type DocumentRef } from '$lib/crm';

	let { open = $bindable<DocumentRef | null>(null) }: { open: DocumentRef | null } = $props();

	const kind = $derived(open ? documentKind(open.mimeType) : 'other');
	/** Truncated in the middle, so the extension survives on a phone. */
	const parts = $derived(splitFilename(open?.filename ?? ''));
	const href = $derived(open ? documentHref(open.id) : '');
	const downloadHref = $derived(open ? documentHref(open.id, true) : '');
	let closeEl = $state<HTMLButtonElement | null>(null);
	/** Restored on close so focus doesn't jump to the top of the page. */
	let opener: HTMLElement | null = null;

	function close() {
		open = null;
	}

	function onKeydown(event: KeyboardEvent) {
		// stopPropagation so one press never also closes a sheet behind the viewer.
		if (open && event.key === 'Escape') {
			event.stopPropagation();
			close();
		}
	}

	$effect(() => {
		if (!open) return;
		opener = document.activeElement as HTMLElement | null;
		// The page behind must not scroll under the overlay.
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		closeEl?.focus();
		return () => {
			document.body.style.overflow = previous;
			opener?.focus?.();
		};
	});
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<div class="viewer" role="dialog" aria-modal="true" aria-label={open.filename}>
		<button type="button" class="scrim" aria-label="Close" onclick={close}></button>
		<div class="inner" class:as-doc={kind === 'pdf'}>
			<!-- The bar is outside the type switch on purpose: these three exits are
			     present in every state, including the one that renders nothing. -->
			<div class="bar">
				<span class="name" title={open.filename}>
					<span class="stem">{parts.stem}</span><span class="ext">{parts.ext}</span>
				</span>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- already a resolved path; ?dl only flips the Content-Disposition -->
				<a class="chip" href={downloadHref} download={open.filename}>Download</a>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- already a resolved path -->
				<a class="chip" {href} target="_blank" rel="noopener">Open in new tab</a>
				<button type="button" class="x" bind:this={closeEl} aria-label="Close" onclick={close}>
					✕
				</button>
			</div>

			{#if kind === 'image'}
				<img class="media" src={href} alt={open.filename} />
			{:else if kind === 'pdf'}
				<!-- A portrait page at readable width, scrolling its own pages — not the
				     letterbox iframe this replaced. <embed> is the fallback for browsers
				     that ignore <object>; if both come up blank (mobile Safari, most
				     reliably) the bar above is still the way out. -->
				<object class="media as-doc" data={href} type="application/pdf" title={open.filename}>
					<embed class="media as-doc" src={href} type="application/pdf" title={open.filename} />
				</object>
			{:else}
				<!-- Stated rather than faked. An <iframe> here produced a blank rectangle
				     that looked like a failure of the app rather than of the file type. -->
				<div class="media as-blank">
					<p class="blank-title">This file can’t be previewed here</p>
					<p class="blank-body">
						This is a type the browser won’t show inline. Download it or open it in a new tab to
						read it.
					</p>
					<div class="blank-actions">
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- already a resolved path -->
						<a class="chip solid" href={downloadHref} download={open.filename}>Download</a>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- already a resolved path -->
						<a class="chip solid" {href} target="_blank" rel="noopener">Open in new tab</a>
						<button type="button" class="chip solid as-btn" onclick={close}>Close</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.viewer {
		position: fixed;
		inset: 0;
		z-index: 90;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.75rem;
	}
	.scrim {
		position: absolute;
		inset: 0;
		border: none;
		padding: 0;
		background: rgba(0, 0, 0, 0.82);
		cursor: pointer;
	}
	.inner {
		position: relative;
		display: grid;
		gap: 0.6rem;
		width: 100%;
		max-width: 60rem;
		min-width: 0;
	}
	/* A document is read in a column, not across a widescreen. */
	.inner.as-doc {
		max-width: 46rem;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		flex-wrap: wrap;
	}
	.name {
		display: flex;
		align-items: baseline;
		flex: 1 1 6rem;
		/* 0, not 6rem: a min-width floor here is what pushes the close control off
		   the right edge of a narrow phone when the filename is long. */
		min-width: 0;
		color: #fff;
		font-size: 0.85rem;
		font-weight: 600;
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
	.chip {
		flex-shrink: 0;
		padding: 0.4rem 0.8rem;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.4);
		color: #fff;
		font-size: 0.8rem;
		font-weight: 700;
		text-decoration: none;
		white-space: nowrap;
	}
	.chip:hover {
		background: rgba(255, 255, 255, 0.15);
	}
	.x {
		flex-shrink: 0;
		width: 2.4rem;
		height: 2.4rem;
		border: 1px solid rgba(255, 255, 255, 0.4);
		border-radius: 999px;
		background: transparent;
		color: #fff;
		font-family: inherit;
		font-size: 0.95rem;
		cursor: pointer;
	}
	.x:hover,
	.x:focus-visible {
		background: rgba(255, 255, 255, 0.18);
	}
	.media {
		display: block;
		width: 100%;
		/* Leaves the bar above it on screen at any height. */
		max-height: calc(100dvh - 6rem);
		object-fit: contain;
		border-radius: 10px;
		background: #000;
	}
	.media.as-doc {
		height: calc(100dvh - 6rem);
		border: none;
		background: #fff;
	}
	.media.as-blank {
		display: grid;
		gap: 0.6rem;
		justify-items: start;
		height: auto;
		padding: 1.4rem;
		background: #fff;
		color: #24292f;
	}
	.blank-title {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
	}
	.blank-body {
		margin: 0;
		font-size: 0.9rem;
		color: #57606a;
		overflow-wrap: anywhere;
	}
	.blank-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.2rem;
	}
	.chip.solid {
		border-color: #d0d7de;
		color: #24292f;
	}
	.chip.solid:hover {
		background: #f6f8fa;
	}
	.chip.solid.as-btn {
		font-family: inherit;
		cursor: pointer;
		background: transparent;
	}
</style>
