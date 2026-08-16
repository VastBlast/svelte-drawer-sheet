import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import FocusAccessibility from './FocusAccessibility.test.svelte';

function element(testId: string): HTMLElement {
	return page.getByTestId(testId).element() as HTMLElement;
}

function focus(testId: string): void {
	element(testId).focus();
}

describe('drawer focus and accessible relationships', () => {
	it('implements callback focus results without collapsing null and undefined', async () => {
		render(FocusAccessibility, { scenario: 'focus-targets' });
		const trigger = page.getByTestId('detached-trigger');
		const close = page.getByRole('button', { name: 'Close focus targets' });

		await trigger.click();
		await expect.element(close).toHaveFocus();
		await close.click();

		await page.getByRole('button', { name: 'Return undefined' }).click();
		await trigger.click();
		await expect.element(trigger).toHaveFocus();
		await close.click();

		await page.getByRole('button', { name: 'Return false' }).click();
		await trigger.click();
		await expect.element(trigger).toHaveFocus();
		await close.click();

		await page.getByRole('button', { name: 'Return true' }).click();
		await trigger.click();
		await expect.element(close).toHaveFocus();
		await close.click();
	});

	it('allows an outside initial target and restores a detached active trigger by default', async () => {
		render(FocusAccessibility, { scenario: 'focus-targets' });
		await page.getByRole('button', { name: 'Return outside' }).click();
		await page.getByRole('button', { name: 'Open by trigger id' }).click();

		await expect.element(page.getByTestId('outside-initial')).toHaveFocus();
		expect(element('outside-initial').closest('[aria-hidden="true"]')).toBeNull();
		// The modal blocker should reject a physical outside click. Invoke the intentional
		// imperative control directly so this test remains about focus restoration.
		element('imperative-close').click();
		await expect.element(page.getByTestId('detached-trigger')).toHaveFocus();
	});

	it('updates the active focus trap when modal mode changes after mount', async () => {
		render(FocusAccessibility, { scenario: 'dynamic-trap' });
		focus('dynamic-outside');
		expect(document.activeElement).toBe(element('dynamic-outside'));

		await page.getByRole('button', { name: 'Enable focus trap' }).click();
		await page.getByRole('button', { name: 'Inside dynamic drawer' }).click();
		focus('dynamic-outside');
		await vi.waitFor(() => {
			expect(element('dynamic-popup').contains(document.activeElement)).toBe(true);
		});

		element('disable-focus-trap').click();
		await expect.element(page.getByTestId('dynamic-popup')).not.toHaveAttribute('aria-modal');
		focus('dynamic-outside');
		expect(document.activeElement).toBe(element('dynamic-outside'));
		await page.getByRole('button', { name: 'Close dynamic drawer' }).click();
	});

	it('unregisters title and description ids when their elements leave the drawer', async () => {
		render(FocusAccessibility, { scenario: 'labels' });
		const popup = page.getByTestId('labels-popup');
		const trigger = page.getByTestId('labels-trigger');
		const title = page.getByTestId('registered-title').element();
		const description = page.getByTestId('registered-description').element();

		await expect.element(popup).toHaveAttribute('aria-labelledby', title.id);
		await expect.element(popup).toHaveAttribute('aria-describedby', description.id);
		await expect.element(trigger).toHaveAttribute('aria-controls', 'registered-popup-1');
		await page.getByRole('button', { name: 'Change label ids' }).click();
		await expect.element(popup).toHaveAttribute('aria-labelledby', 'registered-title-2');
		await expect.element(popup).toHaveAttribute('aria-describedby', 'registered-description-2');
		await expect.element(trigger).toHaveAttribute('aria-controls', 'registered-popup-2');
		await page.getByRole('button', { name: 'Toggle labels' }).click();
		await expect.element(popup).not.toHaveAttribute('aria-labelledby');
		await expect.element(popup).not.toHaveAttribute('aria-describedby');
		await page.getByRole('button', { name: 'Close labels drawer' }).click();
	});

	it('isolates modal content and restores owned attributes across dynamic nested dialogs', async () => {
		render(FocusAccessibility, { scenario: 'modal-isolation' });
		const trigger = page.getByTestId('isolation-trigger');
		await trigger.click();

		await expect.element(trigger).toHaveAttribute('aria-hidden', 'true');
		await expect
			.element(page.getByTestId('isolation-outside'))
			.toHaveAttribute('aria-hidden', 'true');
		await expect
			.element(page.getByTestId('isolation-owned'))
			.toHaveAttribute('aria-hidden', 'true');
		await expect.element(page.getByTestId('isolation-owned')).toHaveAttribute('inert');
		await expect
			.element(page.getByTestId('isolation-prehidden'))
			.toHaveAttribute('aria-hidden', 'true');
		await expect.element(page.getByTestId('isolation-live')).not.toHaveAttribute('aria-hidden');
		await expect.element(page.getByTestId('isolation-inside-a')).not.toHaveAttribute('aria-hidden');
		await expect
			.element(page.getByTestId('isolation-inside-b'))
			.toHaveAttribute('aria-hidden', 'true');
		const insideA = element('isolation-inside-a');
		expect(insideA.closest('[aria-hidden="true"]')).toBeNull();
		insideA.focus();
		expect(document.activeElement).toBe(insideA);
		await page.getByTestId('isolation-inside-a').click();
		await expect.element(page.getByTestId('isolation-inside-a')).toHaveFocus();
		await expect.element(page.getByTestId('isolation-popup')).toBeInTheDocument();
		await page.getByRole('button', { name: 'Switch portaled surface' }).click();
		await expect
			.element(page.getByTestId('isolation-inside-a'))
			.toHaveAttribute('aria-hidden', 'true');
		await expect.element(page.getByTestId('isolation-inside-b')).not.toHaveAttribute('aria-hidden');
		await page.getByTestId('isolation-inside-b').click();
		await expect.element(page.getByTestId('isolation-inside-b')).toHaveFocus();
		await expect.element(page.getByTestId('isolation-popup')).toBeInTheDocument();

		const popup = element('isolation-popup');
		const portal = popup.closest('[data-drawer-portal]');
		expect(portal).not.toBeNull();
		expect(portal?.closest('[aria-hidden="true"]')).toBeNull();

		const dynamicHost = document.createElement('section');
		document.body.append(dynamicHost);
		await vi.waitFor(() => expect(dynamicHost.getAttribute('aria-hidden')).toBe('true'));

		const nestedDialog = document.createElement('div');
		nestedDialog.setAttribute('role', 'dialog');
		nestedDialog.setAttribute('aria-modal', 'true');
		const nestedTarget = document.createElement('button');
		nestedDialog.append(nestedTarget);
		dynamicHost.append(nestedDialog);
		nestedTarget.focus();
		expect(dynamicHost).not.toHaveAttribute('aria-hidden');
		expect(popup.closest('[aria-hidden="true"]')).not.toBeNull();

		nestedDialog.remove();
		await vi.waitFor(() => expect(dynamicHost.getAttribute('aria-hidden')).toBe('true'));
		expect(popup.closest('[aria-hidden="true"]')).toBeNull();
		await page.getByRole('button', { name: 'Close isolated drawer' }).click();

		await expect.element(trigger).not.toHaveAttribute('aria-hidden');
		await expect.element(page.getByTestId('isolation-outside')).not.toHaveAttribute('aria-hidden');
		await expect
			.element(page.getByTestId('isolation-owned'))
			.toHaveAttribute('aria-hidden', 'false');
		await expect.element(page.getByTestId('isolation-owned')).toHaveAttribute('inert');
		await expect
			.element(page.getByTestId('isolation-prehidden'))
			.toHaveAttribute('aria-hidden', 'true');
		expect(dynamicHost).not.toHaveAttribute('aria-hidden');
		dynamicHost.remove();
	});

	it('provides a cancelable focus-out event that can prevent dismissal', async () => {
		render(FocusAccessibility, { scenario: 'focus-out' });
		await expect
			.element(page.getByRole('dialog', { name: 'Cancelable focus outside' }))
			.toHaveFocus();
		focus('focus-outside-target');

		await expect.element(page.getByTestId('focus-event-cancelable')).toHaveTextContent('true');
		await expect.element(page.getByTestId('focus-event-prevented')).toHaveTextContent('true');
		await expect
			.element(page.getByRole('dialog', { name: 'Cancelable focus outside' }))
			.toBeInTheDocument();

		await page.getByRole('button', { name: 'Allow next focus outside' }).click();
		focus('focus-outside-target');
		await expect
			.element(page.getByRole('dialog', { name: 'Cancelable focus outside' }))
			.not.toBeInTheDocument();
		expect(document.activeElement).toBe(element('focus-outside-target'));
	});

	it('gates a parent pointer surface and traps focus in the topmost nested drawer', async () => {
		render(FocusAccessibility, { scenario: 'nested' });
		const parent = element('focus-parent-popup');
		const child = element('focus-child-popup');
		await vi.waitFor(() => expect(parent.style.pointerEvents).toBe('none'));
		await expect
			.element(page.getByTestId('parent-focus-target'))
			.toHaveAttribute('aria-hidden', 'true');
		await vi.waitFor(() => expect(parent.style.getPropertyValue('--drawer-height')).toBe('160px'));
		expect(parent.style.getPropertyValue('--consumer-marker')).toBe('intact');

		focus('parent-focus-target');
		await vi.waitFor(() => expect(child.contains(document.activeElement)).toBe(true));

		await page.getByRole('button', { name: 'Close child focus scope' }).click();
		await expect.element(page.getByTestId('focus-child-popup')).not.toBeInTheDocument();
		await vi.waitFor(() => expect(parent.style.pointerEvents).toBe('all'));
		await expect
			.element(page.getByTestId('parent-focus-target'))
			.not.toHaveAttribute('aria-hidden');

		focus('nested-outside');
		await vi.waitFor(() => expect(parent.contains(document.activeElement)).toBe(true));
		await page.getByRole('button', { name: 'Close parent focus scope' }).click();
	});

	it('lets a newer nonmodal drawer block an older modal focus trap', () => {
		render(FocusAccessibility, { scenario: 'stacked-modes' });
		focus('stacked-nonmodal-target');
		expect(document.activeElement).toBe(element('stacked-nonmodal-target'));
	});

	it('keeps focus and pointer ownership inside an open shadow portal', async () => {
		const rendered = await render(FocusAccessibility, { scenario: 'shadow-portal' });
		const host = element('open-shadow-host') as HTMLElement & {
			drawerTestRoot?: ShadowRoot;
		};
		const shadow = host.drawerTestRoot;
		expect(shadow).toBeDefined();
		if (!shadow) throw new TypeError('Expected the fixture to retain its open shadow root');

		await vi.waitFor(() =>
			expect(shadow.querySelector('[data-testid="shadow-popup"]')).not.toBeNull()
		);
		const popup = shadow.querySelector<HTMLElement>('[data-testid="shadow-popup"]');
		const target = shadow.querySelector<HTMLElement>('[data-testid="shadow-inside-target"]');
		if (!popup || !target) throw new TypeError('Expected the shadow-portaled drawer content');

		target.focus();
		expect(shadow.activeElement).toBe(target);

		const rect = target.getBoundingClientRect();
		const clientX = rect.left + rect.width / 2;
		const clientY = rect.top + rect.height / 2;
		expect(shadow.elementFromPoint(clientX, clientY)).toBe(target);
		for (const [type, buttons] of [
			['pointerdown', 1],
			['pointerup', 0]
		] as const) {
			target.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					cancelable: true,
					composed: true,
					button: 0,
					buttons,
					clientX,
					clientY,
					isPrimary: true,
					pointerId: 91,
					pointerType: 'mouse'
				})
			);
		}
		target.dispatchEvent(
			new MouseEvent('click', {
				bubbles: true,
				cancelable: true,
				composed: true,
				clientX,
				clientY,
				detail: 1
			})
		);
		await Promise.resolve();

		expect(popup.isConnected).toBe(true);
		expect(shadow.activeElement).toBe(target);
		expect(shadow.querySelector('[data-testid="shadow-button-presses"]')?.textContent).toBe('1');

		await rendered.unmount();
		expect(shadow.querySelector('[data-drawer-portal]')).toBeNull();
	});

	it('yields pointer and focus ownership to a generic nested dialog', async () => {
		render(FocusAccessibility, { scenario: 'generic-nested' });
		const parent = element('generic-parent-popup');
		const shadowHost = document.createElement('div');
		const shadow = shadowHost.attachShadow({ mode: 'open' });
		const shadowOutside = document.createElement('button');
		const immediateDialog = document.createElement('div');
		const immediateTarget = document.createElement('button');
		immediateDialog.setAttribute('role', 'dialog');
		immediateDialog.setAttribute('aria-modal', 'true');
		immediateDialog.append(immediateTarget);
		shadow.append(shadowOutside, immediateDialog);
		document.body.append(shadowHost);
		immediateTarget.focus();

		// The focus trap runs before MutationObserver delivery, so this specifically protects the
		// synchronous autofocus path used by independently implemented, shadow-hosted dialogs.
		expect(shadow.activeElement).toBe(immediateTarget);
		expect(shadowOutside).toHaveAttribute('aria-hidden', 'true');
		await vi.waitFor(() => expect(parent.style.pointerEvents).toBe('none'));
		shadowHost.remove();
		await vi.waitFor(() => expect(parent.style.pointerEvents).toBe('all'));

		const pointer = (type: string, clientY: number, buttons: number) =>
			parent.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					cancelable: true,
					button: 0,
					buttons,
					clientY,
					isPrimary: true,
					pointerId: 73,
					pointerType: 'mouse'
				})
			);
		pointer('pointerdown', 20, 1);
		pointer('pointermove', 60, 1);
		const movement = parent.style.getPropertyValue('--drawer-swipe-movement-y');
		const progress = parent.style.getPropertyValue('--drawer-swipe-progress');

		element('generic-dialog-trigger').click();
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		const dialog = element('generic-dialog');
		await vi.waitFor(() => expect(parent.style.pointerEvents).toBe('none'));
		expect(parent.style.getPropertyValue('--drawer-swipe-movement-y')).toBe(movement);
		expect(parent.style.getPropertyValue('--drawer-swipe-progress')).toBe(progress);
		expect(getComputedStyle(parent).transitionDuration).toBe('0s');
		pointer('pointercancel', 60, 0);
		await Promise.resolve();

		// A generic nested dialog owns the interaction stack just like a nested drawer.
		pointer('pointerdown', 20, 1);
		pointer('pointermove', 100, 1);
		expect(parent.hasAttribute('data-swiping')).toBe(false);
		expect(parent.style.getPropertyValue('--drawer-swipe-movement-y')).toBe('0px');

		focus('generic-dialog-target');
		expect(dialog.contains(document.activeElement)).toBe(true);

		await page.getByRole('button', { name: 'Close generic dialog' }).click();
		await expect.element(page.getByTestId('generic-dialog')).not.toBeInTheDocument();
		await vi.waitFor(() => expect(parent.style.pointerEvents).toBe('all'));
		await page.getByRole('button', { name: 'Close generic parent drawer' }).click();
	});
});
