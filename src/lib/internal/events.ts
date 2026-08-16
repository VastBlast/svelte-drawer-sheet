import type {
	DrawerChangeEventDetails,
	DrawerChangeEventReason,
	DrawerSnapPointChangeEventDetails
} from '../types.js';

interface ChangeDetailsOptions {
	trigger?: Element;
	onPreventUnmount?: () => void;
}

const unmountPreventionRequests = new WeakSet<DrawerChangeEventDetails>();

/** Dispatches the keyboard-equivalent click while preserving modifier keys and native activation. */
export function dispatchKeyboardClick(target: Element, source: KeyboardEvent): void {
	const ownerWindow = target.ownerDocument.defaultView;
	const ClickEvent = ownerWindow?.PointerEvent ?? ownerWindow?.MouseEvent;
	if (!ClickEvent) return;
	target.dispatchEvent(
		new ClickEvent('click', {
			bubbles: true,
			cancelable: true,
			composed: true,
			detail: 0,
			shiftKey: source.shiftKey,
			ctrlKey: source.ctrlKey,
			altKey: source.altKey,
			metaKey: source.metaKey
		})
	);
}

function fallbackEvent(): Event {
	return typeof Event === 'function' ? new Event('drawer') : ({ type: 'drawer' } as Event);
}

/**
 * Focus events are not cancelable in browsers. This proxy preserves their complete native API
 * while giving component callbacks a reliable `preventDefault()` contract.
 */
export function createCancelableEvent<T extends Event>(event: T): T {
	if (event.cancelable) return event;
	let defaultPrevented = event.defaultPrevented;
	return new Proxy(event, {
		get(target, property) {
			if (property === 'cancelable') return true;
			if (property === 'defaultPrevented') return defaultPrevented || target.defaultPrevented;
			if (property === 'preventDefault') {
				return () => {
					defaultPrevented = true;
					target.preventDefault();
				};
			}
			const value: unknown = Reflect.get(target, property, target);
			return typeof value === 'function' ? value.bind(target) : value;
		},
		set(target, property, value) {
			return Reflect.set(target, property, value, target);
		}
	}) as T;
}

export function createChangeEventDetails(
	reason: DrawerChangeEventReason,
	event: Event = fallbackEvent(),
	options: ChangeDetailsOptions = {}
): DrawerChangeEventDetails {
	let canceled = false;
	const details: DrawerChangeEventDetails = {
		reason,
		event,
		trigger: options.trigger,
		get isCanceled() {
			return canceled;
		},
		cancel() {
			canceled = true;
		},
		preventUnmountOnClose() {
			unmountPreventionRequests.add(details);
			options.onPreventUnmount?.();
		}
	};
	return details;
}

export function isUnmountPreventionRequested(details: DrawerChangeEventDetails): boolean {
	return unmountPreventionRequests.has(details);
}

export function toSnapPointDetails(
	details: DrawerChangeEventDetails
): DrawerSnapPointChangeEventDetails {
	// Snap cancellation is independent from the open-state request that caused the reset.
	return createChangeEventDetails(details.reason, details.event, { trigger: details.trigger });
}
