import { isElement, isHTMLElement, shadowHost } from './dom.js';

export interface ModalIsolationController {
	/** Attaches this controller to one popup, replacing any previous attachment. */
	attach(element: HTMLElement): () => void;
	/** Open nonmodal surfaces join the stack but intentionally suspend accessibility isolation. */
	setState(open: boolean, isolate: boolean): void;
	/** Replaces the lazy set of externally portaled controls that belongs to this surface. */
	setInsideElements(getElements: ModalIsolationOptions['insideElements']): void;
	/** Permanently detaches the controller and restores every attribute it owns. */
	destroy(): void;
}

export interface ModalIsolationOptions {
	/** Returns the contextual parent popup when nested content is portaled elsewhere. */
	parent?: () => HTMLElement | null;
	/** Returns portaled controls that should remain exposed with the active popup. */
	insideElements?: () => readonly (Element | null | undefined)[];
}

interface IsolationEntry {
	readonly element: HTMLElement;
	readonly getParent: (() => HTMLElement | null) | undefined;
	readonly baselineDialogs: Set<HTMLElement>;
	getInsideElements: ModalIsolationOptions['insideElements'];
	isolate: boolean;
	registry: IsolationRegistry | null;
}

interface AttributeOwnership {
	/** The exact consumer-authored value to restore, including `false` and the empty string. */
	restoreValue: string | null;
	applied: boolean;
}

interface IsolationRegistry {
	readonly document: Document;
	readonly entries: IsolationEntry[];
	readonly dialogs: Set<HTMLElement>;
	readonly activeDialogs: Set<HTMLElement>;
	readonly dialogOrder: Map<HTMLElement, number>;
	readonly liveRegions: Set<Element>;
	readonly owned: Map<Element, AttributeOwnership>;
	readonly expectedWrites: WeakMap<Element, number>;
	readonly observedRoots: WeakSet<Node>;
	readonly observer: MutationObserver | null;
	desired: Set<Element>;
	scheduled: boolean;
	destroyed: boolean;
	nextDialogOrder: number;
	reconcile(): void;
	schedule(): void;
	destroy(): void;
}

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], dialog[open]';
const INITIAL_SELECTOR = `${DIALOG_SELECTOR}, [aria-live]`;

// Coordinate ownership even when an application includes separately bundled library copies.
const REGISTRY = Symbol.for('svelte-drawer-sheet.modal-isolation');

function getRegistry(document: Document): IsolationRegistry | undefined {
	return (document as unknown as Record<symbol, IsolationRegistry | undefined>)[REGISTRY];
}

function setRegistry(document: Document, registry: IsolationRegistry | undefined): void {
	const target = document as unknown as Record<symbol, IsolationRegistry | undefined>;
	if (registry) target[REGISTRY] = registry;
	else delete target[REGISTRY];
}

function composedParent(element: Element): Element | null {
	return element.assignedSlot ?? element.parentElement ?? shadowHost(element.getRootNode());
}

function composedContains(container: Element, target: Element): boolean {
	let current: Element | null = target;
	while (current) {
		if (current === container) return true;
		current = composedParent(current);
	}
	return false;
}

function isAriaHidden(value: string | null): boolean {
	return value !== null && value !== 'false';
}

function isExternallyAriaHidden(registry: IsolationRegistry, element: Element): boolean {
	const value = element.getAttribute('aria-hidden');
	if (!isAriaHidden(value)) return false;
	const ownership = registry.owned.get(element);
	return !ownership || isAriaHidden(ownership.restoreValue);
}

function isActiveDialog(registry: IsolationRegistry, element: HTMLElement): boolean {
	if (
		!element.isConnected ||
		!element.matches(DIALOG_SELECTOR) ||
		(element.localName === 'dialog' && !element.hasAttribute('open'))
	) {
		return false;
	}

	const view = element.ownerDocument.defaultView;
	let current: Element | null = element;
	while (current) {
		if (
			current.hasAttribute('hidden') ||
			current.hasAttribute('inert') ||
			current.getAttribute('data-state') === 'closed' ||
			isExternallyAriaHidden(registry, current)
		) {
			return false;
		}
		const style = view?.getComputedStyle(current);
		if (
			style?.display === 'none' ||
			style?.visibility === 'hidden' ||
			style?.visibility === 'collapse' ||
			style?.contentVisibility === 'hidden'
		) {
			return false;
		}
		current = composedParent(current);
	}
	return true;
}

