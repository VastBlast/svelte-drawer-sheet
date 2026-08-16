import {
	containingShadowRoot,
	deepestActiveElement,
	isComposedDescendant,
	isElement,
	isHTMLElement,
	shadowHost
} from './dom.js';

const TABBABLE_SELECTOR = [
	'a[href]',
	'area[href]',
	'button:not([disabled])',
	'input:not([disabled]):not([type="hidden"])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'iframe',
	'audio[controls]',
	'video[controls]',
	'summary',
	'[contenteditable]:not([contenteditable="false"])',
	'[tabindex]'
].join(',');

interface FocusTrapEntry {
	readonly container: HTMLElement;
	readonly shouldYield: ((target: HTMLElement) => boolean) | undefined;
	readonly parent: (() => HTMLElement | null) | undefined;
	readonly insideElements: (() => readonly Element[]) | undefined;
	shadowRoot: ShadowRoot | null;
	open: boolean;
	trapping: boolean;
	allowedOutside: HTMLElement | null;
	lastFocused: HTMLElement | null;
	/** Set when a reclaim failed to hold focus: a foreign trap owns this scope's contest. */
	contested: boolean;
}

interface FocusTrapRegistry {
	readonly document: Document;
	readonly entries: FocusTrapEntry[];
	retainShadowRoot(root: ShadowRoot): void;
	releaseShadowRoot(root: ShadowRoot): void;
	readonly destroy: () => void;
}

export interface FocusTrapController {
	setState(open: boolean, trapping: boolean): void;
	setAllowedOutside(element: HTMLElement | null): void;
	focusFirst(): void;
	destroy(): void;
}

// Coordinate focus ownership when an application bundles more than one copy of the library.
const REGISTRY = Symbol.for('svelte-drawer-sheet.focus-trap');

function getRegistry(document: Document): FocusTrapRegistry | undefined {
	return (document as unknown as Record<symbol, FocusTrapRegistry | undefined>)[REGISTRY];
}

function setRegistry(document: Document, registry: FocusTrapRegistry | undefined): void {
	const target = document as unknown as Record<symbol, FocusTrapRegistry | undefined>;
	if (registry) target[REGISTRY] = registry;
	else delete target[REGISTRY];
}

function isHidden(element: HTMLElement): boolean {
	let current: Element | null = element;
	while (current) {
		if (current.hasAttribute('hidden') || current.hasAttribute('inert')) return true;
		const parent: Element | null = current.parentElement;
		current = parent ?? shadowHost(current.getRootNode());
	}

	const style = element.ownerDocument.defaultView?.getComputedStyle(element);
	return (
		!style ||
		style.display === 'none' ||
		style.visibility === 'hidden' ||
		element.getClientRects().length === 0
	);
}

function isTabbable(element: HTMLElement): boolean {
	if (!element.matches(TABBABLE_SELECTOR) || element.tabIndex < 0 || isHidden(element))
		return false;
	if (element.matches(':disabled')) return false;
	if (element.localName !== 'input' || (element as HTMLInputElement).type !== 'radio') return true;

	const radio = element as HTMLInputElement;
	if (!radio.name) return true;
	const root = radio.getRootNode() as Document | ShadowRoot;
	const group = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(
		(candidate) => candidate.name === radio.name && candidate.form === radio.form
	);
	const checked = group.find((candidate) => candidate.checked);
	return !checked || checked === radio;
}

function collectTabbableElements(
	root: ParentNode,
	result: Set<HTMLElement>,
	visited: Set<Element>
): void {
	for (const child of root.children) {
		if (!isHTMLElement(child) || visited.has(child)) continue;
		visited.add(child);
		if (isTabbable(child)) result.add(child);

		if (child.localName === 'slot') {
			for (const assigned of (child as HTMLSlotElement).assignedElements({ flatten: true })) {
				if (!isHTMLElement(assigned) || visited.has(assigned)) continue;
				visited.add(assigned);
				if (isTabbable(assigned)) result.add(assigned);
				if (assigned.shadowRoot) collectTabbableElements(assigned.shadowRoot, result, visited);
				collectTabbableElements(assigned, result, visited);
			}
		}
		if (child.shadowRoot) collectTabbableElements(child.shadowRoot, result, visited);
		// Light children can still participate through a slot. The Set avoids duplicates, while
		// the visibility check excludes unslotted nodes from the final tab order.
		collectTabbableElements(child, result, visited);
	}
}

