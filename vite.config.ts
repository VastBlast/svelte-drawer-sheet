import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit({ adapter: adapter() })],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'browser',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: (process.env.CI
							? (['chromium', 'firefox', 'webkit'] as const)
							: (['chromium'] as const)
						).map((browser) => ({ browser, headless: true }))
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	},
	server: {
		port: 4000,
		allowedHosts: ['dev.watcher.guru']
	}
});
