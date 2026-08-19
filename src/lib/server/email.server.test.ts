import { describe, expect, it } from 'vitest';
import { emailConfigured, formatFrom, isEmailConfigured } from './email.server';

/**
 * The provider is never called here. What's worth testing is the two decisions
 * made before the SDK is reached: whether sending is on at all, and how a
 * contractor-authored business name becomes a valid From header.
 */

describe('emailConfigured', () => {
	const KEY = 're_test';
	const FROM = 'hello@mail.example.com';

	it('is on only when the key and the from-address are both set', () => {
		expect(emailConfigured(KEY, FROM)).toBe(true);
	});

	it('treats a key with no from-address as unconfigured', () => {
		// Otherwise every send reaches the provider and is rejected — a feature that
		// looks configured and is broken, instead of a fallback that works.
		expect(emailConfigured(KEY, '')).toBe(false);
		expect(emailConfigured(KEY, undefined)).toBe(false);
	});

	it('treats a from-address with no key as unconfigured', () => {
		expect(emailConfigured('', FROM)).toBe(false);
		expect(emailConfigured(undefined, FROM)).toBe(false);
	});

	it('is off when neither is set', () => {
		expect(emailConfigured(undefined, undefined)).toBe(false);
	});

	it('does not count whitespace as configuration', () => {
		expect(emailConfigured('  ', '  ')).toBe(false);
	});
});

describe('isEmailConfigured', () => {
	it('answers for this deployment without asserting which answer', () => {
		// Deliberately not asserting true or false: the result depends on whether
		// whoever is running the suite has RESEND_API_KEY set, and a test that fails
		// on a teammate's machine because they configured mail is a bad test. The
		// rule itself is covered exhaustively by `emailConfigured` above.
		expect(typeof isEmailConfigured()).toBe('boolean');
	});
});

describe('formatFrom', () => {
	const ADDRESS = 'hello@mail.example.com';

	it('puts the business name on the From line', () => {
		expect(formatFrom('Daniels Decks', ADDRESS)).toBe('"Daniels Decks" <hello@mail.example.com>');
	});

	it('falls back to the bare address when there is no business name', () => {
		expect(formatFrom('', ADDRESS)).toBe(ADDRESS);
		expect(formatFrom('   ', ADDRESS)).toBe(ADDRESS);
	});

	it('escapes quotes so a name cannot break out of the header', () => {
		expect(formatFrom('The "Big" Deck Co', ADDRESS)).toBe(
			'"The \\"Big\\" Deck Co" <hello@mail.example.com>'
		);
	});

	it('escapes backslashes', () => {
		expect(formatFrom('A\\B Builders', ADDRESS)).toBe('"A\\\\B Builders" <hello@mail.example.com>');
	});

	it('quotes a name containing a comma', () => {
		// Unquoted, the comma reads as an address separator.
		expect(formatFrom('Diaz, Sons & Co', ADDRESS)).toBe(
			'"Diaz, Sons & Co" <hello@mail.example.com>'
		);
	});
});

// There is deliberately no test here that calls `sendEmail`. It reads ENV
// directly, so on a machine with RESEND_API_KEY set it stops being a unit test and
// starts posting to Resend — which is exactly what happened the first time this
// file was written. The unconfigured branch is one line guarding the client; the
// configured branch is the provider's to test, and task 7.5 covers it end to end.
