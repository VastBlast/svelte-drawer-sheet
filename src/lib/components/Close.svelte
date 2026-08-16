<script lang="ts">
	import { createAttachmentKey } from 'svelte/attachments';
	import type { DrawerCloseProps } from '../types.js';
	import { useDrawerRoot } from '../internal/context.js';
	import { isHTMLElement } from '../internal/dom.js';
	import { createChangeEventDetails } from '../internal/events.js';
	import { buttonPartProps, createButtonPress } from '../internal/press.js';

	let {
		nativeButton = true,
		ref = $bindable(null),
		children,
		child,
		disabled = false,
		type = 'button',
		onclick,
		onkeydown,
		onkeyup,
		...rest
	}: DrawerCloseProps = $props();

	const root = useDrawerRoot();
	const attachmentKey = createAttachmentKey();
	const partState = $derived({ disabled: Boolean(disabled) });

	type ButtonEvent<T extends Event> = T & { currentTarget: EventTarget & HTMLButtonElement };
	const press = createButtonPress({
		disabled: () => Boolean(disabled),
		nativeButton: () => nativeButton,
		onclick: (event) => onclick?.(event as ButtonEvent<MouseEvent>),
		onkeydown: (event) => onkeydown?.(event as ButtonEvent<KeyboardEvent>),
		onkeyup: (event) => onkeyup?.(event as ButtonEvent<KeyboardEvent>),
		activate(event) {
			if (disabled || event.defaultPrevented) return;
			const details = createChangeEventDetails('close-press', event, {
				trigger: event.currentTarget as Element
			});
			root.requestOpen(false, details);
		}
	});

	function attach(element: Element) {
		if (isHTMLElement(element)) ref = element;
		const clearPressed = () => press.release(element);
		element.addEventListener('blur', clearPressed);
		return () => {
			element.removeEventListener('blur', clearPressed);
			press.release(element);
			if (ref === element) ref = null;
		};
	}

	let partProps = $derived({
		...rest,
		...buttonPartProps({
			nativeButton,
			disabled: Boolean(disabled),
			type,
			tabindex: rest.tabindex
		}),
		onclick: press.handleClick,
		onkeydown: press.handleKeydown,
		onkeyup: press.handleKeyup,
		[attachmentKey]: attach
	});
</script>

{#if child}
	{@render child({ props: partProps, state: partState })}
{:else}
	<button {...partProps}>{@render children?.()}</button>
{/if}
