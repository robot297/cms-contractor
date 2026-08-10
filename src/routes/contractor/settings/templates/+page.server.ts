import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Email templates moved onto the account page at /contractor/settings, so account
 * and configuration are one surface rather than two.
 *
 * This redirect stays because the old path was in the nav for a while and is the
 * kind of URL people bookmark. 308 rather than 302: the move is permanent, and it
 * tells a browser it can stop asking.
 */
export const load: PageServerLoad = async () => {
	redirect(308, '/contractor/settings?tab=email');
};
