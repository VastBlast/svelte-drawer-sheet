import type { HTMLButtonAttributes } from 'svelte/elements';
import { isValidLinkElement } from './dom.js';
import { dispatchKeyboardClick } from './events.js';

export interface ButtonPressOptions {
	disabled(): boolean;
	nativeButton(): boolean;
	onclick?(event: MouseEvent): void;
	onkeydown?(event: KeyboardEvent): void;
	onkeyup?(event: KeyboardEvent): void;
	/** Runs the part's action after an uncanceled click or keyboard activation. */
	activate(event: Event): void;
}

export interface ButtonPress {
	handleClick(event: MouseEvent): void;
	handleKeydown(event: KeyboardEvent): void;
	handleKeyup(event: KeyboardEvent): void;
	/** Clears armed keyboard state when the element blurs or detaches. */
	release(element: Element): void;
}

/**
 * Native-quality activation for button-like parts. Custom (non-button) elements gain Enter/Space
 * handling, while native buttons and links keep browser activation and only attribute its source
 * keyboard event so interaction-type detection survives the synthetic `detail: 0` click.
 */
export function createButtonPress(options: ButtonPressOptions): ButtonPress {
	let spaceKeyDownTarget: EventTarget | null = null;
	let keyboardActivationEvent: KeyboardEvent | null = null;
	let nativeKeyboardActivationEvent: KeyboardEvent | null = null;

	function activateFromKeyboard(target: Element, event: KeyboardEvent): void {
		keyboardActivationEvent = event;
		try {
			dispatchKeyboardClick(target, event);
		} finally {
			keyboardActivationEvent = null;
		}
	}

	return {
		handleClick(event) {
			if (options.disabled()) {
				event.preventDefault();
				return;
			}
			const sourceEvent =
				keyboardActivationEvent ??
				(event.detail === 0 ? nativeKeyboardActivationEvent : null) ??
				event;
			nativeKeyboardActivationEvent = null;
			options.onclick?.(event);
			if (!event.defaultPrevented) options.activate(sourceEvent);
		},
		handleKeydown(event) {
			if (options.disabled()) {
				spaceKeyDownTarget = null;
				if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
				return;
			}
			options.onkeydown?.(event);
			if (options.nativeButton()) {
				if (
					event.target === event.currentTarget &&
					!event.repeat &&
					(event.key === 'Enter' || event.key === ' ')
				) {
					nativeKeyboardActivationEvent = event.defaultPrevented ? null : event;
				}
				return;
			}
			if (event.target !== event.currentTarget) return;
			const target = event.currentTarget as Element;
			if (event.key === 'Enter' && isValidLinkElement(target)) {
				if (!event.repeat) {
					nativeKeyboardActivationEvent = event.defaultPrevented ? null : event;
				}
				return;
			}
			if (event.key === ' ') {
				const canceled = event.defaultPrevented;
				// Prevent page scroll for every repeat, but arm only the initial uncanceled press.
				event.preventDefault();
				if (!event.repeat) spaceKeyDownTarget = canceled ? null : target;
				return;
			}
			if (event.key === 'Enter' && !event.repeat && !event.defaultPrevented) {
				activateFromKeyboard(target, event);
				event.preventDefault();
			}
		},
		handleKeyup(event) {
			if (options.disabled()) {
				spaceKeyDownTarget = null;
				if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
				return;
			}
			options.onkeyup?.(event);
			if (options.nativeButton()) {
				if (
					event.target === event.currentTarget &&
					event.key === ' ' &&
					nativeKeyboardActivationEvent?.key === ' '
				) {
					nativeKeyboardActivationEvent = event.defaultPrevented ? null : event;
				}
				return;
			}
			if (event.key !== ' ') return;
			const target = event.currentTarget as Element;
			const armed = event.target === event.currentTarget && spaceKeyDownTarget === target;
			spaceKeyDownTarget = null;
			if (!armed || event.defaultPrevented) return;
			activateFromKeyboard(target, event);
		},
		release(element) {
			if (spaceKeyDownTarget === element) spaceKeyDownTarget = null;
			nativeKeyboardActivationEvent = null;
		}
	};
}

/** Shared native/custom button attributes for Trigger and Close. */
export function buttonPartProps(options: {
	nativeButton: boolean;
	disabled: boolean;
	type: HTMLButtonAttributes['type'];
	tabindex: number | null | undefined;
}) {
	const { nativeButton, disabled, type, tabindex } = options;
	return {
		type: nativeButton ? type : undefined,
		role: nativeButton ? undefined : ('button' as const),
		tabindex: nativeButton ? tabindex : disabled ? -1 : (tabindex ?? 0),
		disabled: nativeButton && disabled ? true : undefined,
		'aria-disabled': !nativeButton && disabled ? true : undefined,
		'data-disabled': disabled ? '' : undefined
	};
}
