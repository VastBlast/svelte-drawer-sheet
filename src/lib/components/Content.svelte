<script lang="ts">
	import { createAttachmentKey } from 'svelte/attachments';
	import type { DrawerContentProps } from '../types.js';
	import { ATTR } from '../internal/constants.js';
	import { isHTMLElement } from '../internal/dom.js';

	let { ref = $bindable(null), children, child, ...rest }: DrawerContentProps = $props();
	const attachmentKey = createAttachmentKey();
	const partState = {};

	function attach(element: Element) {
		if (!isHTMLElement(element)) return;
		ref = element;
		return () => {
			if (ref === element) ref = null;
		};
	}

	let partProps = $derived({ ...rest, [ATTR.content]: '', [attachmentKey]: attach });
</script>

{#if child}
	{@render child({ props: partProps, state: partState })}
{:else}
	<div {...partProps}>{@render children?.()}</div>
{/if}
