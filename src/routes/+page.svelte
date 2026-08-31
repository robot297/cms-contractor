<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import ThemeToggle from '$lib/ThemeToggle.svelte';
	import ScrollRig from '$lib/ScrollRig.svelte';
	import type { PageData } from './$types';
	import 'lenis/dist/lenis.css';

	// Self-hosted (no CDN request at runtime). Archivo Black carries the display
	// type, Inter everything else; see .landing for where each is applied. Both
	// are loaded by the root layout too — kept here because this page's type is
	// its own, not the app theme's, and should not depend on that staying true.
	import '@fontsource/archivo-black/400.css';
	import '@fontsource/inter/400.css';
	import '@fontsource/inter/500.css';
	import '@fontsource/inter/600.css';
	import '@fontsource/inter/700.css';

	let { data }: { data: PageData } = $props();
	let demoLoading = $state(false);

	const year = new Date().getFullYear();

	// Smooth scroll + on-scroll reveals. Both are opt-in enhancements: neither runs
	// under prefers-reduced-motion, and `revealReady` stays false until the observer
	// is actually wired up so a no-JS visitor never gets a page of invisible cards.
	let revealReady = $state(false);
	// The backdrop. Driven from the Lenis loop below rather than from its own
	// listener, so the rig and the eased scroll cannot drift apart.
	let rig = $state<ReturnType<typeof ScrollRig> | null>(null);

	onMount(() => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		let lenis: { raf: (t: number) => void; destroy: () => void } | undefined;
		let frame = 0;
		let cancelled = false;

		// Dynamic import so Lenis lands in its own chunk instead of the initial payload.
		import('lenis').then(({ default: Lenis }) => {
			if (cancelled) return;
			const instance = new Lenis({ duration: 1.05, wheelMultiplier: 0.9 });
			lenis = instance;
			// One event, one write per frame. `progress` is Lenis's own eased 0–1,
			// so the rig moves with the smoothing rather than with the raw wheel.
			instance.on('scroll', ({ progress }: { progress: number }) => rig?.update(progress));
			const loop = (time: number) => {
				lenis?.raf(time);
				frame = requestAnimationFrame(loop);
			};
			frame = requestAnimationFrame(loop);
		});

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					entry.target.classList.add('in');
					observer.unobserve(entry.target); // reveal once, not on every pass
				}
			},
			{ rootMargin: '0px 0px -12% 0px', threshold: 0.15 }
		);
		for (const el of document.querySelectorAll('.reveal')) observer.observe(el);
		revealReady = true;

		return () => {
			cancelled = true;
			if (frame) cancelAnimationFrame(frame);
			lenis?.destroy();
			observer.disconnect();
		};
	});

	/**
	 * How the product actually works, in the order a contractor meets it. Three
	 * steps because that is genuinely how many there are — a fourth invented to
	 * balance the row would be the first thing a reader caught us on.
	 */
	const steps = [
		{
			n: '01',
			title: 'Add the customer',
			body: 'Type them in, or import straight from your phone’s contacts. No forms to fill in twice.'
		},
		{
			n: '02',
			title: 'Open the order',
			body: 'What the job is, what it costs, when you’re on site. Statuses, notes and files all hang off it.'
		},
		{
			n: '03',
			title: 'They follow along',
			body: 'Invite them to their portal and they see progress, messages and the invoice — without calling to ask.'
		}
	];

	const features = [
		{
			title: 'Secure',
			body: 'Role-based access keeps customer details safe — trusted subcontractors see the job, guests never see personal info. Your data stays yours.',
			variant: 'variant-a'
		},
		{
			title: 'Simple',
			body: 'No enterprise bloat. Search, tap, done — an interface that gets out of the way so you can get back to the work.',
			variant: 'variant-b'
		},
		{
			title: 'Streamlined',
			body: 'Customers, orders, subcontractors, and follow-ups in one flow — from the first inquiry to the final invoice.',
			variant: 'variant-c'
		}
	];
</script>

<svelte:head>
	<title>Contractor CRM — manage client relationships with ease</title>
	<meta name="description" content="Powerful yet simple client relation management." />
