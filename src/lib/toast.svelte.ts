export type ToastTone = 'success' | 'error' | 'info';

export type Toast = {
	id: number;
	message: string;
	/** Optional second line — the consequence, when it's worth stating separately. */
	detail?: string;
	tone: ToastTone;
	durationMs: number;
};

/** Long enough to read two short lines without hunting for the dismiss. */
export const TOAST_DEFAULT_MS = 5000;

/**
 * Transient confirmations, rendered once by `<Toaster />` in the contractor layout.
 *
 * It lives outside the components that raise it on purpose. The first version of
 * the send confirmation rendered inside the contact composer, which meant a
 * "message sent" notice appeared underneath the still-open channel picker of the
 * widget that had just sent it — the card had to stay mounted to show that its own
 * job was finished. A toast lets the composer close immediately and say so after.
 *
 * Deliberately not persisted and not queued beyond a cap: these confirm something
 * the user just did, and anything that needs to survive a reload belongs on a
 * record, not here.
 */
class ToastStore {
	toasts = $state<Toast[]>([]);

	/** Beyond this, the oldest is dropped — a stack taller than this obscures the app. */
	private static readonly MAX = 3;
	private nextId = 1;
	private timers = new Map<number, ReturnType<typeof setTimeout>>();

	show(message: string, options: { detail?: string; tone?: ToastTone; durationMs?: number } = {}) {
		const toast: Toast = {
			id: this.nextId++,
			message,
			detail: options.detail,
			tone: options.tone ?? 'info',
			durationMs: options.durationMs ?? TOAST_DEFAULT_MS
		};
		this.toasts = [...this.toasts, toast].slice(-ToastStore.MAX);
		this.timers.set(
			toast.id,
			setTimeout(() => this.dismiss(toast.id), toast.durationMs)
		);
		return toast.id;
	}

	success(message: string, options: { detail?: string; durationMs?: number } = {}) {
		return this.show(message, { ...options, tone: 'success' });
	}

	error(message: string, options: { detail?: string; durationMs?: number } = {}) {
		return this.show(message, { ...options, tone: 'error' });
	}

	dismiss(id: number) {
		const timer = this.timers.get(id);
		if (timer) clearTimeout(timer);
		this.timers.delete(id);
		this.toasts = this.toasts.filter((t) => t.id !== id);
	}
}

export const toast = new ToastStore();
