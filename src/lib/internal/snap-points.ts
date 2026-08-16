export type SnapPoint = number | string;

export interface ResolvedSnapPoint<T extends SnapPoint = SnapPoint> {
	readonly value: T;
	readonly height: number;
	readonly offset: number;
}

export interface ResolveSnapPointsOptions {
	readonly viewportHeight: number;
	readonly drawerHeight: number;
	readonly rootFontSize?: number;
}

export interface ResolveSnapReleaseOptions<T extends SnapPoint = SnapPoint> {
	readonly points: readonly ResolvedSnapPoint<T>[];
	readonly drawerHeight: number;
	readonly currentOffset: number | null;
	/** Axis-normalized drag distance in pixels; positive moves toward closed. */
	readonly dragDelta: number;
	/** Axis-normalized release velocity in pixels per millisecond. */
	readonly velocity: number;
	/** Whole-gesture velocity used when the final sample reverses direction. */
	readonly fallbackVelocity?: number;
	readonly sequential?: boolean;
}

export type SnapReleaseTarget<T extends SnapPoint = SnapPoint> =
	{ type: 'snap'; point: ResolvedSnapPoint<T> } | { type: 'close' };

const MIN_DIRECTIONAL_DRAG = 10;
const SNAP_VELOCITY_THRESHOLD = 0.5;
const SNAP_VELOCITY_MULTIPLIER = 300;
const MAX_SNAP_VELOCITY = 4;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/** Resolves one snap point to pixels before it is clamped to the drawer. */
export function resolveSnapPoint(
	value: SnapPoint,
	viewportHeight: number,
	rootFontSize = 16
): number | null {
	if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
		return null;
	}

	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			return null;
		}

		return value <= 1 ? clamp(value, 0, 1) * viewportHeight : value;
	}

	const trimmed = value.trim();
	if (trimmed.endsWith('px')) {
		const pixels = Number.parseFloat(trimmed);
		return Number.isFinite(pixels) ? pixels : null;
	}

	if (trimmed.endsWith('rem')) {
		const rems = Number.parseFloat(trimmed);
		return Number.isFinite(rems) && Number.isFinite(rootFontSize) ? rems * rootFontSize : null;
	}

	return null;
}

/**
 * Resolves, clamps, and deduplicates snap points while preserving declaration order.
 * When points resolve within one pixel, the last declaration wins. Scanning from the end avoids
 * sorting, so all surviving points retain their declared order.
 */
export function resolveSnapPoints<T extends SnapPoint>(
	values: readonly T[],
	{ viewportHeight, drawerHeight, rootFontSize = 16 }: ResolveSnapPointsOptions
): ResolvedSnapPoint<T>[] {
	if (
		values.length === 0 ||
		!Number.isFinite(viewportHeight) ||
		viewportHeight <= 0 ||
		!Number.isFinite(drawerHeight) ||
		drawerHeight <= 0
	) {
		return [];
	}

	const maxHeight = Math.min(viewportHeight, drawerHeight);
	const resolved: ResolvedSnapPoint<T>[] = [];

	for (const value of values) {
		const height = resolveSnapPoint(value, viewportHeight, rootFontSize);
		if (height === null) {
			continue;
		}

		const clampedHeight = clamp(height, 0, maxHeight);
		resolved.push({
			value,
			height: clampedHeight,
			offset: Math.max(0, drawerHeight - clampedHeight)
		});
	}

	if (resolved.length < 2) {
		return resolved;
	}

	const deduplicated: ResolvedSnapPoint<T>[] = [];
	for (let index = resolved.length - 1; index >= 0; index -= 1) {
		const point = resolved[index];
		if (deduplicated.some((kept) => Math.abs(kept.height - point.height) <= 1)) {
			continue;
		}
		deduplicated.push(point);
	}

	return deduplicated.reverse();
}

/** Returns the closest value's index, keeping the first value when distances tie. */
export function findClosestSnapPointIndex(values: readonly number[], target: number): number {
	if (!Number.isFinite(target)) {
		return -1;
	}

	let closestIndex = -1;
	let closestDistance = Infinity;
	for (let index = 0; index < values.length; index += 1) {
		const distance = Math.abs(values[index] - target);
		if (distance < closestDistance) {
			closestDistance = distance;
			closestIndex = index;
		}
	}

	return closestIndex;
}