function getTabbableElements(container: HTMLElement): HTMLElement[] {
	const elements = new Set<HTMLElement>();
	const visited = new Set<Element>();
	if (container.shadowRoot) collectTabbableElements(container.shadowRoot, elements, visited);
	collectTabbableElements(container, elements, visited);
	return [...elements]
		.map((element, order) => ({ element, order }))
		.sort((a, b) => {
			const aIndex = a.element.tabIndex;
			const bIndex = b.element.tabIndex;
			if (aIndex === bIndex) return a.order - b.order;
			if (aIndex === 0) return 1;
			if (bIndex === 0) return -1;
			return aIndex - bIndex;
		})
		.map(({ element }) => element);
}

function activeElement(entry: FocusTrapEntry): HTMLElement | null {
	const active =
		(entry.shadowRoot && deepestActiveElement(entry.shadowRoot)) ??
		deepestActiveElement(entry.container.ownerDocument);
	return isHTMLElement(active) ? active : null;
}

function shadowActiveElement(entry: FocusTrapEntry): HTMLElement | null {
	const active = entry.shadowRoot && deepestActiveElement(entry.shadowRoot);
	return isHTMLElement(active) ? active : null;
}

function focus(element: HTMLElement): boolean {
	try {
		element.focus({ preventScroll: true });
	} catch {
		// A custom element can expose a focus method that throws while it is disconnecting.
	}
	const active = deepestActiveElement(containingShadowRoot(element) ?? element.ownerDocument);
	return Boolean(active && (active === element || isComposedDescendant(element, active)));
}

function syncShadowRoot(registry: FocusTrapRegistry, entry: FocusTrapEntry): void {
	const next = containingShadowRoot(entry.container);
	if (entry.shadowRoot === next) return;
	if (entry.shadowRoot) registry.releaseShadowRoot(entry.shadowRoot);
	entry.shadowRoot = next;
	if (next) registry.retainShadowRoot(next);
}

function activeEntry(registry: FocusTrapRegistry): FocusTrapEntry | undefined {
	const open = registry.entries.filter((entry) => entry.open && entry.container.isConnected);
	let topmost = open.at(-1);
	if (!topmost) return undefined;

	const descendsFrom = (entry: FocusTrapEntry, ancestor: FocusTrapEntry) => {
		let parent = entry.parent?.() ?? null;
		const visited = new Set<HTMLElement>();
		while (parent && !visited.has(parent)) {
			if (parent === ancestor.container) return true;
			visited.add(parent);
			parent = open.find((candidate) => candidate.container === parent)?.parent?.() ?? null;
		}
		return false;
	};
	// Nested roots remain above their contextual parent even if Svelte schedules the parent's
	// activation effect later. An unrelated entry still wins by normal stack order.
	for (const entry of open) {
		if (descendsFrom(entry, topmost)) topmost = entry;
	}
	return topmost?.trapping && !topmost.container.hasAttribute('data-nested-open')
		? topmost
		: undefined;
}

function isInsideEntry(entry: FocusTrapEntry, target: Element): boolean {
	return (
		isComposedDescendant(entry.container, target) ||
		Boolean(
			entry
				.insideElements?.()
				.some(
					(element) =>
						element.isConnected &&
						element.ownerDocument === entry.container.ownerDocument &&
						isComposedDescendant(element, target)
				)
		)
	);
}

function isInsideContainer(entry: FocusTrapEntry, target: HTMLElement): boolean {
	return isComposedDescendant(entry.container, target);
}

function isAllowedOutside(entry: FocusTrapEntry, target: Element): boolean {
	return Boolean(
		entry.allowedOutside &&
		entry.allowedOutside.isConnected &&
		isComposedDescendant(entry.allowedOutside, target)
	);
}

function fallbackFocus(entry: FocusTrapEntry): void {
	const target = getTabbableElements(entry.container)[0] ?? entry.container;
	focus(target);
}

/**
 * Returns focus that fell out of the scope to the popup container, matching Base UI's
 * `restoreFocus="popup"`. Re-focusing the previously focused control instead would re-summon the
 * virtual keyboard on iOS, where a tap on a non-focusable control blurs an input without focusing
 * anything else.
 */
