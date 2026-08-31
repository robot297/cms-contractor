import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { renderEmail, type RenderedEmail } from '$lib/email';
import { composeInvoiceEmail, type InvoiceEmailOrder, type InvoiceSummary } from '$lib/invoice';
import { assertCanWrite } from './billing.server';
import { recordEmailSent } from './crm.server';
import {
	asSimulatedOutcome,
	isEmailConfigured,
	isEmailDevToolsEnabled,
	sendEmail
} from './email.server';
import { isDemoUser } from './demo.server';
import { getContractorSettings } from './templates.server';

/**
 * The one send action, shared by every contractor surface that mounts the
 * composer.
 *
 * It lives here rather than in five `+page.server.ts` files because the rule
 * about when a send is recorded on a timeline is the kind of thing that drifts
 * the moment it exists in more than one place. Each page re-exports this under
 * `actions.sendEmail`, inside its existing `withBillingErrors` wrapper.
 *
 * Note what it does NOT trust from the request: branding. The business name and
 * signature are read from the contractor's own row, never from the form. Posting
 * them would let a crafted request send mail under another contractor's name from
 * the product's verified domain. Recomposing here is also what keeps the
 * templates-page preview and the sent mail identical — both call `renderEmail`.
 */

function requireContractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');
	return locals.user;
}

export async function sendEmailAction(event: RequestEvent) {
	const user = requireContractor(event.locals);

	// Two hard refusals before anything else is even parsed:
	// - The shared demo login never sends mail through the app — it is a public
	//   account, and this action reaches real inboxes. Simulated sends are
	//   refused too; the demo showcases the composer, not the send pipeline.
	// - An unverified address never sends. Verified email is the gate on the
	//   whole app (the layout redirects), but a send that lands in a customer's
	//   inbox is exactly what that gate exists for, so it's re-checked here.
	if (isDemoUser(user.email))
		return fail(403, {
			sent: false,
			reason: 'demo',
			message: 'Email sending is disabled in the demo'
		});
	if (!user.emailVerified && isEmailConfigured())
		return fail(403, {
			sent: false,
			reason: 'unverified',
			message: 'Verify your email address before sending'
		});

	const form = await event.request.formData();

	const to = (form.get('customerEmail')?.toString() ?? '').trim();
	const customerName = (form.get('customerName')?.toString() ?? '').trim();
	const subjectInput = (form.get('subject')?.toString() ?? '').trim();
	const bodyInput = (form.get('body')?.toString() ?? '').trim();
	const project = (form.get('project')?.toString() ?? '').trim();
	const orderId = (form.get('orderId')?.toString() ?? '').trim();

	if (!to) return fail(400, { sent: false, reason: 'invalid', message: 'No recipient address' });
	if (!bodyInput)
		return fail(400, { sent: false, reason: 'invalid', message: 'Write a message first' });

	// Refuse a lapsed contractor before anything leaves the building. Guarding only
	// the timeline write would send the mail and then fail to record it — the one
	// outcome worse than refusing outright.
	await assertCanWrite(user.id);

	const settings = await getContractorSettings(user.id);
	// Same fallback the layout uses, so `{{contractor}}` resolves for a contractor
	// who hasn't set a business name yet.
	const businessName = settings.businessName || user.name;

	const rendered = renderEmail(
		{ subject: subjectInput, body: bodyInput },
		{ customer: customerName, contractor: businessName, project },
		{ businessName, signature: settings.signature }
	);

	// Dev-tools override. Only the provider call is skipped — the billing guard
	// above and the ownership check and timeline write below all still run, so the
	// simulated path is the real one minus Resend.
	const requestedSimulation = form.get('simulate')?.toString();
	const simulated = isEmailDevToolsEnabled() ? asSimulatedOutcome(requestedSimulation) : null;

	// A `simulate` field that didn't survive into a real simulation must not fall
	// through to the provider. Asking to fake a send and getting a real one is the
	// one outcome this feature exists to prevent, and it costs an actual email, so
	// refuse loudly instead of guessing at intent.
	if (requestedSimulation && !simulated) {
		return fail(400, {
			sent: false,
			reason: 'invalid',
			subject: rendered.subject,
			body: rendered.text,
			message: isEmailDevToolsEnabled()
				? `Unrecognised simulation "${requestedSimulation}" — nothing was sent`
				: 'Email dev tools are off on this server — nothing was sent'
		});
	}

	if (simulated === 'failure') {
		return fail(502, {
			sent: false,
			reason: 'provider',
			subject: rendered.subject,
			body: rendered.text,
			message: 'That did not send (simulated)'
		});
	}

	// Simulation mode means this server does not send real email, full stop. A
	// deployment with dev tools on is one someone is testing against, and the whole
	// reason the flag exists is that a real send there costs a real email to a real
	// customer. The composer disables Send to match; this is the half that holds
	// when the page is stale or the request is hand-rolled.
	if (!simulated && isEmailDevToolsEnabled()) {
		return fail(409, {
			sent: false,
			reason: 'simulation-only',
			subject: rendered.subject,
			body: rendered.text,
			message: 'Simulation is on for this server — real sending is disabled'
		});
	}

	if (!simulated && !isEmailConfigured()) {
		// Shouldn't be reached — the composer checks the flag and takes the mailto:
		// path client-side — but a stale page or a direct post lands here, and the
		// answer is the same fallback rather than an error.
		return fail(409, {
			sent: false,
			reason: 'unconfigured',
			subject: rendered.subject,
			body: rendered.text,
			message: 'Email sending is not configured'
		});
	}

	const result = simulated
		? ({ ok: true } as const)
		: await sendEmail({
				to,
				replyTo: user.email,
				fromName: businessName,
				subject: rendered.subject,
				html: rendered.html,
				text: rendered.text
			});

	if (!result.ok) {
		// The composed message goes back with the failure so the composer can offer
		// the mailto: route without the contractor retyping anything.
		return fail(502, {
			sent: false,
			reason: result.reason,
			subject: rendered.subject,
			body: rendered.text,
			message: 'That did not send'
		});
	}

	// Sent. Record it only when the composer came from an Order — `recordEmailSent`
	// re-checks ownership and declines quietly, so a bad `orderId` costs the record
	// rather than the message that has already gone out.
	let recorded = false;
	if (orderId) {
		recorded = await recordEmailSent(orderId, user.id, {
			customerName,
			subject: rendered.subject
		});
	}

	return { sent: true, recorded };
}

