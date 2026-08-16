<script lang="ts" generics="Payload = unknown">
	import { onDestroy, tick, untrack } from 'svelte';
	import type { DrawerRootProps } from '../types.js';
	import {
		provideDrawerRoot,
		useOptionalDrawerProvider,
		useOptionalDrawerRoot
	} from '../internal/context.js';
	import { DrawerRootState } from '../internal/root-state.svelte.js';
	import { createChangeEventDetails } from '../internal/events.js';
	import { waitForAnimations } from '../internal/presence.js';

	let {
		defaultOpen = false,
		open = $bindable(defaultOpen),
		onOpenChange,
		onOpenChangeComplete,
		modal = true,
		disablePointerDismissal = false,
		swipeDirection = 'down',
		snapPoints,
		defaultSnapPoint,
		snapPoint = $bindable(),
		onSnapPointChange,
		snapToSequentialPoints = false,
		defaultTriggerId = null,
		triggerId = $bindable(defaultTriggerId),
		handle,
		actions = $bindable(),
		children
	}: DrawerRootProps<Payload> = $props();

	const parent = useOptionalDrawerRoot();
	const provider = useOptionalDrawerProvider();
	const state = new DrawerRootState<Payload>({
		getOpen: () => open,
		setOpen: (value) => (open = value),
		getModal: () => modal,
		getDisablePointerDismissal: () => disablePointerDismissal,
		getSwipeDirection: () => swipeDirection,
		getSnapPoints: () => snapPoints,
		getSnapPoint: () => snapPoint,
		setSnapPoint: (value) => (snapPoint = value),
		isSnapPointControlled: snapPoint !== undefined,
		getDefaultSnapPoint: () => defaultSnapPoint,
		getSnapToSequentialPoints: () => snapToSequentialPoints,
		getOnOpenChange: () => onOpenChange,
		getOnSnapPointChange: () => onSnapPointChange,
		getTriggerId: () => triggerId,
		setTriggerId: (value) => (triggerId = value),
		parent,
		provider
	});
	provideDrawerRoot(state);
	actions = state.actions;
	const exposedActions = actions;
	let observedOpen = state.open;

	function startTransition(targetOpen: boolean): () => void {
		let canceled = false;
		let completed = false;
		let frame: number | undefined;
		let frameWindow: Window | null = null;
		let cancelAnimations = () => {};

		if (targetOpen) {
			const alreadyPrepared = state.transitionStatus === 'starting';
			state.preventUnmount = false;
			state.mounted = true;
			state.transitionStatus = 'starting';
			if (!alreadyPrepared) {
				if (!state.swipeAreaActive) state.resetDrag();
				state.clearSwipeRelease();
			}
		} else {
			state.transitionStatus = 'ending';
		}

		function complete(): void {
			if (canceled || completed || state.open !== targetOpen) return;
			completed = true;
			state.completeOpenChange(targetOpen);
			onOpenChangeComplete?.(targetOpen);
		}

		void tick().then(() => {
			if (canceled || state.open !== targetOpen) return;
			const elements = [state.popup, state.backdrop].filter(
				(element): element is HTMLElement => element !== null
			);
			if (elements.length === 0) {
				complete();
				return;
			}

			const wait = () => {
				if (canceled) return;
				if (targetOpen) {
					// Removing the starting styles only transitions if they reached a style
					// computation first. An animation frame callback runs before that frame's
					// own recalc, so force one here rather than rely on another open side
					// effect (initial focus, the scroll lock) having caused it.
					for (const element of elements) void element.offsetWidth;
					state.transitionStatus = undefined;
				}
				let remaining = elements.length;
				const cleanups = elements.map((element) =>
					waitForAnimations(element, () => {
						remaining -= 1;
						if (remaining === 0) complete();
					})
				);
				cancelAnimations = () => cleanups.forEach((cleanup) => cleanup());
			};

			const ownerWindow = elements[0].ownerDocument.defaultView;
			if (targetOpen && ownerWindow) {
				// Starting styles need one painted frame before their removal can transition.
				frameWindow = ownerWindow;
				frame = frameWindow.requestAnimationFrame(() => {
					frame = undefined;
					wait();
				});
			} else {
				wait();
			}
		});

		return () => {
			canceled = true;
			cancelAnimations();
			if (frame !== undefined) frameWindow?.cancelAnimationFrame(frame);
		};
	}

	$effect(() => {
		const nextOpen = state.open;
		const expectedStatus = nextOpen ? 'starting' : 'ending';
		// requestOpen records the final edge, even when two writes collapse into one Svelte flush.
		if (nextOpen === observedOpen && untrack(() => state.transitionStatus) !== expectedStatus)
			return;
		observedOpen = nextOpen;
		return untrack(() => startTransition(nextOpen));
	});

	$effect(() => {
		provider?.setOpen(state, state.open);
		parent?.setNestedOpen(state, state.open);
		parent?.setNestedPresence(state, state.open || state.transitionStatus === 'ending');
		if (!state.open) {
			parent?.setNestedSwiping(state, false);
			parent?.setNestedProgress(state, 0);
		}
	});

	$effect(() => {
		parent?.setNestedHeight(state, state.open ? state.frontmostHeight : 0);
	});

	$effect(() => {
		if (!handle) return;
		return untrack(() => state.attachHandle(handle));
	});

	$effect(() => {
		const id = state.triggerId;
		const external = id ? handle?._resolveTrigger(id) : undefined;
		state.syncActiveTrigger(id, external);
	});

	$effect(() => {
		const watcherGeneration = state.closeWatcherGeneration;
		const ownerWindow = state.popup?.ownerDocument.defaultView;
		if (
			watcherGeneration < 0 ||
			!state.open ||
			state.nestedInteractionOpen ||
			!ownerWindow ||
			!/android/i.test(ownerWindow.navigator.userAgent)
		) {
			return;
		}
		const CloseWatcherConstructor = (
			ownerWindow as Window & {
				CloseWatcher?: new () => {
					destroy(): void;
					addEventListener(type: 'cancel' | 'close', fn: (e: Event) => void): void;
				};
			}
		).CloseWatcher;
		if (!CloseWatcherConstructor) return;

		const watcher = new CloseWatcherConstructor();
		let requested = false;
		const cancel = (event: Event) => {
			requested = true;
			const accepted = state.requestOpen(false, createChangeEventDetails('close-watcher', event));
			if (!accepted && event.cancelable) event.preventDefault();
		};
		const close = (event: Event) => {
			if (!requested) {
				state.requestOpen(false, createChangeEventDetails('close-watcher', event));
			}
			// A non-cancelable native request consumes its watcher even if the controlled close is
			// vetoed. Promote a fresh watcher without requiring an unrelated state change.
			if (state.open) state.closeWatcherGeneration += 1;
		};
		watcher.addEventListener('cancel', cancel);
		watcher.addEventListener('close', close);
		return () => watcher.destroy();
	});

	onDestroy(() => {
		state.destroy();
		if (actions === exposedActions) actions = undefined;
		provider?.remove(state);
		parent?.setNestedOpen(state, false);
		parent?.setNestedPresence(state, false);
		parent?.setNestedHeight(state, 0);
		parent?.setNestedSwiping(state, false);
		parent?.setNestedProgress(state, 0);
	});
</script>

{@render children?.({ open: state.open, payload: state.payload })}
