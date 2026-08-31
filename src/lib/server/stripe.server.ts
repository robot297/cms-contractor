import Stripe from 'stripe';
import { ENV } from 'varlock/env';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { subscription } from './db/schema';
import { getSubscription } from './billing.server';
import { mapProviderStatus, type SubscriptionStatus } from '$lib/crm';

/**
 * Everything that talks to Stripe. Nothing in here is called while rendering a
 * contractor surface — gating reads the local `subscription` row — so a Stripe
 * outage never becomes an outage of the CRM.
 *
 * The integration is deliberately as small as it can be: hosted Checkout to
 * subscribe, the hosted Billing Portal for card changes / invoices / cancellation,
 * and one webhook to keep the local row in step. No card data touches this app.
 */

export type BillingInterval = 'monthly' | 'annual';

let client: Stripe | null = null;

/** The Stripe client, or null when billing isn't configured (e.g. local dev). */
export function stripeClient(): Stripe | null {
	const key = ENV.STRIPE_SECRET_KEY;
	if (!key) return null;
	client ??= new Stripe(key);
	return client;
}

/** Whether checkout can be offered at all. False in dev with no keys set. */
export function isBillingConfigured(): boolean {
	return Boolean(ENV.STRIPE_SECRET_KEY && (ENV.STRIPE_PRICE_MONTHLY || ENV.STRIPE_PRICE_ANNUAL));
}

export function priceIdFor(interval: BillingInterval): string | undefined {
	return interval === 'annual' ? ENV.STRIPE_PRICE_ANNUAL : ENV.STRIPE_PRICE_MONTHLY;
}

export class BillingUnavailableError extends Error {
	constructor(detail = 'Billing is not configured') {
		super(detail);
		this.name = 'BillingUnavailableError';
	}
}

function originUrl(path: string): string {
	const origin = ENV.ORIGIN ?? 'http://localhost:5173';
	return new URL(path, origin).toString();
}

/** Stripe's status, mapped by the pure rule in `$lib/crm` (which is unit-tested). */
export function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
	return mapProviderStatus(status);
}

/**
 * Find or create this contractor's Stripe customer.
 *
 * Created on first checkout rather than at signup, so a trial that never converts
 * leaves no Stripe record behind and costs nothing.
 */
async function ensureStripeCustomer(
	stripe: Stripe,
	contractorId: string,
	email: string,
	name: string | null
): Promise<string> {
	const existing = await getSubscription(contractorId);
	if (existing?.stripeCustomerId) return existing.stripeCustomerId;

	const customer = await stripe.customers.create({
		email,
		name: name ?? undefined,
		// Lets us recover the contractor from any Stripe object, including events
		// that arrive without our client_reference_id.
		metadata: { contractorId }
	});
	await db
		.update(subscription)
		.set({ stripeCustomerId: customer.id, updatedAt: new Date() })
		.where(eq(subscription.contractorId, contractorId));
	return customer.id;
}

/** Start a hosted Checkout session. Returns the URL to redirect the browser to. */
export async function createCheckoutSession(
	contractorId: string,
	interval: BillingInterval,
	contractor: { email: string; name: string | null }
): Promise<string> {
	const stripe = stripeClient();
	if (!stripe) throw new BillingUnavailableError();
	const price = priceIdFor(interval);
	if (!price) throw new BillingUnavailableError(`No Stripe price configured for ${interval}`);

	const customerId = await ensureStripeCustomer(
		stripe,
		contractorId,
		contractor.email,
		contractor.name
	);
	const session = await stripe.checkout.sessions.create({
		mode: 'subscription',
		customer: customerId,
		line_items: [{ price, quantity: 1 }],
		client_reference_id: contractorId,
		subscription_data: { metadata: { contractorId } },
		success_url: originUrl('/contractor/billing?checkout=success'),
		cancel_url: originUrl('/contractor/billing?checkout=cancelled')
	});
	if (!session.url) throw new BillingUnavailableError('Stripe returned no checkout URL');
	return session.url;
}

/**
 * Open the hosted Billing Portal — card changes, invoices, switching monthly to
 * annual, and cancellation all live there so this app builds none of it.
 */
export async function createPortalSession(contractorId: string): Promise<string> {
	const stripe = stripeClient();
	if (!stripe) throw new BillingUnavailableError();
	const row = await getSubscription(contractorId);
	if (!row?.stripeCustomerId) throw new BillingUnavailableError('No billing account yet');

	const session = await stripe.billingPortal.sessions.create({
		customer: row.stripeCustomerId,
		return_url: originUrl('/contractor/billing')
	});
	return session.url;
}

/**
 * Write a Stripe subscription's current state onto the local row.
 *
 * Absolute state, never an increment — so a webhook delivered twice, or out of
 * order, converges on the same answer. Shared by the webhook reducer and by
 * reconciliation.
 */
export async function applyStripeSubscription(
	contractorId: string,
	sub: Stripe.Subscription
): Promise<void> {
	// Stripe moved period fields onto the subscription items in recent API
	// versions; fall back so both shapes work.
	const periodEnd =
		(sub as unknown as { current_period_end?: number }).current_period_end ??
		sub.items?.data?.[0]?.current_period_end;

	await db
		.update(subscription)
		.set({
			status: mapStripeStatus(sub.status),
			stripeSubscriptionId: sub.id,
			stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
			currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
			updatedAt: new Date()
		})
		.where(eq(subscription.contractorId, contractorId));
}

/** Resolve the contractor a Stripe object belongs to, by metadata then by customer id. */
export async function contractorIdForStripe(
	metadataContractorId: string | null | undefined,
	stripeCustomerId: string | null | undefined
): Promise<string | null> {
	if (metadataContractorId) return metadataContractorId;
	if (!stripeCustomerId) return null;
	const [row] = await db
		.select({ contractorId: subscription.contractorId })
		.from(subscription)
		.where(eq(subscription.stripeCustomerId, stripeCustomerId))
		.limit(1);
	return row?.contractorId ?? null;
}

/**
 * Pull the truth from Stripe and write it locally. Called when the billing page
 * loads, so the one surface where drift is visible is also the surface that
 * repairs it — a missed webhook can never leave a contractor permanently stale.
 *
 * Never throws: a Stripe outage must not stop the billing page from rendering.
 */
export async function reconcileFromStripe(contractorId: string): Promise<void> {
	const stripe = stripeClient();
	if (!stripe) return;
	try {
		const row = await getSubscription(contractorId);
		// Comped subscriptions have no Stripe counterpart and must never be
		// overwritten by reconciliation.
		if (!row || row.status === 'comped' || !row.stripeCustomerId) return;

		const subs = await stripe.subscriptions.list({
			customer: row.stripeCustomerId,
			status: 'all',
			limit: 1
		});
		const latest = subs.data[0];
		if (!latest) return;
		await applyStripeSubscription(contractorId, latest);
	} catch (err) {
		console.error('[billing] reconcile failed (serving local state):', err);
	}
}
