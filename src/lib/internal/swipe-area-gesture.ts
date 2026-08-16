import type { DrawerSwipeDirection } from '../types.js';
import { getDisplacement, isVertical, oppositeDirection } from './constants.js';
import { createChangeEventDetails } from './events.js';
import {
	AXIS_LOCK_BIAS,
	AXIS_LOCK_SLOP,
	MAX_RELEASE_SAMPLE_AGE,
	attachTouchGestureListeners,
	eventTime,
	movementFor,
	renderedDirectionalOffset,
	safePointerCapture,
	touchPoint,
	touchPointFromList,
	type Point
} from './gesture-utils.js';
import type { DrawerRootState } from './root-state.svelte.js';

const OPEN_RATIO = 0.5;
const FALLBACK_THRESHOLD = 40;
const VELOCITY_THRESHOLD = 0.1;

interface OpenGestureSession {
	readonly source: 'pointer' | 'touch';
	readonly direction: DrawerSwipeDirection;
	readonly pointerId?: number;
	readonly touchId?: number;
	readonly start: Point;
	last: Point;
	lastTime: number;
	velocity: number;
	axisLocked: boolean;
	opened: boolean;
	sawPrimaryButtons: boolean;
	closedOffset: number | null;
}

export interface SwipeAreaGestureController {
	update(): void;
	destroy(): void;
}

interface SwipeAreaGestureOptions {
	disabled(): boolean;
	direction(): DrawerSwipeDirection;
	onSwipingChange(swiping: boolean): void;
}

function popupSize(popup: HTMLElement, direction: DrawerSwipeDirection): number {
	return isVertical(direction) ? popup.offsetHeight : popup.offsetWidth;
}

