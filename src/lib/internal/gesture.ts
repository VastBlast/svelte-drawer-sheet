import type { DrawerSwipeBehavior, DrawerSwipeDirection } from '../types.js';
import { ATTR, getDisplacement, isVertical } from './constants.js';
import {
	deepestActiveElement,
	composedParent,
	isElement,
	isHTMLElement,
	isHTMLInputElement,
	isHTMLTextAreaElement
} from './dom.js';
import { createChangeEventDetails } from './events.js';
import {
	AXIS_LOCK_BIAS,
	AXIS_LOCK_SLOP,
	MAX_RELEASE_SAMPLE_AGE,
	attachTouchGestureListeners,
	eventTime,
	movementFor,
	renderedDirectionalOffset,
	resolveNavigationSwipeRelease,
	safePointerCapture,
	touchPoint,
	touchPointFromList,
	type Point
} from './gesture-utils.js';
import type { DrawerRootState } from './root-state.svelte.js';
import { getDampedSnapMovement, resolveSnapRelease } from './snap-points.js';

const MIN_DRAG = 1;
const MIN_SWIPE = 10;
const FAST_SWIPE_VELOCITY = 0.5;
const IGNORE_POINTER_SELECTOR = `[${ATTR.swipeIgnore}],[${ATTR.baseSwipeIgnore}],button,a,input,select,textarea,label,[role="button"]`;
const IGNORE_TOUCH_SELECTOR = `[${ATTR.swipeIgnore}],[${ATTR.baseSwipeIgnore}]`;

interface GestureSession {
	readonly source: 'pointer' | 'touch';
	readonly direction: DrawerSwipeDirection;
	readonly behavior: DrawerSwipeBehavior;
	readonly pointerId?: number;
	readonly touchId?: number;
	start: Point;
	last: Point;
	startTime: number;
	lastTime: number;
	velocityX: number;
	velocityY: number;
	axis: 'horizontal' | 'vertical' | null;
	canceled: boolean;
	claimed: boolean;
	sawPrimaryButtons: boolean;
	swiping: boolean;
	firstTouchMove: boolean;
	baseOffset: number | null;
	movementCorrection: number;
	drawerSize: number;
	scrollTarget: HTMLElement | null;
}

function axisFor(direction: DrawerSwipeDirection): 'horizontal' | 'vertical' {
	return isVertical(direction) ? 'vertical' : 'horizontal';
}

function findScrollable(
	target: EventTarget | null,
	root: HTMLElement,
	axis: 'horizontal' | 'vertical'
): HTMLElement | null {
	let element = isHTMLElement(target) ? target : null;
	while (element) {
		const style = element.ownerDocument.defaultView?.getComputedStyle(element);
		const overflow = axis === 'vertical' ? style?.overflowY : style?.overflowX;
		const overflows =
			axis === 'vertical'
				? element.scrollHeight > element.clientHeight
				: element.scrollWidth > element.clientWidth;
		if ((overflow === 'auto' || overflow === 'scroll') && overflows) return element;
		if (element === root) break;
		element = composedParent(element) as HTMLElement | null;
	}
	return null;
}

function horizontalScrollPosition(element: HTMLElement): { position: number; max: number } {
	const max = Math.max(0, element.scrollWidth - element.clientWidth);
	if (element.ownerDocument.defaultView?.getComputedStyle(element).direction !== 'rtl') {
		return { position: element.scrollLeft, max };
	}

	// Modern engines expose negative RTL scrollLeft. The fallback handles positive reverse models.
	const position = element.scrollLeft < 0 ? max + element.scrollLeft : max - element.scrollLeft;
	return { position: Math.min(max, Math.max(0, position)), max };
}

function canNativeScroll(
	element: HTMLElement,
	axis: 'horizontal' | 'vertical',
	fingerDelta: number
): boolean {
	if (fingerDelta === 0) return true;
	if (axis === 'vertical') {
		const max = Math.max(0, element.scrollHeight - element.clientHeight);
		return fingerDelta > 0 ? element.scrollTop > 0 : element.scrollTop < max;
	}
	const { position, max } = horizontalScrollPosition(element);
	return fingerDelta > 0 ? position > 0 : position < max;
}

