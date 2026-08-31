import { describe, expect, it } from 'vitest';
import {
	isReviewPlatform,
	REVIEW_PLATFORMS,
	reviewPlatformLabel,
	sortReviewLinks,
	validateReviewUrl,
	type ReviewLink
} from './reviews';

describe('validateReviewUrl', () => {
	it('accepts the shapes these platforms actually hand out', () => {
		// Deliberately varied: a Google short link, a Yelp write-a-review path, a
		// Facebook page. The validator is not allowed to have opinions about which
		// of these is "the right" Google URL — see its own note.
		for (const url of [
			'https://g.page/r/CX9aBcDeFgHiJ/review',
			'https://search.google.com/local/writereview?placeid=ChIJ123',
			'https://maps.app.goo.gl/aBcDeFg',
			'https://www.yelp.com/writeareview/biz/abc-plumbing-austin',
			'https://facebook.com/abcplumbing/reviews',
			'https://www.bbb.org/us/tx/austin/profile/plumber/abc-1234'
		]) {
			expect(validateReviewUrl(url), url).toMatchObject({ ok: true });
		}
	});

	it('rejects schemes that are not the web', () => {
		// The reason this function exists. The value lands in an href a customer
		// clicks, so a `javascript:` URL is a stored XSS with a Save button.
		for (const url of [
			'javascript:alert(1)',
			'data:text/html,<script>alert(1)</script>',
			'file:///etc/passwd'
		]) {
			const result = validateReviewUrl(url);
			expect(result.ok, url).toBe(false);
		}
	});

	it('rejects a bare domain with no scheme, and says what is missing', () => {
		// Not silently prefixed with https://. Guessing turns a typo into a live
		// link to somewhere the contractor did not mean.
		const result = validateReviewUrl('yelp.com/writeareview/biz/abc');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain('https://');
	});

	it('treats blank as a removal rather than a malformed link', () => {
		// Blank IS the delete gesture in the settings form, so the message has to
		// say so instead of reading as a validation failure.
		const result = validateReviewUrl('   ');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toMatch(/blank/i);
	});

	it('trims and normalises what it returns', () => {
		const result = validateReviewUrl('  https://example.com/review  ');
		expect(result).toMatchObject({ ok: true, url: 'https://example.com/review' });
	});

	it('refuses a link longer than the column allows', () => {
		expect(validateReviewUrl('https://example.com/' + 'a'.repeat(600)).ok).toBe(false);
	});
});

describe('the catalogue', () => {
	it('has unique ids', () => {
		const ids = REVIEW_PLATFORMS.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('gives every platform a label and a hint, since the hint is what finds the URL', () => {
		for (const p of REVIEW_PLATFORMS) {
			expect(p.label.length, p.id).toBeGreaterThan(0);
			expect(p.hint.length, p.id).toBeGreaterThan(0);
			expect(p.example.startsWith('https://'), p.id).toBe(true);
		}
	});

	it('knows its own ids and nothing else', () => {
		expect(isReviewPlatform('google')).toBe(true);
		expect(isReviewPlatform('myspace')).toBe(false);
	});

	it('falls back to the raw id rather than blanking an unknown platform', () => {
		// A row whose platform left the catalogue must not render as an empty pill.
		expect(reviewPlatformLabel('google')).toBe('Google');
		expect(reviewPlatformLabel('myspace')).toBe('myspace');
	});
});

describe('sortReviewLinks', () => {
	it('puts them in catalogue order whatever order they arrive in', () => {
		// The DB returns rows unordered; Google leading is a product decision that
		// belongs here rather than in an ORDER BY.
		const links = [
			{ platform: 'bbb', url: 'https://bbb.org/x' },
			{ platform: 'google', url: 'https://g.page/r/x/review' },
			{ platform: 'yelp', url: 'https://yelp.com/x' }
		] as ReviewLink[];
		expect(sortReviewLinks(links).map((l) => l.platform)).toEqual(['google', 'yelp', 'bbb']);
	});

	it('does not mutate what it was given', () => {
		const links = [
			{ platform: 'yelp', url: 'https://yelp.com/x' },
			{ platform: 'google', url: 'https://g.page/r/x/review' }
		] as ReviewLink[];
		sortReviewLinks(links);
		expect(links[0].platform).toBe('yelp');
	});
});
