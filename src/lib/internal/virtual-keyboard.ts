import { CSS_VAR } from './constants.js';
import {
	composedParent,
	deepestActiveElement,
	isElement,
	isComposedDescendant,
	isHTMLElement,
	isHTMLInputElement,
	isHTMLTextAreaElement
} from './dom.js';
import type { DrawerRootState } from './root-state.svelte.js';

const KEYBOARD_THRESHOLD = 60;
const VISIBILITY_MARGIN = 16;
const SCROLL_SLACK = 48;
const REALIGN_INTERVAL = 150;
const REALIGN_PASSES = 4;
const SETTLE_FRAME_LIMIT = 60;
const INPUT_TAP_MOVE_THRESHOLD = 10;
const INPUT_TAP_HIT_SLOP = 16;
const TEXT_INPUT_TYPES = new Set(['email', 'number', 'password', 'search', 'tel', 'text', 'url']);
const INTERACTIVE_SELECTOR =
	'button,a[href],[role="button"],select,input,textarea,[contenteditable]:not([contenteditable="false"]),[tabindex]:not([tabindex="-1"])';

interface Point {
	readonly x: number;
	readonly y: number;
}

interface KeyboardTouchTarget {
	readonly focusTarget: HTMLElement;
	readonly clickTarget: HTMLElement;
}

type ElementFromPointRoot = Node & Partial<Pick<Document, 'elementFromPoint'>>;

// A lift over another control must block fallback to touchstart's target. Mobile browsers keep
// `touchend.target` pinned to the element where the sequence began.
const KEYBOARD_TAP_BLOCKED = Symbol('KeyboardTapBlocked');

interface ScrollStyleSnapshot {
	readonly element: HTMLElement;
	readonly unadjustedBottom: number;
	readonly overflowAnchor: string;
	readonly paddingBottom: string;
	readonly scrollPaddingBottom: string;
	readonly computedPaddingBottom: number;
	readonly computedScrollPaddingBottom: number;
	appliedOverflowAnchor: string;
	appliedPaddingBottom: string;
	appliedScrollPaddingBottom: string;
	paddingSettleChecks: number;
}

export interface KeyboardViewport {
	readonly top: number;
	readonly bottom: number;
	readonly inset: number;
}

export interface KeyboardScrollGeometry {
	readonly keyboardTop: number;
	readonly keyboardBottom: number;
	readonly scrollerTop: number;
	readonly scrollerBottom: number;
	readonly targetTop: number;
	readonly targetBottom: number;
	readonly scrollTop: number;
	readonly maxScrollTop: number;
}

export interface KeyboardScrollResolution {
	readonly overlap: number;
	readonly destination: number | null;
}

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(maximum, Math.max(minimum, value));
}

export function resolveKeyboardViewport(
	layoutHeight: number,
	visualHeight: number,
	offsetTop: number,
	scale: number
): KeyboardViewport | null {
	if (
		![layoutHeight, visualHeight, offsetTop, scale].every(Number.isFinite) ||
		layoutHeight <= 0 ||
		visualHeight <= 0 ||
		scale !== 1 ||
		layoutHeight - visualHeight <= KEYBOARD_THRESHOLD
	) {
		return null;
	}

	const top = Math.max(0, offsetTop);
	const bottom = Math.min(layoutHeight, top + visualHeight);
	if (bottom <= top) return null;
	return { top, bottom, inset: Math.max(0, layoutHeight - bottom) };
}

export function resolveKeyboardScroll({
	keyboardTop,
	keyboardBottom,
	scrollerTop,
	scrollerBottom,
	targetTop,
	targetBottom,
	scrollTop,
	maxScrollTop
}: KeyboardScrollGeometry): KeyboardScrollResolution {
	if (
		![
			keyboardTop,
			keyboardBottom,
			scrollerTop,
			scrollerBottom,
			targetTop,
			targetBottom,
			scrollTop,
			maxScrollTop
		].every(Number.isFinite)
	) {
		return { overlap: 0, destination: null };
	}

	const overlap = Math.max(0, scrollerBottom - keyboardBottom);
	const visibleTop = Math.max(scrollerTop, keyboardTop) + VISIBILITY_MARGIN;
	const visibleBottom = Math.min(scrollerBottom, keyboardBottom) - VISIBILITY_MARGIN;
	if (visibleBottom <= visibleTop || maxScrollTop <= 0) return { overlap, destination: null };

	const destination = scrollTop + (targetTop + targetBottom - visibleTop - visibleBottom) / 2;
	return {
		overlap,
		destination: Math.round(clamp(destination, 0, Math.max(0, maxScrollTop)))
	};
}