/** Applies resistance only after movement crosses the fully-open edge at offset zero. */
export function getDampedSnapMovement(baseOffset: number, movement: number): number {
	const nextOffset = baseOffset + movement;
	if (nextOffset >= 0) {
		return movement;
	}

	// Convert the overshoot to a sublinear distance, then back to a delta from the base offset.
	return -Math.sqrt(-nextOffset) - baseOffset;
}

/**
 * Selects a snap point or dismissal after a vertical gesture. Deltas and velocities are normalized
 * so positive values always move toward the closed edge, independent of whether the drawer swipes
 * up or down.
 */
export function resolveSnapRelease<T extends SnapPoint>({
	points,
	drawerHeight,
	currentOffset,
	dragDelta,
	velocity,
	fallbackVelocity = velocity,
	sequential = false
}: ResolveSnapReleaseOptions<T>): SnapReleaseTarget<T> | null {
	if (
		points.length === 0 ||
		!Number.isFinite(drawerHeight) ||
		drawerHeight <= 0 ||
		(currentOffset !== null && !Number.isFinite(currentOffset)) ||
		!Number.isFinite(dragDelta) ||
		!Number.isFinite(velocity)
	) {
		return null;
	}

	const offsets = points.map((point) => point.offset);
	if (offsets.some((offset) => !Number.isFinite(offset))) {
		return null;
	}

	const dragDirection = Math.sign(dragDelta);
	let resolvedVelocity = velocity;
	if (
		dragDirection !== 0 &&
		Math.abs(dragDelta) >= MIN_DIRECTIONAL_DRAG &&
		Math.sign(resolvedVelocity) !== 0 &&
		Math.sign(resolvedVelocity) !== dragDirection &&
		Number.isFinite(fallbackVelocity)
	) {
		// A brief reversal at pointer-up should not overturn the established drag direction.
		resolvedVelocity = fallbackVelocity;
	}

	const resolvedCurrentOffset = clamp(currentOffset ?? 0, 0, drawerHeight);
	const dragTargetOffset = clamp(resolvedCurrentOffset + dragDelta, 0, drawerHeight);
	const velocityOffset =
		Math.abs(resolvedVelocity) >= SNAP_VELOCITY_THRESHOLD
			? clamp(resolvedVelocity, -MAX_SNAP_VELOCITY, MAX_SNAP_VELOCITY) * SNAP_VELOCITY_MULTIPLIER
			: 0;
	const targetOffset = sequential
		? dragTargetOffset
		: clamp(dragTargetOffset + velocityOffset, 0, drawerHeight);

	if (sequential) {
		const orderedPoints = [...points].sort((a, b) => a.offset - b.offset);
		const orderedOffsets = orderedPoints.map((point) => point.offset);
		const currentIndex = findClosestSnapPointIndex(orderedOffsets, resolvedCurrentOffset);
		let targetPoint = orderedPoints[findClosestSnapPointIndex(orderedOffsets, targetOffset)];
		let effectiveTargetOffset = targetOffset;

		const velocityDirection = Math.sign(resolvedVelocity);
		const shouldAdvance =
			dragDirection !== 0 &&
			velocityDirection !== 0 &&
			velocityDirection === dragDirection &&
			Math.abs(resolvedVelocity) >= SNAP_VELOCITY_THRESHOLD;
		if (shouldAdvance) {
			const adjacentIndex = clamp(currentIndex + dragDirection, 0, orderedPoints.length - 1);
			if (adjacentIndex !== currentIndex) {
				const adjacentPoint = orderedPoints[adjacentIndex];
				const shouldForceAdjacent =
					dragDirection > 0
						? targetOffset < adjacentPoint.offset
						: targetOffset > adjacentPoint.offset;
				if (shouldForceAdjacent) {
					targetPoint = adjacentPoint;
					effectiveTargetOffset = adjacentPoint.offset;
				}
			} else if (dragDirection > 0) {
				return { type: 'close' };
			}
		}

		return Math.abs(effectiveTargetOffset - drawerHeight) <
			Math.abs(effectiveTargetOffset - targetPoint.offset)
			? { type: 'close' }
			: { type: 'snap', point: targetPoint };
	}

	if (resolvedVelocity >= SNAP_VELOCITY_THRESHOLD && dragDelta > 0) {
		return { type: 'close' };
	}

	const targetPoint = points[findClosestSnapPointIndex(offsets, targetOffset)];
	return Math.abs(targetOffset - drawerHeight) < Math.abs(targetOffset - targetPoint.offset)
		? { type: 'close' }
		: { type: 'snap', point: targetPoint };
}