function restoreScopeFocus(entry: FocusTrapEntry): void {
	if (!focus(entry.container)) fallbackFocus(entry);
}

function createRegistry(document: Document): FocusTrapRegistry {
	const entries: FocusTrapEntry[] = [];
	const shadowRoots = new Map<ShadowRoot, number>();
	const handledFocusEvents = new WeakSet<FocusEvent>();
	// TypeScript's ShadowRoot event map only declares `slotchange`, even though focus events are
	// valid EventTarget events. Keep one stable adapter so add/remove use the same listener.
	const shadowFocusIn: EventListener = (event) => handleFocusIn(event as FocusEvent);
	const shadowFocusOut: EventListener = (event) => handleFocusOut(event as FocusEvent);
	const registry: FocusTrapRegistry = {
		document,
		entries,
		retainShadowRoot(root) {
			const count = shadowRoots.get(root) ?? 0;
			if (count === 0) {
				root.addEventListener('focusin', shadowFocusIn, true);
				root.addEventListener('focusout', shadowFocusOut, true);
			}
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
			root.removeEventListener('focusout', shadowFocusOut, true);
			shadowRoots.delete(root);
		},
		destroy: () => {
			document.removeEventListener('focusin', handleFocusIn, true);
			document.removeEventListener('focusout', handleFocusOut, true);
			document.removeEventListener('keydown', handleKeydown, true);
			for (const root of shadowRoots.keys()) {
				root.removeEventListener('focusin', shadowFocusIn, true);
				root.removeEventListener('focusout', shadowFocusOut, true);
			}
			shadowRoots.clear();
		}
	};

	// Another modal library's focus trap can steal focus back from inside its own focus handlers.
	// Unchecked, the two traps livelock the page: synchronously through recursive event dispatch,
	// or as a flat focusout → microtask → reclaim cycle that starves the event loop. A reclaim is
	// therefore never started from inside another reclaim's dispatch, and a reclaim that provably
	// fails to keep focus in scope marks that scope contested: an adversary owns focus, so the
	// scope stops reclaiming until focus genuinely returns to it or it opens anew.
	let reclaiming = false;

	function reclaimFocus(entry: FocusTrapEntry): void {
		if (reclaiming || entry.contested) return;
		reclaiming = true;
		try {
			restoreScopeFocus(entry);
		} finally {
			reclaiming = false;
		}
		const active = activeElement(entry);
		if (active && (isInsideEntry(entry, active) || isAllowedOutside(entry, active))) return;
		entry.contested = true;
	}

	function handleFocusIn(event: FocusEvent) {
		if (handledFocusEvents.has(event)) return;
		handledFocusEvents.add(event);
		const entry = activeEntry(registry);
		if (!entry) return;
		syncShadowRoot(registry, entry);
		const pathTarget = event.composedPath()[0] ?? event.target;
		const target = entry.shadowRoot?.host === pathTarget ? shadowActiveElement(entry) : pathTarget;
		// Focusable SVG participates in the scope too; only the HTML-specific extras skip it.
		if (!isElement(target)) return;
		if (isInsideEntry(entry, target)) {
			if (isHTMLElement(target)) entry.lastFocused = target;
			entry.allowedOutside = null;
			entry.contested = false;
			return;
		}
		if (isHTMLElement(target) && entry.shouldYield?.(target)) return;
		if (!isAllowedOutside(entry, target)) reclaimFocus(entry);
	}

	function handleFocusOut(event: FocusEvent) {
		if (handledFocusEvents.has(event)) return;
		handledFocusEvents.add(event);
		const entry = activeEntry(registry);
		if (!entry) return;
		syncShadowRoot(registry, entry);
		const pathTarget = event.composedPath()[0] ?? event.target;
		const target = entry.shadowRoot?.host === pathTarget ? entry.lastFocused : pathTarget;
		if (!isHTMLElement(target) || (!isInsideEntry(entry, target) && !entry.shouldYield?.(target))) {
			return;
		}
		queueMicrotask(() => {
			const current = activeEntry(registry);
			if (!current) return;
			syncShadowRoot(registry, current);
			const active =
				(current.shadowRoot && deepestActiveElement(current.shadowRoot)) ??
				deepestActiveElement(current.container.ownerDocument);
			if (
				active &&
				(isInsideEntry(current, active) ||
					isAllowedOutside(current, active) ||
					(isHTMLElement(active) && current.shouldYield?.(active)))
			) {
				return;
			}
			// An ordinary blur that lands on the body stands: this microtask can observe the transient
			// body focus in the middle of a legitimate focus move, and re-grabbing a still-visible
			// control re-summons the virtual keyboard on iOS taps that blur an input without focusing
			// anything else. A vanished control, or focus reaching a foreign outside element such as a
			// focusable SVG, still reconciles.
			const fellToBody = !active || active === current.container.ownerDocument.body;
			if (fellToBody && isHTMLElement(target) && target.isConnected && !isHidden(target)) return;
			reclaimFocus(current);
		});
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Tab' || event.defaultPrevented) return;
		const entry = activeEntry(registry);
		if (!entry) return;
		syncShadowRoot(registry, entry);

		const active = activeElement(entry);
		// A portaled menu or nested dialog owns its own Tab order while it is an explicit branch of
		// this focus scope. Its eventual focus exit is still caught by the document focus listener.
		if (
			active &&
			!isInsideContainer(entry, active) &&
			(isInsideEntry(entry, active) || entry.shouldYield?.(active))
		) {
			return;
		}
		const tabbable = getTabbableElements(entry.container);
		if (tabbable.length === 0) {
			event.preventDefault();
			focus(entry.container);
			return;
		}

		const first = tabbable[0];
		const last = tabbable.at(-1)!;
		if (
			!active ||
			isAllowedOutside(entry, active) ||
			!isInsideEntry(entry, active) ||
			!tabbable.includes(active)
		) {
			event.preventDefault();
			focus(event.shiftKey ? last : first);
		} else if ((!event.shiftKey && active === last) || (event.shiftKey && active === first)) {
			event.preventDefault();
			focus(event.shiftKey ? last : first);
		}
	}

	document.addEventListener('focusin', handleFocusIn, true);
	document.addEventListener('focusout', handleFocusOut, true);
	document.addEventListener('keydown', handleKeydown, true);
	return registry;
}

