<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { skyFor, type WeatherReport } from '$lib/weather';

	/**
	 * Today's sky where the contractor's live jobs are. A corner readout, not a
	 * panel: conditions, what it is now, and the day's high and low.
	 *
	 * Deliberately the whole of it. This started as a four-day outlook and then a
	 * morning/afternoon/evening split, and both were a weather app growing inside
	 * a CRM — a contractor glancing at the dashboard wants to know whether today
	 * is a working day, and every extra row made that answer slower to find.
	 *
	 * Fetched on mount rather than in the page loader, deliberately: the forecast
	 * comes from a third party, and a slow one must not hold up the list of jobs
	 * that need answering today.
	 *
	 * While it is in flight the widget renders a PLACEHOLDER of exactly its own
	 * shape rather than nothing. Nothing was cheaper to write and wrong to use:
	 * the readout landed a second or so after the dashboard painted and shoved the
	 * heading it sits beside, which on a phone is a line of type moving under a
	 * thumb already reaching for it. The placeholder is the real markup with real
	 * digits in it, hidden behind a wash — that is what makes the two states the
	 * same height, rather than a guess at the height written down twice.
	 *
	 * A forecast that never comes still renders nothing at all: the space collapses
	 * once, on a failure that is rare, and a dashboard that reports its own weather
	 * outage is louder about it than the weather deserves.
	 */
	let { zip }: { zip: string | null } = $props();

	let report = $state<WeatherReport | null>(null);
	/** Set when the fetch fails, which is what collapses the placeholder. */
	let failed = $state(false);

	onMount(() => {
		if (!zip) return;
		// Guards against a report landing after the contractor has navigated away.
		let live = true;
		fetch(`${resolve('/api/weather')}?zip=${encodeURIComponent(zip)}`)
			.then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
			.then((body: WeatherReport) => {
				if (live) report = body;
			})
			.catch(() => {
				if (live) failed = true;
			});
		return () => {
			live = false;
		};
	});

	const sky = $derived(report ? skyFor(report.code) : null);
	/**
	 * Nothing to wait for. No ZIP means no forecast will ever be asked for, so
	 * there is nothing to hold space for either — that is a different state from
	 * "asked, still waiting".
	 */
	const pending = $derived(zip != null && !failed && !report);
</script>