export function resolveKeyboardInputTarget(target: EventTarget | null): HTMLElement | null {
	if (!isHTMLElement(target)) return null;
	if (isHTMLTextAreaElement(target)) return target.matches(':disabled') ? null : target;
	if (isHTMLInputElement(target)) {
		return TEXT_INPUT_TYPES.has(target.type) && !target.matches(':disabled') ? target : null;
	}
	if (!target.isContentEditable) {
		const label = target.closest('label');
		const control = label && 'control' in label ? label.control : null;
		return isHTMLElement(control) ? resolveKeyboardInputTarget(control) : null;
	}

	let host = target;
	let parent = composedParent(host);
	while (isHTMLElement(parent) && parent.isContentEditable) {
		host = parent;
		parent = composedParent(host);
	}
	return host;
}

function resolveKeyboardTouchTarget(target: EventTarget | null): KeyboardTouchTarget | null {
	if (!isHTMLElement(target)) return null;
	const focusTarget = resolveKeyboardInputTarget(target);
	return focusTarget ? { focusTarget, clickTarget: target } : null;
}

function isInteractiveElement(element: Element | null): boolean {
	return element?.closest(INTERACTIVE_SELECTOR) != null;
}

function elementAtPoint(root: ElementFromPointRoot, x: number, y: number): Element | null {
	if (typeof root.elementFromPoint !== 'function') return null;
	let element = root.elementFromPoint(x, y);
	const visited = new Set<ShadowRoot>();
	while (element?.shadowRoot && !visited.has(element.shadowRoot)) {
		const shadowRoot = element.shadowRoot;
		visited.add(shadowRoot);
		if (typeof shadowRoot.elementFromPoint !== 'function') break;
		const nested = shadowRoot.elementFromPoint(x, y);
		if (!nested || nested === element) break;
		element = nested;
	}
	return element;
}

function resolveKeyboardTouchTargetFromPoint(
	root: ElementFromPointRoot,
	x: number,
	y: number
): KeyboardTouchTarget | typeof KEYBOARD_TAP_BLOCKED | null {
	const exactTarget = elementAtPoint(root, x, y);
	if (isHTMLElement(exactTarget)) {
		const focusTarget = resolveKeyboardInputTarget(exactTarget);
		if (focusTarget) return { focusTarget, clickTarget: exactTarget };
	}

	// Hit slop recovers from WebKit retargeting as the keyboard changes layout, but never
	// steals a tap that landed on a neighboring control or label.
	if (isInteractiveElement(exactTarget) || exactTarget?.closest('label')) {
		return KEYBOARD_TAP_BLOCKED;
	}

	for (const [offsetX, offsetY] of [
		[0, INPUT_TAP_HIT_SLOP],
		[0, -INPUT_TAP_HIT_SLOP],
		[INPUT_TAP_HIT_SLOP, 0],
		[-INPUT_TAP_HIT_SLOP, 0]
	]) {
		const focusTarget = resolveKeyboardInputTarget(elementAtPoint(root, x + offsetX, y + offsetY));
		if (focusTarget) return { focusTarget, clickTarget: focusTarget };
	}
	return null;
}

export function resolveKeyboardTapTarget(
	root: ElementFromPointRoot,
	nativeTarget: EventTarget | null,
	x: number,
	y: number
): KeyboardTouchTarget | null {
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	const pointTarget = resolveKeyboardTouchTargetFromPoint(root, x, y);
	if (pointTarget === KEYBOARD_TAP_BLOCKED) return null;
	return pointTarget ?? resolveKeyboardTouchTarget(nativeTarget);
}

export function isKeyboardTapMovement(start: Point, current: Point): boolean {
	return (
		Math.abs(current.x - start.x) <= INPUT_TAP_MOVE_THRESHOLD &&
		Math.abs(current.y - start.y) <= INPUT_TAP_MOVE_THRESHOLD
	);
}

