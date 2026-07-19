import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { auth } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	if (event.locals.user) redirect(302, '/');
	return {};
};

export const actions: Actions = {
	signIn: async (event) => {
		const form = await event.request.formData();
		const email = form.get('email')?.toString() ?? '';
		const password = form.get('password')?.toString() ?? '';
		try {
			await auth.api.signInEmail({ body: { email, password }, headers: event.request.headers });
		} catch (error) {
			if (error instanceof APIError) return fail(400, { mode: 'signIn', message: error.message });
			console.error('[login] signIn failed:', error);
			return fail(500, {
				mode: 'signIn',
				message: `Unexpected error: ${(error as Error)?.message ?? error}`
			});
		}
		redirect(302, '/');
	},

	signUp: async (event) => {
		const form = await event.request.formData();
		const email = form.get('email')?.toString() ?? '';
		const password = form.get('password')?.toString() ?? '';
		const name = form.get('name')?.toString() ?? '';
		try {
			// Self-signup on the login page is always a contractor; customers are
			// created by contractors and join via an invite link.
			await auth.api.signUpEmail({
				body: { email, password, name, role: 'contractor' },
				headers: event.request.headers
			});
		} catch (error) {
			if (error instanceof APIError) return fail(400, { mode: 'signUp', message: error.message });
			console.error('[login] signUp failed:', error);
			return fail(500, {
				mode: 'signUp',
				message: `Unexpected error: ${(error as Error)?.message ?? error}`
			});
		}
		redirect(302, '/');
	},

	signInGithub: async (event) => {
		let result;
		try {
			result = await auth.api.signInSocial({
				body: { provider: 'github', callbackURL: '/' },
				headers: event.request.headers
			});
		} catch (error) {
			if (error instanceof APIError) return fail(400, { mode: 'signIn', message: error.message });
			console.error('[login] GitHub sign-in failed:', error);
			return fail(500, {
				mode: 'signIn',
				message: `GitHub sign-in error: ${(error as Error)?.message ?? error}`
			});
		}
		if (result.url) redirect(302, result.url);
		return fail(400, { mode: 'signIn', message: 'GitHub sign-in unavailable' });
	}
};
