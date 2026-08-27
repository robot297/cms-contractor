import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * The customer directory folded into `/contractor/people`.
 *
 * Kept as a redirect for the same reason `/contractor/crew` and
 * `/contractor/settings/templates` are: this route was in the nav for most of
 * the app's life, so it is the one people bookmarked and the one a back button
 * lands on. A 404 for a page somebody used yesterday is a worse answer than
 * sending them where it went. 308 because the move is permanent.
 */
export const load: PageServerLoad = () => {
	redirect(308, '/contractor/people');
};
