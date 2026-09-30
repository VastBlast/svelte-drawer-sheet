import { describe, expect, it } from 'vitest';
import {
	dispatchCompatibilityClick,
	focusKeyboardInputWithoutPageScroll,
	isKeyboardTapMovement,
	resolveKeyboardInputTarget,
	resolveKeyboardScroll,
	resolveKeyboardTapTarget,
	resolveKeyboardViewport
} from './virtual-keyboard.js';

interface FakeElementOptions {
	readonly control?: HTMLElement;
	readonly disabled?: boolean;
	readonly editable?: boolean;
	readonly interactive?: boolean;
	readonly localName?: string;
	readonly parent?: HTMLElement;
	readonly type?: string;
}

function fakeElement({
	control,
	disabled = false,
	editable = false,
	interactive = false,
	localName = 'div',
	parent,
	type = ''
}: FakeElementOptions = {}): HTMLElement {
	const root = { nodeType: 9 };
	const element = {
		nodeType: 1,
		namespaceURI: 'http://www.w3.org/1999/xhtml',
		localName,
		type,
		control,
		assignedSlot: null,
		parentElement: parent ?? null,
		isContentEditable: editable,
		matches: (selector: string) => selector === ':disabled' && disabled,
		closest(selector: string) {
			if (selector === 'label') return localName === 'label' ? element : null;
			return interactive ? element : null;
		},
		getRootNode: () => root
	};
	return element as unknown as HTMLElement;
}

function pointRoot(
	elementFromPoint: (x: number, y: number) => Element | null
): Parameters<typeof resolveKeyboardTapTarget>[0] {
	return { nodeType: 9, elementFromPoint } as Parameters<typeof resolveKeyboardTapTarget>[0];
}

describe('resolveKeyboardViewport', () => {
	it('resolves the keyboard-visible band and bottom inset', () => {
		expect(resolveKeyboardViewport(800, 500, 0, 1)).toEqual({
			top: 0,
			bottom: 500,
			inset: 300
		});
		expect(resolveKeyboardViewport(800, 500, 40, 1)).toEqual({
			top: 40,
			bottom: 540,
			inset: 260
		});
	});

	it('ignores browser chrome, pinch zoom, and invalid geometry', () => {
		expect(resolveKeyboardViewport(800, 750, 0, 1)).toBeNull();
		expect(resolveKeyboardViewport(800, 500, 0, 1.2)).toBeNull();
		expect(resolveKeyboardViewport(0, 500, 0, 1)).toBeNull();
	});
});

describe('resolveKeyboardScroll', () => {
	it('centers the target within the clipped scroller and reports keyboard overlap', () => {
		expect(
			resolveKeyboardScroll({
				keyboardTop: 20,
				keyboardBottom: 500,
				scrollerTop: 80,
				scrollerBottom: 700,
				targetTop: 500,
				targetBottom: 540,
				scrollTop: 100,
				maxScrollTop: 600
			})
		).toEqual({ overlap: 200, destination: 330 });
	});

	it('leaves a target that is already visible where it is', () => {
		expect(
			resolveKeyboardScroll({
				keyboardTop: 20,
				keyboardBottom: 500,
				scrollerTop: 80,
				scrollerBottom: 700,
				targetTop: 200,
				targetBottom: 240,
				scrollTop: 100,
				maxScrollTop: 600
			})
		).toEqual({ overlap: 200, destination: null });
	});

	it('clamps the destination and handles unusable visible bands', () => {
		const geometry = {
			keyboardTop: 0,
			keyboardBottom: 500,
			scrollerTop: 100,
			scrollerBottom: 700,
			targetTop: 900,
			targetBottom: 940,
			scrollTop: 0,
			maxScrollTop: 250
		};
		expect(resolveKeyboardScroll(geometry)).toEqual({ overlap: 200, destination: 250 });
		expect(
			resolveKeyboardScroll({ ...geometry, keyboardBottom: 110, maxScrollTop: 0 }).destination
		).toBeNull();
	});
});

