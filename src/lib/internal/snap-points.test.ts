import { describe, expect, it } from 'vitest';
import {
	findClosestSnapPointIndex,
	getDampedSnapMovement,
	resolveSnapPoint,
	resolveSnapPoints,
	resolveSnapRelease,
	type SnapPoint
} from './snap-points.js';

describe('resolveSnapPoint', () => {
	it('resolves fractional, pixel, px, and rem values', () => {
		expect(resolveSnapPoint(0, 400)).toBe(0);
		expect(resolveSnapPoint(0.5, 400)).toBe(200);
		expect(resolveSnapPoint(1, 400)).toBe(400);
		expect(resolveSnapPoint(200, 400)).toBe(200);
		expect(resolveSnapPoint(' 125px ', 400)).toBe(125);
		expect(resolveSnapPoint('2.5rem', 400, 20)).toBe(50);
	});

	it('clamps numeric fractions below zero', () => {
		expect(resolveSnapPoint(-0.5, 400)).toBe(0);
	});

	it('treats every finite number above one as a pixel value', () => {
		expect(resolveSnapPoint(1.5, 400)).toBe(1.5);
	});

	it.each([
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		'',
		'invalid',
		'invalidpx',
		'invalidrem',
		'50%'
	])('rejects the invalid snap point %s', (value) => {
		expect(resolveSnapPoint(value, 400)).toBeNull();
	});

	it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
		'rejects the invalid viewport height %s',
		(viewportHeight) => {
			expect(resolveSnapPoint(0.5, viewportHeight)).toBeNull();
		}
	);

	it('rejects rem values when the root font size is not finite', () => {
		expect(resolveSnapPoint('2rem', 400, Number.NaN)).toBeNull();
		expect(resolveSnapPoint('20px', 400, Number.NaN)).toBe(20);
	});
});

describe('resolveSnapPoints', () => {
	it('filters invalid values, clamps heights, and calculates offsets', () => {
		expect(
			resolveSnapPoints([Number.NaN, 'invalid', -1, '2rem', '100px', 200, 200.5, 800], {
				viewportHeight: 400,
				drawerHeight: 300,
				rootFontSize: 20
			})
		).toEqual([
			{ value: -1, height: 0, offset: 300 },
			{ value: '2rem', height: 40, offset: 260 },
			{ value: '100px', height: 100, offset: 200 },
			{ value: 200.5, height: 200.5, offset: 99.5 },
			{ value: 800, height: 300, offset: 0 }
		]);
	});

	it('keeps the last point when resolved heights are within one pixel', () => {
		expect(
			resolveSnapPoints([100, '100.5px', 150, '151px'], {
				viewportHeight: 400,
				drawerHeight: 300
			})
		).toEqual([
			{ value: '100.5px', height: 100.5, offset: 199.5 },
			{ value: '151px', height: 151, offset: 149 }
		]);
	});

	it('deduplicates values after clamping and preserves input order', () => {
		const values = [800, '100px', 1] as const;
		const resolved = resolveSnapPoints(values, { viewportHeight: 400, drawerHeight: 300 });

		expect(resolved).toEqual([
			{ value: '100px', height: 100, offset: 200 },
			{ value: 1, height: 300, offset: 0 }
		]);
		expect(values).toEqual([800, '100px', 1]);
	});

	it('limits snap height to the viewport when the drawer is taller', () => {
		expect(resolveSnapPoints([1], { viewportHeight: 400, drawerHeight: 600 })).toEqual([
			{ value: 1, height: 400, offset: 200 }
		]);
	});

	it('returns no points for empty input or invalid layout measurements', () => {
		expect(resolveSnapPoints([], { viewportHeight: 400, drawerHeight: 300 })).toEqual([]);
		expect(resolveSnapPoints([1], { viewportHeight: 0, drawerHeight: 300 })).toEqual([]);
		expect(resolveSnapPoints([1], { viewportHeight: 400, drawerHeight: Number.NaN })).toEqual([]);
	});
});

describe('findClosestSnapPointIndex', () => {
	it('finds the closest value and keeps the first value on ties', () => {
		expect(findClosestSnapPointIndex([100, 200, 300], 240)).toBe(1);
		expect(findClosestSnapPointIndex([100, 200], 150)).toBe(0);
	});

	it('returns -1 for empty input or a non-finite target', () => {
		expect(findClosestSnapPointIndex([], 100)).toBe(-1);
		expect(findClosestSnapPointIndex([100], Number.NaN)).toBe(-1);
	});

	it('ignores non-finite candidate values', () => {
		expect(findClosestSnapPointIndex([Number.NaN, 100, Number.POSITIVE_INFINITY], 90)).toBe(1);
	});
});

