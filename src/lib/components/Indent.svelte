<script lang="ts">
	import { createAttachmentKey } from 'svelte/attachments';
	import type { DrawerIndentProps, DrawerSwipeBehavior } from '../types.js';
	import { CSS_VAR } from '../internal/constants.js';
	import { useOptionalDrawerProvider } from '../internal/context.js';
	import { isHTMLElement } from '../internal/dom.js';
	import { mergeStyles } from '../internal/styles.js';

	let { ref = $bindable(null), children, child, ...rest }: DrawerIndentProps = $props();
	const provider = useOptionalDrawerProvider();
	const attachmentKey = createAttachmentKey();
	const partState = $derived({ active: provider?.active ?? false });
	let swipeProgress = 0;
	let frontmostHeight = 0;
	let swiping = false;
	let swipeStrength = 1;
	let swipeEasing = '';
	let swipeBehavior: DrawerSwipeBehavior = 'drawer';

	function attach(element: Element) {
		if (!isHTMLElement(element)) return;
		ref = element;
		const unsubscribe = provider?.visualState.subscribe((visualState) => {
			swipeProgress = visualState.swipeProgress;
			frontmostHeight = visualState.frontmostHeight;
			swiping = visualState.swiping;
			swipeStrength = visualState.swipeStrength;
			swipeEasing = visualState.swipeEasing;
			swipeBehavior = visualState.swipeBehavior;
			element.style.setProperty(CSS_VAR.swipeProgress, `${swipeProgress}`);
			element.style.setProperty(CSS_VAR.swipeStrength, `${swipeStrength}`);
			if (swipeEasing) element.style.setProperty(CSS_VAR.swipeEasing, swipeEasing);
			else element.style.removeProperty(CSS_VAR.swipeEasing);
			if (frontmostHeight > 0) element.style.setProperty(CSS_VAR.height, `${frontmostHeight}px`);
			else element.style.removeProperty(CSS_VAR.height);
			element.toggleAttribute('data-swiping', swiping);
			element.setAttribute('data-swipe-behavior', swipeBehavior);
		});
		return () => {
			unsubscribe?.();
			swipeProgress = 0;
			frontmostHeight = 0;
			swiping = false;
			swipeStrength = 1;
			swipeEasing = '';
			swipeBehavior = 'drawer';
			element.style.setProperty(CSS_VAR.swipeProgress, '0');
			element.style.setProperty(CSS_VAR.swipeStrength, '1');
			element.style.removeProperty(CSS_VAR.swipeEasing);
			element.style.removeProperty(CSS_VAR.height);
			element.removeAttribute('data-swiping');
			element.setAttribute('data-swipe-behavior', 'drawer');
			if (ref === element) ref = null;
		};
	}

	let partProps = $derived({
		...rest,
		style: mergeStyles(
			rest.style,
			`${CSS_VAR.swipeProgress}: ${swipeProgress}`,
			`${CSS_VAR.swipeStrength}: ${swipeStrength}`,
			swipeEasing ? `${CSS_VAR.swipeEasing}: ${swipeEasing}` : undefined,
			frontmostHeight > 0 ? `${CSS_VAR.height}: ${frontmostHeight}px` : undefined
		),
		'data-active': partState.active ? '' : undefined,
		'data-inactive': partState.active ? undefined : '',
		'data-swiping': swiping ? '' : undefined,
		'data-swipe-behavior': swipeBehavior,
		[attachmentKey]: attach
	});
</script>

{#if child}
	{@render child({ props: partProps, state: partState })}
{:else}
	<div {...partProps}>{@render children?.()}</div>
{/if}