/**
 * Email a customer their final invoice at close-out.
 *
 * The message itself is composed by `composeInvoiceEmail` — the same pure
 * function the `/contractor/orders/[id]/invoice` preview renders — so what a
 * contractor inspects before sending is byte-identical to what lands in the
 * customer's inbox. This function's job is only the decision about whether to
 * send, and the record afterwards.
 *
 * Three outcomes rather than two:
 *   'sent'      — the provider accepted it.
 *   'simulated' — dev tools are on, so nothing left the building, but the
 *                 timeline was written anyway. That matches what the composer's
 *                 own simulate path does (see `sendEmailAction` above): on a
 *                 server in simulation mode the record is what makes the flow
 *                 observable, and no real customer is being misled because no
 *                 real customer is on that server.
 *   'skipped'   — nowhere to send (no address) or no way to (unconfigured, or the
 *                 provider refused). Completing the order must never fail because
 *                 the courtesy email could not go.
 */
export async function sendFinalInvoiceEmail(
	user: { id: string; name: string; email: string },
	order: {
		id: string;
		projectName: string | null;
		customerName: string;
		customerEmail: string;
		finalNotes: string | null;
	},
	summary: InvoiceSummary
): Promise<'sent' | 'simulated' | 'skipped'> {
	const to = order.customerEmail.trim();
	if (!to) return 'skipped';

	const simulate = isEmailDevToolsEnabled();
	if (!simulate && !isEmailConfigured()) return 'skipped';

	await assertCanWrite(user.id);
	const settings = await getContractorSettings(user.id);
	const businessName = settings.businessName || user.name;

	const rendered = composeInvoiceEmail(order, summary, {
		businessName,
		signature: settings.signature
	});

	if (!simulate) {
		const result = await sendEmail({
			to,
			replyTo: user.email,
			fromName: businessName,
			subject: rendered.subject,
			html: rendered.html,
			text: rendered.text
		});
		if (!result.ok) return 'skipped';
	}

	await recordEmailSent(order.id, user.id, {
		customerName: order.customerName,
		subject: rendered.subject
	});
	return simulate ? 'simulated' : 'sent';
}

/**
 * The invoice email for one order, composed and not sent — what the preview route
 * serves. Kept beside the send path so the two cannot be given different branding
 * or a different renderer by accident.
 */
export async function previewInvoiceEmail(
	user: { id: string; name: string },
	order: InvoiceEmailOrder,
	summary: InvoiceSummary
): Promise<RenderedEmail> {
	const settings = await getContractorSettings(user.id);
	return composeInvoiceEmail(order, summary, {
		businessName: settings.businessName || user.name,
		signature: settings.signature
	});
}
