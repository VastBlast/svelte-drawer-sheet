<script lang="ts">
	import { untrack } from 'svelte';
	import { createAttachmentKey } from 'svelte/attachments';
	import type { DrawerPortalProps } from '../types.js';
	import { provideDrawerPortal } from '../internal/context.js';
	import { isComposedDescendant, isHTMLElement } from '../internal/dom.js';

	let { to, disabled = false, keepMounted = false, children }: DrawerPortalProps = $props();
	const attachmentKey = createAttachmentKey();
	let portal = $state.raw<HTMLElement | null>(null);
	let anchor: Comment | null = null;

	provideDrawerPortal({
		get keepMounted() {
			return keepMounted;
		}
	});

	function move(element: HTMLElement): void {
		if (disabled) {
			anchor?.parentNode?.insertBefore(element, anchor.nextSibling);
			return;
		}

		const document = anchor?.ownerDocument ?? element.ownerDocument;
		let target: Element | ShadowRoot | null = null;
		if (typeof to === 'string') {
			try {
				target = document.querySelector(to);
			} catch {
				// An invalid or not-yet-mounted target falls back to the document portal root.
			}
		} else if (to) {
			target = to;
		}
		// Svelte delegates component events at the app root. A closed shadow tree hides its event path
		// from that root, so accepting one here would silently break consumer handlers after moving.
		if (target?.nodeType === 11 && 'mode' in target && target.mode === 'closed') {
			throw new TypeError('Drawer.Portal `to` does not support a closed ShadowRoot.');
		}
		if (
			target &&
			(target.ownerDocument !== document ||
				!target.isConnected ||
				isComposedDescendant(element, target))
		) {
			throw new TypeError(
				'Drawer.Portal `to` must be a connected element in the same document and outside the portal.'
			);
		}
		(target ?? document.body).append(element);
	}

	function attach(element: Element) {
		if (!isHTMLElement(element)) return;
		portal = element;
		anchor = element.ownerDocument.createComment('drawer-portal');
		element.before(anchor);
		untrack(() => move(element));
		return () => {
			// A portaled node no longer shares Svelte's original DOM parent. Remove it explicitly so
			// rapid route/component teardown cannot leave an orphaned modal shield in document.body.
			element.remove();
			anchor?.remove();
			if (portal === element) portal = null;
			anchor = null;
		};
	}

	$effect(() => {
		const element = portal;
		if (!element) return;
		move(element);
	});
</script>

<div data-drawer-portal="" style="display: contents" {...{ [attachmentKey]: attach }}>
	{@render children?.()}
</div>
