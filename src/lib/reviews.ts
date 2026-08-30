/**
 * Where a finished job can be reviewed.
 *
 * A FIXED CATALOGUE, not free text. The contractor supplies the URL; the app
 * supplies the name, the icon and the order they appear in. That split is the
 * whole design: a customer who has just had their kitchen done is being asked to
 * do the contractor a favour, and the ask has to look like the platform they
 * already have an account on. "Leave us a review at https://g.page/r/CX…" is a
 * link nobody clicks.
 *
 * Adding a platform is a line here plus a swatch — no migration, because the
 * `review_link` row is keyed by this id as text. Removing one leaves orphan rows
 * that simply stop being read, which is the right failure: a platform the app
 * forgot must not delete a URL the contractor pasted.
 */
export const REVIEW_PLATFORMS = [
	{
		id: 'google',
		label: 'Google',
		/** Said on the settings field, because every one of these is found somewhere different. */
		hint: 'Business Profile → Ask for reviews → copy link',
		example: 'https://g.page/r/…/review'
	},
	{
		id: 'facebook',
		label: 'Facebook',
		hint: 'Your Page → Reviews → copy the page address',
		example: 'https://facebook.com/yourbusiness/reviews'
	},
	{
		id: 'yelp',
		label: 'Yelp',
		hint: 'Your business page → Write a Review',
		example: 'https://yelp.com/writeareview/biz/…'
	},
	{
		id: 'angi',
		label: 'Angi',
		hint: 'Your Angi profile → Reviews',
		example: 'https://angi.com/companylist/us/…'
	},
	{
		id: 'houzz',
		label: 'Houzz',
		hint: 'Your profile → Reviews → Request a review',
		example: 'https://houzz.com/professionals/…'
	},
	{
		id: 'thumbtack',
		label: 'Thumbtack',
		hint: 'Your profile → Reviews',
		example: 'https://thumbtack.com/…/service/…'
	},
	{
		id: 'nextdoor',
		label: 'Nextdoor',
		hint: 'Your business page → Recommendations',
		example: 'https://nextdoor.com/pages/…'
	},
	{
		id: 'bbb',
		label: 'BBB',
		hint: 'Your BBB listing → Write a Review',
		example: 'https://bbb.org/us/…'
	}
] as const;

export type ReviewPlatform = (typeof REVIEW_PLATFORMS)[number]['id'];

export function isReviewPlatform(value: string): value is ReviewPlatform {
	return REVIEW_PLATFORMS.some((p) => p.id === value);
}

export function reviewPlatformLabel(id: string): string {
	return REVIEW_PLATFORMS.find((p) => p.id === id)?.label ?? id;
}

/** One configured destination, as both surfaces read it. */
export type ReviewLink = { platform: ReviewPlatform; url: string };

/** Longer than any real review URL, short enough to bound a text input. */
export const MAX_REVIEW_URL = 500;

export type ReviewUrlResult = { ok: true; url: string } | { ok: false; message: string };

/**
 * Check a pasted review URL.
 *
 * Deliberately not a pattern-match per platform. A Google review link alone has
 * at least four shapes in the wild (`g.page/r/…`, `search.google.com/local/…`,
 * `maps.app.goo.gl/…`, a raw place-id query), and a validator that knows three
 * of them rejects a working link — which is worse than accepting an odd one,
 * because the contractor cannot tell whether the app or the URL is wrong.
 *
 * So the rule is only what the app must guarantee: an absolute http(s) URL, so
 * that what lands in the portal's `href` is a real destination and not
 * `javascript:` or a relative path that resolves inside the portal itself.
 */
export function validateReviewUrl(raw: string | undefined | null): ReviewUrlResult {
	const trimmed = (raw ?? '').trim();
	if (trimmed === '')
		return { ok: false, message: 'Paste a link, or leave it blank to remove it.' };
	if (trimmed.length > MAX_REVIEW_URL)
		return { ok: false, message: `Keep links under ${MAX_REVIEW_URL} characters.` };

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return { ok: false, message: 'That doesn’t look like a link — include the https:// part.' };
	}
	// http: as well as https:, because a few smaller directories still redirect
	// through it. The scheme check is the point: `javascript:` and `data:` are
	// URLs too, and this value ends up in an href a customer clicks.
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
		return { ok: false, message: 'Links must start with https://' };

	return { ok: true, url: parsed.toString() };
}

/** The catalogue's order, applied to whatever the contractor has configured. */
export function sortReviewLinks(links: ReviewLink[]): ReviewLink[] {
	const order = REVIEW_PLATFORMS.map((p) => p.id) as readonly string[];
	return [...links].sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform));
}
