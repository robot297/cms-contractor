/**
 * Keep raw control bytes out of source files.
 *
 * Two modules had picked them up as regex-range endpoints and as a separator in
 * a template literal. Both uses were correct — NUL genuinely is the safest
 * separator, and the control range genuinely belonged in that character class —
 * but written as literal bytes rather than escapes they cost more than they look
 * like they do:
 *
 *   - `grep`/`ripgrep` classify the file as BINARY and silently skip it. A
 *     46KB module at the centre of the app returned nothing for any search,
 *     which is a bad way to find out your search tool has been lying to you.
 *   - They are invisible in review. A reader sees `[…|  -  ]` and cannot tell
 *     what the range is, or that there is a range at all.
 *   - Editors, formatters and copy-paste can drop or mangle them without any
 *     visible change to the line.
 *
 * `\u0000` says exactly the same thing to the compiler and none of that
 * to the tooling. So the rule is: escapes, always.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Every file git tracks under src/ and scripts/ — the code we author.
 *
 * TRACKED is not the same as PRESENT: a file deleted in the working tree but not
 * yet committed is still listed here, and reading it throws ENOENT, which failed
 * the whole sweep on an unrelated in-progress removal. Filtered rather than
 * caught — a path that is not on disk has no bytes to check, and the
 * `length > 40` guard below still catches a sweep that has gone empty for real.
 */
function trackedSourceFiles(): string[] {
	return execFileSync('git', ['ls-files', 'src', 'scripts'], { encoding: 'utf8' })
		.split('\n')
		.filter((path) => /\.(ts|js|mjs|svelte|css|html)$/.test(path))
		.filter((path) => existsSync(path));
}

/** Control characters that are not ordinary source whitespace. */
function controlBytes(text: string): { code: number; line: number }[] {
	const found: { code: number; line: number }[] = [];
	[...text].forEach((char, index) => {
		if (char === '\n' || char === '\t' || char === '\r') return;
		const code = char.codePointAt(0)!;
		if (code >= 0x20 && code !== 0x7f) return;
		found.push({ code, line: text.slice(0, index).split('\n').length });
	});
	return found;
}

describe('source files', () => {
	const files = trackedSourceFiles();

	it('finds the files it is meant to be checking', () => {
		// Guard against a glob or git invocation change quietly emptying the sweep.
		expect(files.length).toBeGreaterThan(40);
	});

	it('spell control characters as escapes, never as raw bytes', () => {
		const offenders = files.flatMap((path) =>
			controlBytes(readFileSync(path, 'utf8')).map(
				({ code, line }) =>
					`${path}:${line} — U+${code.toString(16).padStart(4, '0').toUpperCase()}`
			)
		);

		expect(
			offenders,
			'write \\u0000 rather than the byte itself — a raw one makes the file read as binary to grep'
		).toEqual([]);
	});
});
