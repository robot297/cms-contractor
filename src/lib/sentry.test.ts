/**
 * The scrubber is the one part of the Sentry integration worth testing: it is
 * what stands between a stack trace and a third party receiving a customer's
 * address, and unlike the rest of the setup its failure mode is silent. Nothing
 * about a leaked field looks wrong from inside the app.
 *
 * `sentryOptions()` is deliberately not tested — it reads ENV, and the same
 * reasoning as email.server.test.ts applies.
 */
import { describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/sveltekit';
import { scrubEvent } from './sentry';

/** An event shaped like the ones the SDK actually produces, plus overrides. */
function event(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
	return { type: undefined, ...overrides } as ErrorEvent;
}

describe('scrubEvent', () => {
	describe('credentials', () => {
		it('redacts the session cookie header', () => {
			const scrubbed = scrubEvent(
				event({ request: { headers: { cookie: 'better-auth.session_token=abc123' } } })
			);
			expect(scrubbed?.request?.headers?.cookie).toBe('[redacted]');
		});

		it('redacts credential headers whatever their casing', () => {
			// Node lowercases incoming headers, but events are also built by hand in
			// places, and a capitalised `Authorization` is still a bearer token.
			const scrubbed = scrubEvent(
				event({ request: { headers: { Authorization: 'Bearer sk_live_1', 'X-Api-Key': 'k' } } })
			);
			expect(scrubbed?.request?.headers).toEqual({
				Authorization: '[redacted]',
				'X-Api-Key': '[redacted]'
			});
		});

		it('leaves ordinary headers alone', () => {
			const scrubbed = scrubEvent(
				event({ request: { headers: { 'user-agent': 'Firefox', referer: '/contractor' } } })
			);
			expect(scrubbed?.request?.headers).toEqual({
				'user-agent': 'Firefox',
				referer: '/contractor'
			});
		});
	});

	describe('request bodies', () => {
		it('drops the submitted data entirely', () => {
			// A failed "add customer" action carries the whole customer in `data`.
			const scrubbed = scrubEvent(
				event({
					request: { data: { name: 'Dana Whitfield', email: 'dana@example.com', phone: '555' } }
				})
			);
			expect(scrubbed?.request?.data).toBeUndefined();
		});

		it('drops parsed cookies and the raw query string', () => {
			const scrubbed = scrubEvent(
				event({
					request: { cookies: { 'better-auth.session_token': 'abc' }, query_string: 'token=xyz' }
				})
			);
			expect(scrubbed?.request?.cookies).toBeUndefined();
			expect(scrubbed?.request?.query_string).toBe('[redacted]');
		});
	});

	describe('urls', () => {
		it('redacts an invite token while keeping the path', () => {
			// The path is the whole diagnostic value; the token is a capability that
			// would let whoever read the issue bind the customer's account.
			const scrubbed = scrubEvent(
				event({ request: { url: 'https://app.example.com/invite?token=secret-token-value' } })
			);
			expect(scrubbed?.request?.url).toBe('https://app.example.com/invite?token=%5Bredacted%5D');
		});

		it('keeps a url that carries no capability', () => {
			const url = 'https://app.example.com/contractor/orders/8f2a?view=completed';
			expect(scrubEvent(event({ request: { url } }))?.request?.url).toBe(url);
		});

		it('passes through a url it cannot parse rather than discarding it', () => {
			const scrubbed = scrubEvent(event({ request: { url: 'not a url at all' } }));
			expect(scrubbed?.request?.url).toBe('not a url at all');
		});

		it('redacts capability params in breadcrumb urls too', () => {
			// Navigation breadcrumbs record the URLs visited before the error, so the
			// token would arrive by that route even with the request URL clean.
			const scrubbed = scrubEvent(
				event({ breadcrumbs: [{ data: { url: '/verify-email?code=123456' } }] })
			);
			expect(scrubbed?.breadcrumbs?.[0].data?.url).toBe('/verify-email?code=%5Bredacted%5D');
		});
	});

	describe('user identity', () => {
		it('keeps the id and role, and nothing else', () => {
			const scrubbed = scrubEvent(
				event({
					user: {
						id: 'user_123',
						role: 'contractor',
						email: 'dana@example.com',
						username: 'dana',
						ip_address: '203.0.113.4'
					}
				})
			);
			expect(scrubbed?.user).toEqual({ id: 'user_123', role: 'contractor' });
		});

		it('omits the role rather than reporting an empty one', () => {
			const scrubbed = scrubEvent(event({ user: { id: 'user_123' } }));
			expect(scrubbed?.user).toEqual({ id: 'user_123' });
		});
	});

	it('reports an event that carries nothing sensitive', () => {
		// The scrubber withholds fields; it must never swallow the event itself.
		const bare = event({ request: { url: 'https://app.example.com/contractor' } });
		expect(scrubEvent(bare)).not.toBeNull();
	});
});