describe('getDampedSnapMovement', () => {
	it('returns raw movement before and at the fully-open edge', () => {
		expect(getDampedSnapMovement(100, -50)).toBe(-50);
		expect(getDampedSnapMovement(100, -100)).toBe(-100);
		expect(getDampedSnapMovement(0, 20)).toBe(20);
	});

	it('applies square-root resistance beyond the fully-open edge', () => {
		expect(getDampedSnapMovement(0, -150)).toBeCloseTo(-Math.sqrt(150));
		expect(getDampedSnapMovement(100, -250)).toBeCloseTo(-Math.sqrt(150) - 100);
	});
});

describe('resolveSnapRelease', () => {
	const points = resolveSnapPoints(['100px', '300px', 1], {
		viewportHeight: 600,
		drawerHeight: 600
	});

	function release(overrides: Partial<Parameters<typeof resolveSnapRelease<SnapPoint>>[0]> = {}) {
		return resolveSnapRelease({
			points,
			drawerHeight: 600,
			currentOffset: 300,
			dragDelta: 0,
			velocity: 0,
			...overrides
		});
	}

	function expectSnapAt(result: ReturnType<typeof release>, offset: number) {
		expect(result?.type).toBe('snap');
		if (result?.type === 'snap') {
			expect(result.point.offset).toBe(offset);
		}
	}

	it('returns null when geometry or resolved points are unusable', () => {
		expect(release({ points: [] })).toBeNull();
		expect(release({ drawerHeight: 0 })).toBeNull();
		expect(release({ dragDelta: Number.NaN })).toBeNull();
		expect(release({ points: [{ value: 1, height: 600, offset: Number.NaN }] })).toBeNull();
	});

	it('selects the nearest point for a slow drag', () => {
		expectSnapAt(release({ currentOffset: 500, dragDelta: -180 }), 300);
	});

	it('keeps the first configured point when snap distances tie', () => {
		expectSnapAt(release({ currentOffset: 500, dragDelta: -100 }), 500);
	});

	it('dismisses only when closed is strictly nearer than a snap point', () => {
		expect(release({ currentOffset: 500, dragDelta: 80 })).toEqual({ type: 'close' });
		expectSnapAt(release({ currentOffset: 500, dragDelta: 50 }), 500);
	});

	it('projects sufficiently fast releases and ignores slower velocity', () => {
		expectSnapAt(release({ currentOffset: 500, dragDelta: -10, velocity: -2 }), 0);
		expectSnapAt(release({ currentOffset: 500, dragDelta: -10, velocity: -0.49 }), 500);
	});

	it('caps velocity projection to prevent extreme flicks from distorting the target', () => {
		const tallPoints = [
			{ value: 1, height: 5000, offset: 0 },
			{ value: '3500px', height: 3500, offset: 1500 },
			{ value: '2000px', height: 2000, offset: 3000 }
		];

		expectSnapAt(
			release({
				points: tallPoints,
				drawerHeight: 5000,
				currentOffset: 3000,
				dragDelta: 0,
				velocity: -10
			}),
			1500
		);
	});

	it('dismisses immediately on a fast release toward closed', () => {
		expect(release({ currentOffset: 0, dragDelta: 1, velocity: 0.5 })).toEqual({
			type: 'close'
		});
	});

	it('uses fallback velocity when release velocity reverses an established drag', () => {
		expectSnapAt(
			release({ currentOffset: 300, dragDelta: 20, velocity: -1, fallbackVelocity: 0.1 }),
			300
		);
	});

	it('preserves release velocity for a sub-threshold drag', () => {
		expectSnapAt(
			release({ currentOffset: 300, dragDelta: 5, velocity: -1, fallbackVelocity: 1 }),
			0
		);
	});

	it('treats a null current point as the fully-open edge', () => {
		expectSnapAt(release({ currentOffset: null, dragDelta: -40 }), 0);
	});

	describe('sequential mode', () => {
		it('chooses by drag distance without velocity projection', () => {
			expectSnapAt(
				release({
					currentOffset: 500,
					dragDelta: -450,
					velocity: -4,
					sequential: true
				}),
				0
			);
		});

		it('forces an adjacent point on a fast flick', () => {
			const originalOffsets = points.map((point) => point.offset);
			expectSnapAt(
				release({ currentOffset: 0, dragDelta: 40, velocity: 1, sequential: true }),
				300
			);
			expect(points.map((point) => point.offset)).toEqual(originalOffsets);
		});

		it('does not move beyond the fully-open point', () => {
			expectSnapAt(
				release({ currentOffset: 0, dragDelta: -60, velocity: -2, sequential: true }),
				0
			);
		});

		it('dismisses a fast flick beyond the last point', () => {
			expect(release({ currentOffset: 500, dragDelta: 60, velocity: 1, sequential: true })).toEqual(
				{ type: 'close' }
			);
		});

		it('dismisses only when a slow drag is strictly closer to closed', () => {
			expect(release({ currentOffset: 500, dragDelta: 80, velocity: 0, sequential: true })).toEqual(
				{ type: 'close' }
			);
			expectSnapAt(
				release({ currentOffset: 500, dragDelta: 50, velocity: 0, sequential: true }),
				500
			);
		});
	});
});
