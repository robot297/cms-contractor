/**
 * Browser-side error reporting. The mirror of the Sentry block in
 * hooks.server.ts, initialised from the same shared options so the two ends
 * cannot drift apart on what they scrub.
 *
 * The DSN reaches the browser because it is not marked `@sensitive` in
 * .env.schema, so varlock inlines it into the client bundle. That is correct: a
 * DSN says where to report, it does not grant anything.
 */
import type { HandleClientError } from '@sveltejs/kit';
import * as Sentry from '@sentry/sveltekit';
import { sentryEnabled, sentryOptions } from '$lib/sentry';

if (sentryEnabled) {
	Sentry.init({
		...sentryOptions(),
		integrations: [
			// Replays are deliberately NOT enabled. This app's screens are full of
			// customer names, addresses and message threads, and a session recording
			// would ship all of it to a third party — the exact thing $lib/sentry
			// takes care to keep out of an event payload.
			Sentry.browserTracingIntegration()
		]
	});
}

/**
 * Kept on both paths: defining this hook replaces SvelteKit's own client-side
 * error logging, so dropping it would make an unreported error vanish from the
 * browser console as well — the one place a developer is certain to look.
 */
const logClientError: HandleClientError = ({ error, event }) => {
	console.error(`✗ ${event.url.pathname}`, error);
};

export const handleError: HandleClientError = sentryEnabled
	? Sentry.handleErrorWithSentry(logClientError)
	: logClientError;
