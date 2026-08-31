<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';

	/**
	 * ONE order card, for every list that shows orders.
	 *
	 * It was two. The dashboard's "response needed" feed and the orders list drew
	 * the same card twice, and the copies had drifted: the dashboard's title was
	 * 0.95rem where the list's was 1.25rem, the dashboard centred the message
	 * button against the text block where the list hung it from the top edge, and
	 * the dashboard's hover sheen and status rim existed on one surface only. The
	 * two cards showed the same job and did the same two things, so a contractor
	 * moving between the pages was being asked to re-learn a card they already
	 * knew. This file is the single answer; the pages pass what differs.
	 *
	 * What the PAGES still own is what actually differs between them: what the
	 * right-hand control does (the dashboard opens a panel in place, the list opens
	 * a dialog) arrives as a snippet, and swipe-to-snooze is opt-in per surface.
	 */

	type Tone = 'due' | 'overdue' | 'owed' | null;

	let {
		orderId,
		projectName,
		typeSuffix = null,
		customerName,
		location = null,
		tone = null,
		actions,
		onsnooze,
		onswipestart,
		snoozeLabel = 'Snooze',
		snoozeNote = '1 week'
	}: {
		/**
		 * The order this card is about. The card resolves its own link rather than
		 * being handed one — both lists were building the identical URL, and a card
		 * that can be pointed anywhere is a card that will eventually be pointed
		 * somewhere wrong.
		 */
		orderId: string;
		projectName: string | null;
		/** " · Kitchen" and the like — the type, when the name doesn't already say it. */
		typeSuffix?: string | null;
		customerName: string;
		location?: string | null;
		/**
		 * Why this card is being shown, when that is a thing worth colouring. Null on
		 * a plain list, where every card is equally ordinary.
		 */
		tone?: Tone;
		/** The right-hand control cluster, and whatever it opens. */
		actions?: Snippet;
		/** Provide to enable swipe-to-snooze. Called once the gesture commits. */
		onsnooze?: () => void;
		/** Fired as a drag begins, so the page can put away anything it has open. */
		onswipestart?: () => void;
		snoozeLabel?: string;
		snoozeNote?: string;
	} = $props();

	/**
	 * How wide the revealed action is, in px rather than rem.
	 *
	 * The gesture maths and the panel's width have to agree exactly or the card
	 * settles a few pixels off the panel edge, so ONE number feeds both — it is
	 * handed to CSS as a custom property below rather than written down twice.
	 */
	const REVEAL = 112;
	/** Past this, letting go opens the card and leaves the action standing. */
	const OPEN_AT = REVEAL * 0.55;
	/**
	 * Past THIS, letting go just does it.
	 *
	 * Deliberately far — two and a half times the panel — because it is the one
	 * outcome that changes a record without a second press. A contractor who
	 * merely brushes the card sideways gets nothing; one who pushes it most of the
	 * way across has said what they meant, and the panel arms itself on the way so
	 * the commit is never a surprise.
	 */
	const COMMIT_AT = REVEAL * 2.5;

	const href = $derived(resolve(`/contractor/orders/${orderId}`));

	/** Where the card is, relative to its resting place. Negative is leftward. */
	let x = $state(0);
	let dragging = $state(false);
	let open = $state(false);
	/** Set while a drag settles, to eat the click the pointer sequence ends with. */
	let swallowClick = false;

	let startX = 0;
	let startY = 0;
	let axis: 'none' | 'x' | 'y' = 'none';

	const armed = $derived(-x >= COMMIT_AT);
	const swipeable = $derived(!!onsnooze);

	function onpointerdown(event: PointerEvent) {
		if (!swipeable) return;
		// A right-click or a middle-click is not a swipe, and neither is a press on
		// the button riding on top of the card.
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		if ((event.target as HTMLElement).closest('.oc-actions, .oc-behind')) return;
		startX = event.clientX;
		startY = event.clientY;
		axis = 'none';
	}

	function onpointermove(event: PointerEvent) {
		if (!swipeable || axis === 'y') return;
		const dx = event.clientX - startX;
		const dy = event.clientY - startY;
		if (axis === 'none') {
			// Nothing happens until the intent is clear. A vertical wins outright and
			// is never revisited — a list you are scrolling must not start peeling
			// cards open because a thumb drifted.
			if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
			if (Math.abs(dy) > Math.abs(dx)) {
				axis = 'y';
				return;
			}
			// Leftward from rest, or rightward to put an open card away. A rightward
			// drag on a closed card is somebody swiping the wrong way, not a gesture.
			if (dx > 0 && !open) {
				axis = 'y';
				return;
			}
			axis = 'x';
			dragging = true;
			onswipestart?.();
			(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		}
		const from = open ? -REVEAL : 0;
		x = Math.min(0, from + dx);
	}

	function settle() {
		if (!dragging) return;
		dragging = false;
		swallowClick = true;
		const travelled = -x;
		if (travelled >= COMMIT_AT) {
			commit();
		} else if (travelled >= OPEN_AT) {
			open = true;
			x = -REVEAL;
		} else {
			close();
		}
	}

	function close() {
		open = false;
		x = 0;
	}

	function commit() {
		close();
		onsnooze?.();
	}

	/**
	 * The click that ends a drag, and the click that lands on an open card.
	 *
	 * Both have to be stopped before they reach the stretched link, or a swipe ends
	 * on the order page — capture rather than bubble, because the anchor covering
	 * the card would otherwise have already had it.
	 */
	function onclickcapture(event: MouseEvent) {
		if (swallowClick) {
			swallowClick = false;
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (open && !(event.target as HTMLElement).closest('.oc-behind')) {
			event.preventDefault();
			event.stopPropagation();
			close();
		}
	}

	/** Escape puts an open card away, matching every other transient thing here. */
	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) close();
	}
