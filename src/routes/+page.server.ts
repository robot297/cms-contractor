import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	const user = event.locals.user;
	if (user) {
		const home =
			user.role === 'contractor'
				? '/contractor'
				: user.role === 'subcontractor'
					? '/subcontractor'
					: '/customer';
		redirect(302, home);
	}
	return {};
};
