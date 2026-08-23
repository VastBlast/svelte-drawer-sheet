import { describe, expect, it } from 'vitest';
import { resolveNavigationSwipeRelease } from './gesture-utils.js';

describe('resolveNavigationSwipeRelease', () => {
	it('projects a lightweight forward flick past the midpoint', () => {
		expect(resolveNavigationSwipeRelease(20, 400, 1)).toMatchObject({ dismiss: true });
	});

	it('uses recent reversal velocity to cancel even after crossing halfway', () => {
		expect(resolveNavigationSwipeRelease(220, 400, -1)).toMatchObject({ dismiss: false });
	});

	it('falls back to position when the release has no momentum', () => {
		expect(resolveNavigationSwipeRelease(190, 400, 0)).toMatchObject({ dismiss: false });
		expect(resolveNavigationSwipeRelease(210, 400, 0)).toMatchObject({ dismiss: true });
	});

	it('settles less remaining distance in less time', () => {
		const nearTarget = resolveNavigationSwipeRelease(350, 400, 0);
		const farFromTarget = resolveNavigationSwipeRelease(210, 400, 0);

		expect(nearTarget.strength).toBeLessThan(farFromTarget.strength);
		expect(nearTarget.strength).toBeGreaterThanOrEqual(160 / 380);
	});

	it('matches the settle curve to velocity toward the chosen destination', () => {
		const stationary = resolveNavigationSwipeRelease(240, 400, 0);
		const movingTowardDismissal = resolveNavigationSwipeRelease(240, 400, 1);

		expect(stationary.easing).toBe('cubic-bezier(0.18, 0, 0.24, 1)');
		expect(movingTowardDismissal.easing).not.toBe(stationary.easing);
	});
});