function observeRoot(registry: IsolationRegistry, root: Document | ShadowRoot): void {
	const target = root.nodeType === 9 ? registry.document.documentElement : root;
	if (!registry.observer || !target || registry.observedRoots.has(target)) return;
	registry.observedRoots.add(target);
	registry.observer.observe(target, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeOldValue: true,
		attributeFilter: [
			'aria-hidden',
			'aria-live',
			'aria-modal',
			'class',
			'data-state',
			'hidden',
			'inert',
			'open',
			'role',
			'style'
		]
	});
}

function inspectElement(registry: IsolationRegistry, element: Element): void {
	if (isHTMLElement(element) && element.matches(DIALOG_SELECTOR)) registry.dialogs.add(element);
	if (element.hasAttribute('aria-live')) registry.liveRegions.add(element);
	if (element.shadowRoot) {
		observeRoot(registry, element.shadowRoot);
		scan(registry, element.shadowRoot);
	}
}

function scan(registry: IsolationRegistry, root: Document | ShadowRoot | Element): void {
	if (root.nodeType === 9 || root.nodeType === 11) {
		observeRoot(registry, root as Document | ShadowRoot);
	} else {
		inspectElement(registry, root as Element);
	}
	for (const element of root.querySelectorAll('*')) inspectElement(registry, element);
}

function scanInitialDocument(registry: IsolationRegistry): void {
	observeRoot(registry, registry.document);
	for (const element of registry.document.querySelectorAll(INITIAL_SELECTOR)) {
		inspectElement(registry, element);
	}
}

function activeDialogs(registry: IsolationRegistry): HTMLElement[] {
	const result: HTMLElement[] = [];
	const nextActive = new Set<HTMLElement>();
	for (const dialog of registry.dialogs) {
		if (!dialog.isConnected || !dialog.matches(DIALOG_SELECTOR)) {
			registry.dialogs.delete(dialog);
			registry.dialogOrder.delete(dialog);
			continue;
		}
		if (!isActiveDialog(registry, dialog)) continue;
		result.push(dialog);
		nextActive.add(dialog);
		if (!registry.activeDialogs.has(dialog)) {
			registry.dialogOrder.set(dialog, ++registry.nextDialogOrder);
		}
	}
	registry.activeDialogs.clear();
	for (const dialog of nextActive) registry.activeDialogs.add(dialog);
	return result;
}

function snapshotBaseline(registry: IsolationRegistry, owner: HTMLElement): Set<HTMLElement> {
	return new Set(
		activeDialogs(registry).filter((dialog) => dialog !== owner && !composedContains(owner, dialog))
	);
}

function descendsFrom(
	entry: IsolationEntry,
	ancestor: IsolationEntry,
	entries: readonly IsolationEntry[]
): boolean {
	if (composedContains(ancestor.element, entry.element)) return true;
	let parent = entry.getParent?.() ?? null;
	const visited = new Set<HTMLElement>();
	while (parent && !visited.has(parent)) {
		if (parent === ancestor.element) return true;
		visited.add(parent);
		parent = entries.find((candidate) => candidate.element === parent)?.getParent?.() ?? null;
	}
	return false;
}

function topEntry(registry: IsolationRegistry): IsolationEntry | undefined {
	const entries = registry.entries.filter(
		(entry) => entry.element.isConnected && entry.element.ownerDocument === registry.document
	);
	let topmost = entries.at(-1);
	if (!topmost) return undefined;

	// A contextual child stays above its parent even if Svelte runs the parent's effect later.
	for (const entry of entries) {
		if (descendsFrom(entry, topmost, entries)) topmost = entry;
	}
	return topmost;
}

function composedNodeParent(node: Node): Node | null {
	if (isElement(node) && node.assignedSlot) return node.assignedSlot;
	return node.nodeType === 11 ? shadowHost(node) : node.parentNode;
}

function buildKeepSet(body: HTMLElement, targets: readonly Element[]): Set<Node> {
	const keep = new Set<Node>();
	for (const target of targets) {
		if (!target.isConnected || target.ownerDocument !== body.ownerDocument) continue;
		let node: Node | null = target;
		while (node && !keep.has(node)) {
			keep.add(node);
			if (node === body) break;
			node = composedNodeParent(node);
		}
	}
	return keep;
}