describe('mobile keyboard taps', () => {
	it('resolves labels and editing hosts while excluding controls without a text keyboard', () => {
		const input = fakeElement({ localName: 'input', type: 'text', interactive: true });
		const label = fakeElement({ localName: 'label', control: input });
		const editor = fakeElement({ editable: true });
		const editorChild = fakeElement({ editable: true, parent: editor });

		expect(resolveKeyboardInputTarget(label)).toBe(input);
		expect(resolveKeyboardInputTarget(editorChild)).toBe(editor);
		expect(
			resolveKeyboardInputTarget(
				fakeElement({ localName: 'input', type: 'text', disabled: true, interactive: true })
			)
		).toBeNull();
		expect(
			resolveKeyboardInputTarget(
				fakeElement({ localName: 'input', type: 'date', interactive: true })
			)
		).toBeNull();
	});

	it('uses lift-point hit testing without stealing taps from neighboring controls', () => {
		const input = fakeElement({ localName: 'input', type: 'text', interactive: true });
		const label = fakeElement({ localName: 'label', control: input });
		const button = fakeElement({ localName: 'button', interactive: true });
		const wrapper = fakeElement();

		expect(
			resolveKeyboardTapTarget(
				pointRoot(() => button),
				input,
				0,
				0
			)
		).toBeNull();
		expect(
			resolveKeyboardTapTarget(
				pointRoot((_x, y) => (y === 16 ? input : wrapper)),
				wrapper,
				0,
				0
			)
		).toEqual({ focusTarget: input, clickTarget: input });
		expect(
			resolveKeyboardTapTarget(
				pointRoot(() => null),
				label,
				0,
				0
			)
		).toEqual({
			focusTarget: input,
			clickTarget: label
		});
	});

	it('accepts tap slop at the boundary and rejects drags on either axis', () => {
		expect(isKeyboardTapMovement({ x: 20, y: 30 }, { x: 30, y: 20 })).toBe(true);
		expect(isKeyboardTapMovement({ x: 20, y: 30 }, { x: 31, y: 30 })).toBe(false);
		expect(isKeyboardTapMovement({ x: 20, y: 30 }, { x: 20, y: 41 })).toBe(false);
	});

	it('focuses against hidden geometry, restores styles, and recreates the canceled click', () => {
		const calls: Array<{ readonly name: string; readonly value?: unknown }> = [];
		const style = {
			opacity: '0.5',
			transform: 'scale(1)',
			transition: 'opacity 1s'
		};
		const document = { activeElement: null as Element | null, defaultView: null as Window | null };
		const target = fakeElement({ localName: 'input', type: 'text' });
		Object.assign(target, {
			style,
			ownerDocument: document,
			blur() {
				calls.push({ name: 'blur' });
				document.activeElement = null;
			},
			focus(value: FocusOptions) {
				calls.push({ name: 'focus', value: { value, style: { ...style } } });
				document.activeElement = target;
			}
		});
		document.activeElement = target;

		focusKeyboardInputWithoutPageScroll(target);

		expect(calls).toEqual([
			{ name: 'blur' },
			{
				name: 'focus',
				value: {
					value: { preventScroll: true },
					style: { opacity: '0', transform: 'translateY(-2000px)', transition: 'none' }
				}
			}
		]);
		expect(style).toEqual({
			opacity: '0.5',
			transform: 'scale(1)',
			transition: 'opacity 1s'
		});

		class FakePointerEvent {
			constructor(
				readonly type: string,
				readonly init: PointerEventInit
			) {}
		}
		let click: FakePointerEvent | null = null;
		document.defaultView = {
			PointerEvent: FakePointerEvent,
			MouseEvent: FakePointerEvent
		} as unknown as Window;
		Object.assign(target, {
			dispatchEvent(event: FakePointerEvent) {
				click = event;
				return true;
			}
		});

		dispatchCompatibilityClick(target, { clientX: 12, clientY: 34 });

		expect(click).toMatchObject({
			type: 'click',
			init: {
				bubbles: true,
				cancelable: true,
				composed: true,
				clientX: 12,
				clientY: 34,
				detail: 1,
				pointerType: 'touch'
			}
		});
	});
});
