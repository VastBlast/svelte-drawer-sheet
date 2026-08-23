import type { DrawerSwipeDirection } from '../types.js';
import { getDisplacement } from './constants.js';

export const AXIS_LOCK_SLOP = 6;
export const AXIS_LOCK_BIAS = 2;
export const MAX_RELEASE_SAMPLE_AGE = 80;

const NAVIGATION_MIN_DRAG = 10;
const NAVIGATION_PROJECTION_TIME = 240;
const NAVIGATION_SETTLE_DURATION = 380;
const NAVIGATION_MIN_SETTLE_DURATION = 160;
const NAVIGATION_MAX_VELOCITY = 3;
const NAVIGATION_EASING_X1 = 0.18;
const NAVIGATION_EASING_X2 = 0.24;

export interface Point {
	readonly x: number;
	readonly y: number;
}

export interface NavigationSwipeRelease {
	readonly dismiss: boolean;
	/** Multiplier for a 380ms consumer transition. */
	readonly strength: number;
	/** A monotonic curve whose initial slope follows velocity toward the chosen destination. */
	readonly easing: string;
}

function navigationSettleEasing(
	targetVelocity: number,
	remaining: number,
	duration: number
): string {
	const normalizedVelocity = remaining > 0 ? (targetVelocity * duration) / remaining : 0;
	const y1 = Math.min(1, Math.max(0, normalizedVelocity * NAVIGATION_EASING_X1));
	return `cubic-bezier(${NAVIGATION_EASING_X1}, ${Number(y1.toFixed(4))}, ${NAVIGATION_EASING_X2}, 1)`;
}

/** Resolves navigation intent from projected momentum and times only the distance left to settle. */
export function resolveNavigationSwipeRelease(
	displacement: number,
	size: number,
	velocity: number
): NavigationSwipeRelease {
	if (!Number.isFinite(size) || size <= 0) {
		return {
			dismiss: false,
			strength: 1,
			easing: navigationSettleEasing(0, 1, NAVIGATION_SETTLE_DURATION)
		};
	}

	const current = Math.min(size, Math.max(0, Number.isFinite(displacement) ? displacement : 0));
	const resolvedVelocity = Math.min(
		NAVIGATION_MAX_VELOCITY,
		Math.max(-NAVIGATION_MAX_VELOCITY, Number.isFinite(velocity) ? velocity : 0)
	);
	const projected = current + resolvedVelocity * NAVIGATION_PROJECTION_TIME;
	const dismiss = current >= NAVIGATION_MIN_DRAG && projected >= size * 0.5;
	const remaining = dismiss ? size - current : current;
	const targetVelocity = dismiss ? Math.max(0, resolvedVelocity) : Math.max(0, -resolvedVelocity);
	if (remaining <= 0) {
		return {
			dismiss,
			strength: NAVIGATION_MIN_SETTLE_DURATION / NAVIGATION_SETTLE_DURATION,
			easing: navigationSettleEasing(targetVelocity, remaining, NAVIGATION_MIN_SETTLE_DURATION)
		};
	}

	const distanceDuration = NAVIGATION_SETTLE_DURATION * Math.sqrt(remaining / size);
	const velocityDuration = targetVelocity > 0 ? (remaining / targetVelocity) * 1.35 : Infinity;
	const duration = Math.min(
		NAVIGATION_SETTLE_DURATION,
		Math.max(NAVIGATION_MIN_SETTLE_DURATION, Math.min(distanceDuration, velocityDuration))
	);

	return {
		dismiss,
		strength: duration / NAVIGATION_SETTLE_DURATION,
		easing: navigationSettleEasing(targetVelocity, remaining, duration)
	};
}

export function eventTime(event: Event): number {
	return Number.isFinite(event.timeStamp) && event.timeStamp > 0 ? event.timeStamp : Date.now();
}

export function movementFor(direction: DrawerSwipeDirection, displacement: number): Point {
	switch (direction) {
		case 'up':
			return { x: 0, y: -displacement };
		case 'down':
			return { x: 0, y: displacement };
		case 'left':
			return { x: -displacement, y: 0 };
		case 'right':
			return { x: displacement, y: 0 };
	}
}

