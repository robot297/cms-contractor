/**
 * Guard the brand-fill invariant — which CHANGED when the theme did, so this
 * file's job changed with it.
 *
 * The old rule: safety yellow was light in both themes, so anything sitting on
 * it had to stay dark in both, and `--on-yellow` was pinned outside the dark
 * block. Every palette that replaced it flips — a bright accent on the dark
 * ground, a deep one on the light — so `--on-brand` flips too, and pinning a
 * literal on the brand fill is now the bug rather than the fix.
 *
 * The new rule, and what this file enforces: **a rule that fills with the brand
 * must take its foreground from `--on-brand`.** Not from a literal (which can
 * only be right in one theme), and not from `--fg` / `--ink` / any other surface
 * token (which flips the wrong way — those track the PAGE, and the brand fill is
 * not the page).
 *
 * The trap this replaces shipped four times under the old theme. The equivalent
 * under the new one is a hardcoded `#14171c` left behind by the migration, which
 * renders as near-black on a dark-mode azure button. Same failure, new colour.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The brand fill, however a rule names it. */
const BRAND_FILLS = [
	'var(--brand)',
	'var(--brand-deep)',
	'var(--who-contractor)',
	// The accent as a gradient, which is what the primary button, the h1 slab and
	// the active nav pill wear now. Same rule applies: whatever sits on it takes
	// its colour from --on-brand.
	'var(--brand-sweep)'
];

/**
 * Foregrounds that are wrong ON the brand fill.
 *
 * The surface tokens track the PAGE — they go near-white in dark mode, which is
 * correct on a dark card and unreadable on a bright accent. `--on-brand` is the
 * only token that tracks the fill itself.
 */
const ILLEGAL_FOREGROUNDS = [
	'var(--ink)',
	'var(--fg)',
	'var(--muted)',
	'var(--fg-muted)',
	'var(--paper)',
	'var(--surface)',
	'var(--surface-sunken)',
	'var(--surface-inset)'
];

/** A literal is wrong on a fill that flips: it can only be right in one theme. */
const LITERAL = /^(#[0-9a-fA-F]{3,8}|rgb|rgba|hsl|hsla)/;

/**
 * Modifier selectors restate only what changes; their foreground is inherited
 * from the base rule, which this test checks on its own. Flagging them for a
 * missing `color` would just be noise.
 */
const MODIFIER = /:(hover|focus|focus-visible|focus-within|active|disabled|checked)\b/;

function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) sourceFiles(path, out);
		else if (/\.(svelte|css)$/.test(entry.name)) out.push(path);
	}
	return out;
}

/** Same text, every character blanked but the newlines — offsets survive intact. */
function blank(text: string): string {
	return text.replace(/[^\n]/g, ' ');
}

/**
 * Comments are blanked rather than deleted. They have to go — a comment between
 * two declarations otherwise hides the second one from `declaration()`, which is
 * exactly how the first draft of this file reported false positives — but
 * deleting them would slide every line number after them.
 */
