import { eq } from 'drizzle-orm';
import { APIError } from 'better-auth/api';
import { env } from '$env/dynamic/private';
import { db } from './db';
import {
	user,
	customer,
	customerInvite,
	order,
	orderSubcontractor,
	subcontractor,
	subcontractorInvite,
	timelineEntry,
	notification,
	emailTemplate,
	contractorSettings
} from './db/schema';
import { auth } from './auth';
import { compSubscription } from './billing.server';
import { STARTER_EMAIL_TEMPLATES } from '$lib/crm';
// Single source of truth for the sample data — shared with scripts/seed.mjs.
import {
	DEMO_CUSTOMERS,
	DEMO_ORDERS,
	DEMO_NOTIFICATIONS,
	DEMO_SUBCONTRACTORS,
	DEMO_ASSIGNMENTS
} from '../../../scripts/demo-fixtures.js';

/**
 * A shared, self-provisioning demo contractor. The "Explore the live demo"
 * button on /login signs into THIS account, so a visitor experiences the full
 * contractor app — real routes, real guards, real queries — without signing up.
 *
 * It is safe to expose publicly: the account is scoped like any other
 * contractor (it can never see real customers) and holds only sample data,
 * which is re-seeded on every entry so each visitor gets a pristine tour. Turn
 * the whole feature off by setting DEMO_MODE=false in the environment.
 */
export const DEMO_CONTRACTOR = {
	email: 'demo@contractor-crm.app',
	// Intentionally shared and non-secret — this login only ever holds demo data.
	password: 'explore-the-demo-2026',
	name: 'Demo Contractor'
} as const;

/** Demo mode is on unless explicitly disabled. */
export function isDemoEnabled(): boolean {
	return env.DEMO_MODE !== 'false';
}

/**
 * Whether a signed-in account IS the shared demo login. Used to refuse the
 * abilities a public shared account must not have — sending real email, above
 * all — while everything else behaves like a normal contractor.
 */
export function isDemoUser(email: string): boolean {
	return email === DEMO_CONTRACTOR.email;
}

/**
 * Provision (if needed) and re-seed the demo contractor, then hand back its
 * credentials so the caller can establish a session the normal way. Throws if
 * the account can't be provisioned.
 */
export async function prepareDemoSession(): Promise<{ email: string; password: string }> {
	const contractorId = await ensureDemoContractor();
	await seedDemoData(contractorId);
	return { email: DEMO_CONTRACTOR.email, password: DEMO_CONTRACTOR.password };
}

/** Create the demo login if it doesn't exist yet; return its user id. */
async function ensureDemoContractor(): Promise<string> {
	const existing = await findDemoUserId();
	if (existing) {
		// Keep the account verified even if it predates verification enforcement —
		// otherwise the public demo would bounce off the verify-email gate, and its
		// address is ours, not something a visitor can click a link for.
		await db.update(user).set({ emailVerified: true }).where(eq(user.id, existing));
		return existing;
	}

	try {
		// Goes through Better Auth so the password is hashed exactly like a real
		// sign-up. No headers passed — we don't want this to set a session cookie;
		// the caller signs in explicitly afterwards.
		await auth.api.signUpEmail({
			body: {
				email: DEMO_CONTRACTOR.email,
				password: DEMO_CONTRACTOR.password,
				name: DEMO_CONTRACTOR.name,
				role: 'contractor'
			}
		});
	} catch (error) {
		// A concurrent demo entry may have created it first — tolerate that and
		// re-read below. Any non-API error is a real failure.
		if (!(error instanceof APIError)) throw error;
	}

	const id = await findDemoUserId();
	if (!id) throw new Error('Demo contractor could not be provisioned');
	// Self-signup already defaults to contractor; enforce it in case that changes.
	// Verified by fiat: the demo address is ours and never receives a link.
	await db.update(user).set({ role: 'contractor', emailVerified: true }).where(eq(user.id, id));
	// Comp the demo permanently. Provisioned fresh it would otherwise start a
	// 14-day trial and the public demo would silently lapse two weeks later. Note
	// that `seedDemoData` deliberately does not touch the subscription row, so a
	// re-seed cannot reset billing state either.
	await compSubscription(id);
	return id;
}