function collectOutsideElements(body: HTMLElement, targets: readonly Element[]): Set<Element> {
	const stops = new Set(targets.filter((target) => target.isConnected));
	const keep = buildKeepSet(body, [...stops]);
	const outside = new Set<Element>();
	const keptShadowRoots = new Map<Element, ShadowRoot[]>();
	for (const node of keep) {
		if (node.nodeType !== 11) continue;
		const host = shadowHost(node);
		if (!host) continue;
		const roots = keptShadowRoots.get(host) ?? [];
		roots.push(node as ShadowRoot);
		keptShadowRoots.set(host, roots);
	}

	function walk(parent: Element | ShadowRoot): void {
		if (isElement(parent) && stops.has(parent)) return;
		for (const child of parent.children) {
			if (child.localName === 'script') continue;
			if (keep.has(child)) walk(child);
			else outside.add(child);
		}
		if (isElement(parent)) {
			for (const shadowRoot of keptShadowRoots.get(parent) ?? []) walk(shadowRoot);
		}
	}

	walk(body);
	return outside;
}

function recordWrite(registry: IsolationRegistry, element: Element): void {
	registry.expectedWrites.set(element, (registry.expectedWrites.get(element) ?? 0) + 1);
}

function writeAriaHidden(
	registry: IsolationRegistry,
	element: Element,
	value: string | null
): void {
	if (element.getAttribute('aria-hidden') === value) return;
	recordWrite(registry, element);
	if (value === null) element.removeAttribute('aria-hidden');
	else element.setAttribute('aria-hidden', value);
}

function ensureHidden(registry: IsolationRegistry, element: Element): void {
	let ownership = registry.owned.get(element);
	if (!ownership) {
		ownership = { restoreValue: element.getAttribute('aria-hidden'), applied: false };
		registry.owned.set(element, ownership);
	}
	if (isAriaHidden(element.getAttribute('aria-hidden'))) return;
	writeAriaHidden(registry, element, 'true');
	ownership.applied = true;
}

function releaseElement(registry: IsolationRegistry, element: Element): void {
	const ownership = registry.owned.get(element);
	if (!ownership) return;
	registry.owned.delete(element);
	if (ownership.applied && element.getAttribute('aria-hidden') === 'true') {
		writeAriaHidden(registry, element, ownership.restoreValue);
	}
}

function isModalDialog(element: HTMLElement): boolean {
	if (element.getAttribute('aria-modal') === 'true') return true;
	if (element.localName !== 'dialog') return false;
	try {
		return element.matches(':modal');
	} catch {
		return false;
	}
}

function resolveInsideElements(registry: IsolationRegistry, entry: IsolationEntry): Element[] {
	const result: Element[] = [];
	for (const element of entry.getInsideElements?.() ?? []) {
		if (isElement(element) && element.isConnected && element.ownerDocument === registry.document) {
			const root = element.getRootNode();
			if (root.nodeType === 11 && !registry.observedRoots.has(root)) {
				scan(registry, root as ShadowRoot);
			}
			result.push(element);
		}
	}
	return result;
}

function reconcile(registry: IsolationRegistry): void {
	if (registry.destroyed) return;
	registry.scheduled = false;
	const selected = topEntry(registry);
	let next = new Set<Element>();

	if (selected?.isolate) {
		const insideElements = resolveInsideElements(registry, selected);
		const dialogs = activeDialogs(registry);
		for (const entry of registry.entries) {
			for (const dialog of entry.baselineDialogs) {
				if (!registry.activeDialogs.has(dialog)) entry.baselineDialogs.delete(dialog);
			}
		}

		const body = registry.document.body;
		if (body) {
			const ownedDialogs = dialogs.filter(
				(dialog) =>
					dialog !== selected.element &&
					(composedContains(selected.element, dialog) || !selected.baselineDialogs.has(dialog))
			);
			let topModal: HTMLElement | undefined;
			let topModalOrder = -1;
			for (const dialog of ownedDialogs) {
				const order = registry.dialogOrder.get(dialog) ?? 0;
				if (isModalDialog(dialog) && order > topModalOrder) {
					topModal = dialog;
					topModalOrder = order;
				}
			}
			// A newer modal dialog replaces the drawer as the active AT surface. Its ancestor path
			// remains exposed, but sibling drawer controls are hidden until it closes.
			const allowed: Element[] = topModal
				? [
						topModal,
						...ownedDialogs.filter(
							(dialog) => (registry.dialogOrder.get(dialog) ?? 0) > topModalOrder
						)
					]
				: [selected.element, ...insideElements, ...ownedDialogs];
			// Live regions remain exposed, matching Base UI and avoiding lost announcements.
			for (const liveRegion of registry.liveRegions) {
				if (liveRegion.isConnected) allowed.push(liveRegion);
				else registry.liveRegions.delete(liveRegion);
			}
			next = collectOutsideElements(body, allowed);
		}
	}

	registry.desired = next;
	for (const element of [...registry.owned.keys()]) {
		if (!next.has(element)) releaseElement(registry, element);
	}
	for (const element of next) ensureHidden(registry, element);
}

