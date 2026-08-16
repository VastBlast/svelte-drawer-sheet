import { describe, expect, it, vi } from 'vitest';
import { createDismissLayer, type DismissLayerHandlers } from './dismiss-layer.js';

class NativeEvent extends Event {
	readonly #path: EventTarget[];

	constructor(type: string, path: EventTarget[]) {
		super(type, { bubbles: true, cancelable: true });
		this.#path = path;
	}

	override composedPath(): EventTarget[] {
		return this.#path;
	}
}

class NativePointerEvent extends NativeEvent {
	constructor(
		path: EventTarget[],
		readonly button = 0,
		readonly isPrimary = true,
		readonly pointerId = 1,
		type = 'pointerdown'
	) {
		super(type, path);
	}
}

function pointer(type: 'pointerdown' | 'pointerup' | 'pointercancel', path: EventTarget[]) {
	return new NativePointerEvent(path, 0, true, 1, type);
}

class NativeMouseEvent extends NativeEvent {
	constructor(
		path: EventTarget[],
		readonly detail = 1
	) {
		super('click', path);
	}
}

class NativeFocusEvent extends NativeEvent {
	constructor(path: EventTarget[]) {
		super('focusin', path);
	}
}

class NativeKeyboardEvent extends NativeEvent {
	constructor(
		readonly key: string,
		readonly isComposing = false
	) {
		super('keydown', []);
	}
}

class OwnerDocument extends EventTarget {
	listenerCount = 0;

	override addEventListener(
		type: string,
		callback: EventListenerOrEventListenerObject | null,
		options?: AddEventListenerOptions | boolean
	): void {
		this.listenerCount += 1;
		super.addEventListener(type, callback, options);
	}

	override removeEventListener(
		type: string,
		callback: EventListenerOrEventListenerObject | null,
		options?: EventListenerOptions | boolean
	): void {
		this.listenerCount -= 1;
		super.removeEventListener(type, callback, options);
	}
}

function element(document: OwnerDocument): HTMLElement {
	return {
		isConnected: true,
		ownerDocument: document,
		getRootNode: () => document
	} as unknown as HTMLElement;
}