async function findDemoUserId(): Promise<string | undefined> {
	const row = await db.query.user.findFirst({
		where: eq(user.email, DEMO_CONTRACTOR.email),
		columns: { id: true }
	});
	return row?.id;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(Date.now() + n * DAY_MS);
/** Same day, at noon — safe from either end of a calendar-day query. */
const atMidday = (d: Date) => {
	const copy = new Date(d);
	copy.setHours(12, 0, 0, 0);
	return copy;
};

/** Wipe and rebuild the demo contractor's data so every entry is a fresh tour. */
async function seedDemoData(contractorId: string): Promise<void> {
	// Deleting orders cascades their timeline entries; notifications are cleared
	// by owner since some aren't tied to an order.
	await db.delete(order).where(eq(order.contractorId, contractorId));
	await db.delete(customer).where(eq(customer.contractorId, contractorId));
	// Deleting subcontractors cascades their assignments + pending invites.
	await db.delete(subcontractor).where(eq(subcontractor.contractorId, contractorId));
	await db.delete(notification).where(eq(notification.userId, contractorId));
	// Rebuild the demo's email templates + branding so every tour starts clean.
	await db.delete(emailTemplate).where(eq(emailTemplate.contractorId, contractorId));
	await db.delete(contractorSettings).where(eq(contractorSettings.contractorId, contractorId));

	await db.insert(emailTemplate).values(
		STARTER_EMAIL_TEMPLATES.map((t, i) => ({
			contractorId,
			name: t.name,
			subject: t.subject,
			body: t.body,
			sortOrder: i
		}))
	);
	await db.insert(contractorSettings).values({
		contractorId,
		businessName: 'Summit Structures',
		signature: 'Thanks so much,\n{{contractor}}\n(555) 200-0100',
		// The demo arrives with customers, orders and invites already seeded, so every
		// guide step would show pre-ticked — a "get started" card with nothing to do.
		// Suppress it here rather than special-casing demo mode in the UI; the support
		// page still has it for anyone curious.
		guideState: 'dismissed'
	});

	const idByKey = new Map<string, string>();
	for (const c of DEMO_CUSTOMERS) {
		const id = crypto.randomUUID();
		idByKey.set(c.key, id);
		await db.insert(customer).values({
			id,
			contractorId,
			name: c.name,
			email: c.email,
			phone: c.phone,
			address: c.address,
			city: c.city,
			state: c.state,
			postalCode: c.postalCode,
			notes: c.notes,
			avatar: c.avatar,
			preferredContact: c.preferredContact
		});
	}

	// A couple of pending customer app-invites so the Customers pane's invites
	// panel has something to show: one still active, one already expired.
	const demoInvites = [
		{ key: 'luis', email: 'luis.ortega@example.com', expiresInDays: 1 },
		{ key: 'nina', email: 'nina.brooks@example.com', expiresInDays: -1 }
	];
	for (const inv of demoInvites) {
		await db.insert(customerInvite).values({
			contractorId,
			customerId: idByKey.get(inv.key),
			customerEmail: inv.email,
			token: crypto.randomUUID(),
			status: 'pending',
			expiresAt: inDays(inv.expiresInDays)
		});
	}

	const orderIdByProject = new Map<string, string>();
	for (const o of DEMO_ORDERS) {
		const orderId = crypto.randomUUID();
		orderIdByProject.set(o.project, orderId);
		await db.insert(order).values({
			id: orderId,
			contractorId,
			customerId: idByKey.get(o.cust),
			projectName: o.project,
			projectType: o.type,
			icon: o.icon ?? null,
			state: o.state,
			nextFollowUpAt: o.followUpDays === null ? null : inDays(o.followUpDays),
			// The day the crew is on site. `inDays` lands at the current time of day,
			// which is fine for a follow-up but wrong for this: `visitsOn` queries a
			// calendar day, so a visit seeded at 23:50 on the boundary would fall
			// into the wrong one. Normalised to local midday.
			visitDate: o.visitDays == null ? null : atMidday(inDays(o.visitDays))
		});
		// A customer-visible status entry...
		await db.insert(timelineEntry).values({
			orderId,
			kind: 'status',
			title: o.state,
			detail: '',
			authorRole: 'contractor',
			internal: false
		});
		// ...plus any contractor-only internal notes.
		for (const note of o.notes ?? []) {
			await db.insert(timelineEntry).values({
				orderId,
				kind: 'note',
				title: 'Note',
				detail: note,
				authorRole: 'contractor',
				internal: true
			});
		}
	}

	// Subcontractors (one Trusted, one Guest) + a pending invite for the Guest.
	const subIdByKey = new Map<string, string>();
	for (const s of DEMO_SUBCONTRACTORS) {
		const id = crypto.randomUUID();
		subIdByKey.set(s.key, id);
		await db.insert(subcontractor).values({
			id,
			contractorId,
			name: s.name,
			email: s.email,
			phone: s.phone,
			company: s.company,
			trade: s.trade,
			tier: s.tier,
			licenseNumber: s.licenseNumber,
			insuranceCarrier: s.insuranceCarrier,
			insuranceExpiresAt: s.insuranceDays === null ? null : inDays(s.insuranceDays),
			notes: s.notes,
			avatar: s.avatar
		});
		if (s.invited) {
			await db.insert(subcontractorInvite).values({
				subcontractorId: id,
				contractorId,
				subcontractorEmail: s.email,
				token: crypto.randomUUID(),
				status: 'pending',
				expiresAt: inDays(1)
			});
		}
	}

	// Assign subcontractors to orders (many-to-many).
	for (const a of DEMO_ASSIGNMENTS) {
		const orderId = orderIdByProject.get(a.order);
		const subcontractorId = subIdByKey.get(a.sub);
		if (orderId && subcontractorId) {
			await db.insert(orderSubcontractor).values({ orderId, subcontractorId });
		}
	}

	// A couple of unread notifications for the bell.
	await db.insert(notification).values(
		DEMO_NOTIFICATIONS.map((n) => ({
			userId: contractorId,
			title: n.title,
			detail: n.detail,
			priority: n.priority,
			unread: true
		}))
	);
}