</script>

<svelte:window {onkeydown} />

<!-- The host exists for the swipe: it holds the action behind the card and is
     what clips the card as it travels. Without swipe it is a plain wrapper, and
     the clip never turns on — which matters, because clipping while the card sits
     at rest would cut off the contact panel the dashboard opens out of it. -->
<div
	class="oc-host"
	class:is-swiping={dragging}
	class:is-open={open}
	style="--oc-reveal: {REVEAL}px"
>
	{#if swipeable}
		<div class="oc-behind" class:is-armed={armed}>
			<!-- A real button, not a target you can only reach with a thumb. It is
			     under the card until the card moves, so focusing it opens the card —
			     otherwise a keyboard lands on a control nobody can see. -->
			<button
				type="button"
				class="oc-snooze"
				onclick={commit}
				onfocus={() => {
					open = true;
					x = -REVEAL;
				}}
				onblur={close}
			>
				<span class="oc-snooze-glyph" aria-hidden="true">💤</span>
				<span class="oc-snooze-text">
					<span class="oc-snooze-verb">{armed ? 'Release' : snoozeLabel}</span>
					<span class="oc-snooze-note">{snoozeNote}</span>
				</span>
			</button>
		</div>
	{/if}

	<article
		class="order-card card stretch-host"
		class:is-due={tone === 'due'}
		class:is-owed={tone === 'owed'}
		class:is-overdue={tone === 'overdue'}
		class:can-swipe={swipeable}
		style:transform={x ? `translateX(${x}px)` : ''}
		{onpointerdown}
		{onpointermove}
		onpointerup={settle}
		onpointercancel={settle}
		{onclickcapture}
	>
		<div class="oc-head">
			<!-- The whole text block opens the order: `.stretch-link::after` covers the
			     card, so a press anywhere on it lands here.

			     A real <a>, not a click handler on the card, and that is the point —
			     the stretched pseudo-element keeps cmd-click, middle click, "open in
			     new tab" and the status-bar preview all working, which a div with an
			     onclick silently takes away. Controls that sit ON the card lift
			     themselves above it. -->
			<a class="oc-text stretch-link" {href}>
				<strong class="oc-title card-clamp"
					>{projectName ?? 'Untitled project'}{#if typeSuffix}<span class="oc-type">
							· {typeSuffix}</span
						>{/if}</strong
				>
				<!-- Who it is for and where they are, on ONE line. They are one thought,
				     and as separate rows they made every card three lines tall for two
				     facts. The pin does the separating, so no bullet is needed. -->
				<span class="oc-sub">
					<span class="oc-who">{customerName}</span>
					{#if location}
						<span class="oc-loc"><span aria-hidden="true">📍</span>{location}</span>
					{/if}
				</span>
			</a>

			{#if actions}
				<div class="oc-actions">{@render actions()}</div>
			{/if}
		</div>
	</article>
</div>

<style>
	/* ------------------------------------------------------------- Host */
	.oc-host {
		position: relative;
		/* The grid stretches its cells; without this the card inside sits at its
		   own content height and the row goes ragged again. */
		height: 100%;
		border-radius: var(--radius-card);
	}
	/* Clipping is a SWIPE state, never the resting one. The card travels a full
	   panel-width outside this box, which would otherwise paint over the card to
	   its left — but the same clip at rest would cut the dashboard's contact panel
	   off at the card's edge, and that panel is the reason the card is there. */
	.oc-host.is-swiping,
	.oc-host.is-open {
		overflow: clip;
	}

	/* ---------------------------------------------------- Revealed action */
	.oc-behind {
		position: absolute;
		inset: 0 0 0 auto;
		width: var(--oc-reveal);
		display: flex;
		border-radius: var(--radius-card);
		background: color-mix(in srgb, var(--wait-fg) 22%, var(--surface));
		transition: background 0.15s ease;
	}
	/* Armed: let go now and it happens. The colour is the app's own "waiting on
	   someone" tone at full strength — the same amber a snoozed follow-up wears
	   everywhere else, so the gesture is coloured by its OUTCOME rather than by a
	   generic destructive red for something nothing is being destroyed by. */
	.oc-behind.is-armed {
		background: var(--wait-fg);
	}
	.oc-snooze {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.15rem;
		border: none;
		border-radius: inherit;
		background: none;
		color: var(--wait-fg);
		font-family: inherit;
		cursor: pointer;
		padding: 0.4rem;
	}
	.oc-behind.is-armed .oc-snooze {
		color: var(--on-brand);
	}
	.oc-snooze:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -3px;
	}
	.oc-snooze-glyph {
		font-size: 1.15rem;
		line-height: 1;
	}
	.oc-snooze-text {
		display: grid;
		justify-items: center;
		gap: 0.05rem;
	}
	.oc-snooze-verb {
		font-size: 0.78rem;
		font-weight: 800;
		line-height: 1.1;
	}
	/* The consequence, spelled out. "Snooze" alone leaves the contractor to guess
	   for how long, and a gesture whose result you have to guess at is one you do
	   not use twice. */
	.oc-snooze-note {
		font-size: 0.68rem;
		font-weight: 600;
		opacity: 0.85;
		line-height: 1.1;
	}

	/* -------------------------------------------------------- The card
	   Everything below was the dashboard's due card, which had the better of the
	   two treatments — the hover sheen, the status wash, the coloured rim, the
	   tighter padding of a row you scan rather than a surface you sit on. The
	   orders list now wears it too; a card with no tone simply gets the neutral
	   wash, which is what a plain list wanted all along. */
	.order-card {
		--due-tint: color-mix(in srgb, var(--brand) 10%, transparent);
		--due-sheen: rgba(255, 255, 255, 0.65);
		--due-edge: var(--line-strong);
		position: relative;
		height: 100%;
		box-sizing: border-box;
		display: grid;
		gap: 0.35rem;
		align-content: start;
		padding: 0.7rem 0.85rem;
		/* Transparent by default so a status variant can colour it without the
		   card's contents shifting sideways when it does. */
		border-left: 4px solid transparent;
		border-top-color: var(--due-edge);
		border-right-color: var(--due-edge);
		border-bottom-color: var(--due-edge);
		/* Two layers over the flat surface colour. The first is the shimmer: a
		   narrow diagonal band parked off the left edge, swept across on hover by
		   moving its background-position. The second is the resting wash. Painted
		   as the ELEMENT background rather than a ::before overlay on purpose — a
		   positioned pseudo-element would need a stacking context to stay behind
		   the text, and creating one here traps the contact popover under the next
		   card in the list. */
		background-color: var(--surface);
		background-image:
			linear-gradient(105deg, transparent 40%, var(--due-sheen) 47%, transparent 56%),
			linear-gradient(150deg, var(--due-tint), transparent 62%);
		background-repeat: no-repeat;
		background-size:
			220% 100%,
			100% 100%;
		background-position:
			175% 0,
			0 0;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.7),
			var(--card-shadow);
		transition:
			box-shadow 0.18s ease,
			border-color 0.18s ease;
	}
	/* NO z-index on the card, deliberately, and it is load-bearing. `z-index: 1`
	   here would make every card a stacking context, and the contact panel one of
	   them opens could then only climb as high as its own card — so the NEXT card
	   in the grid, later in the DOM at the same level, would paint straight over
	   an open conversation. That is a bug this codebase has already had once.

	   The card still covers the action behind it without one: both are positioned
	   with `z-index: auto`, so they paint in source order, and the card comes
	   second. */
	/* Horizontal is ours, vertical is the page's. Without this the browser claims
	   the gesture for scrolling and the card never moves on a phone. */
	.order-card.can-swipe {
		touch-action: pan-y;
	}
	/* Only while it is travelling. A transform at rest would make this the
	   containing block for the `position: fixed` scrim the contact panel puts up,
	   shrinking a full-screen backdrop to the size of one card. */
	.oc-host:not(.is-swiping) .order-card {
		transition:
			transform 0.22s cubic-bezier(0.22, 0.61, 0.36, 1),
			box-shadow 0.18s ease,
			border-color 0.18s ease;
	}

	/* The sweep. Only the hover rule carries a duration, so the band glides across
	   on the way in and is back at its parked position instantly on the way out —
	   a transition on both would play the shimmer backwards every time the pointer
	   left a card. */
	.order-card:hover,
	.order-card:focus-within {
		--due-edge: var(--brand-deep);
		background-position:
			-75% 0,
			0 0;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.8),
			var(--pop-shadow-lg);
		transition:
			background-position 0.85s cubic-bezier(0.22, 0.61, 0.36, 1),
			box-shadow 0.18s ease,
			border-color 0.18s ease;
	}
	@media (prefers-reduced-motion: reduce) {
		.order-card:hover,
		.order-card:focus-within {
			background-position:
				175% 0,
				0 0;
			transition: none;
		}
		.oc-host:not(.is-swiping) .order-card {
			transition: none;
		}
	}

	/* The second carrier of the same signal. A row of cards that differ only by a
	   small pill is a row you have to read; an edge is something you can scan.

	   ORDER IS THE PRECEDENCE. All three are single classes on the same element,
	   so the last matching rule wins: due-today, then owed, then overdue. A card
	   that is both due and owed shows owed — a person waiting outranks a note you
	   left yourself, which is the same rule the loader sorts by — and overdue
	   beats everything, because late is the older problem. */
	.order-card.is-due {
		--due-tint: color-mix(in srgb, var(--wait-fg) 14%, transparent);
		border-left-color: var(--wait-fg);
	}
	.order-card.is-owed {
		--due-tint: color-mix(in srgb, var(--brand) 18%, transparent);
		border-left-color: var(--brand-deep);
	}
	.order-card.is-overdue {
		--due-tint: color-mix(in srgb, var(--danger) 12%, transparent);
		border-left-color: var(--danger);
	}
	/* Dark restates the locals only — the layered background above is
	   theme-agnostic. A white sheen at light-mode strength reads as a grey smear
	   on these surfaces, and the top-edge highlight has to drop to near nothing
	   or it draws a bright line across every card. */
	:global(:root[data-theme='dark']) .order-card {
		--due-tint: color-mix(in srgb, var(--brand) 7%, transparent);
		--due-sheen: rgba(255, 255, 255, 0.07);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.05),
			var(--card-shadow);
	}
	:global(:root[data-theme='dark']) .order-card:hover,
	:global(:root[data-theme='dark']) .order-card:focus-within {
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.08),
			var(--pop-shadow-lg);
	}
	:global(:root[data-theme='dark']) .order-card.is-due {
		--due-tint: color-mix(in srgb, var(--wait-fg) 12%, transparent);
	}
	:global(:root[data-theme='dark']) .order-card.is-owed {
		--due-tint: color-mix(in srgb, var(--brand) 14%, transparent);
	}
	:global(:root[data-theme='dark']) .order-card.is-overdue {
		--due-tint: color-mix(in srgb, var(--danger) 16%, transparent);
	}

	/* ------------------------------------------------------------ Contents
	   Text left, the one control right, CENTRED against the text block. The orders
	   list used to hang it from the top edge, which put the button visibly high
	   beside a two-line block while the dashboard's sat level — the single most
	   visible tell that these were two cards rather than one. */
	.oc-head {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}
	.oc-text {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 0.15rem;
	}
	/* Up to two lines for the job, and only as many as it uses.

	   `--card-reserve: 1` is the whole of the fix for the gap that used to sit
	   between the job and the customer: `.card-clamp` reserves as many lines as it
	   clamps to, so a card called "Deck" held a blank second line open under it.
	   On the dashboard that line could never be filled at all — the title was
	   `nowrap` there, so the reserve was pure dead space on every card in the
	   list. Clamping at two and reserving one keeps a long name from truncating
	   while a short one costs nothing. */
	.oc-title {
		--card-lines: 2;
		--card-reserve: 1;
		--card-clamp-lh: 1.2;
		font-size: 1.25rem;
		font-weight: 800;
		color: inherit;
		text-decoration: none;
	}
	.oc-text:hover .oc-title {
		text-decoration: underline;
		text-decoration-color: var(--brand-deep);
		text-decoration-thickness: 2px;
		text-underline-offset: 3px;
	}
	/* The type rides the title but shouldn't compete with it. */
	.oc-type {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--fg-muted);
	}
	/* Both halves ellipsise on their own. An ellipsis needs a box to happen in,
	   and a bare text node inside a flex row is an anonymous item that cannot have
	   one — the customer's name would have pushed the town off the card instead of
	   trailing off. `0 1 auto` on both is what lets either give way first. */
	.oc-sub {
		min-width: 0;
		font-size: 0.9rem;
		color: var(--fg-muted);
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
	}
	.oc-who {
		flex: 0 1 auto;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.oc-loc {
		flex: 0 1 auto;
		min-width: 0;
		display: inline-flex;
		align-items: baseline;
		gap: 0.2rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.oc-actions {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
</style>
