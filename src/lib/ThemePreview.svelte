<script lang="ts">
	/**
	 * A miniature of the app, drawn entirely from the theme's own tokens.
	 *
	 * The palette menu can only show two swatches per theme, and two swatches is
	 * not what a theme is. app.css puts it in four parts, and this shows all four
	 * rather than the first:
	 *
	 *   colour   — --paper / --surface / --line / --brand, as the real surfaces
	 *   geometry — --radius-card / --radius-control / --radius-pill, which run from
	 *              square (Halogen, Blueprint) to 14px (Vapor)
	 *   type     — --font-display and its tracking/weight/case, on the brand word
	 *   air      — --atmos, the background painted behind the whole app
	 *
	 * Nothing here is hard-coded and nothing branches on the palette name. It is
	 * the same tokens the app reads, so it cannot drift from what it previews —
	 * and a palette added later is previewed correctly without touching this file.
	 *
	 * `aria-hidden`, deliberately. Every element is a coloured rectangle standing
	 * in for a real one; there is no content here, and reading "brand, card, card,
	 * button" to somebody who cannot see the colours describes nothing. The
	 * controls beside it are what actually change the setting, and those are
	 * labelled.
	 */
	let { label = 'Preview' }: { label?: string } = $props();
</script>

<figure class="preview">
	<div class="frame" aria-hidden="true">
		<!-- The ground: --paper with --atmos over it, the same pair app.css paints
		     behind the whole app. Several themes are mostly their atmosphere. -->
		<div class="ground">
			<!-- Bar. The brand word wears --font-display, which is half of what tells
			     these themes apart at a glance. -->
			<div class="bar">
				<span class="brand">Aa</span>
				<span class="bar-dots"><i></i><i></i></span>
				<span class="avatar"></span>
			</div>

			<div class="body">
				<!-- The accent, as a fill. Every theme's loudest surface. -->
				<div class="hero">
					<span class="hero-line"></span>
					<span class="hero-line short"></span>
				</div>

				<div class="cards">
					<div class="mini">
						<span class="line"></span>
						<span class="line short"></span>
					</div>
					<div class="mini">
						<span class="line"></span>
						<span class="line short"></span>
					</div>
				</div>

				<!-- Status colours and a primary button: the two places a theme has to
				     stay legible rather than merely look like itself. -->
				<div class="row">
					<span class="chip ok"></span>
					<span class="chip wait"></span>
					<span class="btn"></span>
				</div>
			</div>
		</div>
	</div>
	<figcaption>{label}</figcaption>
</figure>

<style>
	.preview {
		margin: 0;
		display: grid;
		gap: 0.3rem;
		min-width: 0;
	}
	figcaption {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--fg-muted);
	}
	/* The frame is the app's own card treatment, so the preview sits on the page
	   as a thing rather than floating on it. */
	.frame {
		overflow: hidden;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-card, 10px);
		box-shadow: var(--card-shadow);
	}
	.ground {
		display: grid;
		gap: 0.3rem;
		padding: 0.35rem;
		background-color: var(--paper);
		background-image: var(--atmos, none);
		/* Scaled down with the rest of it: --atmos-size is drawn for a viewport, and
		   at this size a 64px grid would show one line. */
		background-size: 100% 100%;
		background-position: center;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.25rem 0.35rem;
		border-radius: var(--radius-control, 6px);
		background: var(--surface);
		border: 1px solid var(--line);
	}
	.brand {
		font-family: var(--font-display, inherit);
		font-weight: var(--display-weight, 700);
		letter-spacing: var(--display-tracking, 0.02em);
		text-transform: var(--display-transform, none);
		font-size: 0.6rem;
		line-height: 1;
		color: var(--brand);
	}
	.bar-dots {
		display: flex;
		gap: 0.2rem;
		margin-left: auto;
	}
	.bar-dots i {
		width: 12px;
		height: 3px;
		border-radius: var(--radius-pill, 999px);
		background: var(--fg-muted);
		opacity: 0.5;
	}
	.avatar {
		width: 9px;
		height: 9px;
		border-radius: 999px;
		background: var(--brand);
		/* No text in it today. Stated anyway: `theme.contrast.test.ts` holds that a
		   brand fill declares its foreground, and the bug it guards against is one
		   that only appears the day somebody puts a glyph in here. */
		color: var(--on-brand);
	}

	.body {
		display: grid;
		gap: 0.3rem;
	}
	.hero {
		display: grid;
		gap: 0.2rem;
		padding: 0.4rem;
		border-radius: var(--radius-card, 8px);
		/* The sweep rather than the flat accent: it is what the real hero uses, and
		   on the themes that define two accents it is the only place the second one
		   shows up. */
		background: var(--brand-sweep, var(--brand));
	}
	.hero-line {
		height: 4px;
		width: 70%;
		border-radius: var(--radius-pill, 999px);
		background: var(--on-brand);
		opacity: 0.9;
	}
	.hero-line.short {
		width: 40%;
		opacity: 0.55;
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.3rem;
	}
	.mini {
		display: grid;
		gap: 0.2rem;
		padding: 0.35rem;
		border-radius: var(--radius-card, 8px);
		background: var(--surface);
		border: 1px solid var(--line);
	}
	.line {
		height: 3px;
		width: 100%;
		border-radius: var(--radius-pill, 999px);
		background: var(--fg);
		opacity: 0.75;
	}
	.line.short {
		width: 55%;
		background: var(--fg-muted);
		opacity: 0.6;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	.chip {
		width: 22px;
		height: 8px;
		border-radius: var(--radius-pill, 999px);
		border: 1px solid transparent;
	}
	.chip.ok {
		background: var(--ok-bg);
		border-color: var(--ok-line);
	}
	.chip.wait {
		background: var(--wait-bg);
		border-color: var(--wait-line);
	}
	.btn {
		margin-left: auto;
		width: 34px;
		height: 10px;
		border-radius: var(--radius-control, 6px);
		background: var(--brand);
		/* As above — a brand fill states its foreground, empty or not. */
		color: var(--on-brand);
	}
</style>
