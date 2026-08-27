<script lang="ts">
	/**
	 * One Thread, rendered as a conversation. Used by both ends of it.
	 *
	 * The contractor's order workspace and the customer's portal each hand-rolled
	 * this, which is how they came to disagree about what a message even shows —
	 * one repeated "Dana · Mar 8, 2:14 PM" under every bubble, the other under
	 * every bubble in a different format. They are the two halves of the SAME
	 * conversation, so they should not be able to drift.
	 *
	 * Three things turn a list into a conversation:
	 *   - a date divider per day, so a thread spanning weeks has a shape;
	 *   - runs of consecutive messages from one person, sharing a name and one
	 *     timestamp rather than repeating both under each bubble;
	 *   - bubble corners that square up inside a run, so a run reads as one turn.
	 *
	 * BOTH sides are coloured, by WHO said it rather than by which app is showing
	 * it: the contractor's messages are yellow on both surfaces, the customer's are
	 * teal on both. Layout says who you are — yours on the right — and colour says
	 * who they are, so the two halves of one conversation look like one
	 * conversation instead of two apps that happen to share a table.
	 *
	 * A surface sets two hues on an ANCESTOR and nothing else:
	 *   --thread-mine-hue, --thread-theirs-hue   (plus --thread-max-height)
	 *
	 * Every fill is that hue mixed into `--surface` at `--thread-tint`, and every
	 * text colour is plain `--fg`. That is deliberate: text on a wash of the page's
	 * own surface is legible in both themes by construction. The previous version
	 * asked each surface for a foreground colour too, and the contractor's passed
	 * `--ink` — which FLIPS to near-white in dark mode — producing white text on a
	 * light yellow bubble. There is now no token that can be got wrong that way.
	 */
	import { tick } from 'svelte';
	import { messageTopicLabel, type MessageTopic } from '$lib/crm';

	type Message = {
		id: string;
		body: string;
		authorRole: string;
		topic?: string | null;
		createdAt: Date | string;
	};

	let {
		messages,
		/** Which side is "mine" — whose messages sit on the right, in the accent. */
		mineRole,
		/** Display name of the other party, used on their runs. */
		otherName,
		empty = 'No messages yet.'
	}: {
		messages: Message[];
		mineRole: 'contractor' | 'customer' | 'subcontractor';
		otherName: string;
		empty?: string;
	} = $props();

	let threadEl = $state<HTMLDivElement | null>(null);

	const dayFmt = new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	});
	/** Time only: the divider above the run already said which day. */
	const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

	/** "Today" and "Yesterday" read faster than a date; older entries get the date. */
	function dayLabel(at: Date): string {
		const days = Math.floor((Date.now() - at.getTime()) / 86400000);
		if (days <= 0) return 'Today';
		if (days === 1) return 'Yesterday';
		return dayFmt.format(at);
	}

	/** "Dana Whitfield" → "DW"; "You" → "Y". */
	function initialsOf(name: string): string {
		return name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase() ?? '')
			.join('');
	}

	/**
	 * The thread as days, and each day as runs. Presentation only — the Thread is
	 * still one ordered list of Messages and nothing here changes what was said.
	 */
	const grouped = $derived.by(() => {
		const days: {
			key: string;
			label: string;
			runs: {
				key: string;
				mine: boolean;
				name: string;
				initials: string;
				at: Date;
				messages: Message[];
			}[];
		}[] = [];
		for (const m of messages) {
			const at = new Date(m.createdAt);
			const dayKey = at.toDateString();
			let day = days.at(-1);
			if (!day || day.key !== dayKey) {
				day = { key: dayKey, label: dayLabel(at), runs: [] };
				days.push(day);
			}
			const mine = m.authorRole === mineRole;
			const run = day.runs.at(-1);
			// A gap of more than an hour starts a new run even from the same person:
			// a reply the next morning is not part of last night's message.
			const continues = run && run.mine === mine && at.getTime() - run.at.getTime() < 3600_000;
			if (run && continues) {
				run.messages.push(m);
				run.at = at;
			} else {
				const name = mine ? 'You' : otherName;
				day.runs.push({ key: m.id, mine, name, initials: initialsOf(name), at, messages: [m] });
			}
		}
		return days;
	});

	/**
	 * A thread opens on its newest message, always. Every surface that shows one
	 * keeps it MOUNTED and hides it with CSS — the contractor's workspace toggles
	 * `.pane:not(.on) { display: none }`, the portal's phone layout hides whichever
	 * of Project / Messages you are not on — so "scroll to the bottom once, when
	 * the messages arrive" ran against a `display: none` element, where
	 * `scrollHeight` is 0 and the assignment is a no-op. The thread was then
	 * revealed sitting at the top of the conversation, showing the oldest message.
	 *
	 * So the scroll is driven by three things rather than one:
	 *   - the conversation changing (a reply sent, or a different job picked in
	 *     the contact panel — which can swap the thread for one of the SAME
	 *     length, so the message identity has to be watched, not just the count);
	 *   - the box going from hidden to visible, i.e. gaining a size;
	 *   - growing while already parked at the bottom.
	 * Someone who has scrolled up to read back is left alone until one of those
	 * first two happens.
	 */
	function toBottom() {
		if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
	}

	/** Within a hair of the bottom counts as "following the conversation". */
	const PIN_SLACK = 24;
	let pinned = true;

	function onThreadScroll() {
		if (!threadEl) return;
		pinned = threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight <= PIN_SLACK;
	}

	$effect(() => {
		// Both reads matter: the count catches a message arriving, the last id
		// catches a swap to a different conversation of the same length.
		void messages.length;
		void messages.at(-1)?.id;
		pinned = true;
		tick().then(toBottom);
	});

	$effect(() => {
		const el = threadEl;
		if (!el) return;
		// A hidden element has no box. Reveal is therefore a resize from nothing to
		// something, which is the one moment we can be sure a scroll will take.
		let wasVisible = el.clientHeight > 0;
		if (wasVisible) toBottom();
		const observer = new ResizeObserver(() => {
			const visible = el.clientHeight > 0;
			if (visible && (!wasVisible || pinned)) {
				pinned = true;
				toBottom();
			}
			wasVisible = visible;
		});
		observer.observe(el);
		return () => observer.disconnect();
	});
