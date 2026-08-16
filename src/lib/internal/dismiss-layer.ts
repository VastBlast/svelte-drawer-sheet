import {
	containingShadowRoot,
	deepestActiveElement,
	isComposedDescendant,
	isElement,
	isHTMLElement
} from './dom.js';

export interface DismissLayerHandlers {
	/**
	 * Gates the document's selected layer against overlays managed by another primitive.
	 * Returning false blocks this layer without allowing the event to fall through to its parent.
	 */
	isTopmost?: () => boolean;
	parentElement?: () => HTMLElement | null;
	insideElements?: () => readonly Element[];
	/** Uses click intent so a backdrop drag cannot dismiss the drawer accidentally. */
	intentionalOutsidePress?: boolean | ((event: PointerEvent) => boolean);
	onPointerOutside?: (event: PointerEvent | MouseEvent) => void;
	onFocusOutside?: (event: FocusEvent) => void;
	onEscapeKeydown?: (event: KeyboardEvent) => void;
}

export interface DismissLayerController {
	/** Attaches this controller to one element, replacing any previous attachment. */
	attach(element: HTMLElement): () => void;
	/** Handles Escape early when it bubbles through the attached popup. */
	handleEscapeKeydown(event: KeyboardEvent): boolean;
	/** Controllers start active; reactivating a keep-mounted layer promotes it to the top. */
	setActive(active: boolean): void;
	/** Permanently detaches the controller. */
	destroy(): void;
}

interface DismissLayerEntry {
	readonly element: HTMLElement;
	readonly getHandlers: () => Readonly<DismissLayerHandlers>;
	registry: DismissLayerRegistry | null;
	shadowRoot: ShadowRoot | null;
}

interface DismissLayerRegistry {
	readonly document: Document;
	readonly entries: DismissLayerEntry[];
	composing: boolean;
	retainShadowRoot(root: ShadowRoot): void;
	releaseShadowRoot(root: ShadowRoot): void;
	destroy(): void;
}

// Coordinate topmost behavior even when an application includes separately bundled copies.
const REGISTRY = Symbol.for('svelte-drawer-sheet.dismiss-layer');

// The elements whose `labels` property is the spec's label association. A bare `'labels' in
// target` probe would also match a form exposing a control named "labels" as a named property.
const LABELABLE_SELECTOR = 'button, input, meter, output, progress, select, textarea';

function getRegistry(document: Document): DismissLayerRegistry | undefined {
	return (document as unknown as Record<symbol, DismissLayerRegistry | undefined>)[REGISTRY];
}

function setRegistry(document: Document, registry: DismissLayerRegistry | undefined): void {
	const target = document as unknown as Record<symbol, DismissLayerRegistry | undefined>;
	if (registry) target[REGISTRY] = registry;
	else delete target[REGISTRY];
}

function syncShadowRoot(registry: DismissLayerRegistry, entry: DismissLayerEntry): void {
	const next = containingShadowRoot(entry.element);
	if (entry.shadowRoot === next) return;
	if (entry.shadowRoot) registry.releaseShadowRoot(entry.shadowRoot);
	entry.shadowRoot = next;
	if (next) registry.retainShadowRoot(next);
}

function topEntry(registry: DismissLayerRegistry): DismissLayerEntry | undefined {
	const connected = registry.entries.filter(
		(entry) => entry.element.isConnected && entry.element.ownerDocument === registry.document
	);
	for (const entry of connected) syncShadowRoot(registry, entry);
	let topmost = connected.at(-1);
	if (!topmost) return undefined;

	const descendsFrom = (entry: DismissLayerEntry, ancestor: DismissLayerEntry) => {
		let parent = entry.getHandlers().parentElement?.() ?? null;
		const visited = new Set<HTMLElement>();
		while (parent && !visited.has(parent)) {
			if (parent === ancestor.element) return true;
			visited.add(parent);
			parent =
				connected
					.find((candidate) => candidate.element === parent)
					?.getHandlers()
					.parentElement?.() ?? null;
		}
		return false;
	};
	for (const entry of connected) {
		if (descendsFrom(entry, topmost)) topmost = entry;
	}
	return topmost;
}