function hasProtectedSelection(root: HTMLElement): boolean {
	const selection = root.ownerDocument.getSelection?.();
	return Boolean(selection && !selection.isCollapsed && root.contains(selection.anchorNode));
}

function eventPathElements(event: Event): Element[] {
	return event.composedPath().filter(isElement);
}

function pathMatches(path: readonly Element[], selector: string): boolean {
	return path.some((element) => element.matches(selector));
}

function shouldIgnoreTouch(path: readonly Element[], root: HTMLElement): boolean {
	const target = path[0] ?? null;
	if (!target || pathMatches(path, IGNORE_TOUCH_SELECTOR)) return true;
	if (isHTMLInputElement(target) && target.type === 'range') return true;
	if (hasProtectedSelection(root)) return true;
	const active = deepestActiveElement(root.ownerDocument);
	if (
		isHTMLInputElement(active) ||
		isHTMLTextAreaElement(active) ||
		(isHTMLElement(active) && active.isContentEditable)
	) {
		const start = 'selectionStart' in active ? active.selectionStart : null;
		const end = 'selectionEnd' in active ? active.selectionEnd : null;
		if (start !== null && end !== null && start !== end) return true;
	}
	return false;
}

export function attachDismissGesture(
	element: HTMLElement,
	state: DrawerRootState<unknown>
): () => void {
	let session: GestureSession | null = null;

	function begin(
		source: GestureSession['source'],
		point: Point,
		event: PointerEvent | TouchEvent,
		ids: Pick<GestureSession, 'pointerId' | 'touchId'> = {}
	): void {
		if (session || !state.open || state.nestedInteractionOpen || !state.popup) return;
		const direction = state.swipeDirection;
		const behavior = state.swipeBehavior;
		const path = eventPathElements(event);
		const target = path[0] ?? (isElement(event.target) ? event.target : null);
		if (!path.includes(state.popup) && !(target && state.popup.contains(target))) return;
		if (source === 'pointer') {
			if (
				pathMatches(path, IGNORE_POINTER_SELECTOR) ||
				(behavior === 'drawer' && pathMatches(path, `[${ATTR.content}]`))
			) {
				return;
			}
		} else if (shouldIgnoreTouch(path, element)) {
			return;
		}

		const axis = axisFor(direction);
		session = {
			source,
			direction,
			behavior,
			...ids,
			start: point,
			last: point,
			startTime: eventTime(event),
			lastTime: eventTime(event),
			velocityX: 0,
			velocityY: 0,
			axis: null,
			canceled: false,
			claimed: source === 'pointer',
			sawPrimaryButtons: false,
			swiping: false,
			firstTouchMove: source === 'touch',
			baseOffset: null,
			movementCorrection: 0,
			drawerSize: 0,
			scrollTarget: source === 'touch' ? findScrollable(target, element, axis) : null
		};
	}

	function move(point: Point, event: PointerEvent | TouchEvent): void {
		if (!session || session.canceled) return;
		if (point.x === session.last.x && point.y === session.last.y) return;
		const direction = session.direction;
		const expectedAxis = axisFor(direction);
		const deltaX = point.x - session.start.x;
		const deltaY = point.y - session.start.y;
		const primary = expectedAxis === 'vertical' ? Math.abs(deltaY) : Math.abs(deltaX);
		const cross = expectedAxis === 'vertical' ? Math.abs(deltaX) : Math.abs(deltaY);

		if (!session.axis) {
			if (primary < MIN_DRAG && cross < MIN_DRAG) return;
			if (session.source === 'touch' && primary < AXIS_LOCK_SLOP && cross < AXIS_LOCK_SLOP) return;
			if (cross >= AXIS_LOCK_SLOP && cross >= primary + AXIS_LOCK_BIAS) {
				session.canceled = true;
				return;
			}
			if (cross > primary) return;
			session.axis = expectedAxis;
		}

		if (session.source === 'touch' && !session.claimed) {
			const fingerDelta =
				expectedAxis === 'vertical' ? point.y - session.last.y : point.x - session.last.x;
			if (
				session.scrollTarget &&
				canNativeScroll(session.scrollTarget, expectedAxis, fingerDelta)
			) {
				// Start drawer displacement at the exact scroll edge if ownership changes mid-gesture.
				session.start = point;
				session.last = point;
				session.startTime = eventTime(event);
				session.lastTime = session.startTime;
				session.firstTouchMove = false;
				return;
			}
			session.claimed = true;
			if (session.firstTouchMove) {
				// iOS can withhold touchmove until the finger has already crossed native slop. Treat
				// that first delivered point as the origin so the drawer never jumps by the hidden gap.
				session.firstTouchMove = false;
				session.start = point;
				session.last = point;
				session.startTime = eventTime(event);
				session.lastTime = session.startTime;
				session.velocityX = 0;
				session.velocityY = 0;
				if (event.cancelable) event.preventDefault();
				return;
			}
		}

		const displacement = getDisplacement(direction, deltaX, deltaY);
		const now = eventTime(event);
		const sampleDuration = Math.max(
			session.behavior === 'navigation' ? 4 : 16,
			now - session.lastTime
		);
		session.velocityX = (point.x - session.last.x) / sampleDuration;
		session.velocityY = (point.y - session.last.y) / sampleDuration;
		session.last = point;
		session.lastTime = now;

		const hasSnapPoints = state.resolvedSnapPoints.length > 0 && isVertical(direction);
		let visualDisplacement = displacement;
		if (hasSnapPoints) {
			visualDisplacement = getDampedSnapMovement(
				session.baseOffset ?? state.activeSnapPointOffset ?? 0,
				displacement
			);
		} else if (displacement < 0) {
			visualDisplacement = -Math.sqrt(-displacement);
		}

		if (!session.swiping && Math.abs(visualDisplacement) >= MIN_DRAG) {
			if (session.source === 'touch' && !event.cancelable) {
				session.canceled = true;
				state.resetDrag();
				return;
			}
			const popup = state.popup;
			if (!popup) {
				session.canceled = true;
				return;
			}
			session.swiping = true;
			state.syncSnapPointOffset();
			const renderedOffset = renderedDirectionalOffset(popup, direction);
			state.setSwiping(true);
			const targetOffset = renderedDirectionalOffset(popup, direction);
			session.movementCorrection = renderedOffset - targetOffset;
			session.drawerSize = isVertical(direction) ? state.popupHeight : popup.offsetWidth;
			session.baseOffset = hasSnapPoints
				? Math.min(
						state.popupHeight,
						Math.max(0, state.popupSnapPointOffset + session.movementCorrection)
					)
				: Math.max(0, renderedOffset);
		}
		if (!session.swiping) return;

		if (hasSnapPoints) {
			visualDisplacement = getDampedSnapMovement(session.baseOffset ?? 0, displacement);
		}
		visualDisplacement += session.movementCorrection;
		const dragProgress = state.getSwipeProgress(
			displacement,
			session.drawerSize,
			session.baseOffset
		);
		if (event.cancelable) event.preventDefault();
		const movement = movementFor(direction, visualDisplacement);
		state.applyDrag(movement.x, movement.y, dragProgress);
		state.setNestedSwipeActive(Math.abs(displacement) >= MIN_SWIPE && dragProgress > 0);
	}

	function finish(event: PointerEvent | TouchEvent, canceled = false): void {
		const finished = session;
		session = null;
		touchListeners.setSessionNet(false);
		if (!finished) return;
		if (finished.pointerId !== undefined) {
			safePointerCapture(element, finished.pointerId, 'releasePointerCapture');
		}
		if (!finished.swiping) return;
		if (canceled || finished.canceled) {
			state.resetDrag();
			return;
		}

		const deltaX = finished.last.x - finished.start.x;
		const deltaY = finished.last.y - finished.start.y;
		const duration = Math.max(50, finished.lastTime - finished.startTime);
		const averageVelocityX = deltaX / duration;
		const averageVelocityY = deltaY / duration;
		const sampleFresh = eventTime(event) - finished.lastTime <= MAX_RELEASE_SAMPLE_AGE;
		const velocityX = sampleFresh ? finished.velocityX : 0;
		const velocityY = sampleFresh ? finished.velocityY : 0;
		const direction = finished.direction;
		const displacement = getDisplacement(direction, deltaX, deltaY);
		const releaseVelocity = getDisplacement(direction, velocityX, velocityY);
		const averageVelocity = getDisplacement(direction, averageVelocityX, averageVelocityY);
		const details = createChangeEventDetails('swipe', event, { trigger: element });

		const hasSnapPoints = state.resolvedSnapPoints.length > 0 && isVertical(direction);
		let resolvedReleaseVelocity = averageVelocity;
		let navigationStrength: number | undefined;
		let navigationEasing: string | undefined;
		if (finished.behavior === 'navigation') {
			resolvedReleaseVelocity = releaseVelocity;
			const release = resolveNavigationSwipeRelease(
				displacement,
				finished.drawerSize,
				releaseVelocity
			);
			navigationStrength = release.strength;
			navigationEasing = release.easing;
			if (!release.dismiss) {
				state.settleDrag(release.strength, release.easing);
				return;
			}
		} else if (hasSnapPoints) {
			resolvedReleaseVelocity = releaseVelocity;
			if (
				Math.abs(displacement) >= MIN_SWIPE &&
				Math.sign(releaseVelocity) !== 0 &&
				Math.sign(releaseVelocity) !== Math.sign(displacement)
			) {
				// A brief reversal at release should not overturn the established drag direction.
				resolvedReleaseVelocity = averageVelocity;
			}
			const target = resolveSnapRelease({
				points: state.resolvedSnapPoints,
				drawerHeight: state.popupHeight,
				currentOffset: finished.baseOffset,
				dragDelta: displacement,
				velocity: releaseVelocity,
				fallbackVelocity: averageVelocity,
				sequential: state.snapToSequentialPoints
			});
			if (target?.type === 'snap') {
				state.requestSnapPoint(
					target.point.value,
					createChangeEventDetails('swipe', event, { trigger: element })
				);
				state.resetDrag();
				return;
			}
			if (target?.type !== 'close') {
				state.resetDrag();
				return;
			}
		} else {
			const threshold = Math.max(finished.drawerSize * 0.5, MIN_SWIPE);
			if (
				displacement <= 0 ||
				(resolvedReleaseVelocity < FAST_SWIPE_VELOCITY && displacement <= threshold)
			) {
				state.resetDrag();
				return;
			}
		}

		const previousSnapPoint = state.activeSnapPoint;
		// Release timing depends on the current snap offset, so compute it before staging null.
		state.setSwipeRelease(
			resolvedReleaseVelocity,
			displacement,
			finished.drawerSize,
			finished.baseOffset,
			navigationStrength,
			navigationEasing
		);
		const stagedSnapClose = hasSnapPoints
			? state.requestSnapPoint(null, createChangeEventDetails('swipe', event, { trigger: element }))
			: false;
		state.setSwiping(false);
		if (!state.requestOpen(false, details)) {
			if (stagedSnapClose) {
				state.requestSnapPoint(
					previousSnapPoint,
					createChangeEventDetails('swipe', event, { trigger: element })
				);
			}
			state.clearSwipeRelease();
			if (navigationStrength === undefined) state.resetDrag();
			else state.settleDrag(navigationStrength, navigationEasing);
			return;
		}

		if (state.open) {
			const restore = () => {
				if (!state.open) return;
				if (stagedSnapClose) {
					state.requestSnapPoint(
						previousSnapPoint,
						createChangeEventDetails('swipe', event, { trigger: element })
					);
				}
				state.clearSwipeRelease();
				if (navigationStrength === undefined) state.resetDrag();
				else state.settleDrag(navigationStrength, navigationEasing);
			};
			const view = element.ownerDocument.defaultView;
			if (view?.requestAnimationFrame) view.requestAnimationFrame(restore);
			else queueMicrotask(restore);
		}
	}

	function onPointerDown(event: PointerEvent): void {
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
	}

	function onPointerMove(event: PointerEvent): void {
		if (!session || session.source !== 'pointer' || session.pointerId !== event.pointerId) return;
		const primaryDown = event.buttons % 2 === 1;
		if (primaryDown) session.sawPrimaryButtons = true;
		// A non-primary button taking over the interaction cancels the swipe.
		if (event.buttons !== 0 && !primaryDown) {
			finish(event, true);
			return;
		}
		move({ x: event.clientX, y: event.clientY }, event);
		// A `buttons: 0` move means the primary button was already released. On fast flicks this
		// trailing move arrives before `pointerup` and carries the release displacement and peak
		// velocity, so it commits the release instead of cancelling.
		if (event.buttons === 0 && session?.sawPrimaryButtons) finish(event);
	}

	function onPointerUp(event: PointerEvent): void {
		if (!session || session.pointerId !== event.pointerId) return;
		move({ x: event.clientX, y: event.clientY }, event);
		finish(event);
	}

	function onPointerCancel(event: PointerEvent) {
		if (session?.source === 'pointer' && session.pointerId === event.pointerId) finish(event, true);
	}

	function onLostPointerCapture(event: PointerEvent) {
		if (session?.source === 'pointer' && session.pointerId === event.pointerId) finish(event, true);
	}

	function onTouchStart(event: TouchEvent): void {
		if (event.touches.length !== 1) return;
		const touch = touchPoint(event);
		if (!touch) return;
		begin('touch', touch.point, event, { touchId: touch.id });
		if (session?.source === 'touch') touchListeners.setSessionNet(true);
	}

	function onAdditionalTouchStart(event: TouchEvent): void {
		if (session?.source === 'touch') finish(event, true);
	}

	function onTouchMove(event: TouchEvent): void {
		if (!session || session.source !== 'touch') return;
		if (event.touches.length > 1) {
			finish(event, true);
			return;
		}
		const touch = touchPoint(event, session.touchId);
		if (touch) move(touch.point, event);
	}

	function onTouchEnd(event: TouchEvent): void {
		const touchId = session?.source === 'touch' ? session.touchId : undefined;
		if (touchId === undefined) return;
		const touch = touchPointFromList(event.changedTouches, touchId);
		if (!touch) return;
		move(touch.point, event);
		finish(event);
	}

	function onTouchCancel(event: TouchEvent) {
		const touchId = session?.source === 'touch' ? session.touchId : undefined;
		if (touchId !== undefined && touchPointFromList(event.changedTouches, touchId)) {
			finish(event, true);
		}
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

	return () => {
		const interrupted = session;
		session = null;
		touchListeners.destroy();
		if (interrupted?.pointerId !== undefined) {
			safePointerCapture(element, interrupted.pointerId, 'releasePointerCapture');
		}
		// Avoid reading rune-backed root state during ordinary parent teardown. Only a gesture
		// that reached the visual drag phase can leave imperative styles behind.
		if (interrupted?.swiping) state.resetDrag();
		element.removeEventListener('pointerdown', onPointerDown);
		element.removeEventListener('pointermove', onPointerMove);
		element.removeEventListener('pointerup', onPointerUp);
		element.removeEventListener('pointercancel', onPointerCancel);
		element.removeEventListener('lostpointercapture', onLostPointerCapture);
		element.removeEventListener('touchstart', onTouchStart);
	};
}