/** Tracks the edge gesture independently from Svelte state; only lifecycle changes are emitted. */
export function attachSwipeAreaGesture(
	element: HTMLElement,
	root: DrawerRootState<unknown>,
	options: SwipeAreaGestureOptions
): SwipeAreaGestureController {
	const originalTouchAction = element.style.touchAction;
	const originalPointerEvents = element.style.pointerEvents;
	let session: OpenGestureSession | null = null;
	let swiping = false;
	let applyFrame = 0;
	let pendingApply: {
		readonly active: OpenGestureSession;
		readonly deltaX: number;
		readonly deltaY: number;
	} | null = null;

	function setSwiping(value: boolean) {
		if (swiping === value) return;
		swiping = value;
		options.onSwipingChange(value);
	}

	function resolveClosedOffset(popup: HTMLElement, direction: DrawerSwipeDirection): number | null {
		const size = popupSize(popup, direction);
		if (size <= 0) return null;
		const currentOffset = Math.abs(renderedDirectionalOffset(popup, direction));
		const closedOffset = currentOffset > 0.5 ? Math.min(size, currentOffset) : size;
		const snapOffset = isVertical(direction) ? (root.activeSnapPointOffset ?? 0) : 0;
		return Math.max(0, closedOffset - snapOffset);
	}

	function updateStyles() {
		const disabled = options.disabled();
		const enabled = !disabled && (!root.open || session !== null);
		element.style.pointerEvents = enabled ? originalPointerEvents : 'none';
		element.style.touchAction = !enabled
			? originalTouchAction
			: isVertical(options.direction())
				? 'pan-x pinch-zoom'
				: 'pan-y pinch-zoom';
		if (disabled && session) cancel();
	}

	function begin(
		source: OpenGestureSession['source'],
		point: Point,
		event: PointerEvent | TouchEvent,
		ids: Pick<OpenGestureSession, 'pointerId' | 'touchId'> = {}
	) {
		if (options.disabled() || root.open || session) return;
		root.outsideDismissSuppressed = false;
		const direction = options.direction();
		const popup = root.popup;
		session = {
			source,
			direction,
			...ids,
			start: point,
			last: point,
			lastTime: eventTime(event),
			velocity: 0,
			axisLocked: false,
			opened: false,
			sawPrimaryButtons: false,
			closedOffset: popup ? resolveClosedOffset(popup, direction) : null
		};
		setSwiping(true);
	}

	function apply(active: OpenGestureSession, deltaX: number, deltaY: number) {
		if (session !== active || !active.opened || !root.open) return;
		const popup = root.popup;
		if (!popup) return;
		active.closedOffset ??= resolveClosedOffset(popup, active.direction);
		const closedOffset = active.closedOffset;
		if (!closedOffset) return;

		const displacement = Math.max(0, getDisplacement(active.direction, deltaX, deltaY));
		const traveled =
			displacement > closedOffset
				? closedOffset + Math.sqrt(displacement - closedOffset)
				: displacement;
		const movement = movementFor(oppositeDirection[active.direction], closedOffset - traveled);
		const openProgress = Math.min(1, displacement / closedOffset);
		const restingProgress = root.parent ? 0 : root.settledSwipeProgress;
		const dismissProgress = 1 - openProgress * (1 - restingProgress);
		root.setSwiping(true);
		// Height variables persist through the fully-open overshoot while the finger is still down.
		root.applyDrag(movement.x, movement.y, dismissProgress, openProgress > 0);
	}

	function scheduleApply(active: OpenGestureSession, deltaX: number, deltaY: number) {
		pendingApply = { active, deltaX, deltaY };
		const view = element.ownerDocument.defaultView;
		if (!view?.requestAnimationFrame) {
			apply(active, deltaX, deltaY);
			pendingApply = null;
			return;
		}
		if (applyFrame) return;
		applyFrame = view.requestAnimationFrame(() => {
			applyFrame = 0;
			const pending = pendingApply;
			pendingApply = null;
			if (pending) apply(pending.active, pending.deltaX, pending.deltaY);
		});
	}

	function cancelApply() {
		const view = element.ownerDocument.defaultView;
		if (applyFrame && view) view.cancelAnimationFrame(applyFrame);
		applyFrame = 0;
		pendingApply = null;
	}

	function move(point: Point, event: PointerEvent | TouchEvent) {
		const active = session;
		if (!active || (point.x === active.last.x && point.y === active.last.y)) return;
		const deltaX = point.x - active.start.x;
		const deltaY = point.y - active.start.y;
		const vertical = isVertical(active.direction);
		const primary = Math.abs(vertical ? deltaY : deltaX);
		const cross = Math.abs(vertical ? deltaX : deltaY);

		if (!active.axisLocked) {
			if (primary < AXIS_LOCK_SLOP && cross < AXIS_LOCK_SLOP) return;
			if (cross >= AXIS_LOCK_SLOP && cross >= primary + AXIS_LOCK_BIAS) {
				cancel(event);
				return;
			}
			if (cross > primary) return;
			active.axisLocked = true;
		}

		const now = eventTime(event);
		const duration = Math.max(16, now - active.lastTime);
		active.velocity =
			getDisplacement(active.direction, point.x - active.last.x, point.y - active.last.y) /
			duration;
		active.last = point;
		active.lastTime = now;

		const displacement = getDisplacement(active.direction, deltaX, deltaY);
		if (displacement < 1) return;
		if (!active.opened) {
			// A concurrent programmatic open does not belong to this gesture and must never be closed by it.
			if (root.open) {
				cancel(event);
				return;
			}
			root.outsideDismissSuppressed = true;
			root.swipeAreaActive = true;
			active.opened = root.requestOpen(
				true,
				createChangeEventDetails('swipe', event, { trigger: element }),
				{ trigger: element }
			);
			if (!active.opened) {
				cancel(event);
				return;
			}
		}

		if (active.source === 'touch' && !event.cancelable) {
			cancel(event);
			return;
		}
		if (event.cancelable) event.preventDefault();
		scheduleApply(active, deltaX, deltaY);
	}

	function finish(event?: Event, canceled = false) {
		const active = session;
		cancelApply();
		session = null;
		touchListeners.setSessionNet(false);
		if (!active) return;
		if (active.pointerId !== undefined) {
			safePointerCapture(element, active.pointerId, 'releasePointerCapture');
		}

		const deltaX = active.last.x - active.start.x;
		const deltaY = active.last.y - active.start.y;
		const displacement = getDisplacement(active.direction, deltaX, deltaY);
		const size = active.closedOffset ?? (root.popup ? popupSize(root.popup, active.direction) : 0);
		const threshold = size > 0 ? size * OPEN_RATIO : FALLBACK_THRESHOLD;
		const releaseVelocity =
			event && eventTime(event) - active.lastTime <= MAX_RELEASE_SAMPLE_AGE ? active.velocity : 0;
		const shouldStayOpen =
			!canceled &&
			!options.disabled() &&
			active.opened &&
			(displacement >= threshold || releaseVelocity >= VELOCITY_THRESHOLD);

		root.swipeAreaActive = false;
		root.outsideDismissSuppressed = false;
		if (!shouldStayOpen && active.opened && root.open) {
			root.requestOpen(false, createChangeEventDetails('swipe', event, { trigger: element }));
		}
		root.resetDrag();
		setSwiping(false);
		updateStyles();
	}

	function cancel(event?: Event) {
		finish(event, true);
	}

	function onPointerDown(event: PointerEvent) {
		if (
			event.pointerType === 'touch' ||
			event.button !== 0 ||
			!event.isPrimary ||
			event.defaultPrevented
		) {
			return;
		}
		begin('pointer', { x: event.clientX, y: event.clientY }, event, {
			pointerId: event.pointerId
		});
		if (!session) return;
		safePointerCapture(element, event.pointerId, 'setPointerCapture');
		// Prevent native text selection and drag behavior from competing with the swipe-open drag.
		if (event.cancelable) event.preventDefault();
	}

	function onPointerMove(event: PointerEvent) {
		if (session?.source !== 'pointer' || session.pointerId !== event.pointerId) return;
		const primaryDown = event.buttons % 2 === 1;
		if (primaryDown) session.sawPrimaryButtons = true;
		// A non-primary button taking over the interaction cancels the swipe.
		if (event.buttons !== 0 && !primaryDown) {
			cancel(event);
			return;
		}
		move({ x: event.clientX, y: event.clientY }, event);
		// A `buttons: 0` move means the primary button was already released. On fast flicks this
		// trailing move arrives before `pointerup` and carries the release displacement and peak
		// velocity, so it commits the release instead of cancelling.
		if (event.buttons === 0 && session?.sawPrimaryButtons) finish(event);
	}

	function onPointerUp(event: PointerEvent) {
		if (session?.source !== 'pointer' || session.pointerId !== event.pointerId) return;
		move({ x: event.clientX, y: event.clientY }, event);
		finish(event);
	}

	function onPointerCancel(event: PointerEvent) {
		if (session?.source === 'pointer' && session.pointerId === event.pointerId) cancel(event);
	}

	function onLostPointerCapture(event: PointerEvent) {
		if (session?.source === 'pointer' && session.pointerId === event.pointerId) cancel(event);
	}

	function onTouchStart(event: TouchEvent) {
		if (event.touches.length !== 1) return;
		const touch = touchPoint(event);
		if (!touch) return;
		begin('touch', touch.point, event, { touchId: touch.id });
		if (session?.source === 'touch') touchListeners.setSessionNet(true);
	}

	function onAdditionalTouchStart(event: TouchEvent) {
		if (session?.source === 'touch') cancel(event);
	}

	function onTouchMove(event: TouchEvent) {
		if (session?.source !== 'touch') return;
		if (event.touches.length > 1) {
			cancel(event);
			return;
		}
		const touch = touchPoint(event, session.touchId);
		if (touch) move(touch.point, event);
	}

	function onTouchEnd(event: TouchEvent) {
		const touchId = session?.source === 'touch' ? session.touchId : undefined;
		if (touchId === undefined) return;
		const touch = touchPointFromList(event.changedTouches, touchId);
		if (!touch) return;
		move(touch.point, event);
		finish(event);
	}

	function onTouchCancel(event: TouchEvent) {
		const touchId = session?.source === 'touch' ? session.touchId : undefined;
		if (touchId !== undefined && touchPointFromList(event.changedTouches, touchId)) cancel(event);
	}

	const touchListeners = attachTouchGestureListeners(element, {
		onAdditionalTouchStart,
		onTouchMove,
		onTouchEnd,
		onTouchCancel
	});

	element.addEventListener('pointerdown', onPointerDown);
	element.addEventListener('pointermove', onPointerMove);
	element.addEventListener('pointerup', onPointerUp);
	element.addEventListener('pointercancel', onPointerCancel);
	element.addEventListener('lostpointercapture', onLostPointerCapture);
	element.addEventListener('touchstart', onTouchStart, { passive: true });
	updateStyles();

	return {
		update: updateStyles,
		destroy() {
			cancel();
			touchListeners.destroy();
			root.outsideDismissSuppressed = false;
			root.swipeAreaActive = false;
			element.style.touchAction = originalTouchAction;
			element.style.pointerEvents = originalPointerEvents;
			element.removeEventListener('pointerdown', onPointerDown);
			element.removeEventListener('pointermove', onPointerMove);
			element.removeEventListener('pointerup', onPointerUp);
			element.removeEventListener('pointercancel', onPointerCancel);
			element.removeEventListener('lostpointercapture', onLostPointerCapture);
			element.removeEventListener('touchstart', onTouchStart);
		}
	};
}
