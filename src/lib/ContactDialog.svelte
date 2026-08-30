<script lang="ts">
	/**
	 * Reaching somebody, as a modal — the one presentation of `ContactPanel`.
	 *
	 * The panel had grown four hosts and three presentations: an anchored popover
	 * on the dashboard, the same popover at a different width on the directories
	 * and the order workspace, and a hand-styled `<dialog>` on the orders list.
	 * The popovers turned into a centred card below 480px through a block in
	 * app.css that had to name every variant to beat its own specificity, and the
	 * card they turned into still held a 14rem thread inside a scrolling box —
	 * on a phone, a conversation in a letterbox with the reply field somewhere
	 * below it.
	 *
	 * One box, one size, everywhere: a column that is nearly the whole screen on a
	 * phone and a centred panel on a desktop, with the conversation taking the
	 * height that the header and the composer do not.
	 *
	 * A native `<dialog>` opened with `showModal()`, so the top layer handles what
	 * the popovers hand-rolled: it escapes every `overflow: hidden` card and
	 * transformed ancestor it is nested inside, traps focus, closes on Escape, and
	 * paints its own backdrop. Mount it to open it — every host already has an
	 * `{#if}` around the panel — and it reports its own dismissal through
	 * `onclose`, which is the same prop the panel took.
	 */
	import type { ComponentProps, Snippet } from 'svelte';
	import ContactPanel from '$lib/ContactPanel.svelte';

	let {
		/** Sits beside the name in the header — the orders list hangs its info toggle here. */
		headerExtra,
		/** Between the header and the panel: contact details, an address, a note. */
		details,
		...panel
	}: ComponentProps<typeof ContactPanel> & {
		headerExtra?: Snippet;
		details?: Snippet;
	} = $props();

	let dialogEl = $state<HTMLDialogElement | null>(null);

	/**
	 * Open on mount and stay open: the host decides when this exists at all.
	 * `showModal()` rather than the `open` attribute — only the modal form puts the
	 * dialog in the top layer, and only the top layer is immune to the card it is
	 * nested in.
	 */
	$effect(() => {
		const el = dialogEl;
		if (!el || el.open) return;
		el.showModal();
	});

	/** Escape, the backdrop and the ✕ all end at the host's own close handler. */
	function close() {
		panel.onclose?.();
	}

	/**
	 * A click that lands on the dialog element itself is a click on the backdrop —
	 * everything inside is a child, so anything else has a nearer target. The
	 * native `::backdrop` cannot be clicked directly.
	 */
	function onBackdrop(event: MouseEvent) {
		if (event.target === dialogEl) close();
	}
</script>

<dialog
	bind:this={dialogEl}
	class="contact-dialog"
	aria-label="Message {panel.contact.name}"
	onclose={close}
	onclick={onBackdrop}
>
	<div class="frame">
		<div class="head">
			<h2>{panel.contact.name}</h2>
			{@render headerExtra?.()}
			<button type="button" class="close" aria-label="Close" onclick={close}>✕</button>
		</div>
		{@render details?.()}
		<div class="body">
			<ContactPanel {...panel} heading={false} />
		</div>
	</div>
</dialog>

<style>
	.contact-dialog {
		/* Nearly the whole screen on a phone, a centred panel on a desktop — and one
		   SIZE either way. A box that shrank to a three-line "Call" tab and grew for
		   a thread made switching channels feel like the modal was jumping about. */
		width: min(38rem, calc(100vw - 1.25rem));
		height: min(46rem, calc(100dvh - 1.5rem));
		max-width: none;
		max-height: none;
		padding: 0;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-card);
		background: var(--surface);
		color: var(--fg);
		box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
		overflow: hidden;
	}
	.contact-dialog::backdrop {
		background: rgba(15, 23, 42, 0.45);
	}
	/* The chain that lets the conversation have the leftover height: a definite box,
	   then columns that may shrink past their content all the way down. */
	.frame {
		height: 100%;
		box-sizing: border-box;
		padding: 0.85rem 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-height: 0;
		/* The 0 floor, at every level. A flex column stretches its items to its own
		   width, so the widest thing inside — the four-channel tab strip — can no
		   longer set the width everything below truncates against. */
		min-width: 0;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.head h2 {
		margin: 0;
		min-width: 0;
		flex: 1;
		font-size: 1.05rem;
		font-weight: 800;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.close {
		flex: none;
		border: none;
		background: none;
		padding: 0.15rem 0.3rem;
		font-size: 1.1rem;
		line-height: 1;
		color: var(--fg-muted);
		cursor: pointer;
		border-radius: var(--radius-control);
	}
	.close:hover {
		color: var(--fg);
		background: var(--surface-sunken);
	}
	.body {
		flex: 1;
		min-height: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
</style>
