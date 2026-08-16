interface DrawerVisualState {
	readonly swipeProgress: number;
	readonly frontmostHeight: number;
}

export class DrawerVisualStateStore {
	#state: DrawerVisualState = { swipeProgress: 0, frontmostHeight: 0 };
	// Keep each root's last value so removing the frontmost drawer can reveal the previous one.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#states = new Map<object, DrawerVisualState>();
	// This store is deliberately imperative so pointer-move updates never schedule Svelte effects.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#listeners = new Set<(state: DrawerVisualState) => void>();

	set(owner: object, next: Partial<DrawerVisualState>): void {
		const swipeProgress = Number.isFinite(next.swipeProgress)
			? (next.swipeProgress ?? this.#state.swipeProgress)
			: 0;
		const frontmostHeight = Number.isFinite(next.frontmostHeight)
			? (next.frontmostHeight ?? this.#state.frontmostHeight)
			: 0;

		const resolved = { swipeProgress, frontmostHeight };
		// Map.set does not change insertion order for an existing key; promote the latest writer.
		this.#states.delete(owner);
		this.#states.set(owner, resolved);
		this.#publish(resolved);
	}

	remove(owner: object): void {
		if (!this.#states.delete(owner)) return;
		this.#publish([...this.#states.values()].at(-1) ?? { swipeProgress: 0, frontmostHeight: 0 });
	}

	#publish(next: DrawerVisualState): void {
		if (
			next.swipeProgress === this.#state.swipeProgress &&
			next.frontmostHeight === this.#state.frontmostHeight
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
