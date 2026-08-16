<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { createAttachmentKey } from 'svelte/attachments';
	import type { DrawerPopupProps } from '../types.js';
	import { CSS_VAR } from '../internal/constants.js';
	import { useDrawerRoot } from '../internal/context.js';
	import {
		createNestedDialogObserver,
		type NestedDialogObserver
	} from '../internal/dialog-observer.js';
	import { createDismissLayer } from '../internal/dismiss-layer.js';
	import {
		deepestActiveElement,
		isComposedDescendant,
		isElement,
		isHTMLElement
	} from '../internal/dom.js';
	import { createCancelableEvent, createChangeEventDetails } from '../internal/events.js';
	import { createFocusTrap, type FocusTrapController } from '../internal/focus.js';
	import { createModalIsolation } from '../internal/modal-isolation.js';
	import { lockDocumentScroll } from '../internal/scroll-lock.js';
	import { mergeStyles } from '../internal/styles.js';

	const uid = $props.id();
	let {
		id = `drawer-popup-${uid}`,
		initialFocus,
		finalFocus,
		ref = $bindable(null),
		onOpenAutoFocus,
		onCloseAutoFocus,
		onEscapeKeydown,
		onInteractOutside,
		onFocusOutside,
		getInsideElements,
		onkeydown,
		children,
		child,
		...rest
	}: DrawerPopupProps = $props();

	const root = useDrawerRoot();
	const contentOwner = {};
	const attachmentKey = createAttachmentKey();
	let focusTrap = $state.raw<FocusTrapController | null>(null);
	let dialogObserver = $state.raw<NestedDialogObserver | null>(null);
	let focusCycleOpen = false;
	let focusCycleElement: HTMLElement | null = null;
	let pendingCloseFocusElement: HTMLElement | null = null;
	let insideElementsSnapshot: readonly (Element | null | undefined)[] = [];
	let focusInsideElement: HTMLElement | null = null;
	const resolvedInsideElements = () => [...insideElementsSnapshot, focusInsideElement];
	const connectedInsideElements = () => {
		const document = root.popup?.ownerDocument;
		return resolvedInsideElements().filter(
			(element): element is Element =>
				isElement(element) && element.isConnected && element.ownerDocument === document
		);
	};

	const dismissLayer = createDismissLayer(() => ({
		isTopmost: () => root.open && !root.nestedInteractionOpen,
		parentElement: () => root.parent?.popup ?? null,
		insideElements: () => [...root.triggerElements, ...connectedInsideElements()],
		intentionalOutsidePress: (event) =>
			event.pointerType === 'touch' || root.modal !== 'trap-focus' || root.backdrop !== null,
		onPointerOutside: handleInteractOutside,
		onFocusOutside: handleFocusOutside,
		onEscapeKeydown: handleEscape
	}));
	dismissLayer.setActive(false);
	const modalIsolation = createModalIsolation({
		parent: () => root.parent?.popup ?? null,
		insideElements: resolvedInsideElements
	});
	modalIsolation.setState(false, false);

	// Nested CSS sizes the parent from this frozen value during nesting and exit; resting drawers
	// keep intrinsic sizing.
	const drawerHeightValue = $derived(
		(root.nestedPresenceCount > 0 || (!root.open && root.mounted)) && root.popupHeight
			? `${root.popupHeight}px`
			: 'auto'
	);
	const popupState = $derived({
		open: root.open,
		transitionStatus: root.transitionStatus,
		expanded: root.activeSnapPoint === 1,
		nested: Boolean(root.parent),
		nestedDrawerOpen: root.nestedOpenCount > 0,
		nestedDrawerSwiping: root.nestedSwiping,
		swipeDirection: root.swipeDirection,
		swiping: root.swiping
	});

	function attach(element: Element) {
		if (!isHTMLElement(element)) return;
		ref = element;
		element.addEventListener('keydown', handleKeydown);
		// Attachments are reactive effects. Setup reads are deliberately untracked so geometry and
		// open-state changes update the controllers instead of rebuilding them during a gesture.
		const controllers = untrack(() => {
			const dialogs = createNestedDialogObserver(element, (open) => {
				root.nestedDialogOpen = open;
				element.toggleAttribute('data-nested-open', open);
			});
			const trap = createFocusTrap(
				element,
				(target) => dialogs.claimFocusTarget(target),
				() => root.parent?.popup ?? null,
				connectedInsideElements
			);
			dialogs.setActive(root.open);
			return {
				trap,
				dialogs,
				cleanRoot: root.attachPopup(element),
				cleanDismiss: dismissLayer.attach(element),
				cleanIsolation: modalIsolation.attach(element)
			};
		});
		focusTrap = controllers.trap;
		dialogObserver = controllers.dialogs;
		return () => {
			element.removeEventListener('keydown', handleKeydown);
			controllers.dialogs.destroy();
			controllers.cleanIsolation();
			controllers.cleanDismiss();
			controllers.trap.destroy();
			controllers.cleanRoot();
			if (focusTrap === controllers.trap) focusTrap = null;
			if (dialogObserver === controllers.dialogs) dialogObserver = null;
			if (ref === element) ref = null;
		};
	}

	function autofocusEvent(element: HTMLElement, type: string): Event {
		const EventConstructor = element.ownerDocument.defaultView?.Event ?? Event;
		return new EventConstructor(type, { cancelable: true });
	}

	function scheduleFocus(callback: () => void): void {
		// Focus before the next paint. A frame-delayed focus can visibly flash on the trigger and may
		// never run in a throttled background document.
		queueMicrotask(callback);
	}

	function setFocusInsideElement(element: HTMLElement | null): void {
		if (focusInsideElement === element) return;
		focusInsideElement = element;
		modalIsolation.setInsideElements(resolvedInsideElements);
	}

	function handleOpenAutoFocus(element: HTMLElement): void {
		const event = autofocusEvent(element, 'drawer-open-auto-focus');
		onOpenAutoFocus?.(event);
		if (event.defaultPrevented) return;

		focusTrap?.setAllowedOutside(null);
		const callback = typeof initialFocus === 'function';
		const target = callback ? initialFocus(root.openMethod) : initialFocus;
		setFocusInsideElement(isHTMLElement(target) ? target : null);
		if (isHTMLElement(target)) {
			focusTrap?.setAllowedOutside(target);
			scheduleFocus(() => {
				if (root.open && target.isConnected) target.focus({ preventScroll: true });
			});
			return;
		}
		if (target === true || (callback && target === null)) {
			scheduleFocus(() => {
				if (root.open && element.isConnected) focusTrap?.focusFirst();
			});
			return;
		}
		if (!callback && initialFocus === undefined) {
			scheduleFocus(() => {
				if (root.open && element.isConnected) element.focus({ preventScroll: true });
			});
		}
	}

	function handleCloseAutoFocus(element: HTMLElement): void {
		const event = autofocusEvent(element, 'drawer-close-auto-focus');
		onCloseAutoFocus?.(event);
		if (event.defaultPrevented) return;

		const callback = typeof finalFocus === 'function';
		const target = callback ? finalFocus(root.closeMethod) : finalFocus;
		if (isHTMLElement(target)) {
			if (target.isConnected) target.focus({ preventScroll: true });
			return;
		}
		const restoreDefault =
			target === true || (callback && target === null) || (!callback && finalFocus === undefined);
		if (
			restoreDefault &&
			target !== true &&
			root.modal === false &&
			(root.closeReason === 'outside-press' || root.closeReason === 'focus-out')
		) {
			const active = deepestActiveElement(element.ownerDocument);
			if (
				isHTMLElement(active) &&
				active !== element.ownerDocument.body &&
				!isComposedDescendant(element, active)
			) {
				return;
			}
		}
		const trigger = root.activeTrigger;
		if (restoreDefault && isHTMLElement(trigger) && trigger.isConnected) {
			trigger.focus({ preventScroll: true });
		}
	}

	function finishFocusCycle(): void {
		const element = pendingCloseFocusElement;
		if (!element) return;
		pendingCloseFocusElement = null;
		handleCloseAutoFocus(element);
		setFocusInsideElement(null);
	}

	function handleEscape(event: KeyboardEvent): void {
		onEscapeKeydown?.(event);
		if (!event.defaultPrevented) {
			const accepted = root.requestOpen(false, createChangeEventDetails('escape-key', event));
			if (accepted) event.preventDefault();
		}
	}

	function handleInteractOutside(event: PointerEvent | MouseEvent): void {
		onInteractOutside?.(event);
		if (event.defaultPrevented) return;
		if (root.disablePointerDismissal || root.outsideDismissSuppressed) {
			return;
		}
		// Presence keeps the modal shield alive through this compatibility click, so it cannot reach
		// the page that becomes interactive after the exit finishes.
		if (root.modal === true && 'pointerType' in event && event.pointerType === 'touch') {
			event.preventDefault();
		}
		root.requestOpen(false, createChangeEventDetails('outside-press', event));
	}

	function handleFocusOutside(event: FocusEvent): void {
		const target = event.composedPath()[0] ?? event.target;
		if (isHTMLElement(target) && dialogObserver?.claimFocusTarget(target)) return;
		const cancelableEvent = createCancelableEvent(event);
		onFocusOutside?.(cancelableEvent);
		if (
			cancelableEvent.defaultPrevented ||
			root.modal !== false ||
			root.disablePointerDismissal ||
			!root.open
		) {
			return;
		}
		root.requestOpen(false, createChangeEventDetails('focus-out', cancelableEvent));
	}

	function handleKeydown(event: KeyboardEvent) {
		onkeydown?.(event as KeyboardEvent & { currentTarget: EventTarget & HTMLDivElement });
		if (
			event.key === 'Escape' &&
			!event.isComposing &&
			!event.cancelBubble &&
			dismissLayer.handleEscapeKeydown(event)
		) {
			// Handle Escape before it reaches an enclosing menu/dialog while still letting focused
			// descendants and the consumer's key handler decline ownership first.
			event.stopPropagation();
			return;
		}
		if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
			event.stopPropagation();
		}
	}

	$effect(() => {
		const element = root.popup;
		if (root.open && element && (!focusCycleOpen || focusCycleElement !== element)) {
			focusCycleOpen = true;
			focusCycleElement = element;
			pendingCloseFocusElement = null;
			queueMicrotask(() => {
				if (
					root.open &&
					focusCycleOpen &&
					focusCycleElement === element &&
					root.popup === element
				) {
					handleOpenAutoFocus(element);
				}
			});
		} else if (!root.open) {
			if (focusCycleOpen) {
				focusCycleOpen = false;
				pendingCloseFocusElement = focusCycleElement;
				focusCycleElement = null;
			}
			if (root.transitionStatus === undefined) finishFocusCycle();
		}
	});

	$effect(() => dismissLayer.setActive(root.open || root.transitionStatus === 'ending'));
	$effect(() => {
		// Resolve inside a tracked effect so a stable getter can depend on Svelte state. The manager
		// still filters connectivity and document ownership only when it reconciles the DOM.
		insideElementsSnapshot = getInsideElements?.() ?? [];
		modalIsolation.setInsideElements(resolvedInsideElements);
	});
	$effect(() => modalIsolation.setState(root.open, root.modal !== false));
	$effect(() => dialogObserver?.setActive(root.open));
	$effect(() => root.registerContent(contentOwner, id));

	$effect(() => {
		const element = root.popup;
		if (!element || !root.swiping) root.syncSnapPointOffset();
		if (!element) return;
		element.style.setProperty(CSS_VAR.height, drawerHeightValue);
		element.style.setProperty(CSS_VAR.frontmostHeight, `${root.frontmostHeight || 0}px`);
		element.style.setProperty(CSS_VAR.nestedDrawers, `${root.nestedVisualCount}`);
		element.style.setProperty(CSS_VAR.swipeStrength, `${root.swipeStrength}`);
		root.syncRestingProgress();
	});

	$effect(() => {
		const element = root.popup;
		const present = root.open || root.transitionStatus === 'ending';
		if (!element || !present || root.modal !== true) return;
		return lockDocumentScroll(element.ownerDocument);
	});

	$effect(() => {
		const trap = focusTrap;
		if (!trap) return;
		trap.setState(root.open, root.modal !== false && !root.nestedInteractionOpen);
		return () => trap.setState(false, false);
	});

	onDestroy(() => {
		if (focusCycleOpen) {
			focusCycleOpen = false;
			pendingCloseFocusElement = focusCycleElement;
			focusCycleElement = null;
		}
		finishFocusCycle();
		dismissLayer.destroy();
		modalIsolation.destroy();
	});

	let partProps = $derived.by(() => {
		const snapPointOffset = root.swiping
			? root.popupSnapPointOffset
			: (root.activeSnapPointOffset ?? 0);
		return {
			...rest,
			id,
			role: rest.role ?? 'dialog',
			style: mergeStyles(
				rest.style,
				`${CSS_VAR.swipeMovementX}: ${root.popupSwipeMovementX}px`,
				`${CSS_VAR.swipeMovementY}: ${root.popupSwipeMovementY}px`,
				`${CSS_VAR.swipeProgress}: ${root.popupSwipeProgress}`,
				`${CSS_VAR.snapPointOffset}: ${root.swipeDirection === 'up' ? -snapPointOffset : snapPointOffset}px`,
				`${CSS_VAR.height}: ${drawerHeightValue}`,
				`${CSS_VAR.frontmostHeight}: ${root.frontmostHeight || 0}px`,
				`${CSS_VAR.nestedDrawers}: ${root.nestedVisualCount}`,
				`${CSS_VAR.swipeStrength}: ${root.swipeStrength}`,
				root.swiping ? 'transition: none' : undefined,
				root.nestedInteractionOpen ? 'pointer-events: none !important' : undefined
			),
			'aria-labelledby': rest['aria-labelledby'] ?? root.titleId,
			'aria-describedby': rest['aria-describedby'] ?? root.descriptionId,
			'aria-modal': root.modal === false ? undefined : true,
			'aria-hidden': root.open ? undefined : true,
			hidden: !root.mounted,
			inert: root.open ? undefined : true,
			tabindex: rest.tabindex ?? -1,
			'data-open': root.open ? '' : undefined,
			'data-closed': root.open ? undefined : '',
			'data-starting-style': root.transitionStatus === 'starting' ? '' : undefined,
			'data-ending-style': root.transitionStatus === 'ending' ? '' : undefined,
			'data-expanded': root.activeSnapPoint === 1 ? '' : undefined,
			'data-nested': root.parent ? '' : undefined,
			'data-nested-drawer-open': root.nestedVisualCount > 0 ? '' : undefined,
			'data-nested-drawer-swiping': root.nestedSwiping ? '' : undefined,
			'data-swipe-direction': root.swipeDirection,
			'data-swipe-dismiss': root.swipeDismissed ? '' : undefined,
			'data-swiping': root.swiping ? '' : undefined,
			[attachmentKey]: attach
		};
	});
</script>

{#if child}
	{@render child({ props: partProps, state: popupState })}
{:else}
	<div {...partProps}>{@render children?.()}</div>
{/if}