function closestDialog(target: Element): HTMLElement | null {
	let current: Element | null = target;
	while (current) {
		if (isHTMLElement(current) && current.matches(DIALOG_SELECTOR)) return current;
		current = composedParent(current);
	}
	return null;
}

const VISIBILITY_STYLE = /(?:^|;)\s*(?:display|visibility|content-visibility)\s*:/i;

function styleCanChangeVisibility(oldValue: string | null, value: string | null): boolean {
	if (oldValue === value) return false;
	return VISIBILITY_STYLE.test(oldValue ?? '') || VISIBILITY_STYLE.test(value ?? '');
}

function affectsDialog(registry: IsolationRegistry, target: Element): boolean {
	for (const dialog of registry.dialogs) {
		if (dialog === target || composedContains(target, dialog)) return true;
	}
	return false;
}

function consumeExpectedWrite(registry: IsolationRegistry, element: Element): boolean {
	const count = registry.expectedWrites.get(element) ?? 0;
	if (count === 0) return false;
	if (count === 1) registry.expectedWrites.delete(element);
	else registry.expectedWrites.set(element, count - 1);
	return true;
}

function handleExternalAriaHidden(registry: IsolationRegistry, element: Element): void {
	const ownership = registry.owned.get(element);
	if (!ownership) return;
	ownership.restoreValue = element.getAttribute('aria-hidden');
	ownership.applied = false;
	if (registry.desired.has(element) && !isAriaHidden(ownership.restoreValue)) {
		writeAriaHidden(registry, element, 'true');
		ownership.applied = true;
	}
}

function createRegistry(document: Document): IsolationRegistry {
	const Observer = document.defaultView?.MutationObserver;

	function handleMutations(records: MutationRecord[]): void {
		let relevant = false;
		for (const record of records) {
			if (record.type === 'childList') {
				let hasElements = false;
				for (const node of record.addedNodes) {
					if (!isElement(node)) continue;
					hasElements = true;
					scan(registry, node);
				}
				if (!hasElements) {
					for (const node of record.removedNodes) {
						if (isElement(node)) {
							hasElements = true;
							break;
						}
					}
				}
				relevant = relevant || hasElements;
				continue;
			}

			const target = record.target;
			if (!isElement(target)) continue;
			if (record.attributeName === 'aria-hidden') {
				if (consumeExpectedWrite(registry, target)) continue;
				handleExternalAriaHidden(registry, target);
				relevant = relevant || affectsDialog(registry, target);
				continue;
			}
			if (record.attributeName === 'aria-live') {
				if (target.hasAttribute('aria-live')) registry.liveRegions.add(target);
				else registry.liveRegions.delete(target);
				relevant = true;
				continue;
			}
			if (
				(record.attributeName === 'role' || record.attributeName === 'open') &&
				isHTMLElement(target)
			) {
				if (target.matches(DIALOG_SELECTOR)) registry.dialogs.add(target);
				relevant = relevant || registry.dialogs.has(target);
				continue;
			}
			if (
				record.attributeName === 'style' &&
				!styleCanChangeVisibility(record.oldValue, target.getAttribute('style'))
			) {
				continue;
			}
			relevant = relevant || affectsDialog(registry, target);
		}
		if (relevant) registry.schedule();
	}

	const observer = Observer ? new Observer(handleMutations) : null;
	const registry: IsolationRegistry = {
		document,
		entries: [],
		dialogs: new Set(),
		activeDialogs: new Set(),
		dialogOrder: new Map(),
		liveRegions: new Set(),
		owned: new Map(),
		expectedWrites: new WeakMap(),
		observedRoots: new WeakSet(),
		observer,
		desired: new Set(),
		scheduled: false,
		destroyed: false,
		nextDialogOrder: 0,
		reconcile: () => reconcile(registry),
		schedule() {
			if (registry.scheduled || registry.destroyed) return;
			registry.scheduled = true;
			queueMicrotask(registry.reconcile);
		},
		destroy() {
			if (registry.destroyed) return;
			registry.destroyed = true;
			registry.observer?.disconnect();
			document.removeEventListener('focusin', handleFocusIn, true);
			for (const element of [...registry.owned.keys()]) releaseElement(registry, element);
			registry.desired.clear();
			registry.dialogs.clear();
			registry.activeDialogs.clear();
			registry.dialogOrder.clear();
			registry.liveRegions.clear();
			registry.entries.length = 0;
		}
	};

	function handleFocusIn(event: FocusEvent): void {
		const selected = topEntry(registry);
		const target = event.composedPath()[0] ?? event.target;
		if (!selected?.isolate || !isElement(target)) return;
		const dialog = closestDialog(target);
		if (
			!dialog ||
			dialog === selected.element ||
			(!composedContains(selected.element, dialog) && selected.baselineDialogs.has(dialog))
		) {
			return;
		}
		registry.dialogs.add(dialog);
		const root = dialog.getRootNode();
		if (root.nodeType === 11 && !registry.observedRoots.has(root)) {
			scan(registry, root as ShadowRoot);
		}
		// Focus can precede MutationObserver delivery when a nested dialog mounts and autofocuses.
		if (isActiveDialog(registry, dialog)) registry.reconcile();
	}

	document.addEventListener('focusin', handleFocusIn, true);
	scanInitialDocument(registry);
	return registry;
}

