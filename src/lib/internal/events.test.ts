import { describe, expect, it, vi } from 'vitest';
import { createCancelableEvent, createChangeEventDetails, toSnapPointDetails } from './events.js';

describe('createCancelableEvent', () => {
	it('adds reliable cancellation without losing the native event surface', () => {
		const event = new Event('focusin');
		const wrapped = createCancelableEvent(event);

		expect(wrapped).toBeInstanceOf(Event);
		expect(wrapped.type).toBe('focusin');
		expect(wrapped.cancelable).toBe(true);
		expect(wrapped.defaultPrevented).toBe(false);

		wrapped.preventDefault();
		expect(wrapped.defaultPrevented).toBe(true);
		expect(event.defaultPrevented).toBe(false);
	});
});

describe('createChangeEventDetails', () => {
	it('preserves event metadata and tracks cancellation', () => {
		const event = new Event('pointerdown');
		const trigger = {} as Element;
		const details = createChangeEventDetails('outside-press', event, { trigger });

		expect(details).toMatchObject({ reason: 'outside-press', event, trigger });
		expect(details.isCanceled).toBe(false);

		details.cancel();
		expect(details.isCanceled).toBe(true);
	});

	it('creates a fallback event and invokes the unmount request hook', () => {
		const onPreventUnmount = vi.fn();
		const details = createChangeEventDetails('imperative-action', undefined, {
			onPreventUnmount
		});

		expect(details.event).toBeInstanceOf(Event);
		expect(details.event.type).toBe('drawer');
		details.preventUnmountOnClose();
		expect(onPreventUnmount).toHaveBeenCalledOnce();
	});
});

describe('toSnapPointDetails', () => {
	it('copies source metadata without coupling cancellation state', () => {
		const event = new Event('pointerup');
		const trigger = {} as Element;
		const openDetails = createChangeEventDetails('swipe', event, { trigger });
		const snapDetails = toSnapPointDetails(openDetails);

		expect(snapDetails).not.toBe(openDetails);
		expect(snapDetails).toMatchObject({ reason: 'swipe', event, trigger });

		snapDetails.cancel();
		expect(snapDetails.isCanceled).toBe(true);
		expect(openDetails.isCanceled).toBe(false);
	});
});
