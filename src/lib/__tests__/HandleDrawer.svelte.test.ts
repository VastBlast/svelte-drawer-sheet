import { page, userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import HandleDrawerTest from './HandleDrawer.test.svelte';

describe('Drawer handle integration', () => {
	it('opens a detached custom trigger, toggles it, and follows a changed handle', async () => {
		render(HandleDrawerTest);
		const trigger = page.getByTestId('detached-trigger');
		const triggerElement = trigger.element();
		if (!(triggerElement instanceof HTMLElement)) throw new TypeError('Expected an HTML trigger');

		await expect.element(page.getByTestId('trigger-ref')).toHaveTextContent('attached');
		triggerElement.focus();
		await userEvent.keyboard('{Enter}');
		await expect.element(page.getByRole('dialog', { name: 'Detached drawer' })).toBeInTheDocument();
		await expect.element(page.getByTestId('payload')).toHaveTextContent('First payload');

		await trigger.click();
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
		await trigger.click();
		await expect.element(page.getByRole('dialog', { name: 'Detached drawer' })).toBeInTheDocument();

		await page.getByRole('button', { name: 'Update open payload' }).click();
		await expect.element(page.getByTestId('payload')).toHaveTextContent('Updated payload');
		await page.getByRole('button', { name: 'Close detached drawer' }).click();
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();

		await page.getByTestId('switch-handle').click();
		await page.getByTestId('open-selected-handle').click();
		await expect.element(page.getByRole('dialog', { name: 'Detached drawer' })).toBeInTheDocument();
		await expect.element(page.getByTestId('payload')).toHaveTextContent('First payload');

		await page.getByRole('button', { name: 'Close detached drawer' }).click();
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
	});
});