export function safePointerCapture(
	element: HTMLElement,
	pointerId: number,
	method: 'setPointerCapture' | 'releasePointerCapture'
): void {
	try {
		element[method]?.(pointerId);
	} catch (error) {
		if (
			!error ||
			typeof error !== 'object' ||
			!('name' in error) ||
			error.name !== 'NotFoundError'
		) {
			throw error;
		}
	}
}

export function touchPointFromList(
	touches: TouchList,
	id?: number
): { point: Point; id: number } | null {
	for (const touch of touches) {
		if (id === undefined || touch.identifier === id) {
			return { point: { x: touch.clientX, y: touch.clientY }, id: touch.identifier };
		}
	}
	return null;
}

export function touchPoint(event: TouchEvent, id?: number): { point: Point; id: number } | null {
	return touchPointFromList(event.touches, id) ?? touchPointFromList(event.changedTouches, id);
}

/** Reads the element's rendered transform translation along the drawer's dismissal axis. */
export function renderedDirectionalOffset(
	element: HTMLElement,
	direction: DrawerSwipeDirection
): number {
	const view = element.ownerDocument.defaultView;
	if (!view) return 0;
	const transform = view.getComputedStyle(element).transform;
	if (!transform || transform === 'none') return 0;
	try {
		const matrix = new view.DOMMatrixReadOnly(transform);
		return getDisplacement(direction, matrix.m41, matrix.m42);
	} catch {
		return 0;
	}
}

export interface TouchGestureListeners {
	onAdditionalTouchStart(event: TouchEvent): void;
	onTouchMove(event: TouchEvent): void;
	onTouchEnd(event: TouchEvent): void;
	onTouchCancel(event: TouchEvent): void;
}

export interface AttachedTouchGestureListeners {
	/** Toggles the document-level session net while a touch session is active. */
	setSessionNet(active: boolean): void;
	destroy(): void;
}

/**
 * Wires the touch listeners a drag session needs.
 *
 * The move/end/cancel listeners live permanently on the gesture element: touch events keep firing
 * at the touchstart target for the whole gesture, so the element observes every sample even after
 * the finger leaves it — and iOS latches the deliverable listener set when a touch begins, so a
 * listener added mid-gesture can miss the rest of that gesture entirely. Element-scoped listeners
 * also never couple scrolling elsewhere on the page to this handler, unlike a permanent
 * non-passive document listener.
 *
 * The document-level net exists only during a session: it observes a second finger landing
 * anywhere and keeps a gesture alive if its start target is detached mid-drag. Both scopes can
 * deliver the same event, which the session handlers absorb idempotently.
 */
export function attachTouchGestureListeners(
	element: HTMLElement,
	listeners: TouchGestureListeners
): AttachedTouchGestureListeners {
	const document = element.ownerDocument;
	let netActive = false;

	element.addEventListener('touchmove', listeners.onTouchMove, { passive: false, capture: true });
	element.addEventListener('touchend', listeners.onTouchEnd, true);
	element.addEventListener('touchcancel', listeners.onTouchCancel, true);

	function setSessionNet(active: boolean): void {
		if (netActive === active) return;
		netActive = active;
		if (active) {
			document.addEventListener('touchstart', listeners.onAdditionalTouchStart, {
				passive: true,
				capture: true
			});
			document.addEventListener('touchmove', listeners.onTouchMove, {
				passive: false,
				capture: true
			});
			document.addEventListener('touchend', listeners.onTouchEnd, true);
			document.addEventListener('touchcancel', listeners.onTouchCancel, true);
		} else {
			document.removeEventListener('touchstart', listeners.onAdditionalTouchStart, true);
			document.removeEventListener('touchmove', listeners.onTouchMove, true);
			document.removeEventListener('touchend', listeners.onTouchEnd, true);
			document.removeEventListener('touchcancel', listeners.onTouchCancel, true);
		}
	}

	return {
		setSessionNet,
		destroy() {
			setSessionNet(false);
			element.removeEventListener('touchmove', listeners.onTouchMove, true);
			element.removeEventListener('touchend', listeners.onTouchEnd, true);
			element.removeEventListener('touchcancel', listeners.onTouchCancel, true);
		}
	};
}
