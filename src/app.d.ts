import type { User, Session } from 'better-auth';
import type { UserRole } from '$lib/crm';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			user?: User & { role: UserRole };
			session?: Session;
			/**
			 * Development-only: the contractor is viewing one of their own customers'
			 * portals. `user` is UNCHANGED — still the contractor's own session and
			 * role. Every write is refused while this is set.
			 * See src/lib/server/view-as.server.ts and ADR-0008.
			 */
			viewAs?: { customerId: string; customerName: string };
		}

		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