function findScroller(
	target: HTMLElement,
	root: HTMLElement,
	excluded: ReadonlySet<HTMLElement>
): HTMLElement | null {
	let element = composedParent(target);
	let overflowIntent: HTMLElement | null = null;
	while (element) {
		if (isHTMLElement(element) && !excluded.has(element)) {
			const styles = element.ownerDocument.defaultView?.getComputedStyle(element);
			const canScroll = styles?.overflowY === 'auto' || styles?.overflowY === 'scroll';
			if (canScroll && element.clientHeight > 0) {
				if (element.scrollHeight > element.clientHeight) return element;
				overflowIntent ??= element;
			}
		}
		if (element === root) break;
		element = composedParent(element);
	}
	return overflowIntent;
}

function overrideGeometryDuringFocus(target: HTMLElement, translateY: number): () => void {
	const { opacity, transform, transition } = target.style;
	const applied = {
		transition: 'none',
		opacity: '0',
		transform: `translateY(${translateY}px)`
	};
	target.style.transition = applied.transition;
	target.style.opacity = applied.opacity;
	target.style.transform = applied.transform;
	return () => {
		// Synchronous focus handlers may intentionally change inline styles. Restore only values
		// still owned by this temporary iOS focus workaround.
		if (target.style.opacity === applied.opacity) target.style.opacity = opacity;
		if (target.style.transform === applied.transform) target.style.transform = transform;
		if (target.style.transition === applied.transition) target.style.transition = transition;
	};
}

export function focusKeyboardInputWithoutPageScroll(target: HTMLElement): void {
	const wasFocused = deepestActiveElement(target.ownerDocument) === target;
	// `preventScroll` alone does not stop iOS from panning a transformed sheet. During the
	// synchronous focus call, present the field as an invisible off-screen target, then restore
	// its exact inline styles before the browser paints.
	const restore = overrideGeometryDuringFocus(target, -2000);
	try {
		if (wasFocused) target.blur();
		target.focus({ preventScroll: true });
	} finally {
		restore();
	}
}

/** Recreates the compatibility click that canceling `touchend` suppressed. */
export function dispatchCompatibilityClick(
	target: HTMLElement,
	touch: Pick<Touch, 'clientX' | 'clientY'>
): void {
	const ownerWindow = target.ownerDocument.defaultView;
	if (!ownerWindow) return;
	const init: MouseEventInit = {
		bubbles: true,
		cancelable: true,
		composed: true,
		button: 0,
		buttons: 0,
		clientX: touch.clientX,
		clientY: touch.clientY,
		detail: 1,
		view: ownerWindow
	};
	const click = ownerWindow.PointerEvent
		? new ownerWindow.PointerEvent('click', {
				...init,
				isPrimary: true,
				pointerType: 'touch'
			})
		: new ownerWindow.MouseEvent('click', init);
	target.dispatchEvent(click);
}

function findTouch(touches: TouchList, identifier?: number): Touch | null {
	for (let index = 0; index < touches.length; index += 1) {
		const touch = touches.item(index);
		if (touch && (identifier === undefined || touch.identifier === identifier)) return touch;
	}
	return null;
}