</script>

{#if grouped.length === 0}
	<div class="thread-empty">
		<span class="thread-mark" aria-hidden="true">✎</span>
		<p>{empty}</p>
	</div>
{:else}
	<div class="thread" bind:this={threadEl} onscroll={onThreadScroll}>
		{#each grouped as day (day.key)}
			<div class="day"><span>{day.label}</span></div>
			{#each day.runs as run (run.key)}
				<div class="run" class:mine={run.mine}>
					<span class="who">
						<span class="avatar" aria-hidden="true">{run.initials}</span>
						{run.name}
					</span>
					<div class="bubbles">
						{#each run.messages as m, i (m.id)}
							<div class="bubble" class:first={i === 0} class:last={i === run.messages.length - 1}>
								{#if m.topic && m.topic !== 'general'}
									<!-- Only on older messages: the quick actions that set a topic are
									     gone from the portal, so nothing new carries one. Still shown
									     where it exists — dropping it would rewrite what was said. -->
									<span class="topic">{messageTopicLabel(m.topic as MessageTopic)}</span>
								{/if}
								<p class="body">{m.body}</p>
							</div>
						{/each}
					</div>
					<span class="stamp">{timeFmt.format(run.at)}</span>
				</div>
			{/each}
		{/each}
	</div>
{/if}

<style>
	/* How much of each participant's hue lands in their bubble, and in its edge.
	   Both were raised: at 17% the two sides were near-identical washes of the page
	   and you had to read a name to tell who said what, which is the one thing a
	   chat layout is supposed to answer without reading. Dark carries slightly more
	   because the same mix against a near-black surface reads weaker. */
	.thread,
	.thread-empty {
		--thread-tint: 26%;
		--thread-edge: 62%;
		--thread-avatar: 78%;
	}
	:global(:root[data-theme='dark']) .thread,
	:global(:root[data-theme='dark']) .thread-empty {
		--thread-tint: 30%;
		--thread-edge: 55%;
		--thread-avatar: 72%;
	}

	.thread {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.55rem;
		min-width: 0;
		max-height: var(--thread-max-height, 24rem);
		/* Inert on the surfaces that stack their card down the page, and the whole
		   mechanism on the ones that turn Messages into a screen: given a column of
		   known height, the thread takes the space the heading and the composer do
		   not, and scrolls inside it. Those surfaces pass `--thread-max-height: none`
		   and let this do the sizing, so the composer is on screen with the newest
		   message rather than below the fold under a fixed 24rem box. */
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		padding: 0.15rem 0.1rem 0.25rem;
		scrollbar-width: thin;
	}

	.day {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 0.6rem;
		margin: 0.35rem 0 0.1rem;
	}
	.day::before,
	.day::after {
		content: '';
		height: 1px;
		background: var(--line);
	}
	.day span {
		font-size: 0.66rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fg-muted);
	}

	.run {
		display: grid;
		justify-items: start;
		gap: 0.2rem;
		min-width: 0;
		max-width: min(88%, 38rem);
	}
	.run.mine {
		justify-items: end;
		justify-self: end;
	}
	.who {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0 0.15rem;
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--fg-muted);
	}
	.run.mine .who {
		flex-direction: row-reverse;
	}
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
		height: 1.6rem;
		flex: none;
		border-radius: 999px;
		/* Nearly the full hue, not a wash of it. This is the one element in the
		   thread whose whole job is to say WHO at a glance, and at a third-strength
		   tint it was doing that job worse than the name next to it. The ring in
		   the surface colour lifts it off the bubble it sits above. */
		background: color-mix(
			in srgb,
			var(--thread-theirs-hue, var(--fg-muted)) var(--thread-avatar),
			var(--surface)
		);
		box-shadow: 0 0 0 2px var(--surface);
		font-size: 0.62rem;
		font-weight: 900;
		letter-spacing: 0.02em;
		color: var(--fg);
	}
	.run.mine .avatar {
		background: color-mix(
			in srgb,
			var(--thread-mine-hue, var(--fg-muted)) var(--thread-avatar),
			var(--surface)
		);
	}

	.bubbles {
		display: grid;
		gap: 0.15rem;
		min-width: 0;
		justify-items: start;
	}
	.run.mine .bubbles {
		justify-items: end;
	}
	.bubble {
		min-width: 0;
		max-width: 100%;
		display: grid;
		gap: 0.25rem;
		padding: 0.5rem 0.75rem;
		/* Squared on the side the run hangs from, so consecutive bubbles read as
		   one block of speech rather than as separate remarks. */
		border-radius: 14px 14px 14px 5px;
		background: color-mix(
			in srgb,
			var(--thread-theirs-hue, transparent) var(--thread-tint),
			var(--surface)
		);
		border: 1px solid
			color-mix(in srgb, var(--thread-theirs-hue, var(--line)) var(--thread-edge), transparent);
		/* Enough to separate a bubble from the panel behind it without turning the
		   thread into a stack of cards. */
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
	}
	.bubble.first {
		border-top-left-radius: 14px;
	}
	.bubble:not(.last) {
		border-bottom-left-radius: 5px;
	}
	.bubble.last {
		border-bottom-left-radius: 14px;
	}
	.run.mine .bubble {
		border-radius: 14px 14px 5px 14px;
		background: color-mix(
			in srgb,
			var(--thread-mine-hue, transparent) var(--thread-tint),
			var(--surface)
		);
		border-color: color-mix(
			in srgb,
			var(--thread-mine-hue, var(--line)) var(--thread-edge),
			transparent
		);
	}
	.run.mine .bubble:not(.last) {
		border-bottom-right-radius: 5px;
	}
	.run.mine .bubble.last {
		border-bottom-right-radius: 14px;
	}

	.topic {
		justify-self: start;
		font-size: 0.6rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		color: var(--fg-muted);
	}
	.body {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.5;
		white-space: pre-wrap;
		/* A pasted URL or a long unbroken word must break rather than widen the
		   bubble past its container. */
		overflow-wrap: anywhere;
		color: var(--fg);
	}
	.stamp {
		padding: 0 0.15rem;
		font-size: 0.66rem;
		color: var(--fg-muted);
		opacity: 0.85;
	}

	.thread-empty {
		display: grid;
		justify-items: center;
		gap: 0.4rem;
		text-align: center;
		padding: 1.1rem 0.75rem;
		border: 1px dashed var(--line-strong);
		border-radius: 12px;
	}
	.thread-mark {
		font-size: 1.1rem;
		/* Its OWN token, not the bubble fill: a surface whose "mine" colour is a
		   pale wash would render this mark all but invisible. */
		color: var(--thread-mine-hue, var(--fg-muted));
	}
	.thread-empty p {
		margin: 0;
		max-width: 40ch;
		font-size: 0.85rem;
		color: var(--fg-muted);
		line-height: 1.5;
	}
</style>