describe('createDismissLayer', () => {
	it('routes only primary outside presses to the active topmost layer', () => {
		const document = new OwnerDocument();
		const outside = {} as EventTarget;
		const parentElement = element(document);
		const childElement = element(document);
		const parentPress = vi.fn();
		const childPress = vi.fn();
		let intentionalOutsidePress = false;
		const parent = createDismissLayer(() => ({ onPointerOutside: parentPress }));
		const child = createDismissLayer(() => ({
			intentionalOutsidePress,
			onPointerOutside: childPress
		}));
		parent.attach(parentElement);
		child.attach(childElement);
		expect(document.listenerCount).toBe(8);

		document.dispatchEvent(new NativePointerEvent([childElement, document]));
		document.dispatchEvent(new NativePointerEvent([outside, document], 1));
		document.dispatchEvent(new NativePointerEvent([outside, document], 0, false));
		expect(childPress).not.toHaveBeenCalled();

		const press = new NativePointerEvent([outside, document]);
		document.dispatchEvent(press);
		expect(childPress).toHaveBeenCalledOnce();
		expect(childPress).toHaveBeenCalledWith(press);
		expect(parentPress).not.toHaveBeenCalled();

		child.setActive(false);
		document.dispatchEvent(new NativePointerEvent([outside, document]));
		expect(parentPress).toHaveBeenCalledOnce();

		child.setActive(true);
		document.dispatchEvent(new NativePointerEvent([outside, document]));
		expect(childPress).toHaveBeenCalledTimes(2);

		intentionalOutsidePress = true;
		document.dispatchEvent(pointer('pointerdown', [outside, document]));
		document.dispatchEvent(pointer('pointerup', [childElement, document]));
		document.dispatchEvent(new NativeMouseEvent([childElement, document]));
		document.dispatchEvent(pointer('pointerdown', [childElement, document]));
		document.dispatchEvent(pointer('pointerup', [outside, document]));
		document.dispatchEvent(new NativeMouseEvent([outside, document]));
		expect(childPress).toHaveBeenCalledTimes(2);
		document.dispatchEvent(pointer('pointerdown', [outside, document]));
		document.dispatchEvent(pointer('pointerup', [outside, document]));
		const click = new NativeMouseEvent([outside, document]);
		document.dispatchEvent(click);
		expect(childPress).toHaveBeenCalledTimes(3);
		expect(childPress).toHaveBeenLastCalledWith(click);
		const virtualClick = new NativeMouseEvent([outside, document], 0);
		document.dispatchEvent(virtualClick);
		expect(childPress).toHaveBeenLastCalledWith(virtualClick);

		child.destroy();
		expect(document.listenerCount).toBe(8);
		parent.destroy();
		expect(document.listenerCount).toBe(0);
	});

	it('uses live nesting and handler state for focus and Escape without falling through', () => {
		const document = new OwnerDocument();
		const outside = {} as EventTarget;
		const parentElement = element(document);
		const childElement = element(document);
		const parentFocus = vi.fn();
		const parentEscape = vi.fn();
		const childFocus = vi.fn();
		const firstEscape = vi.fn();
		const nextEscape = vi.fn();
		let topmost = false;
		let handlers: DismissLayerHandlers = {
			isTopmost: () => topmost,
			parentElement: () => parentElement,
			onFocusOutside: childFocus,
			onEscapeKeydown: firstEscape
		};
		const parent = createDismissLayer(() => ({
			onFocusOutside: parentFocus,
			onEscapeKeydown: parentEscape
		}));
		const child = createDismissLayer(() => handlers);
		// Svelte may activate the parent after its child in the same flush. Contextual nesting must
		// still select the child instead of relying only on registration order.
		child.attach(childElement);
		parent.attach(parentElement);

		document.dispatchEvent(new NativeFocusEvent([outside, document]));
		document.dispatchEvent(new NativeKeyboardEvent('Escape'));
		expect(
			child.handleEscapeKeydown(new NativeKeyboardEvent('Escape') as unknown as KeyboardEvent)
		).toBe(false);
		expect(childFocus).not.toHaveBeenCalled();
		expect(firstEscape).not.toHaveBeenCalled();
		expect(parentFocus).not.toHaveBeenCalled();
		expect(parentEscape).not.toHaveBeenCalled();

		topmost = true;
		handlers = { ...handlers, onEscapeKeydown: nextEscape };
		const focus = new NativeFocusEvent([outside, document]);
		document.dispatchEvent(focus);
		const localEscape = new NativeKeyboardEvent('Escape') as unknown as KeyboardEvent;
		expect(parent.handleEscapeKeydown(localEscape)).toBe(false);
		expect(child.handleEscapeKeydown(localEscape)).toBe(true);
		document.dispatchEvent(new NativeKeyboardEvent('Enter'));
		document.dispatchEvent(new NativeKeyboardEvent('Escape', true));
		const escape = new NativeKeyboardEvent('Escape');
		document.dispatchEvent(escape);
		expect(childFocus).toHaveBeenCalledWith(focus);
		expect(firstEscape).not.toHaveBeenCalled();
		expect(nextEscape).toHaveBeenCalledTimes(2);
		expect(nextEscape).toHaveBeenNthCalledWith(1, localEscape);
		expect(nextEscape).toHaveBeenCalledWith(escape);
	});

	it('isolates owner documents and fully detaches replacements and destroyed controllers', () => {
		const firstDocument = new OwnerDocument();
		const secondDocument = new OwnerDocument();
		const firstElement = element(firstDocument);
		const replacement = element(firstDocument);
		const onPress = vi.fn();
		const layer = createDismissLayer(() => ({ onPointerOutside: onPress }));
		const staleCleanup = layer.attach(firstElement);
		layer.attach(replacement);
		staleCleanup();
		expect(firstDocument.listenerCount).toBe(8);

		firstDocument.dispatchEvent(new NativePointerEvent([firstElement, firstDocument]));
		expect(onPress).toHaveBeenCalledOnce();
		secondDocument.dispatchEvent(new NativePointerEvent([{} as EventTarget, secondDocument]));
		expect(onPress).toHaveBeenCalledOnce();

		// Adoption changes `ownerDocument`; teardown must still clean the document of registration.
		(replacement as unknown as { ownerDocument: OwnerDocument }).ownerDocument = secondDocument;
		layer.destroy();
		expect(firstDocument.listenerCount).toBe(0);
		firstDocument.dispatchEvent(new NativePointerEvent([firstElement, firstDocument]));
		expect(onPress).toHaveBeenCalledOnce();
	});

	it('does not dismiss the drawer while Escape is settling an IME composition', () => {
		vi.useFakeTimers();
		try {
			const document = new OwnerDocument();
			const onEscape = vi.fn();
			const layer = createDismissLayer(() => ({ onEscapeKeydown: onEscape }));
			layer.attach(element(document));

			document.dispatchEvent(new NativeEvent('compositionstart', [document]));
			document.dispatchEvent(new NativeKeyboardEvent('Escape'));
			document.dispatchEvent(new NativeEvent('compositionend', [document]));
			document.dispatchEvent(new NativeKeyboardEvent('Escape'));
			expect(onEscape).not.toHaveBeenCalled();

			vi.advanceTimersByTime(5);
			document.dispatchEvent(new NativeKeyboardEvent('Escape'));
			expect(onEscape).toHaveBeenCalledOnce();
			layer.destroy();
		} finally {
			vi.useRealTimers();
		}
	});
});