function isOutside(
	event: Event,
	element: HTMLElement,
	insideElements: readonly Element[] = []
): boolean {
	// `composedPath` preserves the real target across open shadow roots and retargeting boundaries.
	const path = event.composedPath();
	if (path.includes(element) || insideElements.some((inside) => path.includes(inside)))
		return false;
	const target = resolveEventTarget(event, [element, ...insideElements], path[0] ?? event.target);
	if (
		isElement(target) &&
		(isComposedDescendant(element, target) ||
			insideElements.some((inside) => isComposedDescendant(inside, target)))
	) {
		return false;
	}
	// A labeled control activated from a label inside the popup — an iOS haptic switch
	// portaled to the body, for example — is half of one logical widget. Its forwarded
	// `detail: 0` activation click, focus, and presses belong to the popup that contains
	// its label.
	if (isHTMLElement(target) && target.matches(LABELABLE_SELECTOR)) {
		for (const label of (target as HTMLInputElement).labels ?? []) {
			if (
				isComposedDescendant(element, label) ||
				insideElements.some((inside) => isComposedDescendant(inside, label))
			) {
				return false;
			}
		}
	}
	if (isHTMLElement(target) && isScrollbarPress(event, target)) return false;
	if (target && typeof target === 'object' && 'isConnected' in target && target.isConnected) {
		// A connected DOM target is authoritative, including clipped or rounded areas inside the
		// popup's bounding box. Geometry is only a fallback for retargeted injected UI.
		return true;
	}
	if ('clientX' in event && 'clientY' in event) {
		const { clientX, clientY } = event as PointerEvent;
		const rect = element.getBoundingClientRect();
		// Password managers and injected UI can retarget an event outside the popup while its pointer
		// is visibly inside. Geometry is the authoritative fallback for those integrations.
		if (
			clientX >= rect.left &&
			clientX <= rect.right &&
			clientY >= rect.top &&
			clientY <= rect.bottom
		) {
			return false;
		}
	}
	return true;
}

function retainedShadowRoots(elements: readonly Element[]): ShadowRoot[] {
	return [
		...new Set(
			elements.map((element) => containingShadowRoot(element)).filter(Boolean) as ShadowRoot[]
		)
	];
}

function resolveEventTarget(
	event: Event,
	elements: readonly Element[],
	target: EventTarget | null
): EventTarget | null {
	for (const root of retainedShadowRoots(elements)) {
		if (target !== root.host) continue;
		if (
			event.type === 'focusin' ||
			(event.type === 'click' && 'detail' in event && event.detail === 0)
		) {
			const active = deepestActiveElement(root);
			if (active) return active;
		}
		if ('clientX' in event && 'clientY' in event) {
			const hit = deepElementFromPoint(
				elements[0].ownerDocument,
				event.clientX as number,
				event.clientY as number,
				elements
			);
			if (hit) return hit;
		}
	}
	return target;
}

function isScrollbarPress(event: Event, target: HTMLElement): boolean {
	if (!('offsetX' in event) || !('offsetY' in event)) return false;
	if ('pointerType' in event && event.pointerType === 'touch') return false;
	const document = target.ownerDocument;
	const isRoot = target === document.documentElement || target === document.body;
	const style = document.defaultView?.getComputedStyle(target);
	if (!style) return false;
	const { offsetX, offsetY } = event as MouseEvent;
	const scrollable = /auto|scroll/;
	const canScrollX =
		(isRoot || scrollable.test(style.overflowX)) &&
		target.clientWidth > 0 &&
		target.scrollWidth > target.clientWidth;
	const canScrollY =
		(isRoot || scrollable.test(style.overflowY)) &&
		target.clientHeight > 0 &&
		target.scrollHeight > target.clientHeight;
	const contentWidth = isRoot
		? Math.min(target.clientWidth, target.offsetWidth)
		: target.clientWidth;
	const contentHeight = isRoot
		? Math.min(target.clientHeight, target.offsetHeight)
		: target.clientHeight;
	const verticalGutter = Math.abs(target.offsetWidth - target.clientWidth);
	const pressedVertical =
		canScrollY && (style.direction === 'rtl' ? offsetX <= verticalGutter : offsetX > contentWidth);
	const pressedHorizontal = canScrollX && offsetY > contentHeight;
	return pressedVertical || pressedHorizontal;
}

function deepElementFromPoint(
	document: Document,
	x: number,
	y: number,
	elements: readonly Element[] = []
): Element | null {
	let hit = document.elementFromPoint?.(x, y) ?? null;
	for (const root of retainedShadowRoots(elements)) {
		const nested = root.elementFromPoint?.(x, y) ?? null;
		if (nested !== root.host && nested && isComposedDescendant(root.host, nested)) {
			hit = nested;
			break;
		}
	}
	const visited = new Set<Element>();
	while (hit?.shadowRoot && !visited.has(hit)) {
		visited.add(hit);
		const nested = hit.shadowRoot.elementFromPoint?.(x, y) ?? null;
		if (!nested || nested === hit) break;
		hit = nested;
	}
	return hit;
}

