import { redirect } from '@sveltejs/kit';
import {
	ensureStarterTemplates,
	getContractorSettings,
	listEmailTemplates
} from '$lib/server/templates.server';
import type { LayoutServerLoad } from './$types';

/** Guards the whole contractor section and provides nav chrome + template data. */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');

	// Seed starter templates for contractors who have never made one, then load the
	// templates + branding once here so the composer has them on every contractor
	// surface (dashboard, orders, order detail, customers) without per-page loads.
	const contractorId = locals.user.id;
	await ensureStarterTemplates(contractorId);
	const [templates, settings] = await Promise.all([
		listEmailTemplates(contractorId),
		getContractorSettings(contractorId)
	]);

	return {
		userName: locals.user.name,
		emailTemplates: templates.map((t) => ({
			id: t.id,
			name: t.name,
			subject: t.subject,
			body: t.body
		})),
		contractorSettings: {
			// Fall back to the contractor's own name so `{{contractor}}` resolves even
			// before they set a business name.
			businessName: settings.businessName || locals.user.name,
			signature: settings.signature
		}
	};
};
