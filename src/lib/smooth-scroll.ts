/**
 * A short, eased, INTERRUPTIBLE scroll — the motion behind the A–Z jump rails.
 *
 * Neither native behaviour works for a scrubbed rail:
 *
 *   `behavior: 'auto'`   teleports. The rail fires on every pointer move, so a
 *                        finger dragged down it repaints the whole directory
 *                        dozens of times a second with no sense of travel — you
 *                        arrive somewhere without ever having gone there.
 *   `behavior: 'smooth'` queues. Each call starts a fresh animation with the
 *                        browser's own duration, so a scrub stacks dozens of
 *                        competing tweens; the list lurches, lags behind the
 *                        finger, and keeps moving after it stops.
 *
 * So this is exponential smoothing towards a target that is allowed to move,
 * which is the trick every "smooth scroll" library is built on. Each frame
 * closes a fixed FRACTION of the remaining distance rather than stepping a fixed
 * amount, which gives motion that starts immediately (responsive), decelerates
 * into place (natural), and — the part that matters here — retargets for free:
 * a new letter mid-flight just moves the target, and the scroll bends towards it
 * instead of restarting. Dragging the rail feels like pulling the list along.
 *
 * Frame-rate independent: the per-frame fraction is derived from elapsed time,
 * so a 120Hz phone and a 60Hz laptop take the same wall-clock time to arrive.
 */

/** Time to close ~63% of the distance. Small enough to feel immediate. */
const TIME_CONSTANT_MS = 78;

/** Below this the remaining distance is not worth another frame. */
const SETTLE_PX = 0.5;

type Runner = {
	container: HTMLElement | Window;
	target: number;
	frame: number;
	stop: () => void;
};

/** At most one scroll is ever animating; a new target steers the one in flight. */
let active: Runner | null = null;

function scrollTopOf(c: HTMLElement | Window): number {
	return c instanceof Window ? c.scrollY : c.scrollTop;
}

function maxScrollOf(c: HTMLElement | Window): number {
	return c instanceof Window
		? Math.max(0, document.documentElement.scrollHeight - c.innerHeight)
		: Math.max(0, c.scrollHeight - c.clientHeight);
}

function scrollToTop(c: HTMLElement | Window, top: number): void {
	if (c instanceof Window) c.scrollTo(0, top);
	else c.scrollTop = top;
}

/**
 * The element that actually scrolls for `el` — the nearest ancestor with its own
 * overflow, or the window. Walking up rather than assuming the page scrolls:
 * these directories are inside a layout that has changed shape more than once.
 */
function scrollParent(el: HTMLElement): HTMLElement | Window {
	for (let node = el.parentElement; node; node = node.parentElement) {
		const { overflowY } = getComputedStyle(node);
		const scrollable = overflowY === 'auto' || overflowY === 'scroll';
		if (scrollable && node.scrollHeight > node.clientHeight) return node;
	}
	return window;
}

export function cancelSmoothScroll(): void {
	active?.stop();
}

/**
 * Scroll `el` to the top of its scroll container, `offset` px below it.
 *
 * `ignore` is the control doing the scrolling — the rail. Interaction anywhere
 * else cancels the animation, because a scroll the user started themselves must
 * always win; touches on the rail itself are what is driving this and must not.
 */
export function smoothScrollIntoView(
	el: HTMLElement,
	{ offset = 0, ignore }: { offset?: number; ignore?: HTMLElement | null } = {}
): void {
	const container = scrollParent(el);
	const current = scrollTopOf(container);

	// Measured against the container's own top, not the viewport's, so this is
	// correct whether the page scrolls or a panel inside it does.
	const containerTop = container instanceof Window ? 0 : container.getBoundingClientRect().top;
	const target = Math.max(
		0,
		Math.min(
			maxScrollOf(container),
			current + el.getBoundingClientRect().top - containerTop - offset
		)
	);

	// Someone who has asked for less motion is asking for exactly the teleport
	// this module exists to avoid — and should still get it.
	if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
		active?.stop();
		scrollToTop(container, target);
		return;
	}

	// Already flying towards this container: just steer it. No new loop, no
	// second tween racing the first.
	if (active && active.container === container) {
		active.target = target;
		return;
	}

	active?.stop();

	const onInterrupt = (e: Event) => {
		if (ignore && e.target instanceof Node && ignore.contains(e.target)) return;
		runner.stop();
	};

	const runner: Runner = {
		container,
		target,
		frame: 0,
		stop() {
			cancelAnimationFrame(runner.frame);
			window.removeEventListener('wheel', onInterrupt);
			window.removeEventListener('touchstart', onInterrupt);
			window.removeEventListener('keydown', onInterrupt);
			if (active === runner) active = null;
		}
	};
	active = runner;

	window.addEventListener('wheel', onInterrupt, { passive: true });
	window.addEventListener('touchstart', onInterrupt, { passive: true });
	window.addEventListener('keydown', onInterrupt);

	let last = performance.now();
	const step = (now: number) => {
		// Clamped: a backgrounded tab hands back a gap of seconds, and an unclamped
		// one would resolve to a fraction of 1 — the teleport again.
		const dt = Math.min(64, now - last);
		last = now;

		const from = scrollTopOf(runner.container);
		const remaining = runner.target - from;
		if (Math.abs(remaining) < SETTLE_PX) {
			scrollToTop(runner.container, runner.target);
			runner.stop();
			return;
		}
		scrollToTop(runner.container, from + remaining * (1 - Math.exp(-dt / TIME_CONSTANT_MS)));
		runner.frame = requestAnimationFrame(step);
	};
	runner.frame = requestAnimationFrame(step);
}
