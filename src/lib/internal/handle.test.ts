import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHandle, DrawerHandle } from './handle.svelte.js';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('DrawerHandle', () => {
	it('is inert while detached', () => {
		const handle = createHandle<{ id: number }>();

		expect(handle).toBeInstanceOf(DrawerHandle);
		expect(handle.isOpen).toBe(false);
		expect(handle.contentId).toBeUndefined();
		expect(handle.activeTrigger).toBeUndefined();
		expect(() => {
			handle.open();
			handle.openWithPayload({ id: 1 });
			handle.close();
		}).not.toThrow();
		expect(handle._openFromTrigger(undefined, {} as Element, new Event('click'))).toBe(false);
	});

	it('reflects live connection state and forwards imperative requests', () => {
		let open = false;
		let contentId: string | undefined = 'drawer-content';
		const activeTrigger = {} as Element;
		const requestOpen = vi.fn((nextOpen: boolean) => {
			open = nextOpen;
			return true;
		});
		const handle = createHandle<{ id: number }>();
		const cleanup = handle._attach({
			get open() {
				return open;
			},
			get contentId() {
				return contentId;
			},
			get activeTrigger() {
				return activeTrigger;
			},
			document: undefined,
			requestOpen
		});

		expect(handle.isOpen).toBe(false);
		expect(handle.contentId).toBe('drawer-content');

		handle.openWithPayload({ id: 7 });
		expect(requestOpen).toHaveBeenLastCalledWith(true, { payload: { id: 7 } });
		expect(handle.isOpen).toBe(true);

		contentId = undefined;
		expect(handle.activeTrigger).toBe(activeTrigger);
		expect(handle.contentId).toBeUndefined();

		handle.close();
		expect(requestOpen).toHaveBeenLastCalledWith(false);
		expect(handle.isOpen).toBe(false);

		cleanup();
		expect(handle.contentId).toBeUndefined();
	});

	it('resolves a trigger id and forwards trigger-originated events', () => {
		const trigger = {} as Element;
		const getElementById = vi.fn(() => trigger);
		vi.stubGlobal('document', { getElementById });
		const requestOpen = vi.fn(() => true);
		const handle = createHandle<string>();
		handle._attach({
			open: false,
			contentId: undefined,
			activeTrigger: undefined,
			document: undefined,
			requestOpen
		});

		handle.open('detached-trigger');
		expect(getElementById).toHaveBeenCalledWith('detached-trigger');
		expect(requestOpen).toHaveBeenLastCalledWith(true, { trigger });

		const event = new Event('click');
		expect(handle._openFromTrigger('payload', trigger, event)).toBe(true);
		expect(requestOpen).toHaveBeenLastCalledWith(true, { payload: 'payload', trigger, event });
	});

	it('restores the previous mounted connection after an overlapping root detaches', () => {
		const handle = createHandle();
		const firstCleanup = handle._attach({
			open: false,
			contentId: 'first',
			activeTrigger: undefined,
			document: undefined,
			requestOpen: () => true
		});
		const secondCleanup = handle._attach({
			open: true,
			contentId: 'second',
			activeTrigger: undefined,
			document: undefined,
			requestOpen: () => true
		});

		secondCleanup();
		expect(handle.contentId).toBe('first');
		expect(handle.isOpen).toBe(false);

		firstCleanup();
		expect(handle.contentId).toBeUndefined();
		expect(handle.isOpen).toBe(false);
	});
});
