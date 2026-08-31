/**
 * Every theme, measured.
 *
 * Every palette x two modes is several hundred individual colour pairs. That is
 * well past the point where "it looked fine" is a control, and past the point
 * where a reviewer can be expected to catch a single mistyped hex — so the
 * ratios are computed here from the shipped CSS rather than trusted.
 *
 * The counts are taken from `PALETTES` rather than written down, because a
 * literal here is a third source of truth that goes stale the moment a palette
 * lands — which is exactly what happened when round two was added and this file
 * still said eight.
 *
 * Deliberately parses `src/app.css` rather than importing a table of values: a
 * table would be a second source of truth, and the bug worth catching is
 * exactly the case where the table and the stylesheet disagree.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PALETTES } from './theme.svelte';

/**
 * Comments blanked, newlines kept.
 *
 * The header of app.css documents the selector shape using a stand-in theme
 * name, and the sweeps below would otherwise read that prose as a real theme
 * and demand blocks for it. Blanked rather than deleted so any line number a
 * failure reports still points at the right line.
 */
function blankComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

const css = blankComments(readFileSync('src/app.css', 'utf8'));

// ------------------------------------------------------------------ contrast

function channels(hex: string): [number, number, number] {
	const s = hex.replace('#', '');
	const full =
		s.length === 3
			? s
					.split('')
					.map((c) => c + c)
					.join('')
			: s;
	return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** sRGB → linear, the WCAG transfer curve. */
function linearize(c: number): number {
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
	const [r, g, b] = channels(hex).map(linearize);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/**
 * Perceptual distance between two colours, in OKLab, scaled x100.
 *
 * The right tool for "can a person tell these two apart", where a contrast
 * ratio is the right tool for "can a person read this on that". OKLab is used
 * rather than plain RGB distance because RGB badly under-counts hue differences
 * in the blues and over-counts them in the greens.
 */
export function perceptualDistance(a: string, b: string): number {
	const [l1, a1, b1] = oklab(a);
	const [l2, a2, b2] = oklab(b);
	return Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 100;
}

function oklab(hex: string): [number, number, number] {
	const [r, g, b] = channels(hex).map(linearize);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	];
}

// -------------------------------------------------------------------- parsing

type Palette = Record<string, string>;

/**
 * Every `:root…{ }` block that declares a palette, keyed by "<name> <mode>".
 *
 * Only literal hex values are collected. A token defined as `color-mix(…)` or
 * `var(…)` is derived from ones that ARE literal here, so measuring the
 * literals measures the whole ladder.
 */
function palettes(): Map<string, Palette> {
	const found = new Map<string, Palette>();
	for (const block of css.match(/:root[^{]*\{[^}]*\}/g) ?? []) {
		const selector = block.slice(0, block.indexOf('{'));
		const name = selector.match(/\[data-palette='([a-z]+)'\]/)?.[1];
		if (!name) continue;
		const mode = selector.includes("[data-theme='dark']") ? 'dark' : 'light';

		const tokens: Palette = {};
		for (const [, key, value] of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
			const v = value.trim();
			if (/^#[0-9a-fA-F]{3,8}$/.test(v)) tokens[key] = v;
		}
		found.set(`${name} ${mode}`, tokens);
	}
	return found;
}

const ALL = palettes();

/**
 * The pairs the app actually renders, with the bar each has to clear.
 *
 * 4.5 is WCAG AA for body text. 3 is AA-large, and the bar for a UI component
 * or graphical object that carries meaning — which is what an accent fill and a
 * status dot are. Hairlines are deliberately absent: they are decorative
 * separation, and holding them to 3:1 would force every card into a cage.
 */
const PAIRS: [string, string, string, number][] = [
	['body text on a card', 'fg', 'surface', 4.5],
	['body text on the page', 'fg', 'paper', 4.5],
	['muted text on a card', 'fg-muted', 'surface', 4.5],
	['muted text on a sunken well', 'fg-muted', 'surface-sunken', 4.5],
	['muted text on an inset field', 'fg-muted', 'surface-inset', 4.5],
	['label on the accent fill', 'on-brand', 'brand', 4.5],
	['label on the pressed accent', 'on-brand', 'brand-deep', 4.5],
	['accent on a card', 'brand', 'surface', 3],
	['accent on the page', 'brand', 'paper', 3],
	['second accent on a card', 'brand-2', 'surface', 3],
	['success text on a card', 'ok-fg', 'surface', 4.5],
	['waiting text on a card', 'wait-fg', 'surface', 4.5],
	['stopped text on a card', 'stop-fg', 'surface', 4.5],
	['portal accent on a card', 'who-customer', 'surface', 3]
];

describe('every theme is legible', () => {
	it('finds a light and a dark block for every palette', () => {
		// A selector change that quietly matched nothing would make every
		// assertion below vacuous, so the sweep proves it still sees them — and
		// counts against `PALETTES`, so adding a palette without its blocks fails
		// here rather than silently skipping every check below.
		expect(ALL.size).toBe(PALETTES.length * 2);
	});

	it('defines the same token ladder in every palette', () => {
		// A palette missing a token silently inherits the previous one's — which
		// is how a violet theme ends up with an azure focus ring.
		const required = [...new Set(PAIRS.flatMap(([, fg, bg]) => [fg, bg]))];
		const gaps: string[] = [];
		for (const [name, tokens] of ALL) {
			for (const token of required) {
				if (!tokens[token]) gaps.push(`${name} is missing --${token}`);
			}
		}
		expect(gaps).toEqual([]);
	});

	it('clears WCAG on every rendered pair', () => {
		const failures: string[] = [];
		for (const [name, tokens] of ALL) {
			for (const [label, fg, bg, min] of PAIRS) {
				if (!tokens[fg] || !tokens[bg]) continue;
				const ratio = contrast(tokens[fg], tokens[bg]);
				if (ratio < min) {
					failures.push(
						`${name}: ${label} — ${tokens[fg]} on ${tokens[bg]} is ${ratio.toFixed(2)}:1, needs ${min}`
					);
				}
			}
		}
		expect(failures).toEqual([]);
	});

	it('keeps the two accents of a theme apart', () => {
		// The second accent is half of what tells one theme from another — it
		// carries the gradients, the paired chart marks and the portal's own
		// colour. Set too close to the first, the gradient reads as a flat fill
		// and the theme loses its signature.
		//
		// Measured as perceptual distance, NOT as contrast ratio. Contrast is a
		// LIGHTNESS comparison, and several of these pairs are deliberately close
		// in lightness and far apart in hue — Outrun's magenta and teal are near
		// opposites that a contrast check scores 1.05:1, which would read as
		// "identical" when they are as different as two colours get.
		const flat: string[] = [];
		for (const [name, tokens] of ALL) {
			if (!tokens.brand || !tokens['brand-2']) continue;
			const d = perceptualDistance(tokens.brand, tokens['brand-2']);
			// A low bar on purpose. Halogen's two accents are near-neighbours BY
			// DESIGN — it is the near-monochrome theme — so this is sized to catch a
			// copy-paste that left both accents identical, not a close pairing that
			// was chosen.
			if (d < 6) {
				flat.push(`${name}: --brand and --brand-2 are only ${d.toFixed(1)} apart (OKLab)`);
			}
		}
		expect(flat).toEqual([]);
	});
});

describe('every theme is fully specified', () => {
	const names = [...new Set([...css.matchAll(/\[data-palette='([a-z]+)'\]/g)].map((m) => m[1]))];

	it('defines exactly the palettes the switcher offers', () => {
		// Both directions on purpose. A CSS block with no entry in `PALETTES` is
		// dead weight nobody can select; an entry with no CSS block is a menu item
		// that silently leaves the previous palette on screen.
		expect([...names].sort()).toEqual([...PALETTES].sort());
	});

	it('gives each theme both modes', () => {
		// A theme with only a light block renders the previous theme's dark values
		// the moment someone flips the toggle — a half-applied brand, which reads
		// as a rendering fault rather than a missing definition.
		const missing = names.filter((name) => !ALL.has(`${name} light`) || !ALL.has(`${name} dark`));
		expect(missing).toEqual([]);
	});

	it('gives each theme its own geometry, type and air', () => {
		// The three non-colour halves of a theme. Without them eight themes are
		// one theme wearing eight coats of paint, which is the note this whole
		// system exists to answer.
		const thin: string[] = [];
		for (const name of names) {
			for (const mode of ['light', 'dark']) {
				const selector =
					mode === 'dark'
						? `:root[data-palette='${name}'][data-theme='dark']`
						: `[data-palette='${name}']`;
				const block = (css.match(/:root[^{]*\{[^}]*\}/g) ?? []).find(
					(b) =>
						b.slice(0, b.indexOf('{')).includes(selector) &&
						(mode === 'dark') === b.includes("[data-theme='dark']")
				);
				if (!block) continue;
				for (const token of ['--radius-card', '--font-display', '--atmos']) {
					if (!block.includes(`${token}:`)) thin.push(`${name} ${mode} is missing ${token}`);
				}
			}
		}
		expect(thin).toEqual([]);
	});
});
