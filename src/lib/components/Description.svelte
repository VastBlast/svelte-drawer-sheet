<script lang="ts">
	import { createAttachmentKey } from 'svelte/attachments';
	import type { DrawerDescriptionProps } from '../types.js';
	import { useDrawerRoot } from '../internal/context.js';
	import { isHTMLElement } from '../internal/dom.js';

	const uid = $props.id();
	let {
		id = `drawer-description-${uid}`,
		ref = $bindable(null),
		children,
		child,
		...rest
	}: DrawerDescriptionProps = $props();
	const root = useDrawerRoot();
	const attachmentKey = createAttachmentKey();
	const partState = {};

	function attach(node: Element) {
		if (!isHTMLElement(node)) return;
		ref = node;
		const unregister = root.registerDescription(node, id);
		return () => {
			if (ref === node) ref = null;
			// See Title: a microtask still updates live conditional content without touching a parent
			// render effect that has already been destroyed.
			queueMicrotask(unregister);
		};
	}
</script>

{#snippet descriptionChild({ props }: { props: Record<string, unknown> })}
	{@const customProps = { ...props, ...rest, id, [attachmentKey]: attach }}
	{#if child}
		{@render child({ props: customProps, state: partState })}
	{:else}
		<p {...customProps}>{@render children?.()}</p>
	{/if}
{/snippet}

{@render descriptionChild({ props: {} })}
