import type { DrawerSwipeBehavior } from '../types.js';

interface DrawerVisualState {
	readonly swipeProgress: number;
	readonly frontmostHeight: number;
	readonly swiping: boolean;
	readonly swipeStrength: number;
	readonly swipeEasing: string;
	readonly swipeBehavior: DrawerSwipeBehavior;
}

const EMPTY_VISUAL_STATE: DrawerVisualState = {
	swipeProgress: 0,
	frontmostHeight: 0,
	swiping: false,
	swipeStrength: 1,
	swipeEasing: '',
	swipeBehavior: 'drawer'
};

export class DrawerVisualStateStore {
	#state: DrawerVisualState = EMPTY_VISUAL_STATE;
	// Keep each root's last value so removing the frontmost drawer can reveal the previous one.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#states = new Map<object, DrawerVisualState>();
	// This store is deliberately imperative so pointer-move updates never schedule Svelte effects.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#listeners = new Set<(state: DrawerVisualState) => void>();

	set(owner: object, next: DrawerVisualState): void {
		const swipeProgress = Number.isFinite(next.swipeProgress) ? next.swipeProgress : 0;
		const frontmostHeight = Number.isFinite(next.frontmostHeight) ? next.frontmostHeight : 0;
		const swipeStrength = Number.isFinite(next.swipeStrength) ? next.swipeStrength : 1;

		const resolved = {
			swipeProgress,
			frontmostHeight,
			swiping: next.swiping,
			swipeStrength,
			swipeEasing: next.swipeEasing,
			swipeBehavior: next.swipeBehavior
		};
		// Map.set does not change insertion order for an existing key; promote the latest writer.
		this.#states.delete(owner);
		this.#states.set(owner, resolved);
		this.#publish(resolved);
	}

	remove(owner: object): void {
		if (!this.#states.delete(owner)) return;
		this.#publish([...this.#states.values()].at(-1) ?? EMPTY_VISUAL_STATE);
	}

	#publish(next: DrawerVisualState): void {
		if (
			next.swipeProgress === this.#state.swipeProgress &&
			next.frontmostHeight === this.#state.frontmostHeight &&
			next.swiping === this.#state.swiping &&
			next.swipeStrength === this.#state.swipeStrength &&
			next.swipeEasing === this.#state.swipeEasing &&
			next.swipeBehavior === this.#state.swipeBehavior
		) {
			return;
		}
		this.#state = next;
		for (const listener of this.#listeners) listener(this.#state);
	}

	subscribe(listener: (state: DrawerVisualState) => void): () => void {
		this.#listeners.add(listener);
		listener(this.#state);
		return () => this.#listeners.delete(listener);
	}
}

export class DrawerProviderState {
	// Mutations are mirrored into the reactive `active` boolean below.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#openDrawers = new Set<object>();
	active = $state(false);
	readonly visualState = new DrawerVisualStateStore();

	setOpen(drawer: object, open: boolean): void {
		if (this.#openDrawers.has(drawer) === open) return;
		if (open) this.#openDrawers.add(drawer);
		else this.#openDrawers.delete(drawer);
		this.active = this.#openDrawers.size > 0;
	}

	remove(drawer: object): void {
		this.setOpen(drawer, false);
		this.visualState.remove(drawer);
	}
}
