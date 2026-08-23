<script lang="ts">
	import { untrack } from 'svelte';
	import { createAttachmentKey } from 'svelte/attachments';
	import type { DrawerViewportProps } from '../types.js';
	import { useDrawerRoot, useOptionalDrawerPortal } from '../internal/context.js';
	import { isHTMLElement } from '../internal/dom.js';
	import { attachDismissGesture } from '../internal/gesture.js';
	import { CSS_VAR } from '../internal/constants.js';
	import { mergeStyles } from '../internal/styles.js';

	let { ref = $bindable(null), children, child, ...rest }: DrawerViewportProps = $props();
	const root = useDrawerRoot();
	const portal = useOptionalDrawerPortal();
	const attachmentKey = createAttachmentKey();
	let internalBackdrop = $state.raw<HTMLElement | null>(null);
	const partState = $derived({
		open: root.open,
		transitionStatus: root.transitionStatus,
		nested: Boolean(root.parent),
		nestedDrawerOpen: root.nestedOpenCount > 0
	});

	function attach(element: Element) {
		if (!isHTMLElement(element)) return;
		ref = element;
		const controllers = untrack(() => {
			// The negative z-index keeps the modal blocker under every popup style inside the
			// viewport's isolated stacking context, so consumer CSS never has to layer around it.
			const backdrop = element.ownerDocument.createElement('div');
			backdrop.dataset.drawerInternalBackdrop = '';
			backdrop.setAttribute('role', 'presentation');
			backdrop.setAttribute('aria-hidden', 'true');
			backdrop.style.cssText =
				'position:fixed;inset:0;z-index:-1;pointer-events:none;user-select:none;-webkit-user-select:none';
			backdrop.hidden = true;
			element.prepend(backdrop);
			return {
				backdrop,
				cleanMeasurement: root.attachViewport(element),
				cleanGesture: attachDismissGesture(element, root)
			};
		});
		internalBackdrop = controllers.backdrop;
		return () => {
			controllers.cleanGesture();
			controllers.cleanMeasurement();
			controllers.backdrop.remove();
			if (internalBackdrop === controllers.backdrop) internalBackdrop = null;
			if (ref === element) ref = null;
		};
	}

	$effect(() => {
		const backdrop = internalBackdrop;
		if (!backdrop) return;
		// Self-heal if consumer code replaced the viewport's children and dropped the blocker.
		if (!backdrop.isConnected && ref?.isConnected) ref.prepend(backdrop);
		const active = (root.open || root.transitionStatus === 'ending') && root.modal === true;
		backdrop.hidden = !active;
		backdrop.style.pointerEvents = active ? 'auto' : 'none';
	});

	let partProps = $derived({
		...rest,
		style: mergeStyles(
			rest.style,
			`${CSS_VAR.keyboardInset}: ${root.keyboardInset}px`,
			`${CSS_VAR.nestingDepth}: ${root.nestingDepth}`,
			// The isolated stacking context guarantees the internal modal blocker layers under the
			// popup in every engine, including ones where plain `position: fixed` does not isolate.
			'isolation: isolate'
		),
		'data-open': root.open ? '' : undefined,
		'data-closed': root.open ? undefined : '',
		'data-nested': root.parent ? '' : undefined,
		'data-nested-drawer-open': root.nestedVisualCount > 0 ? '' : undefined,
		hidden: !root.mounted,
		// The viewport stays interactive through the exit so the modal blocker inside it can keep
		// shielding the page from trailing clicks; the popup's own `inert` covers drawer content.
		inert: root.open || root.transitionStatus === 'ending' ? undefined : true,
		[attachmentKey]: attach
	});
</script>

{#if root.mounted || portal?.keepMounted}
	{#if child}
		{@render child({ props: partProps, state: partState })}
	{:else}
		<div {...partProps}>{@render children?.()}</div>
	{/if}
{/if}
