<script lang="ts">
	import { createAttachmentKey } from 'svelte/attachments';
	import type { DrawerIndentProps } from '../types.js';
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

	function attach(element: Element) {
		if (!isHTMLElement(element)) return;
		ref = element;
		const unsubscribe = provider?.visualState.subscribe((visualState) => {
			swipeProgress = visualState.swipeProgress;
			frontmostHeight = visualState.frontmostHeight;
			element.style.setProperty(CSS_VAR.swipeProgress, `${swipeProgress}`);
			if (frontmostHeight > 0) element.style.setProperty(CSS_VAR.height, `${frontmostHeight}px`);
			else element.style.removeProperty(CSS_VAR.height);
		});
		return () => {
			unsubscribe?.();
			swipeProgress = 0;
			frontmostHeight = 0;
			element.style.setProperty(CSS_VAR.swipeProgress, '0');
			element.style.removeProperty(CSS_VAR.height);
			if (ref === element) ref = null;
		};
	}

	let partProps = $derived({
		...rest,
		style: mergeStyles(
			rest.style,
			`${CSS_VAR.swipeProgress}: ${swipeProgress}`,
			frontmostHeight > 0 ? `${CSS_VAR.height}: ${frontmostHeight}px` : undefined
		),
		'data-active': partState.active ? '' : undefined,
		'data-inactive': partState.active ? undefined : '',
		[attachmentKey]: attach
	});
</script>

{#if child}
	{@render child({ props: partProps, state: partState })}
{:else}
	<div {...partProps}>{@render children?.()}</div>
{/if}
