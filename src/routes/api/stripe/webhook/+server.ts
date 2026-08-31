import { json, text } from '@sveltejs/kit';
import { ENV } from 'varlock/env';
import type Stripe from 'stripe';
import {
	applyStripeSubscription,
	contractorIdForStripe,
	stripeClient
} from '$lib/server/stripe.server';
import type { RequestHandler } from './$types';

/**
 * Stripe's view of the world, written onto the local `subscription` row.
 *
 * Two properties matter here:
 *
 *  - **Authenticity.** The raw body is verified against the signing secret before
 *    anything is parsed. An unsigned request changes nothing.
 *  - **Idempotency.** Every handler writes absolute desired state derived from the
 *    event's subscription object — never an increment — so at-least-once delivery
 *    and out-of-order retries converge on the same answer.
 */

const HANDLED = new Set([
	'checkout.session.completed',
	'customer.subscription.created',
	'customer.subscription.updated',
	'customer.subscription.deleted',
	'invoice.payment_failed'
]);

export const POST: RequestHandler = async ({ request }) => {
	const stripe = stripeClient();
	const secret = ENV.STRIPE_WEBHOOK_SECRET;
	if (!stripe || !secret) {
		// Billing isn't configured; nothing to do but don't pretend it worked.
		return text('Billing not configured', { status: 503 });
	}

	const signature = request.headers.get('stripe-signature');
	if (!signature) return text('Missing signature', { status: 400 });

	// Read the RAW body. Parsing first would break signature verification.
	const raw = await request.text();

	let event: Stripe.Event;
	try {
		event = await stripe.webhooks.constructEventAsync(raw, signature, secret);
	} catch (err) {
		// A bad signature is a client error: never retry, never mutate.
		console.error('[stripe] signature verification failed:', err);
		return text('Invalid signature', { status: 400 });
	}

	if (!HANDLED.has(event.type)) {
		// Acknowledge so Stripe stops resending events we don't act on.
		return json({ received: true, ignored: event.type });
	}

	try {
		await reduce(stripe, event);
	} catch (err) {
		// A genuine failure — let Stripe retry.
		console.error(`[stripe] failed to apply ${event.type} (${event.id}):`, err);
		return text('Handler failed', { status: 500 });
	}

	return json({ received: true });
};

async function reduce(stripe: Stripe, event: Stripe.Event): Promise<void> {
	switch (event.type) {
		case 'checkout.session.completed': {
			const session = event.data.object as Stripe.Checkout.Session;
			const contractorId = await contractorIdForStripe(
				session.client_reference_id,
				typeof session.customer === 'string' ? session.customer : session.customer?.id
			);
			if (!contractorId || !session.subscription) return;
			// Re-read the subscription rather than trusting the session snapshot, so
			// a replayed or late event still writes the CURRENT state.
			const subId =
				typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
			const sub = await stripe.subscriptions.retrieve(subId);
			await applyStripeSubscription(contractorId, sub);
			return;
		}

		case 'customer.subscription.created':
		case 'customer.subscription.updated':
		case 'customer.subscription.deleted': {
			const sub = event.data.object as Stripe.Subscription;
			const contractorId = await contractorIdForStripe(
				sub.metadata?.contractorId,
				typeof sub.customer === 'string' ? sub.customer : sub.customer.id
			);
			if (!contractorId) return;
			await applyStripeSubscription(contractorId, sub);
			return;
		}

		case 'invoice.payment_failed': {
			const invoice = event.data.object as Stripe.Invoice;
			const subRef = (invoice as unknown as { subscription?: string | Stripe.Subscription })
				.subscription;
			if (!subRef) return;
			const subId = typeof subRef === 'string' ? subRef : subRef.id;
			// Read the subscription back and apply its status, rather than assuming
			// `past_due` — by the time a retry of this event lands, Stripe may have
			// recovered the payment or given up entirely.
			const sub = await stripe.subscriptions.retrieve(subId);
			const contractorId = await contractorIdForStripe(
				sub.metadata?.contractorId,
				typeof sub.customer === 'string' ? sub.customer : sub.customer.id
			);
			if (!contractorId) return;
			await applyStripeSubscription(contractorId, sub);
			return;
		}
	}
}
