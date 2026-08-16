import type { DrawerSwipeDirection } from '../types.js';
import { getDisplacement } from './constants.js';

export const AXIS_LOCK_SLOP = 6;
export const AXIS_LOCK_BIAS = 2;
export const MAX_RELEASE_SAMPLE_AGE = 80;

export interface Point {
	readonly x: number;
	readonly y: number;
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
