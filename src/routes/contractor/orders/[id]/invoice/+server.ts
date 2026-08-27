import { error, redirect } from '@sveltejs/kit';
import { getOrderDetail } from '$lib/server/crm.server';
import { previewInvoiceEmail } from '$lib/server/email-action.server';
import type { RequestHandler } from './$types';

/**
 * The final invoice, exactly as the customer receives it.
 *
 * This serves the SAME document `sendFinalInvoiceEmail` hands to the provider —
 * both call `composeInvoiceEmail`, so there is no second renderer to drift. A
 * contractor can open this before closing a job out and know what is about to
 * land in an inbox, and it works regardless of whether email is configured on
 * this server, which is the situation on every dev and e2e box.
 *
 * A GET returning `text/html` rather than a Svelte page on purpose: the whole
 * value is seeing the untouched email document, and a page would wrap it in the
 * app's shell, its fonts and its dark mode — none of which any mail client will
 * apply. `?format=text` returns the plain-text alternative part instead, which is
 * what `mailto:` carries and what a text-only client shows.
 *
 * Not cached: an invoice changes every time a payment is recorded, and a stale
 * one is a wrong balance.
 */
export const GET: RequestHandler = async ({ locals, params, url, setHeaders }) => {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');

	// Ownership comes from the query, not from a check bolted on afterwards — an
	// order that isn't this contractor's simply isn't found.
	const detail = await getOrderDetail(params.id, locals.user.id);
	if (!detail) error(404, 'Order not found');

	const rendered = await previewInvoiceEmail(
		{ id: locals.user.id, name: locals.user.name },
		{
			projectName: detail.order.projectName,
			customerName: detail.order.customerName,
			finalNotes: detail.order.finalNotes
		},
		detail.invoice
	);

	setHeaders({ 'cache-control': 'no-store' });

	if (url.searchParams.get('format') === 'text') {
		return new Response(`Subject: ${rendered.subject}\n\n${rendered.text}\n`, {
			headers: { 'content-type': 'text/plain; charset=utf-8' }
		});
	}

	return new Response(rendered.html, {
		headers: { 'content-type': 'text/html; charset=utf-8' }
	});
};