function isOutsideAtRelease(
	event: PointerEvent,
	element: HTMLElement,
	insideElements: readonly Element[] = []
): boolean {
	const elements = [element, ...insideElements];
	const hit = deepElementFromPoint(element.ownerDocument, event.clientX, event.clientY, elements);
	if (!isElement(hit)) return isOutside(event, element, insideElements);
	return !(
		isComposedDescendant(element, hit) ||
		insideElements.some((inside) => isComposedDescendant(inside, hit))
	);
}

function selectedHandlers(registry: DismissLayerRegistry): {
	entry: DismissLayerEntry;
	handlers: Readonly<DismissLayerHandlers>;
} | null {
	const entry = topEntry(registry);
	if (!entry) return null;
	const handlers = entry.getHandlers();
	return handlers.isTopmost?.() === false ? null : { entry, handlers };
}

function createRegistry(document: Document): DismissLayerRegistry {
	const entries: DismissLayerEntry[] = [];
	const shadowRoots = new Map<ShadowRoot, number>();
	const handledFocusEvents = new WeakSet<FocusEvent>();
	// ShadowRoot inherits EventTarget focus events, but TypeScript's specialized overload omits them.
	const shadowFocusIn: EventListener = (event) => onFocusIn(event as FocusEvent);
	let pendingRelease: {
		entry: DismissLayerEntry;
		pointerId: number;
		releaseEvent?: PointerEvent;
	} | null = null;
	let compositionTimer: ReturnType<typeof setTimeout> | undefined;
	const registry: DismissLayerRegistry = {
		document,
		entries,
		composing: false,
		retainShadowRoot(root) {
			const count = shadowRoots.get(root) ?? 0;
			if (count === 0) root.addEventListener('focusin', shadowFocusIn, true);
			shadowRoots.set(root, count + 1);
		},
		releaseShadowRoot(root) {
			const count = shadowRoots.get(root);
			if (!count) return;
			if (count > 1) {
				shadowRoots.set(root, count - 1);
				return;
			}
			root.removeEventListener('focusin', shadowFocusIn, true);
			shadowRoots.delete(root);
		},
		destroy() {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('pointerup', onPointerUp, true);
			document.removeEventListener('pointercancel', onPointerCancel, true);
			document.removeEventListener('click', onClick, true);
			document.removeEventListener('focusin', onFocusIn, true);
			document.removeEventListener('keydown', onKeydown);
			document.removeEventListener('compositionstart', onCompositionStart);
			document.removeEventListener('compositionend', onCompositionEnd);
			for (const root of shadowRoots.keys())
				root.removeEventListener('focusin', shadowFocusIn, true);
			shadowRoots.clear();
			if (compositionTimer !== undefined) clearTimeout(compositionTimer);
		}
	};

	function onPointerDown(event: PointerEvent): void {
		pendingRelease = null;
		// A secondary mouse button or a non-primary touch/pen contact is never an outside press.
		if (!event.isPrimary || event.button !== 0) return;
		const selected = selectedHandlers(registry);
		if (
			!selected ||
			!isOutside(event, selected.entry.element, selected.handlers.insideElements?.())
		)
			return;
		const intentional = selected.handlers.intentionalOutsidePress;
		if (typeof intentional === 'function' ? intentional(event) : intentional) {
			pendingRelease = {
				entry: selected.entry,
				pointerId: event.pointerId
			};
			return;
		}
		selected.handlers.onPointerOutside?.(event);
	}

	function onPointerUp(event: PointerEvent): void {
		const pending = pendingRelease;
		if (!pending || pending.pointerId !== event.pointerId) return;
		const selected = selectedHandlers(registry);
		if (
			!selected ||
			selected.entry !== pending.entry ||
			!isOutsideAtRelease(event, selected.entry.element, selected.handlers.insideElements?.())
		) {
			pendingRelease = null;
			return;
		}
		pending.releaseEvent = event;
	}

	function onPointerCancel(event: PointerEvent): void {
		if (pendingRelease?.pointerId === event.pointerId) pendingRelease = null;
	}

	function onClick(event: MouseEvent): void {
		const pending = pendingRelease;
		pendingRelease = null;
		const selected = selectedHandlers(registry);
		if (
			!selected ||
			!isOutside(event, selected.entry.element, selected.handlers.insideElements?.())
		) {
			return;
		}
		if (pending?.entry === selected.entry && pending.releaseEvent) {
			selected.handlers.onPointerOutside?.(event);
			return;
		}
		// A physical trailing click without an outside press sequence is ignored, e.g. from
		// SwipeArea when its opening pointerdown predated layer activation.
		if (event.detail !== 0) return;
		// Only genuinely virtual activation — keyboard or assistive technology — dismisses
		// from a bare click; a pointer-generated click identifies itself through `pointerType`.
		if ('pointerType' in event && (event as PointerEvent).pointerType !== '') return;
		selected.handlers.onPointerOutside?.(event);
	}

	function onFocusIn(event: FocusEvent): void {
		if (handledFocusEvents.has(event)) return;
		handledFocusEvents.add(event);
		const selected = selectedHandlers(registry);
		if (
			!selected ||
			!isOutside(event, selected.entry.element, selected.handlers.insideElements?.())
		)
			return;
		selected.handlers.onFocusOutside?.(event);
	}

	function onKeydown(event: KeyboardEvent): void {
		// Escape belongs to the active IME while it is composing, not to the surrounding drawer.
		if (
			event.key !== 'Escape' ||
			event.isComposing ||
			registry.composing ||
			event.defaultPrevented
		) {
			return;
		}
		selectedHandlers(registry)?.handlers.onEscapeKeydown?.(event);
	}

	function onCompositionStart(): void {
		if (compositionTimer !== undefined) clearTimeout(compositionTimer);
		compositionTimer = undefined;
		registry.composing = true;
	}

	function onCompositionEnd(): void {
		if (compositionTimer !== undefined) clearTimeout(compositionTimer);
		// Safari dispatches compositionend before the Escape keydown that only dismisses the IME.
		compositionTimer = setTimeout(() => {
			compositionTimer = undefined;
			registry.composing = false;
		}, 5);
	}

	document.addEventListener('pointerdown', onPointerDown, true);
	document.addEventListener('pointerup', onPointerUp, true);
	document.addEventListener('pointercancel', onPointerCancel, true);
	document.addEventListener('click', onClick, true);
	document.addEventListener('focusin', onFocusIn, true);
	document.addEventListener('keydown', onKeydown);
	document.addEventListener('compositionstart', onCompositionStart);
	document.addEventListener('compositionend', onCompositionEnd);
	return registry;
}