export function attachVirtualKeyboard(
	viewport: HTMLElement,
	root: DrawerRootState<unknown>
): () => void {
	const document = viewport.ownerDocument;
	const defaultView = document.defaultView;
	if (!defaultView?.visualViewport) return () => {};
	const ownerWindow = defaultView;
	const visualViewport = defaultView.visualViewport;

	const baseScroll = { x: ownerWindow.scrollX, y: ownerWindow.scrollY };
	let focused: HTMLElement | null = null;
	let adjustment: ScrollStyleSnapshot | null = null;
	let frame = 0;
	let preemptFrame = 0;
	let realignTimer = 0;
	let restorePreemptedFocus: (() => void) | null = null;
	let trackedScroller: HTMLElement | null = null;
	let trackedDestination = 0;
	let settleChecks = 0;
	let observedScrollTop = -1;
	const rejectedScrollers = new Set<HTMLElement>();
	let programmaticFocus = false;
	let touchStart: (Point & { readonly identifier: number }) | null = null;
	let touchMoved = false;

	function keyboardViewport() {
		return resolveKeyboardViewport(
			ownerWindow.innerHeight,
			visualViewport.height,
			visualViewport.offsetTop,
			visualViewport.scale
		);
	}

	function resetScrollTracking() {
		trackedScroller = null;
		trackedDestination = 0;
		settleChecks = 0;
		observedScrollTop = -1;
	}

	function restoreAdjustment(): boolean {
		if (!adjustment) return false;
		let changed = false;
		if (adjustment.element.style.overflowAnchor === adjustment.appliedOverflowAnchor) {
			changed ||= adjustment.element.style.overflowAnchor !== adjustment.overflowAnchor;
			adjustment.element.style.overflowAnchor = adjustment.overflowAnchor;
		}
		if (adjustment.element.style.paddingBottom === adjustment.appliedPaddingBottom) {
			changed ||= adjustment.element.style.paddingBottom !== adjustment.paddingBottom;
			adjustment.element.style.paddingBottom = adjustment.paddingBottom;
		}
		if (adjustment.element.style.scrollPaddingBottom === adjustment.appliedScrollPaddingBottom) {
			changed ||= adjustment.element.style.scrollPaddingBottom !== adjustment.scrollPaddingBottom;
			adjustment.element.style.scrollPaddingBottom = adjustment.scrollPaddingBottom;
		}
		adjustment = null;
		return changed;
	}

	function setScrollSlack(element: HTMLElement, slack: number, unadjustedBottom: number): boolean {
		if (adjustment && (!adjustment.element.isConnected || adjustment.element !== element)) {
			restoreAdjustment();
			return true;
		}
		if (
			adjustment &&
			(element.style.overflowAnchor !== adjustment.appliedOverflowAnchor ||
				element.style.paddingBottom !== adjustment.appliedPaddingBottom ||
				element.style.scrollPaddingBottom !== adjustment.appliedScrollPaddingBottom)
		) {
			// Consumer inline changes take ownership. Preserve them and measure a fresh baseline.
			restoreAdjustment();
			return true;
		}
		if (slack <= 0) {
			return restoreAdjustment();
		}
		if (!adjustment) {
			const styles = ownerWindow.getComputedStyle(element);
			adjustment = {
				element,
				unadjustedBottom,
				overflowAnchor: element.style.overflowAnchor,
				paddingBottom: element.style.paddingBottom,
				scrollPaddingBottom: element.style.scrollPaddingBottom,
				computedPaddingBottom: Number.parseFloat(styles.paddingBottom) || 0,
				computedScrollPaddingBottom: Number.parseFloat(styles.scrollPaddingBottom) || 0,
				appliedOverflowAnchor: '',
				appliedPaddingBottom: '',
				appliedScrollPaddingBottom: '',
				paddingSettleChecks: 0
			};
		}

		const overflowAnchor = 'none';
		const paddingBottom = `${adjustment.computedPaddingBottom + Math.ceil(slack)}px`;
		const scrollPaddingBottom = `${adjustment.computedScrollPaddingBottom + VISIBILITY_MARGIN}px`;
		let changed = false;
		if (element.style.overflowAnchor !== overflowAnchor) {
			element.style.overflowAnchor = overflowAnchor;
			changed = true;
		}
		if (element.style.paddingBottom !== paddingBottom) {
			element.style.paddingBottom = paddingBottom;
			adjustment.paddingSettleChecks = 0;
			changed = true;
		}
		if (element.style.scrollPaddingBottom !== scrollPaddingBottom) {
			element.style.scrollPaddingBottom = scrollPaddingBottom;
			changed = true;
		}
		adjustment.appliedOverflowAnchor = overflowAnchor;
		adjustment.appliedPaddingBottom = paddingBottom;
		adjustment.appliedScrollPaddingBottom = scrollPaddingBottom;
		return changed;
	}

	function consumePreemptedFocus() {
		if (preemptFrame) ownerWindow.cancelAnimationFrame(preemptFrame);
		preemptFrame = 0;
		restorePreemptedFocus?.();
		restorePreemptedFocus = null;
	}

	function preemptFocusReveal(target: HTMLElement, keyboard: KeyboardViewport) {
		consumePreemptedFocus();
		const rect = target.getBoundingClientRect();
		restorePreemptedFocus = overrideGeometryDuringFocus(
			target,
			(keyboard.top + keyboard.bottom - rect.top - rect.bottom) / 2
		);
		preemptFrame = ownerWindow.requestAnimationFrame(consumePreemptedFocus);
	}

	function clearLayout() {
		root.keyboardInset = 0;
		viewport.style.setProperty(CSS_VAR.keyboardInset, '0px');
		restoreAdjustment();
		rejectedScrollers.clear();
		resetScrollTracking();
	}

	function cancelAlignment() {
		if (frame) ownerWindow.cancelAnimationFrame(frame);
		if (realignTimer) ownerWindow.clearTimeout(realignTimer);
		frame = 0;
		realignTimer = 0;
	}

	function clearFocusedTarget() {
		focused = null;
		consumePreemptedFocus();
		cancelAlignment();
		clearLayout();
	}

	function restoreWindowScroll(keyboard = keyboardViewport()): boolean {
		if (
			root.modal !== true ||
			root.nestedInteractionOpen ||
			!focused ||
			!keyboard ||
			(ownerWindow.scrollX === baseScroll.x && ownerWindow.scrollY === baseScroll.y)
		) {
			return false;
		}
		ownerWindow.scrollTo({
			left: baseScroll.x,
			top: baseScroll.y,
			behavior: 'instant' as ScrollBehavior
		});
		return true;
	}

	function requestAlignmentFrame() {
		if (frame) ownerWindow.cancelAnimationFrame(frame);
		frame = ownerWindow.requestAnimationFrame(align);
	}

	function align() {
		frame = 0;
		const target = focused;
		if (
			!root.open ||
			root.nestedInteractionOpen ||
			!target?.isConnected ||
			!isComposedDescendant(viewport, target)
		) {
			clearLayout();
			return;
		}

		let keyboard = keyboardViewport();
		if (!keyboard) {
			clearLayout();
			return;
		}
		if (restoreWindowScroll(keyboard)) keyboard = keyboardViewport() ?? keyboard;
		const keyboardInset = Math.ceil(keyboard.inset);
		const keyboardInsetValue = `${keyboardInset}px`;
		if (
			root.keyboardInset !== keyboardInset ||
			viewport.style.getPropertyValue(CSS_VAR.keyboardInset) !== keyboardInsetValue
		) {
			// Rebase the scroll boundary after the inset changes layout. The next frame measures
			// without provider-owned padding, so that padding can never become new keyboard overlap.
			restoreAdjustment();
			rejectedScrollers.clear();
			root.keyboardInset = keyboardInset;
			viewport.style.setProperty(CSS_VAR.keyboardInset, keyboardInsetValue);
			// The inset can resize the popup. Measure the resulting geometry on the next frame.
			requestAlignmentFrame();
			return;
		}

		// Provider padding can change which ancestor appears scrollable. Keep the current owner
		// through the measurement phase unless the target leaves it or it proves unusable below.
		const ownedScroller = adjustment?.element;
		const scroller =
			ownedScroller?.isConnected && isComposedDescendant(ownedScroller, target)
				? ownedScroller
				: findScroller(target, viewport, rejectedScrollers);
		if (!scroller) {
			restoreAdjustment();
			// Delayed/viewport alignments are separate layout epochs and may retry after CSS settles.
			rejectedScrollers.clear();
			resetScrollTracking();
			return;
		}
		const scrollerRect = scroller.getBoundingClientRect();
		const targetRect = target.getBoundingClientRect();
		const scrollTop = scroller.scrollTop;
		const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
		const geometry = {
			keyboardTop: keyboard.top,
			keyboardBottom: keyboard.bottom,
			scrollerTop: scrollerRect.top,
			scrollerBottom: scrollerRect.bottom,
			targetTop: targetRect.top,
			targetBottom: targetRect.bottom,
			scrollTop
		};
		const unadjustedBottom =
			adjustment?.element === scroller ? adjustment.unadjustedBottom : scrollerRect.bottom;
		const { overlap } = resolveKeyboardScroll({
			...geometry,
			scrollerBottom: unadjustedBottom,
			maxScrollTop: 0
		});
		if (setScrollSlack(scroller, overlap > 0 ? overlap + SCROLL_SLACK : 0, unadjustedBottom)) {
			// Padding changes scroll geometry, so consume it before the next read phase.
			requestAlignmentFrame();
			return;
		}
		const visibleTop = Math.max(scrollerRect.top, keyboard.top) + VISIBILITY_MARGIN;
		const visibleBottom = Math.min(scrollerRect.bottom, keyboard.bottom) - VISIBILITY_MARGIN;
		if (maxScrollTop <= 0 && (targetRect.top < visibleTop || targetRect.bottom > visibleBottom)) {
			const ownedAdjustment = adjustment?.element === scroller ? adjustment : null;
			if (ownedAdjustment) {
				const renderedPadding = Number.parseFloat(
					ownerWindow.getComputedStyle(scroller).paddingBottom
				);
				const appliedPadding = Number.parseFloat(ownedAdjustment.appliedPaddingBottom);
				if (
					Number.isFinite(renderedPadding) &&
					Number.isFinite(appliedPadding) &&
					Math.abs(renderedPadding - appliedPadding) > 0.5 &&
					ownedAdjustment.paddingSettleChecks < SETTLE_FRAME_LIMIT
				) {
					ownedAdjustment.paddingSettleChecks += 1;
					requestAlignmentFrame();
					return;
				}
			}
			// Auto-sized overflow containers can absorb padding without gaining scroll range.
			// Retry the next eligible ancestor instead of pinning a covered target to this one.
			rejectedScrollers.add(scroller);
			restoreAdjustment();
			resetScrollTracking();
			requestAlignmentFrame();
			return;
		}
		const { destination } = resolveKeyboardScroll({
			...geometry,
			maxScrollTop
		});
		if (destination === null) {
			resetScrollTracking();
			return;
		}

		const sameScroller = trackedScroller === scroller;
		const settled = sameScroller && Math.abs(trackedDestination - destination) <= 1;
		if (!settled) {
			settleChecks = sameScroller ? settleChecks + 1 : 1;
			trackedScroller = scroller;
			trackedDestination = destination;
			observedScrollTop = -1;
			if (settleChecks <= SETTLE_FRAME_LIMIT) {
				requestAlignmentFrame();
				return;
			}
		} else if (observedScrollTop >= 0) {
			if (Math.abs(scroller.scrollTop - destination) <= 1) return;
			if (scroller.scrollTop !== observedScrollTop) {
				observedScrollTop = scroller.scrollTop;
				return;
			}
		}

		if (Math.abs(scroller.scrollTop - destination) <= 1) return;
		trackedScroller = scroller;
		trackedDestination = destination;
		settleChecks = 0;
		observedScrollTop = scroller.scrollTop;
		scroller.scrollTo({
			top: destination,
			behavior: ownerWindow.matchMedia?.('(prefers-reduced-motion: reduce)').matches
				? ('instant' as ScrollBehavior)
				: 'smooth'
		});
	}

	function scheduleDelayedRealignment() {
		if (realignTimer) ownerWindow.clearTimeout(realignTimer);
		let passes = REALIGN_PASSES;
		const realign = () => {
			requestAlignmentFrame();
			passes -= 1;
			realignTimer = passes > 0 ? ownerWindow.setTimeout(realign, REALIGN_INTERVAL) : 0;
		};
		realignTimer = ownerWindow.setTimeout(realign, REALIGN_INTERVAL);
	}

	function captureFocusedTarget(target: EventTarget | null): boolean {
		if (root.nestedInteractionOpen) return false;
		const nextTarget = resolveKeyboardInputTarget(target);
		if (!nextTarget || !isComposedDescendant(viewport, nextTarget)) return false;
		if (focused !== nextTarget) {
			restoreAdjustment();
			rejectedScrollers.clear();
			resetScrollTracking();
		}
		focused = nextTarget;
		return true;
	}

	function onFocusIn(event: FocusEvent) {
		// A focus handler may immediately blur or redirect the field. Clear suppression before its
		// target/bubble handlers run so those subsequent focus events reconcile normally.
		programmaticFocus = false;
		consumePreemptedFocus();
		const target = event.composedPath().find(isElement) ?? event.target;
		if (!captureFocusedTarget(target)) {
			clearFocusedTarget();
			return;
		}
		if (keyboardViewport()) scheduleDelayedRealignment();
		requestAlignmentFrame();
	}

	function onFocusOut(event: FocusEvent) {
		if (programmaticFocus) return;
		if (captureFocusedTarget(event.relatedTarget)) {
			const keyboard = keyboardViewport();
			if (focused && keyboard) preemptFocusReveal(focused, keyboard);
			requestAlignmentFrame();
			return;
		}
		clearFocusedTarget();
	}

	function onViewportUpdate() {
		if (focused || captureFocusedTarget(deepestActiveElement(document))) requestAlignmentFrame();
	}

	function onWindowScroll() {
		if (restoreWindowScroll()) requestAlignmentFrame();
	}

	function onPointerDown() {
		cancelAlignment();
		resetScrollTracking();
	}

	function resetTouchTracking() {
		touchStart = null;
		touchMoved = false;
	}

	function onTouchStart(event: TouchEvent) {
		resetTouchTracking();
		if (event.touches.length !== 1) return;
		const touch = findTouch(event.touches);
		if (!touch) return;
		touchStart = {
			x: touch.clientX,
			y: touch.clientY,
			identifier: touch.identifier
		};
	}

	function onAdditionalTouchStart(event: TouchEvent) {
		if (touchStart && event.touches.length !== 1) resetTouchTracking();
	}

	function onTouchMove(event: TouchEvent) {
		const start = touchStart;
		if (!start || touchMoved) return;
		if (event.touches.length !== 1) {
			touchMoved = true;
			return;
		}
		const touch = findTouch(event.touches, start.identifier);
		if (!touch || !isKeyboardTapMovement(start, { x: touch.clientX, y: touch.clientY })) {
			touchMoved = true;
		}
	}

	function onTouchEnd(event: TouchEvent) {
		const start = touchStart;
		if (!start) return;
		const changedTouch = findTouch(event.changedTouches, start.identifier);
		// Another finger ended while the tracked finger remains down.
		if (!changedTouch && event.changedTouches.length > 0) return;
		const touch = changedTouch ?? findTouch(event.touches, start.identifier);
		const moved =
			touchMoved ||
			Boolean(touch && !isKeyboardTapMovement(start, { x: touch.clientX, y: touch.clientY }));
		resetTouchTracking();
		if (
			!touch ||
			moved ||
			!root.open ||
			!root.mounted ||
			root.nestedInteractionOpen ||
			!event.cancelable ||
			event.defaultPrevented
		) {
			return;
		}

		const nativeTarget = event.composedPath().find(isElement) ?? event.target;
		const keyboardTarget = resolveKeyboardTapTarget(
			viewport.getRootNode() as ElementFromPointRoot,
			nativeTarget,
			touch.clientX,
			touch.clientY
		);
		if (
			!keyboardTarget ||
			!isComposedDescendant(viewport, keyboardTarget.focusTarget) ||
			!isComposedDescendant(viewport, keyboardTarget.clickTarget) ||
			visualViewport.scale !== 1
		) {
			return;
		}

		const { focusTarget, clickTarget } = keyboardTarget;
		// Preserve the native event when it can reposition an existing caret. If the field is
		// focused but the keyboard is closed, the blur/re-focus below is required to summon it.
		if (deepestActiveElement(document) === focusTarget && keyboardViewport()) return;

		event.preventDefault();
		programmaticFocus = true;
		try {
			focusKeyboardInputWithoutPageScroll(focusTarget);
		} finally {
			programmaticFocus = false;
		}
		// Canceling touchend also cancels its compatibility click. Recreate it at the actual lift
		// target so label activation, consumer handlers, and coordinate-sensitive behavior survive.
		dispatchCompatibilityClick(clickTarget, touch);
	}

	document.addEventListener('focusin', onFocusIn, true);
	document.addEventListener('focusout', onFocusOut, true);
	document.addEventListener('pointerdown', onPointerDown, true);
	document.addEventListener('touchstart', onAdditionalTouchStart, true);
	viewport.addEventListener('touchstart', onTouchStart, { passive: true });
	document.addEventListener('touchmove', onTouchMove, { passive: true, capture: true });
	viewport.addEventListener('touchend', onTouchEnd, { passive: false });
	document.addEventListener('touchcancel', resetTouchTracking, true);
	visualViewport.addEventListener('resize', onViewportUpdate);
	visualViewport.addEventListener('scroll', onViewportUpdate);
	ownerWindow.addEventListener('scroll', onWindowScroll);

	if (captureFocusedTarget(deepestActiveElement(document))) requestAlignmentFrame();

	return () => {
		document.removeEventListener('focusin', onFocusIn, true);
		document.removeEventListener('focusout', onFocusOut, true);
		document.removeEventListener('pointerdown', onPointerDown, true);
		document.removeEventListener('touchstart', onAdditionalTouchStart, true);
		viewport.removeEventListener('touchstart', onTouchStart);
		document.removeEventListener('touchmove', onTouchMove, true);
		viewport.removeEventListener('touchend', onTouchEnd);
		document.removeEventListener('touchcancel', resetTouchTracking, true);
		visualViewport.removeEventListener('resize', onViewportUpdate);
		visualViewport.removeEventListener('scroll', onViewportUpdate);
		ownerWindow.removeEventListener('scroll', onWindowScroll);
		clearFocusedTarget();
		root.keyboardInset = 0;
		viewport.style.removeProperty(CSS_VAR.keyboardInset);
	};
}
