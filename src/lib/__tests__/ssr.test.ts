import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import * as Drawer from '../index.js';
import type { DrawerRootSnippetProps } from '../types.js';

describe('server rendering', () => {
	it('imports the public entry point and renders Root without browser globals', () => {
		const children = createRawSnippet<[DrawerRootSnippetProps]>((getState) => ({
			render: () => `<output data-drawer-ssr>${getState().open}</output>`
		}));

		const result = render(Drawer.Root, {
			props: {
				defaultOpen: true,
				snapPoints: ['160px', 1],
				children
			}
		});

		expect(result.body).toContain('<output data-drawer-ssr>true</output>');
		expect(result.head).toBe('');
	});

	it('constructs a detached public handle without accessing the DOM', () => {
		const handle = Drawer.createHandle();

		expect(handle.isOpen).toBe(false);
		expect(() => handle.open()).not.toThrow();
		expect(() => handle.close()).not.toThrow();
	});
});