function blankComments(css: string): string {
	return css.replace(/\/\*[\s\S]*?\*\//g, blank);
}

/**
 * The CSS of a file, positioned as it sits in the file: a `.css` file entire, or
 * a component's `<style>` bodies with the markup around them blanked out. Keeping
 * the original offsets is what lets a failure name the line you have to go edit.
 */
function styleText(path: string, source: string): string {
	if (path.endsWith('.css')) return blankComments(source);
	let out = blank(source);
	for (const match of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
		const start = match.index + match[0].indexOf(match[1]);
		out = out.slice(0, start) + match[1] + out.slice(start + match[1].length);
	}
	return blankComments(out);
}

type Rule = { selector: string; body: string; line: number };

/**
 * Innermost declaration blocks. A body of `[^{}]*` can't span a nested block, so
 * wrappers like `@media`/`:global()` are skipped over and only leaf rules match —
 * which is all this check looks at.
 */
function rules(css: string): Rule[] {
	return [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((m) => ({
		// The capture runs back to the previous `}`, so the selector is its last line.
		selector: m[1].trim().split('\n').pop()!.trim(),
		body: m[2],
		line: css.slice(0, m.index).split('\n').length
	}));
}

/** The last winning value for a property in a block, or undefined if unset. */
function declaration(body: string, property: string): string | undefined {
	const found = [...body.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]+)`, 'g'))];
	return found.length ? found[found.length - 1][1].trim() : undefined;
}

const files = sourceFiles('src');

/** Every rule in the app whose fill is one that does not flip between themes. */
const brandFilled = files.flatMap((path) => {
	const css = styleText(path, readFileSync(path, 'utf8'));
	return rules(css)
		.map((rule) => ({
			...rule,
			path,
			fill: declaration(rule.body, 'background') ?? declaration(rule.body, 'background-color')
		}))
		.filter((rule) => rule.fill !== undefined && BRAND_FILLS.includes(rule.fill));
});

describe('foregrounds on the brand fill', () => {
	it('finds the brand-filled rules it is meant to be guarding', () => {
		// A parser change that quietly matched nothing would make every assertion
		// below vacuous, so the sweep has to prove it still sees the real rules.
		expect(brandFilled.length).toBeGreaterThan(20);
	});

	it('never takes its colour from a token that tracks the page', () => {
		const offenders = brandFilled
			.filter((rule) => {
				const fg = declaration(rule.body, 'color');
				return fg !== undefined && ILLEGAL_FOREGROUNDS.includes(fg);
			})
			.map((r) => `${r.path}:${r.line} — ${r.selector} { background: ${r.fill}; color: ... }`);

		expect(
			offenders,
			'use var(--on-brand): a surface token goes near-white on a bright accent'
		).toEqual([]);
	});

	it('never pins a literal on a fill that flips', () => {
		// The migration hazard. A hardcoded #14171c was correct while the brand was
		// yellow in both themes; on an accent that flips it is near-black on a
		// bright button in one theme and near-black on a deep one in the other.
		const offenders = brandFilled
			.filter((rule) => {
				const fg = declaration(rule.body, 'color');
				return fg !== undefined && LITERAL.test(fg.replace('!important', '').trim());
			})
			.map(
				(r) => `${r.path}:${r.line} — ${r.selector} { background: ${r.fill}; color: <literal> }`
			);

		expect(offenders, 'use var(--on-brand): a literal can only be right in one theme').toEqual([]);
	});

	it('states its colour rather than inheriting one', () => {
		// Inheriting is the same bug wearing a disguise: the shell's text colour
		// tracks the page, so an unstated foreground on the accent flips with it.
		const offenders = brandFilled
			.filter((rule) => !MODIFIER.test(rule.selector))
			.filter((rule) => declaration(rule.body, 'color') === undefined)
			.map((r) => `${r.path}:${r.line} — ${r.selector} { background: ${r.fill}; /* no color */ }`);

		expect(offenders, 'add color: var(--on-brand) — an inherited colour flips').toEqual([]);
	});
});

describe('the palette blocks', () => {
	// Comments blanked before anything is scanned. The header of app.css documents
	// the selector shape using a stand-in palette name, and without this the sweep
	// below reads that prose as a real palette and demands blocks for it — a test
	// that fails because the file explains itself is a test nobody keeps.
	const appCss = blankComments(readFileSync('src/app.css', 'utf8'));

	/** Every `:root…{ … }` block in app.css. None of them nest, so this is enough. */
	const rootBlocks = appCss.match(/:root[^{]*\{[^}]*\}/g) ?? [];

	it('finds the blocks it is meant to be guarding', () => {
		expect(rootBlocks.length).toBeGreaterThan(4);
	});

	it('always ships --on-brand alongside --brand', () => {
		// The inverse of the rule this file used to enforce. `--on-brand` no longer
		// sits outside the theme — it moves WITH the accent, because a bright accent
		// wants a dark label and a deep one wants white. So the invariant is that
		// the two are always defined together: a palette that sets an accent and
		// forgets its label inherits the previous palette's, which is the one
		// combination guaranteed to be wrong.
		const orphans = rootBlocks
			.filter((block) => /--brand\s*:/.test(block) && !/--on-brand\s*:/.test(block))
			.map((block) => block.slice(0, block.indexOf('{')).trim());

		expect(orphans, 'a block setting --brand must also set --on-brand').toEqual([]);
	});

	it('gives every palette both themes', () => {
		// A palette with only a light block renders the previous palette's dark
		// values the moment someone flips the theme — a half-applied brand, which
		// looks like a rendering fault rather than a missing definition.
		const named = [...appCss.matchAll(/\[data-palette='([a-z]+)'\]/g)].map((m) => m[1]);
		const palettes = [...new Set(named)];
		expect(palettes.length).toBeGreaterThan(0);

		const missing = palettes.filter((name) => {
			const blocks = rootBlocks.filter((b) => b.includes(`[data-palette='${name}']`));
			const hasDark = blocks.some((b) => b.includes("[data-theme='dark']"));
			const hasLight = blocks.some((b) => !b.includes("[data-theme='dark']"));
			return !hasDark || !hasLight;
		});

		expect(missing, 'each palette needs a light block and a dark one').toEqual([]);
	});
});