{#if report && sky}
	<div class="weather">
		<!-- The visual rows are shorthand — a glyph, a slash, a "·". Rather than
		     make a screen reader assemble a sentence out of that, it gets the
		     sentence and the shorthand is hidden from it. -->
		<span class="sr">
			Weather in {report.place}: {sky.label}, high {report.highF}°, low {report.lowF}°{#if report.rainChance >= 20},
				{report.rainChance}% chance of rain{/if}
		</span>

		<span class="line" aria-hidden="true">
			<span class="glyph">{sky.glyph}</span>
			<span class="high">{report.highF}°</span>
			<span class="sep">/</span>
			<span class="low">{report.lowF}°</span>
		</span>
		<span class="meta" aria-hidden="true">
			{sky.label}
			<!-- Only worth the ink once it is a real possibility; below that it is a
			     number that makes every day look uncertain. -->
			{#if report.rainChance >= 20}· 💧{report.rainChance}%{/if}
			· {report.place}
		</span>
	</div>
{:else if pending}
	<!-- The same element tree as the real readout — same type, same sizes, same
	     gaps — so the two states are the same height without either one having to
	     know what that height is.

	     What it does NOT do is imitate the answer. The first version filled the
	     slots with fake digits behind a grey wash, which is the shape of a
	     forecast with none of the information, and a corner of the dashboard full
	     of grey rectangles reads as a broken image rather than as a wait. This
	     says what it is instead: a sky that has not resolved yet, dashes where the
	     numbers will be, and the sentence in the place the sentence goes.

	     Hidden from the screen reader entirely — a placeholder is not information,
	     and the real readout announces itself when it arrives. -->
	<div class="weather is-loading" aria-hidden="true">
		<span class="line">
			<span class="glyph sky">
				<span class="sun"></span>
				<span class="cloud"></span>
			</span>
			<span class="high">—°</span>
			<span class="sep">/</span>
			<span class="low">—°</span>
		</span>
		<span class="meta">Checking the sky<span class="dots"><i></i><i></i><i></i></span></span>
	</div>
{/if}

<style>
	/* A corner readout. No card chrome on purpose — it sits across from the "On
	   site today" heading as a fact about the day, not as a second panel competing
	   with the list beside it.

	   RIGHT-ALIGNED, and that is the whole shape of it: this lives in the top
	   right, so the edge nearest the corner is the one that has to be straight.
	   Left-aligned, its lines ragged out towards the corner and the block read as
	   something that had been pushed there rather than something that belonged
	   there.

	   `margin-left: auto` keeps it in that corner on a narrow screen too, where
	   `.today-head` wraps and would otherwise drop it to the left margin with its
	   text still pointing the other way. */
	.weather {
		display: grid;
		justify-items: end;
		text-align: right;
		gap: 0.1rem;
		min-width: 0;
		margin-left: auto;
	}
	/* The line that gets read: the day's range, and the sky it happens under.
	   The CURRENT temperature used to lead here and has been dropped — at a glance
	   it competed with the high for the same slot, and "what will today be" is the
	   question a crew plans around, not "what is it this second". */
	.line {
		display: flex;
		align-items: baseline;
		gap: 0.3rem;
		min-width: 0;
	}
	.glyph {
		flex: none;
		font-size: 1.2rem;
		line-height: 1;
		/* Sits a touch off the text baseline otherwise — emoji carry their own
		   metrics and this one rides high next to figures. */
		transform: translateY(0.05em);
	}
	.high,
	.low,
	.sep {
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}
	.high {
		font-size: 1.15rem;
		font-weight: 700;
		color: var(--fg);
	}
	/* Quieter than the high, and the separator quieter still: it is one reading
	   with a floor, not two equal numbers. */
	.sep {
		font-size: 0.95rem;
		color: var(--line-strong);
	}
	.low {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--fg-muted);
	}
	/* Conditions, rain if it is worth saying, and where. One muted line under the
	   numbers rather than two — three stacked sizes in a corner was the fussy part. */
	.meta {
		max-width: 100%;
		font-size: 0.76rem;
		color: var(--fg-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ------------------------------------------------------- Placeholder
	   Drawn rather than washed out. Two shapes on the glyph's own footprint — a
	   disc that breathes and a cloud drifting across it — plus dashes where the
	   figures will be. It occupies exactly the space the reading will, and looks
	   like weather being looked up rather than like a component that failed. */
	.is-loading {
		color: var(--fg-muted);
	}
	.is-loading .high,
	.is-loading .low,
	.is-loading .sep {
		color: var(--line-strong);
		font-weight: 700;
	}

	/* The glyph slot, at the emoji's own size so the swap costs no height. */
	.sky {
		position: relative;
		display: inline-block;
		width: 1.2em;
		height: 1.2em;
	}
	.sun {
		position: absolute;
		top: 12%;
		left: 14%;
		width: 58%;
		height: 58%;
		border-radius: 50%;
		background: var(--line-strong);
		animation: sky-breathe 2.4s ease-in-out infinite;
	}
	/* Two overlapping lobes and a flat base — enough of a cloud at 20px, and no
	   asset to load for a state that lasts a second. */
	.cloud {
		position: absolute;
		right: 2%;
		bottom: 16%;
		width: 74%;
		height: 40%;
		border-radius: 999px;
		background: var(--fg-muted);
		opacity: 0.55;
		animation: sky-drift 2.4s ease-in-out infinite;
	}
	.cloud::before {
		content: '';
		position: absolute;
		left: 22%;
		top: -46%;
		width: 46%;
		height: 96%;
		border-radius: 50%;
		background: inherit;
	}

	/* The sentence finishes itself, one dot at a time.
	   Three real elements rather than an animated `content` string: animating
	   `content` works in Chrome and does nothing at all in Firefox, so the ellipsis
	   would simply sit there. Their box is a fixed width either way, so nothing
	   reflows as they come and go. */
	.dots {
		display: inline-flex;
		align-items: baseline;
		gap: 0.09em;
		width: 1.1em;
		padding-left: 0.1em;
	}
	.dots i {
		width: 0.18em;
		height: 0.18em;
		border-radius: 50%;
		background: currentColor;
		opacity: 0.25;
		animation: sky-dots 1.4s ease-in-out infinite;
	}
	.dots i:nth-child(2) {
		animation-delay: 0.18s;
	}
	.dots i:nth-child(3) {
		animation-delay: 0.36s;
	}

	@keyframes sky-breathe {
		0%,
		100% {
			transform: scale(0.86);
			opacity: 0.5;
		}
		50% {
			transform: scale(1);
			opacity: 0.9;
		}
	}
	@keyframes sky-drift {
		0%,
		100% {
			transform: translateX(-14%);
		}
		50% {
			transform: translateX(6%);
		}
	}
	@keyframes sky-dots {
		0%,
		70%,
		100% {
			opacity: 0.25;
		}
		35% {
			opacity: 1;
		}
	}

	/* A placeholder is the one thing on the page with no business insisting on
	   attention from somebody who has asked for less motion. It keeps the drawing
	   and drops every bit of the movement. */
	@media (prefers-reduced-motion: reduce) {
		.sun,
		.cloud,
		.dots i {
			animation: none;
		}
		.dots i {
			opacity: 0.45;
		}
	}

	/* Visually hidden, still announced. */
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
