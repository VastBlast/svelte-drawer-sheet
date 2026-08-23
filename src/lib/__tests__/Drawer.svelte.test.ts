import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DrawerTest from './Drawer.test.svelte';
import NavigationProviderTest from './NavigationProvider.test.svelte';
import NestedDrawerTest from './NestedDrawer.test.svelte';

describe('Drawer', () => {
	type TouchEventType = 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel';
	type TouchPoint = { readonly id: number; readonly x: number; readonly y: number };

	function dispatchTouches(
		target: Element,
		type: TouchEventType,
		touches: readonly TouchPoint[],
		changedTouches: readonly TouchPoint[]
	) {
		const createTouch = ({ id, x, y }: TouchPoint) =>
			new Touch({ identifier: id, target, clientX: x, clientY: y });
		return target.dispatchEvent(
			new TouchEvent(type, {
				bubbles: true,
				cancelable: true,
				touches: touches.map(createTouch),
				changedTouches: changedTouches.map(createTouch)
			})
		);
	}

	function dispatchTouch(
		target: HTMLElement,
		type: 'touchstart' | 'touchmove' | 'touchend',
		x: number,
		y: number
	) {
		const touch = { id: 1, x, y };
		return dispatchTouches(target, type, type === 'touchend' ? [] : [touch], [touch]);
	}

	function dispatchKeyboard(
		target: Element,
		type: 'keydown' | 'keyup',
		key: 'Enter' | ' ',
		repeat = false
	) {
		const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, key, repeat });
		target.dispatchEvent(event);
		return event;
	}

	it('connects accessible dialog anatomy and restores focus after close', async () => {
		render(DrawerTest);
		const trigger = page.getByTestId('trigger');

		await expect.element(trigger).toHaveAttribute('aria-expanded', 'false');
		await trigger.click();

		const dialog = page.getByRole('dialog', { name: 'Account settings' });
		await expect.element(dialog).toBeInTheDocument();
		await expect.element(dialog).toHaveAttribute('aria-modal', 'true');
		await expect.element(dialog).toHaveAttribute('aria-describedby');
		await expect.element(dialog).toHaveFocus();
		await expect.element(trigger).toHaveAttribute('aria-expanded', 'true');
		await expect
			.element(page.getByTestId('secondary-trigger'))
			.toHaveAttribute('aria-expanded', 'false');
		const blocker = document.querySelector<HTMLElement>('[data-drawer-internal-backdrop]');
		expect(blocker).not.toBeNull();
		expect(getComputedStyle(blocker!).position).toBe('fixed');
		await expect.element(page.getByTestId('reason')).toHaveTextContent('trigger-press');

		await page.getByRole('button', { name: 'Close drawer' }).click();

		await expect.element(dialog).not.toBeInTheDocument();
		await expect.element(trigger).toHaveFocus();
		await expect.element(page.getByTestId('reason')).toHaveTextContent('close-press');
	});

	it('switches active triggers while open and lets the active trigger toggle closed', async () => {
		render(DrawerTest, { modal: false });
		const primary = page.getByTestId('trigger');
		const secondary = page.getByTestId('secondary-trigger');
		await primary.click();
		await expect.element(primary).toHaveAttribute('aria-expanded', 'true');

		const popup = page.getByTestId('popup').element();
		let enteredExit = false;
		const observer = new MutationObserver(() => {
			enteredExit ||= popup.hasAttribute('data-ending-style');
		});
		observer.observe(popup, { attributes: true, attributeFilter: ['data-ending-style'] });
		await secondary.click();
		observer.disconnect();
		expect(enteredExit).toBe(false);
		await expect
			.element(page.getByRole('dialog', { name: 'Account settings' }))
			.toBeInTheDocument();
		await expect.element(primary).toHaveAttribute('aria-expanded', 'false');
		await expect.element(secondary).toHaveAttribute('aria-expanded', 'true');

		await secondary.click();
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
		await expect.element(page.getByTestId('reason')).toHaveTextContent('trigger-press');
	});

	it('attributes native keyboard clicks without misclassifying physical clicks', async () => {
		render(DrawerTest, { captureFocusMethods: true, modal: false });
		const trigger = page.getByRole('button', { name: 'Open drawer' });
		trigger.element().focus();

		await userEvent.keyboard('{Enter}');
		await expect.element(page.getByTestId('open-method')).toHaveTextContent('keyboard');

		const close = page.getByRole('button', { name: 'Close drawer' });
		close.element().focus();
		await userEvent.keyboard('{Space}');
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
		await expect.element(page.getByTestId('close-method')).toHaveTextContent('keyboard');

		await trigger.click();
		await expect.element(page.getByTestId('open-method')).toHaveTextContent('mouse');
		await page.getByRole('button', { name: 'Close drawer' }).click();

		trigger
			.element()
			.dispatchEvent(
				new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, detail: 0 })
			);
		await expect.element(page.getByTestId('open-method')).toHaveTextContent('keyboard');
		await page.getByRole('button', { name: 'Close drawer' }).click();
	});

	it('gives custom triggers and closes native-quality keyboard activation', async () => {
		render(DrawerTest, { modal: false });
		const trigger = page.getByTestId('custom-trigger').element();
		const anchor = page.getByTestId('anchor-trigger').element();
		const triggerClicks = vi.fn();
		const anchorClicks = vi.fn();
		if (!(trigger instanceof HTMLElement) || !(anchor instanceof HTMLElement)) {
			throw new TypeError('Expected HTML custom triggers');
		}
		trigger.addEventListener('click', triggerClicks);
		anchor.addEventListener('click', anchorClicks);

		const anchorEnter = dispatchKeyboard(anchor, 'keydown', 'Enter');
		expect(anchorEnter.defaultPrevented).toBe(false);
		expect(anchorClicks).not.toHaveBeenCalled();
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();

		trigger.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
		dispatchKeyboard(trigger, 'keydown', 'Enter');
		expect(triggerClicks).not.toHaveBeenCalled();

		const enter = dispatchKeyboard(trigger, 'keydown', 'Enter');
		dispatchKeyboard(trigger, 'keydown', 'Enter', true);
		expect(enter.defaultPrevented).toBe(true);
		expect(triggerClicks).toHaveBeenCalledOnce();
		await expect
			.element(page.getByRole('dialog', { name: 'Account settings' }))
			.toBeInTheDocument();

		dispatchKeyboard(trigger, 'keydown', 'Enter');
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();

		const spaceDown = dispatchKeyboard(trigger, 'keydown', ' ');
		const repeatedSpaceDown = dispatchKeyboard(trigger, 'keydown', ' ', true);
		expect(spaceDown.defaultPrevented).toBe(true);
		expect(repeatedSpaceDown.defaultPrevented).toBe(true);
		expect(triggerClicks).toHaveBeenCalledTimes(2);
		dispatchKeyboard(trigger, 'keyup', ' ');
		dispatchKeyboard(trigger, 'keyup', ' ');
		expect(triggerClicks).toHaveBeenCalledTimes(3);
		await expect
			.element(page.getByRole('dialog', { name: 'Account settings' }))
			.toBeInTheDocument();

		const enterClose = page.getByTestId('custom-close').element();
		const enterCloseClicks = vi.fn();
		enterClose.addEventListener('click', enterCloseClicks);
		dispatchKeyboard(enterClose, 'keydown', 'Enter');
		dispatchKeyboard(enterClose, 'keydown', 'Enter', true);
		expect(enterCloseClicks).toHaveBeenCalledOnce();
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();

		trigger.click();
		await expect
			.element(page.getByRole('dialog', { name: 'Account settings' }))
			.toBeInTheDocument();
		const spaceClose = page.getByTestId('custom-close').element();
		const spaceCloseClicks = vi.fn();
		spaceClose.addEventListener('click', spaceCloseClicks);
		const closeSpaceDown = dispatchKeyboard(spaceClose, 'keydown', ' ');
		dispatchKeyboard(spaceClose, 'keydown', ' ', true);
		expect(closeSpaceDown.defaultPrevented).toBe(true);
		expect(spaceCloseClicks).not.toHaveBeenCalled();
		dispatchKeyboard(spaceClose, 'keyup', ' ');
		dispatchKeyboard(spaceClose, 'keyup', ' ');
		expect(spaceCloseClicks).toHaveBeenCalledOnce();
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
	});

	it('lets an ordinary blur stand and restores focus only for a vanished control', async () => {
		render(DrawerTest, { defaultOpen: true });
		const popup = page.getByTestId('popup').element();
		await vi.waitFor(() => expect(document.activeElement).toBe(popup));
		const textbox = page.getByRole('textbox', { name: 'Display name' });
		const input = textbox.element();
		if (!(input instanceof HTMLElement)) throw new TypeError('Expected the drawer input');
		input.focus();
		await expect.element(textbox).toHaveFocus();

		// An iOS tap on a non-focusable control blurs the field without focusing anything else.
		// Re-grabbing the still-visible field would re-summon the virtual keyboard mid-tap.
		input.blur();
		await new Promise<void>((resolve) => setTimeout(resolve, 50));
		expect(document.activeElement).toBe(document.body);

		input.focus();
		await expect.element(textbox).toHaveFocus();
		input.style.display = 'none';
		await vi.waitFor(() => expect(document.activeElement).toBe(popup));
		input.style.removeProperty('display');
		await page.getByRole('button', { name: 'Close drawer' }).click();
	});

	it('honors synchronous cancellation without exposing a transient open state', async () => {
		render(DrawerTest, { cancelOpen: true });
		const trigger = page.getByRole('button', { name: 'Open drawer' });

		await trigger.click();

		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
		await expect.element(page.getByTestId('open-state')).toHaveTextContent('false');
		await expect.element(trigger).toHaveAttribute('aria-expanded', 'false');
		await expect.element(page.getByTestId('reason')).toHaveTextContent('trigger-press');
	});

	it('settles an open-close pair collapsed into one Svelte flush', async () => {
		render(DrawerTest);
		const cycle = page.getByTestId('open-close-cycle').element();
		if (!(cycle instanceof HTMLElement)) throw new TypeError('Expected an HTML cycle control');

		cycle.click();

		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
		await expect.element(page.getByTestId('completion-history')).toHaveTextContent('false');
	});

	it('settles a close-open pair collapsed into one Svelte flush', async () => {
		render(DrawerTest, { defaultOpen: true });
		const cycle = page.getByTestId('close-open-cycle').element();
		if (!(cycle instanceof HTMLElement)) throw new TypeError('Expected an HTML cycle control');

		cycle.click();

		await expect
			.element(page.getByRole('dialog', { name: 'Account settings' }))
			.toBeInTheDocument();
		await expect.element(page.getByTestId('completion-history')).toHaveTextContent('true');
		await expect.element(page.getByTestId('popup')).not.toHaveAttribute('data-starting-style');
	});

	it('treats a portaled control labeled from inside the popup as inside', async () => {
		render(DrawerTest, { defaultOpen: true });
		const popup = page.getByTestId('popup').element();
		if (!(popup instanceof HTMLElement)) throw new TypeError('Expected the drawer popup');

		// The iOS haptics pattern: a label inside the popup forwards its activation as a
		// synthetic `detail: 0` click to a control portaled to the body. The pair is one
		// logical widget, so the forwarded click must not read as an outside press.
		const control = document.createElement('input');
		control.type = 'checkbox';
		control.id = 'portaled-switch';
		document.body.append(control);
		const label = document.createElement('label');
		label.htmlFor = control.id;
		popup.append(label);

		try {
			control.dispatchEvent(
				new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, detail: 0 })
			);
			await expect.element(page.getByTestId('open-state')).toHaveTextContent('true');
			await expect.element(page.getByRole('dialog')).toBeInTheDocument();

			// An unassociated virtual outside click is genuine assistive or programmatic
			// activation and dismisses immediately.
			document.body.dispatchEvent(
				new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, detail: 0 })
			);
			await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
			await expect.element(page.getByTestId('reason')).toHaveTextContent('outside-press');
		} finally {
			control.remove();
			label.remove();
		}
	});

	it('dismisses for a press on a form that names a control "labels"', async () => {
		render(DrawerTest, { defaultOpen: true });
		// HTMLFormElement exposes <input name="labels"> as `form.labels`, shadowing the label
		// association API with a non-iterable value; the outside judgment must not trip on it.
		const form = document.createElement('form');
		const named = document.createElement('input');
		named.name = 'labels';
		form.append(named);
		document.body.append(form);

		try {
			const press = {
				bubbles: true,
				composed: true,
				cancelable: true,
				isPrimary: true,
				button: 0,
				pointerId: 3,
				pointerType: 'mouse',
				clientX: 5,
				clientY: 495
			};
			form.dispatchEvent(new PointerEvent('pointerdown', press));
			form.dispatchEvent(new PointerEvent('pointerup', press));
			form.dispatchEvent(
				new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, detail: 1 })
			);
			await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
			await expect.element(page.getByTestId('reason')).toHaveTextContent('outside-press');
		} finally {
			form.remove();
		}
	});

	it('cedes focus to a foreign trap instead of livelocking the page', async () => {
		render(DrawerTest, { defaultOpen: true });
		const popup = page.getByTestId('popup').element();
		if (!(popup instanceof HTMLElement)) throw new TypeError('Expected the drawer popup');
		const foreign = document.createElement('button');
		foreign.textContent = 'Foreign modal control';
		document.body.append(foreign);
		// A second modal library's focus trap: whenever focus enters the drawer, it
		// synchronously steals focus back. Unguarded, the two traps trade wins forever.
		const steal = (event: FocusEvent) => {
			const target = event.target;
			if (target instanceof Node && popup.contains(target)) foreign.focus();
		};
		document.addEventListener('focusin', steal, true);

		try {
			foreign.focus();
			await new Promise<void>((resolve) => setTimeout(resolve, 100));
			// The page survived, the adversary kept focus, and the drawer stayed open.
			expect(document.activeElement).toBe(foreign);
			await expect.element(page.getByRole('dialog')).toBeInTheDocument();

			// Once the foreign trap is gone, a later outside focus is reclaimed again.
			document.removeEventListener('focusin', steal, true);
			popup.focus();
			foreign.focus();
			await vi.waitFor(() => expect(popup.contains(document.activeElement)).toBe(true));
		} finally {
			document.removeEventListener('focusin', steal, true);
			foreign.remove();
		}
	});

	it('enters through starting styles when mounted already open', async () => {
		render(DrawerTest, { defaultOpen: true });

		// The popup's first insertion carries the starting styles; shedding them is the
		// enter transition. A conditionally mounted drawer opening on mount used to skip
		// straight to its resting styles and never report the open as complete.
		const popup = page.getByTestId('popup').element();
		expect(popup).toHaveAttribute('data-starting-style');

		await expect.element(page.getByTestId('popup')).not.toHaveAttribute('data-starting-style');
		await expect.element(page.getByTestId('completion-history')).toHaveTextContent('true');
	});

	it('runs the enter transition without relying on focus or scroll-lock reflows', async () => {
		const style = document.createElement('style');
		style.textContent = `
			[data-testid='popup'] { transition: opacity 40ms linear; }
			[data-testid='popup'][data-starting-style] { opacity: 0.5; }
		`;
		document.head.append(style);
		const transitionRan = new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => resolve(false), 1000);
			const onRun = (event: Event) => {
				if (!(event.target instanceof HTMLElement) || event.target.dataset.testid !== 'popup')
					return;
				clearTimeout(timer);
				document.removeEventListener('transitionrun', onRun, true);
				resolve(true);
			};
			document.addEventListener('transitionrun', onRun, true);
		});

		try {
			// Non-modal with focus suppressed: nothing else forces a style recalc, so the
			// starting styles must be committed by the transition machinery itself.
			render(DrawerTest, {
				defaultOpen: true,
				modal: false,
				suppressAutoFocus: true,
				withBackdrop: false
			});
			await expect.element(page.getByTestId('popup')).not.toHaveAttribute('data-starting-style');
			await expect(transitionRan).resolves.toBe(true);
		} finally {
			style.remove();
		}
	});

	it('supports non-modal drawers without claiming modal semantics', async () => {
		render(DrawerTest, { modal: false });

		await page.getByRole('button', { name: 'Open drawer' }).click();

		const dialog = page.getByRole('dialog', { name: 'Account settings' });
		await expect.element(dialog).not.toHaveAttribute('aria-modal');
		const blocker = document.querySelector<HTMLElement>('[data-drawer-internal-backdrop]');
		expect(blocker).not.toBeNull();
		expect(blocker!.hidden).toBe(true);
		expect(blocker!.style.pointerEvents).toBe('none');
		const input = page.getByRole('textbox', { name: 'Display name' }).element();
		input.focus();
		input.addEventListener('keydown', (event) => event.stopPropagation(), { once: true });
		await userEvent.keyboard('{Escape}');
		await expect.element(dialog).toBeInTheDocument();

		const enclosingEscape = vi.fn();
		const observeEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') enclosingEscape(event);
		};
		document.body.addEventListener('keydown', observeEscape);
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		try {
			await userEvent.keyboard('{Escape}');
		} finally {
			document.body.removeEventListener('keydown', observeEscape);
		}
		await expect.element(dialog).not.toBeInTheDocument();
		await expect.element(page.getByTestId('reason')).toHaveTextContent('escape-key');
		expect(enclosingEscape).not.toHaveBeenCalled();
	});

	it('traps focus without locking page scroll in trap-focus mode', async () => {
		render(DrawerTest, { modal: 'trap-focus', withBackdrop: false });
		const trigger = page.getByTestId('trigger');
		await trigger.click();

		const dialog = page.getByRole('dialog', { name: 'Account settings' });
		await expect.element(dialog).toHaveAttribute('aria-modal', 'true');
		expect(document.body.style.overflow).not.toBe('hidden');

		const triggerElement = trigger.element();
		if (!(triggerElement instanceof HTMLElement)) throw new TypeError('Expected a trigger button');
		triggerElement.focus();
		await vi.waitFor(() => expect(dialog.element().contains(document.activeElement)).toBe(true));

		const root = document.documentElement;
		const originalOverflow = root.style.overflowY;
		const originalGutter = root.style.scrollbarGutter;
		const spacer = document.createElement('div');
		spacer.style.height = '200vh';
		document.body.append(spacer);
		try {
			root.style.overflowY = 'scroll';
			root.style.scrollbarGutter = 'stable';
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
			const gutterX = Math.min(root.clientWidth, root.offsetWidth) + 1;
			const gutterPress = new PointerEvent('pointerdown', {
				bubbles: true,
				button: 0,
				clientX: gutterX,
				isPrimary: true,
				pointerType: 'mouse'
			});
			Object.defineProperty(gutterPress, 'offsetX', { value: gutterX });
			root.dispatchEvent(gutterPress);
			await expect.element(dialog).toBeInTheDocument();
		} finally {
			root.style.overflowY = originalOverflow;
			root.style.scrollbarGutter = originalGutter;
			spacer.remove();
		}

		await userEvent.keyboard('{Escape}');
		await expect.element(dialog).not.toBeInTheDocument();
	});

	it('resolves the initial snap point against measured browser geometry', async () => {
		render(DrawerTest, { defaultOpen: true });
		const popup = page.getByTestId('popup').element();

		await vi.waitFor(() => {
			expect(popup.style.getPropertyValue('--drawer-snap-point-offset')).toBe('200px');
			// Resting drawers keep intrinsic sizing; fixed pixels are reserved for nesting and exit.
			expect(popup.style.getPropertyValue('--drawer-height')).toBe('auto');
		});
		await page.getByRole('button', { name: 'Close drawer' }).click();
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
	});

	it('leaves drag state untouched when a pointer only taps the popup', async () => {
		render(DrawerTest, { defaultOpen: true });
		const popup = page.getByTestId('popup').element();
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

		const mutations: MutationRecord[] = [];
		const observer = new MutationObserver((records) => mutations.push(...records));
		observer.observe(popup, { attributes: true, attributeFilter: ['style', 'data-swiping'] });

		for (const type of ['pointerdown', 'pointerup']) {
			popup.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					button: 0,
					buttons: type === 'pointerdown' ? 1 : 0,
					clientY: 20,
					isPrimary: true,
					pointerId: 41,
					pointerType: 'mouse'
				})
			);
		}
		await Promise.resolve();
		observer.disconnect();

		expect(mutations).toEqual([]);
		await page.getByRole('button', { name: 'Close drawer' }).click();
	});

	it('dismisses a regular drawer after a decisive pointer drag', async () => {
		render(DrawerTest, { defaultOpen: true, withSnapPoints: false });
		const popup = page.getByTestId('popup').element();
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

		popup.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				cancelable: true,
				button: 0,
				buttons: 1,
				clientY: 20,
				isPrimary: true,
				pointerId: 1,
				pointerType: 'mouse'
			})
		);
		popup.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				cancelable: true,
				buttons: 1,
				clientY: 260,
				isPrimary: true,
				pointerId: 1,
				pointerType: 'mouse'
			})
		);
		popup.dispatchEvent(
			new PointerEvent('pointerup', {
				bubbles: true,
				cancelable: true,
				button: 0,
				clientY: 260,
				isPrimary: true,
				pointerId: 1,
				pointerType: 'mouse'
			})
		);

		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
		await expect.element(page.getByTestId('reason')).toHaveTextContent('swipe');
	});

	it('uses content-wide projected release behavior for horizontal navigation', async () => {
		render(DrawerTest, {
			defaultOpen: true,
			swipeBehavior: 'navigation',
			swipeDirection: 'right',
			withSnapPoints: false
		});
		const popup = page.getByTestId('popup').element();
		if (!(popup instanceof HTMLElement)) throw new TypeError('Expected an HTML popup');
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		await expect
			.element(page.getByTestId('popup'))
			.toHaveAttribute('data-swipe-behavior', 'navigation');

		dispatchTouch(popup, 'touchstart', 200, 100);
		dispatchTouch(popup, 'touchmove', 220, 100);
		dispatchTouch(popup, 'touchmove', 255, 100);
		expect(popup.style.getPropertyValue('--drawer-swipe-movement-x')).toBe('35px');
		dispatchTouch(popup, 'touchend', 255, 100);

		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
		await expect.element(page.getByTestId('reason')).toHaveTextContent('swipe');
	});

	it('keeps navigation behavior out of vertical drawers', async () => {
		render(DrawerTest, { defaultOpen: true, swipeBehavior: 'navigation' });

		await expect
			.element(page.getByTestId('popup'))
			.toHaveAttribute('data-swipe-behavior', 'drawer');
		await page.getByRole('button', { name: 'Close drawer' }).click();
	});

	it('redirects a navigation swipe back to open and clears its temporary settle state', async () => {
		render(DrawerTest, {
			defaultOpen: true,
			swipeBehavior: 'navigation',
			swipeDirection: 'right',
			withSnapPoints: false
		});
		const popup = page.getByTestId('popup').element();
		if (!(popup instanceof HTMLElement)) throw new TypeError('Expected an HTML popup');
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

		dispatchTouch(popup, 'touchstart', 180, 100);
		dispatchTouch(popup, 'touchmove', 200, 100);
		dispatchTouch(popup, 'touchmove', 330, 100);
		dispatchTouch(popup, 'touchmove', 240, 100);
		dispatchTouch(popup, 'touchend', 240, 100);

		expect(popup.style.getPropertyValue('--drawer-swipe-movement-x')).toBe('0px');
		expect(popup.style.getPropertyValue('--drawer-swipe-easing')).toMatch(/^cubic-bezier\(/);
		await expect.element(page.getByRole('dialog')).toBeInTheDocument();
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		expect(popup.style.getPropertyValue('--drawer-swipe-strength')).toBe('1');
		expect(popup.style.getPropertyValue('--drawer-swipe-easing')).toBe('');

		await page.getByRole('button', { name: 'Close drawer' }).click();
	});

	it('coordinates navigation settle state with a provider indent', async () => {
		render(NavigationProviderTest);
		const popup = page.getByTestId('popup').element();
		const indent = page.getByTestId('indent').element();
		if (!(popup instanceof HTMLElement) || !(indent instanceof HTMLElement)) {
			throw new TypeError('Expected navigation elements');
		}
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

		expect(indent.getAttribute('data-swipe-behavior')).toBe('navigation');
		dispatchTouch(popup, 'touchstart', 180, 100);
		dispatchTouch(popup, 'touchmove', 200, 100);
		dispatchTouch(popup, 'touchmove', 280, 100);
		expect(indent.hasAttribute('data-swiping')).toBe(true);
		expect(Number(indent.style.getPropertyValue('--drawer-swipe-progress'))).toBeCloseTo(0.2);

		dispatchTouch(popup, 'touchmove', 230, 100);
		dispatchTouch(popup, 'touchend', 230, 100);
		expect(indent.style.getPropertyValue('--drawer-swipe-easing')).toMatch(/^cubic-bezier\(/);
		await expect.element(page.getByRole('dialog')).toBeInTheDocument();
	});

	it('clears imperative release styles when reopening interrupts a swipe dismissal', async () => {
		render(DrawerTest, { defaultOpen: true, withSnapPoints: false });
		const popup = page.getByTestId('popup').element();
		const trigger = page.getByTestId('trigger').element();
		if (!(trigger instanceof HTMLElement)) throw new TypeError('Expected an HTML trigger');
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

		const pointer = (type: string, clientY: number, buttons: number) =>
			popup.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					cancelable: true,
					button: 0,
					buttons,
					clientY,
					isPrimary: true,
					pointerId: 42,
					pointerType: 'mouse'
				})
			);

		pointer('pointerdown', 20, 1);
		pointer('pointermove', 260, 1);
		pointer('pointerup', 260, 0);
		// Reopen in the same task, before the close presence transition can finish.
		trigger.click();

		await expect
			.element(page.getByRole('dialog', { name: 'Account settings' }))
			.toBeInTheDocument();
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		expect(popup.style.getPropertyValue('--drawer-swipe-movement-y')).toBe('0px');
		expect(popup.style.getPropertyValue('--drawer-swipe-strength')).toBe('1');
		expect(popup.hasAttribute('data-swipe-dismiss')).toBe(false);
		await expect.element(page.getByTestId('completion-history')).toHaveTextContent('true');

		await page.getByRole('button', { name: 'Close drawer' }).click();
	});

	it('hands touch movement to scrollable content until it reaches the dismissal edge', async () => {
		render(DrawerTest, {
			defaultOpen: true,
			scrollableContent: true,
			withSnapPoints: false
		});
		const content = page.getByTestId('content').element();
		if (!(content instanceof HTMLElement)) throw new TypeError('Expected HTML drawer content');
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		content.scrollTop = 80;

		dispatchTouch(content, 'touchstart', 20, 100);
		dispatchTouch(content, 'touchmove', 20, 180);
		dispatchTouch(content, 'touchend', 20, 180);
		await expect.element(page.getByRole('dialog')).toBeInTheDocument();

		content.scrollTop = 0;
		dispatchTouch(content, 'touchstart', 20, 100);
		dispatchTouch(content, 'touchmove', 20, 180);
		expect(
			page.getByTestId('popup').element().style.getPropertyValue('--drawer-swipe-movement-y')
		).toBe('0px');
		dispatchTouch(content, 'touchmove', 20, 400);
		dispatchTouch(content, 'touchend', 20, 400);
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
		await expect.element(page.getByTestId('reason')).toHaveTextContent('swipe');
	});

	it('keeps both touch gesture sessions identifier-safe and cancels them on multitouch', async () => {
		render(DrawerTest, { defaultOpen: true, withSnapPoints: false });
		const popup = page.getByTestId('popup').element();
		const tracked = { id: 11, x: 20, y: 100 };
		const unrelated = { id: 12, x: 80, y: 180 };
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

		dispatchTouches(popup, 'touchstart', [tracked], [tracked]);
		dispatchTouches(popup, 'touchmove', [{ ...tracked, y: 160 }], [{ ...tracked, y: 160 }]);
		dispatchTouches(popup, 'touchmove', [{ ...tracked, y: 260 }], [{ ...tracked, y: 260 }]);
		expect(popup.hasAttribute('data-swiping')).toBe(true);
		expect(popup.style.getPropertyValue('--drawer-swipe-movement-y')).not.toBe('0px');

		// Another finger ending or being canceled must not release the tracked finger's session.
		dispatchTouches(popup, 'touchend', [{ ...tracked, y: 260 }], [unrelated]);
		dispatchTouches(popup, 'touchcancel', [{ ...tracked, y: 260 }], [unrelated]);
		expect(popup.hasAttribute('data-swiping')).toBe(true);
		expect(popup.style.getPropertyValue('--drawer-swipe-movement-y')).not.toBe('0px');

		// A real second touch, even outside the gesture element, cancels the drag immediately.
		dispatchTouches(document.body, 'touchstart', [{ ...tracked, y: 260 }, unrelated], [unrelated]);
		expect(popup.hasAttribute('data-swiping')).toBe(false);
		expect(popup.style.getPropertyValue('--drawer-swipe-movement-y')).toBe('0px');
		await expect
			.element(page.getByRole('dialog', { name: 'Account settings' }))
			.toBeInTheDocument();

		await page.getByRole('button', { name: 'Close drawer' }).click();
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();

		const area = page.getByTestId('swipe-area').element();
		const edgeTouch = { id: 21, x: 20, y: 300 };
		const otherEdgeTouch = { id: 22, x: 80, y: 220 };
		dispatchTouches(area, 'touchstart', [edgeTouch], [edgeTouch]);
		dispatchTouches(area, 'touchmove', [{ ...edgeTouch, y: 220 }], [{ ...edgeTouch, y: 220 }]);
		await expect.element(page.getByTestId('swipe-area')).toHaveAttribute('data-swiping');
		await expect
			.element(page.getByRole('dialog', { name: 'Account settings' }))
			.toBeInTheDocument();

		dispatchTouches(area, 'touchend', [{ ...edgeTouch, y: 220 }], [otherEdgeTouch]);
		dispatchTouches(area, 'touchcancel', [{ ...edgeTouch, y: 220 }], [otherEdgeTouch]);
		await expect.element(page.getByTestId('swipe-area')).toHaveAttribute('data-swiping');
		await expect
			.element(page.getByRole('dialog', { name: 'Account settings' }))
			.toBeInTheDocument();

		dispatchTouches(
			document.body,
			'touchstart',
			[{ ...edgeTouch, y: 220 }, otherEdgeTouch],
			[otherEdgeTouch]
		);
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
		await expect.element(page.getByTestId('swipe-area')).not.toHaveAttribute('data-swiping');
	});

	it('opens from the edge swipe area and ignores a cross-axis gesture', async () => {
		render(DrawerTest);
		const area = page.getByTestId('swipe-area').element();
		const pointer = (type: string, x: number, y: number, buttons: number) =>
			area.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					cancelable: true,
					button: 0,
					buttons,
					clientX: x,
					clientY: y,
					isPrimary: true,
					pointerId: 2,
					pointerType: 'mouse'
				})
			);

		pointer('pointerdown', 20, 300, 1);
		pointer('pointermove', 100, 296, 1);
		pointer('pointermove', 20, 80, 1);
		pointer('pointerup', 20, 80, 0);
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();

		pointer('pointerdown', 20, 300, 1);
		pointer('pointermove', 20, 240, 1);
		// Let Svelte flush the open state. The attachment and gesture session must survive it.
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		await expect.element(page.getByTestId('swipe-area')).toHaveAttribute('data-swiping');
		await expect
			.element(page.getByRole('dialog', { name: 'Account settings' }))
			.toBeInTheDocument();
		expect(
			page.getByTestId('popup').element().style.getPropertyValue('--drawer-swipe-movement-y')
		).toBe('100px');
		pointer('pointermove', 20, 80, 1);
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		expect(
			page.getByTestId('popup').element().style.getPropertyValue('--drawer-swipe-movement-y')
		).not.toBe('0px');
		pointer('pointerup', 20, 80, 0);
		await expect
			.element(page.getByRole('dialog', { name: 'Account settings' }))
			.toBeInTheDocument();
		await expect.element(page.getByTestId('reason')).toHaveTextContent('swipe');
		await page.getByRole('button', { name: 'Close drawer' }).click();
	});

	it('keeps a fast swipe-area flick whose only move is delivered already released', async () => {
		render(DrawerTest);
		const area = page.getByTestId('swipe-area').element();
		const pointer = (type: string, clientY: number, buttons: number) =>
			area.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					cancelable: true,
					button: 0,
					buttons,
					clientX: 20,
					clientY,
					isPrimary: true,
					pointerId: 5,
					pointerType: 'mouse'
				})
			);

		pointer('pointerdown', 300, 1);
		// A flick faster than the sampling rate: the only move arrives with the button already up.
		pointer('pointermove', 60, 0);
		pointer('pointerup', 60, 0);

		await expect
			.element(page.getByRole('dialog', { name: 'Account settings' }))
			.toBeInTheDocument();
		await page.getByRole('button', { name: 'Close drawer' }).click();
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
	});

	it('retains a requested close safely without leaving an interactive backdrop', async () => {
		render(DrawerTest, { defaultOpen: true, retainOnClose: true });
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		await page.getByRole('button', { name: 'Close drawer' }).click();

		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
		await expect.element(page.getByTestId('popup')).toHaveAttribute('aria-hidden', 'true');
		await expect.element(page.getByTestId('backdrop')).toHaveAttribute('inert');

		await page.getByRole('button', { name: 'Unmount retained drawer' }).click();
		await expect.element(page.getByTestId('popup')).not.toBeInTheDocument();
	});

	it('restores owned scroll styles without erasing concurrent body changes', async () => {
		const property = '--drawer-test-concurrent-style';
		const previous = document.body.style.getPropertyValue(property);
		render(DrawerTest);
		try {
			await page.getByRole('button', { name: 'Open drawer' }).click();
			await vi.waitFor(() => expect(document.body.style.overflow).toBe('hidden'));
			document.body.style.setProperty(property, 'preserved');

			await page.getByRole('button', { name: 'Close drawer' }).click();
			await vi.waitFor(() => expect(document.body.style.overflow).not.toBe('hidden'));
			expect(document.body.style.getPropertyValue(property)).toBe('preserved');
		} finally {
			if (previous) document.body.style.setProperty(property, previous);
			else document.body.style.removeProperty(property);
		}
	});

	it('clears nested ownership while preserving parent height through child exit', async () => {
		render(NestedDrawerTest);
		const parent = page.getByTestId('parent-popup');
		await expect.element(parent).toHaveAttribute('data-nested-drawer-open');
		await vi.waitFor(() => {
			expect(parent.element().style.getPropertyValue('--drawer-height')).toMatch(
				/^\d+(?:\.\d+)?px$/
			);
			expect(
				page.getByTestId('child-popup').element().style.getPropertyValue('--drawer-height')
			).toBe('auto');
		});

		await page.getByRole('button', { name: 'Close child drawer' }).click();
		await expect.element(page.getByTestId('child-popup')).toHaveAttribute('data-ending-style');
		await expect.element(parent).not.toHaveAttribute('data-nested-drawer-open');
		expect(parent.element().style.getPropertyValue('--nested-drawers')).toBe('0');
		expect(parent.element().style.getPropertyValue('--drawer-height')).toMatch(/^\d+(?:\.\d+)?px$/);

		await expect.element(page.getByTestId('child-popup')).not.toBeInTheDocument();
		await vi.waitFor(() => {
			expect(parent.element().style.getPropertyValue('--drawer-height')).toBe('auto');
		});
	});
});
