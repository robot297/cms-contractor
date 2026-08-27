import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * The crew directory folded into `/contractor/people`.
 *
 * Kept as a redirect rather than deleted: this route shipped, so a bookmark or a
 * back button can still land here, and a 404 for a page somebody used yesterday
 * is a worse answer than sending them where it went. 308 because the move is
 * permanent.
 */
export const load: PageServerLoad = () => {
	redirect(308, '/contractor/people');
};
