/**
 * Guard against the app's most-repeated dark-mode bug: dark text tokens rendered
 * on the brand fill.
 *
 * The brand yellow is light in BOTH themes. Every other surface token in the app
 * flips between themes — `--ink`, `--fg`, `--muted` and friends are dark on light
 * and near-white on dark. So a rule that fills with yellow and takes its
 * foreground from one of those tokens looks fine while you're building it in
 * light mode and turns into white-on-yellow the moment someone flips the theme.
 *
 * That has now shipped four separate times (the dashboard's waiting badge, the
 * orders list's unread badge, an order's document button, the dev role switcher),
 * which is three times too many for a code review to be the control. So the rule
 * is mechanical instead: on a fill that does not flip, the foreground must not
 * flip either. Use `var(--on-yellow)`, or pin the literal.
 *
 * The same trap exists in reverse — a pinned dark foreground on a fill that flips
 * — but that one is only reachable inside a `[data-theme]` block, where the fill
 * is effectively pinned too, so it is not worth chasing here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Fills that stay light in both themes. A foreground on these must stay dark. */
const NON_FLIPPING_FILLS = [
	'var(--yellow)',
	'var(--yellow-deep)',
	'var(--who-contractor)',
	'#ffcc00',
	'#ffd633',
	'#e6b800'
];

/** Tokens whose value differs between light and dark. Illegal on the fills above. */
const FLIPPING_FOREGROUNDS = [
	'var(--ink)',
	'var(--fg)',
	'var(--muted)',
	'var(--fg-muted)',
	'var(--paper)',
	'var(--surface)',
	'var(--surface-sunken)',
	'var(--surface-inset)'
];

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
		.filter((rule) => rule.fill !== undefined && NON_FLIPPING_FILLS.includes(rule.fill));
});

describe('foregrounds on the brand fill', () => {
	it('finds the brand-filled rules it is meant to be guarding', () => {
		// A parser change that quietly matched nothing would make every assertion
		// below vacuous, so the sweep has to prove it still sees the real rules.
		expect(brandFilled.length).toBeGreaterThan(20);
	});

	it('never takes its colour from a token that flips between themes', () => {
		const offenders = brandFilled
			.filter((rule) => {
				const fg = declaration(rule.body, 'color');
				return fg !== undefined && FLIPPING_FOREGROUNDS.includes(fg);
			})
			.map((r) => `${r.path}:${r.line} — ${r.selector} { background: ${r.fill}; color: ... }`);

		expect(
			offenders,
			'use var(--on-yellow): these render near-white on yellow in dark mode'
		).toEqual([]);
	});

	it('states its colour rather than inheriting one', () => {
		// Inheriting is the same bug wearing a disguise: the shell's text colour
		// flips, so an unstated foreground on yellow goes white in dark mode too.
		const offenders = brandFilled
			.filter((rule) => !MODIFIER.test(rule.selector))
			.filter((rule) => declaration(rule.body, 'color') === undefined)
			.map((r) => `${r.path}:${r.line} — ${r.selector} { background: ${r.fill}; /* no color */ }`);

		expect(offenders, 'add color: var(--on-yellow) — an inherited colour flips').toEqual([]);
	});
});

describe('the --on-yellow token', () => {
	const appCss = readFileSync('src/app.css', 'utf8');

	it('is defined once, at the root', () => {
		expect([...appCss.matchAll(/--on-yellow\s*:/g)]).toHaveLength(1);
	});

	it('is not redefined under a dark theme', () => {
		// The whole point of the token is that it is the one colour that does NOT
		// move when the theme does. Overriding it in the dark block would reopen
		// every bug this file exists to close.
		const darkBlocks = appCss.match(/\[data-theme=['"]dark['"]\][^{]*\{[^}]*\}/g) ?? [];
		expect(darkBlocks.filter((block) => block.includes('--on-yellow:'))).toEqual([]);
	});
});
