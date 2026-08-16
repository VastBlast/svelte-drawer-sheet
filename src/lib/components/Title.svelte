<script lang="ts">
	import { createAttachmentKey } from 'svelte/attachments';
	import type { DrawerTitleProps } from '../types.js';
	import { useDrawerRoot } from '../internal/context.js';
	import { isHTMLElement } from '../internal/dom.js';

	const uid = $props.id();
	let {
		id = `drawer-title-${uid}`,
		level = 2,
		ref = $bindable(null),
		children,
		child,
		...rest
	}: DrawerTitleProps = $props();
	const root = useDrawerRoot();
	const attachmentKey = createAttachmentKey();
	const partState = {};
	let tag = $derived(`h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6');

	function attach(node: Element) {
		if (!isHTMLElement(node)) return;
		ref = node;
		const unregister = root.registerTitle(node, id);
		return () => {
			if (ref === node) ref = null;
			// Child attachments can tear down after their parent's render effect. Deferring the source
			// update avoids notifying an already-destroyed consumer during whole-tree destruction.
			queueMicrotask(unregister);
		};
	}
</script>

{#snippet titleChild({ props }: { props: Record<string, unknown> })}
	{@const customProps = { ...props, ...rest, id, [attachmentKey]: attach }}
	{#if child}
		{@render child({ props: customProps, state: partState })}
	{:else}
		<svelte:element this={tag} {...customProps}>{@render children?.()}</svelte:element>
	{/if}
{/snippet}

{@render titleChild({ props: {} })}
