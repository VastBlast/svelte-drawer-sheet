<script lang="ts" generics="Payload = unknown">
	import { untrack } from 'svelte';
	import { createAttachmentKey } from 'svelte/attachments';
	import type { DrawerTriggerProps } from '../types.js';
	import { useOptionalDrawerRoot } from '../internal/context.js';
	import { isHTMLElement } from '../internal/dom.js';
	import { createChangeEventDetails } from '../internal/events.js';
	import { buttonPartProps, createButtonPress } from '../internal/press.js';

	let {
		handle,
		payload,
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
	}: DrawerTriggerProps<Payload> = $props();

	const root = useOptionalDrawerRoot();
	const attachmentKey = createAttachmentKey();
	let activeElement = $state.raw<Element | null>(null);
	const partState = $derived({
		disabled: Boolean(disabled),
		open: handle
			? handle.isOpen && handle.activeTrigger === activeElement
			: Boolean(root?.open && root.activeTrigger === activeElement)
	});

	type ButtonEvent<T extends Event> = T & { currentTarget: EventTarget & HTMLButtonElement };
	const press = createButtonPress({
		disabled: () => Boolean(disabled),
		nativeButton: () => nativeButton,
		onclick: (event) => onclick?.(event as ButtonEvent<MouseEvent>),
		onkeydown: (event) => onkeydown?.(event as ButtonEvent<KeyboardEvent>),
		onkeyup: (event) => onkeyup?.(event as ButtonEvent<KeyboardEvent>),
		activate
	});

	function attach(element: Element) {
		activeElement = element;
		if (isHTMLElement(element)) ref = element;
		const clearPressed = () => press.release(element);
		element.addEventListener('blur', clearPressed);
		// Track only which registry owns the trigger. Payload stays lazy and registry mutations stay
		// outside the attachment effect, so changing a handle reattaches without self-subscribing.
		const registrationHandle = handle;
		const unregister = untrack(() =>
			registrationHandle
				? registrationHandle._registerTrigger(element, () => payload)
				: root?.registerTrigger(element, () => payload)
		);
		return () => {
			element.removeEventListener('blur', clearPressed);
			press.release(element);
			unregister?.();
			if (activeElement === element) activeElement = null;
			if (ref === element) ref = null;
		};
	}

	function activate(event: Event) {
		if (disabled || event.defaultPrevented || !activeElement) return;
		if (handle) {
			handle._openFromTrigger(payload, activeElement, event);
			return;
		}
		if (!root) throw new Error('Drawer.Trigger must be inside Drawer.Root or receive a handle.');
		const details = createChangeEventDetails('trigger-press', event, {
			trigger: activeElement
		});
		const open = !(root.open && root.activeTrigger === activeElement);
		root.requestOpen(open, details, open ? { payload, trigger: activeElement } : undefined);
	}

	let partProps = $derived({
		...rest,
		...buttonPartProps({
			nativeButton,
			disabled: Boolean(disabled),
			type,
			tabindex: rest.tabindex
		}),
		'aria-haspopup': 'dialog' as const,
		'aria-expanded': partState.open,
		'aria-controls': partState.open ? (handle?.contentId ?? root?.contentId) : undefined,
		'data-popup-open': partState.open ? '' : undefined,
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
