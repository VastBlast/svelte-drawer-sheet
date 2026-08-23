import type { DrawerSwipeDirection } from '../types.js';

export const ATTR = {
	content: 'data-drawer-content',
	swipeIgnore: 'data-drawer-swipe-ignore',
	baseSwipeIgnore: 'data-base-ui-swipe-ignore'
} as const;

export const CSS_VAR = {
	swipeMovementX: '--drawer-swipe-movement-x',
	swipeMovementY: '--drawer-swipe-movement-y',
	swipeProgress: '--drawer-swipe-progress',
	swipeStrength: '--drawer-swipe-strength',
	swipeEasing: '--drawer-swipe-easing',
	snapPointOffset: '--drawer-snap-point-offset',
	height: '--drawer-height',
	frontmostHeight: '--drawer-frontmost-height',
	nestedDrawers: '--nested-drawers',
	keyboardInset: '--drawer-keyboard-inset'
} as const;

export const oppositeDirection: Record<DrawerSwipeDirection, DrawerSwipeDirection> = {
	up: 'down',
	down: 'up',
	left: 'right',
	right: 'left'
};

export function isVertical(direction: DrawerSwipeDirection): boolean {
	return direction === 'up' || direction === 'down';
}

export function getDisplacement(
	direction: DrawerSwipeDirection,
	deltaX: number,
	deltaY: number
): number {
	switch (direction) {
		case 'up':
			return -deltaY;
		case 'down':
			return deltaY;
		case 'left':
			return -deltaX;
		case 'right':
			return deltaX;
	}
}