</svelte:head>

<ThemeToggle />

<div class="landing" class:reveal-ready={revealReady}>
	<!-- Scenery. Sits behind every section; see ScrollRig for why it is driven by
	     a custom property rather than by `animation-timeline: scroll()`. -->
	<ScrollRig bind:this={rig} />

	<!-- Hero -->
	<section class="hero">
		<div class="hero-inner">
			<h1 class="headline">
				Manage client relationships<br /><span class="accent">with ease.</span>
			</h1>
			<p class="subhead">Powerful yet simple client relation management.</p>

			<div class="cta-row">
				{#if data.demoEnabled}
					<form
						method="POST"
						action="/login?/demo"
						use:enhance={() => {
							demoLoading = true;
							return async ({ update }) => {
								await update();
								demoLoading = false;
							};
						}}
					>
						<button type="submit" class="btn primary" disabled={demoLoading}>
							{demoLoading ? 'Setting up…' : 'Demo'}
						</button>
					</form>
				{/if}
				<a class="btn ghost" href={resolve('/pricing')}>Pricing</a>
				<a class="btn ghost" href={resolve('/login')}>Sign in</a>
			</div>
		</div>
	</section>

	<!-- Features -->
	<section class="features">
		<div class="features-inner">
			<h2 class="section-title reveal">
				Tools to enable contractors to keep clients updated with minimal hassle.
			</h2>
			<p class="section-sub reveal">Focused tools with none of the enterprise bloat.</p>
			<div class="grid">
				{#each features as f, i (f.title)}
					<article class="card reveal {f.variant}" style="--reveal-delay: {i * 90}ms">
						<h3 class="card-title">{f.title}</h3>
						<p class="card-body">{f.body}</p>
					</article>
				{/each}
			</div>
		</div>
	</section>

	<!-- How it works. Sits between the pitch and the feature cards: the cards say
	     what the product is good at, and this says what using it looks like, which
	     is the question someone has first. -->
	<section class="steps">
		<div class="steps-inner">
			<h2 class="section-title reveal">Three steps, then it runs itself.</h2>
			<ol class="step-list">
				{#each steps as s, i (s.n)}
					<li class="step reveal" style="--reveal-delay: {i * 90}ms">
						<span class="step-n">{s.n}</span>
						<h3 class="step-title">{s.title}</h3>
						<p class="step-body">{s.body}</p>
					</li>
				{/each}
			</ol>
		</div>
	</section>

	<!-- The half of the product the buyer never sees in a screenshot of a CRM:
	     what their CUSTOMER gets. Drawn rather than screenshotted so it can't go
	     stale the first time the portal is restyled. -->
	<section class="portal-band">
		<div class="portal-inner">
			<div class="portal-copy reveal">
				<span class="kicker">Their side</span>
				<h2 class="section-title">Your customers stop calling to ask.</h2>
				<p class="section-sub">
					Every job gets a page of its own. Where it stands, what was said, what’s been paid and
					what’s left — the same figures you see, never a second set.
				</p>
				<ul class="portal-points">
					<li>Progress in their words, not your workflow’s</li>
					<li>One thread per job, both ends in step</li>
					<li>Deposit and balance, itemised</li>
				</ul>
			</div>

			<div class="portal-art reveal" aria-hidden="true">
				<div class="pa-card">
					<div class="pa-head">
						<span class="pa-dot"></span>
						<span class="pa-title">Backyard deck rebuild</span>
					</div>
					<div class="pa-rail">
						<span class="pa-step done"></span>
						<span class="pa-step done"></span>
						<span class="pa-step now"></span>
						<span class="pa-step"></span>
					</div>
					<div class="pa-rows">
						<span class="pa-row"><em>Project total</em><b>$4,800.00</b></span>
						<span class="pa-row muted"><em>Deposit · Check</em><b>−$2,400.00</b></span>
					</div>
					<div class="pa-balance">
						<em>Balance due</em>
						<b>$2,400.00</b>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- Closing CTA -->
	<section class="closing">
		<div class="closing-inner reveal">
			<h2 class="closing-title">Ready to build?</h2>
			<p class="closing-sub">Take the full app for a spin with sample customers and orders.</p>
			{#if data.demoEnabled}
				<form
					method="POST"
					action="/login?/demo"
					use:enhance={() => {
						demoLoading = true;
						return async ({ update }) => {
							await update();
							demoLoading = false;
						};
					}}
				>
					<button type="submit" class="btn primary lg" disabled={demoLoading}>
						{demoLoading ? 'Setting up your demo…' : '▶  Explore the live demo'}
					</button>
				</form>
			{:else}
				<a class="btn primary lg" href={resolve('/login')}>Get started →</a>
			{/if}

			<div class="closing-secondary">
				<a class="btn ghost" href={resolve('/pricing')}>View pricing</a>
			</div>
		</div>
	</section>

	<footer class="foot">
		<span>© {year} Contractor CRM</span>
		<span class="dot">·</span>
		<span>Built for those who do</span>
	</footer>
</div>

<style>
	/* Keep padding inside every element's width so nothing overflows the
	   viewport on mobile (the app doesn't set a global border-box). */
	.landing,
	.landing *,
	.landing *::before,
	.landing *::after {
		box-sizing: border-box;
	}
	.landing {
		/* Type. Archivo Black is a single-weight display face (400 IS its black), so
		   --display-weight stays at 400 rather than the 800 the old stack used. */
		--font-display: 'Archivo Black', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		--font-body: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		--display-weight: 400;
		--display-tracking: -0.02em;

		/* Local surface tokens so the dark values sit in one block at the bottom
		   instead of a [data-theme='dark'] twin for every rule below. The hero and
		   footer are dark by design in both themes, so they stay literal. */
		--panel: var(--surface);
		--panel-line: var(--line);

		/* Feature-card accents. One hue per card, mixed against --panel for the wash
		   and border — so the dark block only has to restate the three hues (the
		   blue and purple need lifting to hold up on a dark surface). */
		--accent-a: var(--brand-deep);
		--accent-b: #7c5cf0;
		--accent-c: #0079bf;

		/* Hero. It used to be dark in both themes; now it follows the theme, which
		   means the accent needs two treatments — see .accent below. */
		--hero-bg:
			radial-gradient(
				1200px 600px at 70% -10%,
				color-mix(in srgb, var(--brand) 40%, transparent),
				transparent 60%
			),
			radial-gradient(900px 500px at 0% 110%, rgba(139, 92, 246, 0.16), transparent 55%),
			linear-gradient(180deg, #ffffff 0%, #f5f6f8 100%);
		--hero-fg: var(--fg);
		--hero-sub: rgba(31, 35, 40, 0.7);
		/*
		 * The label on the accent slab, from the token that exists for exactly this.
		 *
		 * It was the literal `#14171c`, which was correct when the brand was safety
		 * yellow — light in both themes, so a near-black label was always right. Now
		 * the brand is whichever of thirteen palettes is on, and most of their LIGHT
		 * accents are deep: near-black on Halogen's `#1f3b4d` measures 1.53:1, which
		 * is not a contrast problem so much as an invisible headline. Every palette
		 * failed AA here; none was above 3.95.
		 *
		 * `--on-brand` is app.css's answer to "text on a brand fill" and moves with
		 * the accent by design — a bright accent gets a dark label, a deep one gets
		 * white. It lands between 4.6:1 and 11.7:1 across all thirteen.
		 */
		--accent-fg: var(--on-brand);
		--accent-bg: var(--brand);
		--ghost-bg: rgba(17, 17, 17, 0.04);
		--ghost-bg-hover: rgba(17, 17, 17, 0.09);
		--ghost-fg: var(--fg);
		--ghost-line: rgba(17, 17, 17, 0.25);

		font-family: var(--font-body);
		color: var(--fg);
		background: var(--surface);
		min-height: 100dvh;
		overflow-x: hidden;
	}

	/* ---------- Hero ---------- */
	.hero {
		position: relative;
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 6rem clamp(1rem, 5vw, 3rem) 4rem;
		background: var(--hero-bg);
		overflow: hidden;
	}
	/* Seam blur: the hero's glows end wherever the viewport cuts them, which drew
	   a hard line against the features band. This strip fades whatever the hero is
	   doing into the next section's exact surface, so the two read as one page. */
	.hero::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: clamp(90px, 18vh, 170px);
		background: linear-gradient(180deg, transparent, var(--surface-sunken));
		pointer-events: none;
	}
	.hero-inner {
		position: relative;
		/* Above the seam fade, which paints after it in the stacking order. */
		z-index: 1;
		max-width: 780px;
		text-align: center;
		color: var(--hero-fg);
	}
	.headline {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(2.2rem, 6vw, 3.6rem);
		/* Leading has to clear the accent line's highlight box — at 1.05 the yellow
		   marker on line two overlapped the descenders of line one. */
		line-height: 1.22;
		font-weight: var(--display-weight);
		letter-spacing: var(--display-tracking);
		text-transform: none;
		color: var(--hero-fg);
		/* Opt out of the global chunky-yellow h1 treatment. */
		display: block;
		background: none;
		border: none;
		border-radius: 0;
		box-shadow: none;
		padding: 0;
	}
	/* Yellow type is unreadable on the light hero, so light mode marks the accent
	   line with a yellow highlight and dark type instead — the same yellow-behind-
	   dark-text lockup the app uses everywhere. Dark mode keeps it as yellow type. */
	/* The highlight is drawn as a padded inline box, so its height is set by the
	   font's line box — keep the vertical padding small and let .headline's leading
	   provide the breathing room, otherwise it grows into the line above. */
	.headline .accent {
		color: var(--accent-fg);
		background: var(--accent-bg);
		padding: 0.02em 0.16em;
		border-radius: 10px;
		box-decoration-break: clone;
		-webkit-box-decoration-break: clone;
	}
	.subhead {
		margin: 1.2rem auto 0;
		max-width: 34rem;
		font-size: clamp(1rem, 2.3vw, 1.18rem);
		line-height: 1.55;
		color: var(--hero-sub);
		font-weight: 400;
	}
	.cta-row {
		margin-top: 2rem;
		display: flex;
		gap: 0.75rem;
		justify-content: center;
		align-items: center;
		flex-wrap: wrap;
	}
	/* Let the demo form's button participate directly in the flex row so both
	   CTAs are treated as equal, centered siblings. */
	.cta-row form {
		display: contents;
	}
	.cta-row .btn {
		min-width: 8.5rem;
	}
	/* ---------- Buttons ---------- */
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.85rem 1.5rem;
		border-radius: 12px;
		font-weight: 700;
		font-size: 0.98rem;
		cursor: pointer;
		text-decoration: none;
		border: 1px solid transparent;
		transition:
			transform 0.08s ease,
			background 0.15s ease,
			box-shadow 0.15s ease;
	}
	.btn.primary {
		background: var(--brand);
		color: var(--on-brand);
		/* The glow is the accent's own, so it follows the palette instead of
		   staying a yellow halo under a blue button. */
		box-shadow: 0 8px 24px var(--brand-glow);
	}
	.btn.primary:hover:not(:disabled) {
		background: var(--brand-deep);
		transform: translateY(-1px);
	}
	.btn.primary:disabled {
		opacity: 0.75;
		cursor: default;
	}
	.btn.ghost {
		background: var(--ghost-bg);
		color: var(--ghost-fg);
		border-color: var(--ghost-line);
	}
	.btn.ghost:hover {
		background: var(--ghost-bg-hover);
	}
	.btn.lg {
		padding: 0.95rem 1.9rem;
		font-size: 1.05rem;
	}

	/* ---------- Features ---------- */
	.features {
		position: relative;
		z-index: 1;
		padding: clamp(3.5rem, 8vw, 6rem) clamp(1rem, 5vw, 3rem);
		/* Holds the sunken tone through the cards, then eases into the closing
		   section's surface — a gradient hand-off instead of the old hairline,
		   which split the page into three obvious slabs. */
		background: linear-gradient(
			180deg,
			var(--surface-sunken) 0%,
			var(--surface-sunken) 72%,
			var(--surface) 100%
		);
	}
	.features-inner {
		max-width: 1080px;
		margin: 0 auto;
	}
	.section-title {
		margin: 0;
		text-align: center;
		font-family: var(--font-display);
		font-size: clamp(1.5rem, 3.5vw, 2.1rem);
		line-height: 1.2;
		font-weight: var(--display-weight);
		letter-spacing: var(--display-tracking);
		text-transform: none;
		color: var(--fg);
	}
	.section-sub {
		margin: 0.6rem 0 2.5rem;
		text-align: center;
		color: var(--fg-muted);
		font-size: 1.05rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
		gap: 1.1rem;
	}
	/* Sticker card, same family as the buttons: hard outline, hard offset shadow,
	   and a press-in lift on hover. The top accent rule stays quiet until hover. */
	.card {
		position: relative;
		overflow: hidden;
		--card-accent: var(--accent-a);
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--card-accent) 12%, var(--panel)),
			color-mix(in srgb, var(--card-accent) 4%, var(--panel))
		);
		border: 1px solid color-mix(in srgb, var(--card-accent) 45%, var(--panel-line));
		border-radius: 18px;
		padding: 1.8rem 1.5rem 1.5rem;
		box-shadow: var(--pop-shadow-sm);
		transition:
			transform 0.12s ease,
			box-shadow 0.12s ease;
	}
	.card::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 4px;
		background: var(--card-accent);
		transform: scaleX(0);
		transform-origin: left;
		transition: transform 0.25s ease;
	}
	.card:hover {
		transform: translate(-2px, -2px);
		box-shadow: var(--pop-shadow-lg);
	}
	.card:hover::before {
		transform: scaleX(1);
	}
	.card > * {
		position: relative;
		z-index: 1;
	}
	/* Each variant only picks its accent; the wash and border are both mixed from it
	   against --panel, so the same rules hold in light and dark. */
	.card.variant-a {
		--card-accent: var(--accent-a);
	}
	.card.variant-b {
		--card-accent: var(--accent-b);
	}
	.card.variant-c {
		--card-accent: var(--accent-c);
	}
	.card-title {
		margin: 0 0 0.4rem;
		font-family: var(--font-display);
		font-size: 1.15rem;
		font-weight: var(--display-weight);
		letter-spacing: -0.01em;
		text-transform: none;
		color: var(--fg);
	}
	.card-body {
		margin: 0;
		color: var(--fg-muted);
		font-size: 0.95rem;
		line-height: 1.55;
	}

	/* ---------- Closing CTA ----------
	   The section is just the gutter; the panel inside it is a feature card scaled
	   up — same accent border, same mixed wash, same radius — so the page ends on
	   the shape it spent the middle establishing. It used to be --surface-sunken on
	   --surface behind a hairline border, which read as a stray rounded rectangle. */
	/* ---------- How it works ---------- */
	.steps {
		position: relative;
		z-index: 1;
		padding: clamp(3.5rem, 8vw, 6rem) clamp(1rem, 5vw, 3rem);
		background: var(--surface);
	}
	.steps-inner {
		max-width: 1100px;
		margin: 0 auto;
		display: grid;
		gap: clamp(2rem, 4vw, 3rem);
	}
	.step-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: clamp(1.5rem, 3vw, 2.5rem);
		grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr));
	}
	.step {
		display: grid;
		gap: 0.5rem;
		align-content: start;
	}
	/* The number carries the sequence, so it is the one loud thing here — an
	   outline rather than a fill, so three of them don't shout over the copy. */
	.step-n {
		font-family: var(--font-display);
		font-size: 2.25rem;
		line-height: 1;
		color: transparent;
		-webkit-text-stroke: 1.5px var(--brand-deep);
	}
	.step-title {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 600;
		color: var(--fg);
	}
	.step-body {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.6;
		color: var(--fg-muted);
	}

	/* ---------- Their side ---------- */
	.portal-band {
		position: relative;
		z-index: 1;
		padding: clamp(3.5rem, 8vw, 6rem) clamp(1rem, 5vw, 3rem);
		background: var(--surface-sunken);
	}
	.portal-inner {
		max-width: 1100px;
		margin: 0 auto;
		display: grid;
		gap: clamp(2rem, 5vw, 4rem);
		align-items: center;
		grid-template-columns: minmax(0, 1fr);
	}
	@media (min-width: 900px) {
		.portal-inner {
			grid-template-columns: minmax(0, 1fr) minmax(0, 0.85fr);
		}
	}
	.portal-copy {
		display: grid;
		gap: 0.85rem;
		justify-items: start;
	}
	/* This section's title is left-aligned — it sits beside a picture rather than
	   over a row of cards, and centring it would leave it floating. */
	.portal-copy .section-title {
		text-align: left;
	}
	.kicker {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--brand-deep);
	}
	.portal-points {
		list-style: none;
		margin: 0.25rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.portal-points li {
		position: relative;
		padding-left: 1.35rem;
		font-size: 0.95rem;
		color: var(--fg-muted);
	}
	.portal-points li::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0.5rem;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 999px;
		background: var(--brand);
		/* No text in here — this is for the brand-fill guard, which is kept
		   absolute rather than carved out for the elements that happen to be
		   empty today. */
		color: var(--on-brand);
	}

	/* The drawing of the portal. Built from divs rather than a screenshot so it
	   cannot go stale the first time that page is restyled — and so it themes,
	   which a PNG never will. */
	.pa-card {
		display: grid;
		gap: 0.75rem;
		padding: 1.1rem 1.2rem;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: var(--surface);
		box-shadow: var(--card-shadow);
	}
	.pa-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.pa-dot {
		width: 0.65rem;
		height: 0.65rem;
		border-radius: 999px;
		background: var(--brand);
		/* No text in here — this is for the brand-fill guard, which is kept
		   absolute rather than carved out for the elements that happen to be
		   empty today. */
		color: var(--on-brand);
	}
	.pa-title {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--fg);
	}
	.pa-rail {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.pa-step {
		flex: 1;
		height: 4px;
		border-radius: 999px;
		background: var(--line);
	}
	.pa-step.done {
		background: var(--brand-deep);
		/* No text in here — this is for the brand-fill guard, which is kept
		   absolute rather than carved out for the elements that happen to be
		   empty today. */
		color: var(--on-brand);
	}
	.pa-step.now {
		background: var(--brand);
		/* No text in here — this is for the brand-fill guard, which is kept
		   absolute rather than carved out for the elements that happen to be
		   empty today. */
		color: var(--on-brand);
	}
	.pa-rows {
		display: grid;
		gap: 0.1rem;
	}
	.pa-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.35rem 0;
		border-top: 1px solid var(--line);
		font-size: 0.85rem;
	}
	.pa-row em {
		font-style: normal;
		color: var(--fg-muted);
	}
	.pa-row b {
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		color: var(--fg);
	}
	.pa-row.muted b {
		color: var(--fg-muted);
	}
	/* The one figure the whole card exists to show, set like the real portal's. */
	.pa-balance {
		display: grid;
		gap: 0.1rem;
		padding: 0.7rem 0.85rem;
		border-radius: 12px;
		border: 1px solid var(--brand-deep);
		background: color-mix(in srgb, var(--brand) 12%, var(--surface));
	}
	.pa-balance em {
		font-style: normal;
		font-size: 0.66rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--fg-muted);
	}
	.pa-balance b {
		font-size: 1.6rem;
		font-weight: 700;
		line-height: 1.1;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
		color: var(--fg);
	}

	.closing {
		position: relative;
		z-index: 1;
		padding: clamp(3.5rem, 8vw, 6rem) clamp(1rem, 5vw, 3rem);
	}
	.closing-inner {
		--card-accent: var(--accent-a);
		position: relative;
		overflow: hidden;
		max-width: 960px;
		margin: 0 auto;
		padding: clamp(2.5rem, 6vw, 3.75rem) clamp(1.5rem, 5vw, 3rem);
		text-align: center;
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--card-accent) 12%, var(--panel)),
			color-mix(in srgb, var(--card-accent) 4%, var(--panel))
		);
		border: 1px solid color-mix(in srgb, var(--card-accent) 45%, var(--panel-line));
		border-radius: 18px;
		box-shadow: var(--pop-shadow-sm);
	}
	/* The feature cards wipe this rule in on hover; the CTA isn't hoverable, so it
	   just wears it. */
	.closing-inner::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 4px;
		background: var(--card-accent);
	}
	.closing-title {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(1.6rem, 4vw, 2.3rem);
		line-height: 1.2;
		font-weight: var(--display-weight);
		letter-spacing: var(--display-tracking);
		text-transform: none;
		color: var(--fg);
	}
	.closing-sub {
		margin: 0.6rem 0 1.6rem;
		color: var(--fg-muted);
		font-size: 1.05rem;
	}
	.closing form {
		display: inline-block;
	}
	.closing .btn.primary {
		min-width: 15rem;
	}
	.closing-secondary {
		margin-top: 1.2rem;
	}

	/* ---------- Footer ---------- */
	.foot {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		padding: 2rem 1rem;
		background: #101216;
		color: rgba(255, 255, 255, 0.6);
		font-size: 0.85rem;
		font-weight: 500;
	}
	.foot .dot {
		opacity: 0.5;
	}

	/* ---- Scroll reveal -------------------------------------------------------
	   The hidden state is gated on .reveal-ready, which JS only sets once the
	   observer is attached — so without JS (or with reduced motion, where onMount
	   bails before setting it) everything renders visible as normal. */
	.reveal-ready .reveal {
		opacity: 0;
		transform: translateY(18px);
		transition:
			opacity 0.5s ease var(--reveal-delay, 0ms),
			transform 0.5s cubic-bezier(0.22, 1, 0.36, 1) var(--reveal-delay, 0ms);
	}
	.reveal-ready .reveal:global(.in) {
		opacity: 1;
		transform: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.reveal-ready .reveal {
			opacity: 1;
			transform: none;
			transition: none;
		}
		.card,
		.card::before,
		.btn {
			transition: none;
		}
	}

	/* ---- Dark theme ----------------------------------------------------------
	   Feature cards sit a step ABOVE the section they're on, matching the light
	   white-on-grey stack. */
	:global(:root[data-theme='dark']) .landing {
		--panel: #2c333d;
		--panel-line: #3d4650;
		--accent-a: var(--brand);
		--accent-b: #a78bfa;
		--accent-c: #4aa8e0;

		/* The hero keeps the dark treatment it has always had, and the accent drops
		   the slab for plain brand-coloured type — in dark every palette's accent is
		   a bright one, and it clears 5.9:1 against this ground at worst (Overdrive)
		   and 14.6:1 at best (Halogen). The slab is a LIGHT-mode fix, for accents
		   that are deep there and would otherwise be type you cannot read. */
		--hero-bg:
			radial-gradient(
				1200px 600px at 70% -10%,
				color-mix(in srgb, var(--brand) 16%, transparent),
				transparent 60%
			),
			radial-gradient(900px 500px at 0% 110%, rgba(139, 92, 246, 0.16), transparent 55%),
			linear-gradient(180deg, #16181d 0%, #101216 100%);
		--hero-fg: #ffffff;
		--hero-sub: rgba(255, 255, 255, 0.72);
		--accent-fg: var(--brand);
		--accent-bg: transparent;
		--ghost-bg: rgba(255, 255, 255, 0.06);
		--ghost-bg-hover: rgba(255, 255, 255, 0.14);
		--ghost-fg: #ffffff;
		--ghost-line: rgba(255, 255, 255, 0.22);
	}

	@media (max-width: 480px) {
		.cta-row {
			flex-direction: column;
			align-items: stretch;
		}
		.cta-row .btn {
			width: 100%;
		}
	}
</style>
