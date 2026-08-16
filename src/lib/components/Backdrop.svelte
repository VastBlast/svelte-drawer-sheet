<script lang="ts">
	import { untrack } from 'svelte';
	import { createAttachmentKey } from 'svelte/attachments';
	import type { DrawerBackdropProps } from '../types.js';
	import { CSS_VAR } from '../internal/constants.js';
	import { useDrawerRoot, useOptionalDrawerPortal } from '../internal/context.js';
	import { isHTMLElement } from '../internal/dom.js';
	import { mergeStyles } from '../internal/styles.js';

	let {
		forceRender = false,
		ref = $bindable(null),
		children,
		child,
		...rest
	}: DrawerBackdropProps = $props();
	const root = useDrawerRoot();
	const portal = useOptionalDrawerPortal();
	const attachmentKey = createAttachmentKey();
	const baseState = $derived({
		open: root.open,
		swiping: root.swiping
	});

	function attach(element: Element) {
		if (!isHTMLElement(element)) return;
		ref = element;
		// Attachment bodies are reactive effects. Setup must not subscribe to drawer state or a
		// gesture-start update would tear down and reattach this node mid-frame.
		const cleanup = untrack(() => {
			element.style.setProperty(
				CSS_VAR.swipeProgress,
				`${root.open ? root.settledSwipeProgress : 0}`
			);
			element.style.setProperty(CSS_VAR.swipeStrength, '1');
			return root.attachBackdrop(element);
		});
		return () => {
			cleanup();
			if (ref === element) ref = null;
		};
	}
</script>

{#snippet overlayChild()}
	{@const partState = { ...baseState, transitionStatus: root.transitionStatus }}
	{@const customProps = {
		...rest,
		// Svelte reapplies a spread style object when state attributes change. Carry the
		// imperative values through that update so a drag/release never flashes back to rest.
		style: mergeStyles(
			rest.style,
			`${CSS_VAR.swipeProgress}: ${root.backdropSwipeProgress}`,
			`${CSS_VAR.swipeStrength}: ${root.swipeStrength}`,
			root.backdropHeight > 0 ? `${CSS_VAR.height}: ${root.backdropHeight}px` : undefined,
			root.swiping ? 'transition: none' : undefined
		),
		role: 'presentation',
		'aria-hidden': true,
		hidden: !root.mounted,
		inert: root.open ? undefined : true,
		'data-open': root.open ? '' : undefined,
		'data-closed': root.open ? undefined : '',
		'data-starting-style': root.transitionStatus === 'starting' ? '' : undefined,
		'data-ending-style': root.transitionStatus === 'ending' ? '' : undefined,
		'data-swiping': root.swiping ? '' : undefined,
		'data-swipe-dismiss': root.swipeDismissed ? '' : undefined,
		[attachmentKey]: attach
	}}
	{#if child}
		{@render child({ props: customProps, state: partState })}
	{:else}
		<div {...customProps}>{@render children?.()}</div>
	{/if}
{/snippet}

{#if !root.parent || forceRender}
	{#if root.mounted || portal?.keepMounted}
		{@render overlayChild()}
	{/if}
{/if}
