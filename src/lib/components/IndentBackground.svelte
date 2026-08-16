<script lang="ts">
	import { createAttachmentKey } from 'svelte/attachments';
	import type { DrawerIndentProps } from '../types.js';
	import { useOptionalDrawerProvider } from '../internal/context.js';
	import { isHTMLElement } from '../internal/dom.js';

	let { ref = $bindable(null), children, child, ...rest }: DrawerIndentProps = $props();
	const provider = useOptionalDrawerProvider();
	const attachmentKey = createAttachmentKey();
	const partState = $derived({ active: provider?.active ?? false });

	function attach(element: Element) {
		if (!isHTMLElement(element)) return;
		ref = element;
		return () => {
			if (ref === element) ref = null;
		};
	}

	let partProps = $derived({
		...rest,
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
