import { untrack } from 'svelte';

export interface DrawerRegisteredTrigger<Payload> {
	readonly element: Element;
	readonly payload: () => Payload | undefined;
}

interface DrawerConnection<Payload> {
	readonly open: boolean;
	readonly contentId: string | undefined;
	readonly activeTrigger: Element | undefined;
	readonly document: Document | undefined;
	requestOpen(
		open: boolean,
		options?: { payload?: Payload; trigger?: Element; event?: Event }
	): boolean;
	resolveTrigger?(id: string): DrawerRegisteredTrigger<Payload> | undefined;
}

/** Connects detached triggers and imperative callers to one mounted Drawer.Root. */
export class DrawerHandle<Payload = unknown> {
	#connection = $state.raw<DrawerConnection<Payload> | null>(null);
	// Attachment order is bookkeeping only; the active pointer below is the reactive surface.
	#connections: DrawerConnection<Payload>[] = [];
	#triggers = $state.raw<DrawerRegisteredTrigger<Payload>[]>([]);

	get isOpen(): boolean {
		return this.#connection?.open ?? false;
	}

	get contentId(): string | undefined {
		return this.#connection?.contentId;
	}

	get activeTrigger(): Element | undefined {
		return this.#connection?.activeTrigger;
	}

	open(triggerId: string | null = null): void {
		const connection = this.#connection;
		if (!connection) return;
		const registered = triggerId
			? (connection.resolveTrigger?.(triggerId) ?? this._resolveTrigger(triggerId))
			: undefined;
		const trigger = triggerId
			? (registered?.element ??
				(typeof document === 'undefined' && !connection.document
					? undefined
					: ((connection.document ?? document).getElementById(triggerId) ?? undefined)))
			: undefined;
		connection.requestOpen(
			true,
			registered ? { trigger, payload: registered.payload() } : { trigger }
		);
	}

	openWithPayload(payload: Payload): void {
		this.#connection?.requestOpen(true, { payload });
	}

	close(): void {
		this.#connection?.requestOpen(false);
	}

	/** @internal */
	_attach(connection: DrawerConnection<Payload>): () => void {
		this.#connections.push(connection);
		this.#connection = connection;
		return () => {
			const index = this.#connections.lastIndexOf(connection);
			if (index === -1) return;
			this.#connections.splice(index, 1);
			this.#connection = this.#connections.at(-1) ?? null;
		};
	}

	/** @internal */
	_registerTrigger(element: Element, payload: () => Payload | undefined): () => void {
		const registration = { element, payload };
		untrack(() => {
			this.#triggers = [...this.#triggers, registration];
		});
		return () => {
			untrack(() => {
				const index = this.#triggers.lastIndexOf(registration);
				if (index !== -1) this.#triggers = this.#triggers.toSpliced(index, 1);
			});
		};
	}

	/** @internal */
	_resolveTrigger(id: string): DrawerRegisteredTrigger<Payload> | undefined {
		return this.#triggers.findLast((registration) => registration.element.id === id);
	}

	/** @internal */
	_triggerElements(): readonly Element[] {
		return this.#triggers.map((registration) => registration.element);
	}

	/** @internal */
	_openFromTrigger(payload: Payload | undefined, trigger: Element, event: Event): boolean {
		const connection = this.#connection;
		if (!connection) return false;
		const open = !(connection.open && connection.activeTrigger === trigger);
		return connection.requestOpen(open, open ? { payload, trigger, event } : { trigger, event });
	}
}

export function createHandle<Payload = unknown>(): DrawerHandle<Payload> {
	return new DrawerHandle<Payload>();
}
