import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { reviewLink } from './db/schema';
import { assertCanWrite } from './billing.server';
import {
	isReviewPlatform,
	sortReviewLinks,
	validateReviewUrl,
	type ReviewLink,
	type ReviewPlatform
} from '$lib/reviews';

/**
 * The review destinations a contractor offers on a finished job.
 *
 * Reads are NOT billing-guarded and writes are. A lapsed contractor must not be
 * able to add a link, but their customers must still see the ones already there:
 * a portal that quietly drops half a completed job's page because the business
 * missed an invoice is exactly what ADR-0005 rules out — nothing about lapsing
 * may reach a customer.
 */

/** Everything this contractor has configured, in catalogue order. */
export async function listReviewLinks(contractorId: string): Promise<ReviewLink[]> {
	const rows = await db
		.select({ platform: reviewLink.platform, url: reviewLink.url })
		.from(reviewLink)
		.where(eq(reviewLink.contractorId, contractorId));
	// Unknown ids are dropped rather than shown. A platform removed from the
	// catalogue leaves its row alone (see the schema note); this is where that
	// row stops being offered to anybody.
	return sortReviewLinks(rows.filter((r): r is ReviewLink => isReviewPlatform(r.platform)));
}

export class UnknownReviewPlatformError extends Error {
	constructor() {
		super('That is not a review platform this app knows about');
		this.name = 'UnknownReviewPlatformError';
	}
}

export class InvalidReviewUrlError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidReviewUrlError';
	}
}

/**
 * Set one platform's link, creating or replacing it.
 *
 * The URL is re-validated here rather than trusted from the form: this value
 * ends up in an `href` a customer clicks, and the only thing standing between a
 * pasted `javascript:` and a portal visitor is this check. The client runs the
 * same function first, so a bad paste is caught before the round trip — but the
 * client is not what makes it safe.
 */
export async function saveReviewLink(
	contractorId: string,
	platform: string,
	url: string
): Promise<void> {
	await assertCanWrite(contractorId);
	if (!isReviewPlatform(platform)) throw new UnknownReviewPlatformError();

	const checked = validateReviewUrl(url);
	if (!checked.ok) throw new InvalidReviewUrlError(checked.message);

	await db
		.insert(reviewLink)
		.values({ contractorId, platform, url: checked.url })
		.onConflictDoUpdate({
			target: [reviewLink.contractorId, reviewLink.platform],
			set: { url: checked.url }
		});
}

/** Stop offering a platform. Blank-and-save is the same gesture in the form. */
export async function removeReviewLink(
	contractorId: string,
	platform: ReviewPlatform | string
): Promise<void> {
	await assertCanWrite(contractorId);
	await db
		.delete(reviewLink)
		.where(and(eq(reviewLink.contractorId, contractorId), eq(reviewLink.platform, platform)));
}