function register(entry: IsolationEntry): void {
	if (entry.registry) unregister(entry);
	const document = entry.element.ownerDocument;
	let registry = getRegistry(document);
	if (!registry) {
		registry = createRegistry(document);
		setRegistry(document, registry);
	}
	const root = entry.element.getRootNode();
	if (root.nodeType === 11) {
		observeRoot(registry, root as ShadowRoot);
		scan(registry, root as ShadowRoot);
	}
	scan(registry, entry.element);
	entry.baselineDialogs.clear();
	for (const dialog of snapshotBaseline(registry, entry.element)) {
		entry.baselineDialogs.add(dialog);
	}
	registry.entries.push(entry);
	entry.registry = registry;
	registry.reconcile();
}

function unregister(entry: IsolationEntry): void {
	const registry = entry.registry;
	if (!registry) return;
	entry.registry = null;
	const index = registry.entries.indexOf(entry);
	if (index !== -1) registry.entries.splice(index, 1);
	entry.baselineDialogs.clear();
	if (registry.entries.length > 0) {
		registry.reconcile();
		return;
	}
	registry.destroy();
	if (getRegistry(registry.document) === registry) setRegistry(registry.document, undefined);
}

/**
 * Creates document-scoped modal accessibility isolation. It only owns `aria-hidden`; focus,
 * pointer blocking, scroll locking, and consumer-authored `inert` remain independent concerns.
 */
export function createModalIsolation(
	options: Readonly<ModalIsolationOptions> = {}
): ModalIsolationController {
	let open = false;
	let isolate = false;
	let insideElements = options.insideElements;
	let destroyed = false;
	let attachment: { entry: IsolationEntry; token: object } | null = null;

	function deactivateAttachment(): void {
		if (attachment && open) unregister(attachment.entry);
	}

	return {
		attach(element) {
			if (destroyed) return () => {};
			deactivateAttachment();
			const token = {};
			const entry: IsolationEntry = {
				element,
				getParent: options.parent,
				baselineDialogs: new Set(),
				getInsideElements: insideElements,
				isolate,
				registry: null
			};
			attachment = { entry, token };
			if (open) register(entry);

			return () => {
				if (attachment?.token !== token) return;
				if (open) unregister(entry);
				attachment = null;
			};
		},
		setState(nextOpen, nextIsolate) {
			if (destroyed) return;
			const openChanged = open !== nextOpen;
			open = nextOpen;
			isolate = nextIsolate;
			if (!attachment) return;
			attachment.entry.isolate = isolate;
			if (openChanged) {
				if (open) register(attachment.entry);
				else unregister(attachment.entry);
			} else if (open) {
				attachment.entry.registry?.reconcile();
			}
		},
		setInsideElements(getElements) {
			if (destroyed) return;
			insideElements = getElements;
			if (!attachment) return;
			attachment.entry.getInsideElements = insideElements;
			if (open) attachment.entry.registry?.reconcile();
		},
		destroy() {
			if (destroyed) return;
			deactivateAttachment();
			attachment = null;
			destroyed = true;
		}
	};
}
