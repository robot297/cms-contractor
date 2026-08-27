<script lang="ts">
	/**
	 * The decorative panels flanking a narrow form.
	 *
	 * The support page is a 640px column, which on a desktop leaves two wide empty
	 * gutters. These fill them without asking anything of the reader: purely
	 * decorative, `aria-hidden`, and gone entirely below the breakpoint where the
	 * form has the screen to itself.
	 *
	 * Drawn rather than set in an emoji font. An emoji is somebody else's artwork,
	 * renders differently on every platform, and at this size looks like a missing
	 * glyph — these are flat shapes with heavy outlines and halftone shading, which
	 * is a look that survives being scaled up.
	 *
	 * Colours come from tokens, so the outlines invert in dark mode along with the
	 * text while the safety yellow stays exactly where it is — the same rule the
	 * rest of the app follows for the brand fill.
	 */
	let { scene }: { scene: 'hat' | 'tools' } = $props();

	// Unique per instance: two of these on one page would otherwise share one
	// <pattern id>, and the second would silently reference the first's.
	const uid = $props.id();
</script>

<div class="aside" aria-hidden="true">
	<svg viewBox="0 0 200 320" fill="none" xmlns="http://www.w3.org/2000/svg">
		<defs>
			<!-- Halftone. The one texture doing all the shading work. -->
			<pattern id="dots-{uid}" width="9" height="9" patternUnits="userSpaceOnUse">
				<circle cx="2" cy="2" r="1.7" fill="var(--fg)" opacity="0.16" />
			</pattern>
			<!-- The burst behind the subject, clipped so its rays stop at the panel. -->
			<clipPath id="clip-{uid}">
				<rect x="0" y="0" width="200" height="320" rx="18" />
			</clipPath>
		</defs>

		<g clip-path="url(#clip-{uid})">
			<rect x="0" y="0" width="200" height="320" fill="url(#dots-{uid})" />

			<!-- Comic-book rays radiating from behind the subject. -->
			<g opacity="0.5">
				{#each [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330] as angle (angle)}
					<path
						d="M100 160 L{100 + 260 * Math.cos((angle * Math.PI) / 180)} {160 +
							260 * Math.sin((angle * Math.PI) / 180)} L{100 +
							260 * Math.cos(((angle + 14) * Math.PI) / 180)} {160 +
							260 * Math.sin(((angle + 14) * Math.PI) / 180)} Z"
						fill="var(--brand)"
						opacity="0.22"
					/>
				{/each}
			</g>

			{#if scene === 'hat'}
				<!-- Hard hat, three-quarter on. Brim first so the dome sits over it. -->
				<g stroke="var(--fg)" stroke-width="5" stroke-linejoin="round">
					<path
						d="M28 196 Q100 178 172 196 Q172 214 100 218 Q28 214 28 196 Z"
						fill="var(--brand-deep)"
					/>
					<path d="M52 198 C52 128 72 96 100 96 C128 96 148 128 148 198 Z" fill="var(--brand)" />
					<!-- Ribs. Just enough to read as moulded plastic. -->
					<path d="M100 96 L100 198" stroke-width="4" opacity="0.5" />
					<path d="M74 108 C68 140 66 172 66 198" stroke-width="4" opacity="0.35" fill="none" />
					<path d="M126 108 C132 140 134 172 134 198" stroke-width="4" opacity="0.35" fill="none" />
				</g>
				<!-- The shine. One flat wedge, no gradient — gradients are the thing that
				     stops this reading as print. -->
				<path
					d="M74 118 C80 108 88 102 96 100 L92 152 C84 148 76 134 74 118 Z"
					fill="#fff"
					opacity="0.5"
				/>
			{:else}
				<!-- Hammer and wrench, crossed. -->
				<g stroke="var(--fg)" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">
					<!-- Hammer, leaning left. -->
					<g transform="rotate(-24 100 160)">
						<rect x="92" y="150" width="16" height="118" rx="7" fill="var(--brand-deep)" />
						<path
							d="M62 116 L138 116 L138 146 L120 146 Q110 154 100 146 L80 146 L62 140 Z"
							fill="var(--brand)"
						/>
					</g>
					<!-- Wrench, leaning right. -->
					<g transform="rotate(28 100 160)">
						<rect x="93" y="152" width="14" height="112" rx="6" fill="var(--brand)" />
						<path
							d="M100 104 A26 26 0 1 0 100 156 A26 26 0 1 0 100 104 Z M100 118 A13 13 0 1 1 100 142 A13 13 0 1 1 100 118 Z"
							fill="var(--brand)"
							fill-rule="evenodd"
						/>
						<path d="M88 100 L112 100 L112 118 L88 118 Z" fill="var(--paper)" stroke="none" />
					</g>
				</g>
			{/if}
		</g>
	</svg>
</div>

<style>
	.aside {
		/* Absent on anything narrower than a desktop. The form is the page there,
		   and decoration that pushes it around is worse than no decoration. */
		display: none;
		/* Dialled back so it reads as wallpaper rather than as something to look
		   at — the form is what the page is for. */
		opacity: 0.55;
	}
	@media (min-width: 1180px) {
		.aside {
			display: block;
			align-self: center;
			justify-self: center;
			width: min(100%, 15rem);
		}
	}
	svg {
		display: block;
		width: 100%;
		height: auto;
	}
</style>