function register(entry: DismissLayerEntry): void {
	if (entry.registry) unregister(entry);
	const document = entry.element.ownerDocument;
	let registry = getRegistry(document);
	if (!registry) {
		registry = createRegistry(document);
		setRegistry(document, registry);
	}
	registry.entries.push(entry);
	entry.registry = registry;
	syncShadowRoot(registry, entry);
}

function unregister(entry: DismissLayerEntry): void {
	// Retain the original registry so adopting an attached node into an iframe cannot leak it.
	const registry = entry.registry;
	if (!registry) return;
	entry.registry = null;
	const { document } = registry;
	const index = registry.entries.indexOf(entry);
	if (index >= 0) registry.entries.splice(index, 1);
	if (entry.shadowRoot) {
		registry.releaseShadowRoot(entry.shadowRoot);
		entry.shadowRoot = null;
	}
	if (index < 0) return;
	if (registry.entries.length > 0) return;
	registry.destroy();
	if (getRegistry(document) === registry) setRegistry(document, undefined);
}

/**
 * Creates a document-scoped dismissal layer. Handlers are resolved for every native event so
 * callback and nesting changes never require reattaching the element.
 */
export function createDismissLayer(
	getHandlers: () => Readonly<DismissLayerHandlers>
): DismissLayerController {
	let active = true;
	let destroyed = false;
	let attachment: { entry: DismissLayerEntry; token: object } | null = null;

	function deactivateAttachment(): void {
		if (attachment && active) unregister(attachment.entry);
	}

	return {
		attach(element) {
			if (destroyed) return () => {};
			deactivateAttachment();
			const token = {};
			const entry: DismissLayerEntry = { element, getHandlers, registry: null, shadowRoot: null };
			attachment = { entry, token };
			if (active) register(entry);

			return () => {
				if (attachment?.token !== token) return;
				if (active) unregister(entry);
				attachment = null;
			};
		},
		handleEscapeKeydown(event) {
			const entry = attachment?.entry;
			const registry = entry?.registry;
			if (
				destroyed ||
				!active ||
				!entry ||
				!registry ||
				event.key !== 'Escape' ||
				event.isComposing ||
				registry.composing ||
				event.defaultPrevented
			) {
				return false;
			}
			const selected = selectedHandlers(registry);
			if (selected?.entry !== entry) return false;
			selected.handlers.onEscapeKeydown?.(event);
			return true;
		},
		setActive(nextActive) {
			if (destroyed || active === nextActive) return;
			active = nextActive;
			if (!attachment) return;
			if (active) register(attachment.entry);
			else unregister(attachment.entry);
		},
		destroy() {
			if (destroyed) return;
			deactivateAttachment();
			attachment = null;
			destroyed = true;
		}
	};
}
