<script lang="ts">
	import { untrack } from 'svelte';
	import { createAttachmentKey } from 'svelte/attachments';
	import type { DrawerSwipeAreaProps } from '../types.js';
	import { oppositeDirection } from '../internal/constants.js';
	import { useDrawerRoot } from '../internal/context.js';
	import { isHTMLElement } from '../internal/dom.js';
	import {
		attachSwipeAreaGesture,
		type SwipeAreaGestureController
	} from '../internal/swipe-area-gesture.js';

	let {
		disabled = false,
		swipeDirection,
		ref = $bindable(null),
		children,
		child,
		...rest
	}: DrawerSwipeAreaProps = $props();
	const root = useDrawerRoot();
	const attachmentKey = createAttachmentKey();
	let swiping = $state(false);
	let controller = $state.raw<SwipeAreaGestureController | null>(null);
	let resolvedDirection = $derived(swipeDirection ?? oppositeDirection[root.swipeDirection]);
	const partState = $derived({
		open: root.open,
		swiping,
		swipeDirection: resolvedDirection,
		disabled: Boolean(disabled)
	});

	function attach(element: Element) {
		if (!isHTMLElement(element)) return;
		ref = element;
		// The controller's first style sync reads open/direction/disabled. The explicit effect
		// below owns those updates; tracking them here would destroy an in-flight edge gesture.
		const attached = untrack(() =>
			attachSwipeAreaGesture(element, root, {
				disabled: () => disabled,
				direction: () => resolvedDirection,
				onSwipingChange: (value) => (swiping = value)
			})
		);
		controller = attached;
		return () => {
			attached.destroy();
			if (controller === attached) controller = null;
			if (ref === element) ref = null;
		};
	}

	$effect(() => {
		// The gesture captures direction per session, while idle interaction styles stay reactive.
		controller?.update();
	});

	let partProps = $derived({
		...rest,
		role: 'presentation',
		'aria-hidden': true,
		'data-open': root.open ? '' : undefined,
		'data-closed': root.open ? undefined : '',
		'data-disabled': disabled ? '' : undefined,
		'data-swipe-direction': resolvedDirection,
		'data-swiping': swiping ? '' : undefined,
		[attachmentKey]: attach
	});
</script>

{#if child}
	{@render child({ props: partProps, state: partState })}
{:else}
	<div {...partProps}>{@render children?.()}</div>
{/if}
