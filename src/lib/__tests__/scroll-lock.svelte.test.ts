import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DrawerTest from './Drawer.test.svelte';

describe('Drawer scroll locking', () => {
	it('locks and restores html when it owns the viewport scroll container', async () => {
		const html = document.documentElement;
		const body = document.body;
		const htmlOverflowY = html.style.overflowY;
		const htmlOverflowYPriority = html.style.getPropertyPriority('overflow-y');
		const bodyOverflowY = body.style.overflowY;
		html.style.setProperty('overflow-y', 'scroll', 'important');
		body.style.overflowY = 'hidden';

		try {
			render(DrawerTest, { defaultOpen: true });
			await vi.waitFor(() => expect(html.style.overflowY).toBe('hidden'));
			expect(html.style.getPropertyPriority('overflow-y')).toBe('important');

			const close = page.getByRole('button', { name: 'Close drawer' }).element();
			if (!(close instanceof HTMLElement)) throw new TypeError('Expected a close button');
			close.click();
			await Promise.resolve();
			// The page must stay locked while the closing presence is still painted.
			expect(html.style.overflowY).toBe('hidden');
			await vi.waitFor(() => expect(html.style.overflowY).toBe('scroll'));
			expect(html.style.getPropertyPriority('overflow-y')).toBe('important');
			expect(body.style.overflowY).toBe('hidden');
		} finally {
			html.style.setProperty('overflow-y', htmlOverflowY, htmlOverflowYPriority);
			body.style.overflowY = bodyOverflowY;
		}
	});

	it('takes over an existing external lock and does not restore its stale state', async () => {
		const body = document.body;
		const previousOverflow = body.style.overflow;
		body.style.overflow = 'hidden';

		try {
			render(DrawerTest, { defaultOpen: true });
			body.style.removeProperty('overflow');
			await vi.waitFor(() => expect(body.style.overflowY).toBe('hidden'));

			await page.getByRole('button', { name: 'Close drawer' }).click();
			await vi.waitFor(() => expect(body.style.overflowY).not.toBe('hidden'));
		} finally {
			body.style.overflow = previousOverflow;
		}
	});
});