/**
 * Registers one popup in a document-level stack. Activation is separate from mounting so
 * keep-mounted drawers and runtime modal changes always promote the actual newest focus scope.
 */
export function createFocusTrap(
	container: HTMLElement,
	shouldYield?: (target: HTMLElement) => boolean,
	parent?: () => HTMLElement | null,
	insideElements?: () => readonly Element[]
): FocusTrapController {
	const document = container.ownerDocument;
	let registry = getRegistry(document);
	if (!registry) {
		registry = createRegistry(document);
		setRegistry(document, registry);
	}
	const currentRegistry = registry;
	const entry: FocusTrapEntry = {
		container,
		shouldYield,
		parent,
		insideElements,
		shadowRoot: null,
		open: false,
		trapping: false,
		allowedOutside: null,
		lastFocused: null,
		contested: false
	};
	currentRegistry.entries.push(entry);
	syncShadowRoot(currentRegistry, entry);
	let destroyed = false;

	return {
		setState(open, trapping) {
			if (destroyed || (entry.open === open && entry.trapping === trapping)) return;
			syncShadowRoot(currentRegistry, entry);
			const promote = open && !entry.open;
			entry.open = open;
			entry.trapping = open && trapping;
			if (promote) {
				const index = currentRegistry.entries.indexOf(entry);
				if (index >= 0) currentRegistry.entries.splice(index, 1);
				currentRegistry.entries.push(entry);
				entry.contested = false;
			}
			if (!open) {
				entry.allowedOutside = null;
				entry.lastFocused = null;
				entry.contested = false;
			}
		},
		setAllowedOutside(element) {
			if (!destroyed) entry.allowedOutside = element;
		},
		focusFirst() {
			if (!destroyed) {
				syncShadowRoot(currentRegistry, entry);
				fallbackFocus(entry);
			}
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			const index = currentRegistry.entries.indexOf(entry);
			if (index >= 0) currentRegistry.entries.splice(index, 1);
			if (entry.shadowRoot) {
				currentRegistry.releaseShadowRoot(entry.shadowRoot);
				entry.shadowRoot = null;
			}
			if (currentRegistry.entries.length === 0) {
				currentRegistry.destroy();
				if (getRegistry(document) === currentRegistry) setRegistry(document, undefined);
			}
		}
	};
}
