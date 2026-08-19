/**
 * Shared Sentry setup for both halves of the app.
 *
 * The client and the server each call `Sentry.init` in their own hooks file, but
 * they init with the SAME options from here — otherwise the two ends drift, and
 * the usual way that shows up is a scrubbing rule that was only ever applied to
 * one of them.
 *
 * Reporting is opt-in and degrades to nothing: with `SENTRY_DSN` blank the SDK is
 * never initialised, errors go to the console exactly as they did before, and no
 * surface changes. That matches how every other integration here behaves when
 * unconfigured (Stripe, Resend, Turnstile, the ID-scan fallback).
 */
import { ENV } from 'varlock/env';
import type { ErrorEvent } from '@sentry/sveltekit';

/**
 * Whether to report at all. Blank in development, and blank is a valid, quiet
 * configuration rather than a misconfiguration to warn about.
 */
export const sentryEnabled = Boolean(ENV.SENTRY_DSN?.trim());

/**
 * Request headers that must never leave the building. `sendDefaultPii: false`
 * already withholds most of this, but the list is spelled out rather than
 * assumed: these carry live session credentials, and a default changing under us
 * in a minor SDK release is not a risk worth taking with them.
 */
const CREDENTIAL_HEADERS = ['cookie', 'authorization', 'set-cookie', 'x-api-key'];

/**
 * Query parameters that carry a capability rather than a lookup — anyone holding
 * one can act as somebody else, so they are redacted out of reported URLs.
 */
const CAPABILITY_PARAMS = ['token', 'invite', 'code', 'secret', 'key', 'signature'];

/** Replace the value of any capability parameter in a URL, leaving the path intact. */
function redactUrl(url: string): string {
	// Errors carry all sorts of things in a `url` field, not all of them URLs, so
	// an unparseable value is passed through rather than thrown away.
	try {
		const parsed = new URL(url, 'http://placeholder.invalid');
		let touched = false;
		for (const param of CAPABILITY_PARAMS) {
			if (parsed.searchParams.has(param)) {
				parsed.searchParams.set(param, '[redacted]');
				touched = true;
			}
		}
		if (!touched) return url;
		return url.startsWith('http') ? parsed.toString() : parsed.pathname + parsed.search;
	} catch {
		return url;
	}
}

/**
 * Last gate before an event leaves the process.
 *
 * This app's records are almost entirely other people's personal information —
 * customer names, addresses, phone numbers, and the messages between them and
 * their contractor. None of that is ours to forward to a third party because a
 * loader threw, so the posture is deliberately strict: identify WHICH user hit
 * the error, never WHO they are. The user id and role are enough to find the
 * account in the database; the name and email add nothing to a stack trace that
 * a lookup can't supply.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
	if (event.request) {
		if (event.request.headers) {
			for (const header of Object.keys(event.request.headers)) {
				if (CREDENTIAL_HEADERS.includes(header.toLowerCase())) {
					event.request.headers[header] = '[redacted]';
				}
			}
		}
		// Form fields and JSON bodies are the single richest source of customer PII
		// in the app — a submitted order, a message, an address. Never reported.
		delete event.request.data;
		delete event.request.cookies;
		if (event.request.url) event.request.url = redactUrl(event.request.url);
		if (event.request.query_string) event.request.query_string = '[redacted]';
	}

	if (event.user) {
		// Whitelist, not blacklist: a future SDK version adding another identifying
		// field shouldn't silently start reporting it.
		event.user = { id: event.user.id, ...(event.user.role ? { role: event.user.role } : {}) };
	}

	if (event.breadcrumbs) {
		for (const crumb of event.breadcrumbs) {
			if (typeof crumb.data?.url === 'string') crumb.data.url = redactUrl(crumb.data.url);
		}
	}

	return event;
}

/**
 * Options shared by the client and server SDKs.
 *
 * `tracesSampleRate` governs performance traces only — errors are sent whatever
 * it is set to, so turning tracing down to control cost never costs visibility
 * into failures.
 */
export function sentryOptions() {
	return {
		dsn: ENV.SENTRY_DSN!.trim(),
		environment: ENV.SENTRY_ENVIRONMENT?.trim() || undefined,
		tracesSampleRate: ENV.SENTRY_TRACES_SAMPLE_RATE ?? 0.1,
		// The scrubbing above is the safety net; this is the thing that stops IPs and
		// session cookies being attached in the first place. Leave it off.
		sendDefaultPii: false,
		beforeSend: scrubEvent
	};
}
