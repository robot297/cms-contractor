import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/** Guards the whole contractor section and provides nav chrome data. */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');
	return { userName: locals.user.name };
};
