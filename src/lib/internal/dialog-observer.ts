import { composedParent, isComposedDescendant, isElement } from './dom.js';

export interface NestedDialogObserver {
	setActive(active: boolean): void;
	claimFocusTarget(target: HTMLElement): boolean;
	destroy(): void;
}

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], dialog[open]';

function isActiveDialog(element: HTMLElement): boolean {
	if (!element.isConnected || (element.localName === 'dialog' && !element.hasAttribute('open')))
		return false;

	const view = element.ownerDocument.defaultView;
	let current: Element | null = element;
	while (current) {
		if (
			current.hasAttribute('hidden') ||
			current.hasAttribute('inert') ||
			current.getAttribute('aria-hidden') === 'true' ||
			current.getAttribute('data-state') === 'closed'
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

function closestDialog(target: HTMLElement): HTMLElement | null {
	let current: Element | null = target;
	while (current) {
		if (
			current.matches(DIALOG_SELECTOR) &&
			current.namespaceURI === 'http://www.w3.org/1999/xhtml'
		) {
			return current as HTMLElement;
		}
		current = composedParent(current);
	}
	return null;
}

/**
 * Detects dialogs opened after a drawer becomes active. This lets an independently implemented
 * nested dialog temporarily own focus and pointer interaction without coupling either library.
 */
export function createNestedDialogObserver(
	owner: HTMLElement,
	onChange: (open: boolean) => void
): NestedDialogObserver {
	const document = owner.ownerDocument;
	let active = false;
	let destroyed = false;
	let open = false;
	let observer: MutationObserver | null = null;
	let observedRoots = new WeakSet<Node>();
	const candidates = new Set<HTMLElement>();
	let existingOutside = new Set<HTMLElement>();

	function publish(nextOpen: boolean): void {
		if (open === nextOpen) return;
		open = nextOpen;
		onChange(open);
	}

	function observe(root: Document | ShadowRoot): void {
		const target = root.nodeType === 9 ? document.documentElement : root;
		if (!observer || observedRoots.has(target)) return;
		observedRoots.add(target);
		observer.observe(target, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeOldValue: true,
			attributeFilter: [
				'aria-hidden',
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

	function scan(root: Document | ShadowRoot | HTMLElement): boolean {
		let found = false;
		if (root.nodeType === 9 || root.nodeType === 11) observe(root as Document | ShadowRoot);
		const elements =
			root.nodeType === 1
				? [root as HTMLElement, ...root.querySelectorAll<HTMLElement>('*')]
				: [...root.querySelectorAll<HTMLElement>('*')];
		for (const element of elements) {
			if (
				element.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
				element.matches(DIALOG_SELECTOR)
			) {
				candidates.add(element);
				found = true;
			}
			if (element.shadowRoot) found = scan(element.shadowRoot) || found;
		}
		return found;
	}

	function scanInitialDocument(): void {
		observe(document);
		for (const element of document.querySelectorAll<HTMLElement>(DIALOG_SELECTOR)) {
			candidates.add(element);
		}
		// A portaled popup can live in a ShadowRoot that document selectors cannot cross. Scan that
		// owned root, while newly mounted external roots are discovered incrementally or on focus.
		const ownerRoot = owner.getRootNode();
		if (ownerRoot.nodeType === 11) scan(ownerRoot as ShadowRoot);
	}

	function owns(candidate: HTMLElement): boolean {
		return (
			candidate !== owner &&
			candidate.matches(DIALOG_SELECTOR) &&
			(isComposedDescendant(owner, candidate) || !existingOutside.has(candidate)) &&
			isActiveDialog(candidate)
		);
	}

	function sync(): void {
		if (!active) return;
		let nextOpen = false;
		for (const candidate of candidates) {
			if (!candidate.isConnected || !candidate.matches(DIALOG_SELECTOR)) {
				candidates.delete(candidate);
				existingOutside.delete(candidate);
				continue;
			}
			if (existingOutside.has(candidate)) continue;
			if (owns(candidate)) nextOpen = true;
		}
		publish(nextOpen);
	}

	function visibilityStyle(value: string | null): string {
		return [
			...(value ?? '').matchAll(/(?:^|;)\s*(display|visibility|content-visibility)\s*:\s*([^;]*)/gi)
		]
			.map((match) => `${match[1].toLowerCase()}:${match[2].trim().toLowerCase()}`)
			.join(';');
	}

	function handleMutations(records: MutationRecord[]): void {
		if (!active) return;
		let relevant = false;
		const dirtyBaseline = new Set<HTMLElement>();
		for (const record of records) {
			if (record.type === 'childList') {
				for (const node of record.addedNodes) {
					if (node.nodeType === 1) relevant = scan(node as HTMLElement) || relevant;
				}
				for (const node of record.removedNodes) {
					if (
						node.nodeType === 1 &&
						[...candidates].some((candidate) => isComposedDescendant(node as Element, candidate))
					) {
						relevant = true;
					}
				}
				continue;
			}

			const target = record.target;
			if (!isElement(target)) continue;
			const affected = [...candidates].filter(
				(candidate) =>
					candidate !== owner && (candidate === target || isComposedDescendant(target, candidate))
			);
			const becomesCandidate =
				target.namespaceURI === 'http://www.w3.org/1999/xhtml' && target.matches(DIALOG_SELECTOR);
			if (!becomesCandidate && affected.length === 0) continue;
			if (record.attributeName === 'style') {
				if (visibilityStyle(record.oldValue) === visibilityStyle(target.getAttribute('style'))) {
					continue;
				}
			}
			for (const candidate of affected) {
				if (existingOutside.has(candidate)) dirtyBaseline.add(candidate);
			}
			if (becomesCandidate) {
				candidates.add(target as HTMLElement);
				relevant = true;
			} else if (affected.length > 0) {
				relevant = true;
			}
		}
		for (const candidate of dirtyBaseline) {
			if (!isActiveDialog(candidate)) existingOutside.delete(candidate);
		}
		if (relevant) sync();
	}

	return {
		setActive(nextActive) {
			if (destroyed || active === nextActive) return;
			active = nextActive;
			observer?.disconnect();
			observer = null;
			observedRoots = new WeakSet();
			candidates.clear();
			if (!active) {
				existingOutside.clear();
				publish(false);
				return;
			}

			// Active dialogs that predate this open cycle are older siblings. Closed, force-mounted
			// dialogs are omitted so a later open edge can correctly take ownership.
			const Observer = document.defaultView?.MutationObserver;
			observer = Observer ? new Observer(handleMutations) : null;
			scanInitialDocument();
			existingOutside = new Set(
				[...candidates].filter(
					(candidate) =>
						candidate !== owner &&
						!isComposedDescendant(owner, candidate) &&
						isActiveDialog(candidate)
				)
			);
			sync();
		},
		claimFocusTarget(target) {
			if (!active || destroyed) return false;
			const candidate = closestDialog(target);
			if (!candidate || !owns(candidate)) return false;
			candidates.add(candidate);
			const targetRoot = candidate.getRootNode();
			if (targetRoot.nodeType === 11) observe(targetRoot as ShadowRoot);
			// Focus events run before MutationObserver delivery. Claim synchronously so a newly
			// mounted dialog can autofocus without the parent drawer pulling focus back first.
			publish(true);
			return true;
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			active = false;
			observer?.disconnect();
			observer = null;
			observedRoots = new WeakSet();
			candidates.clear();
			existingOutside.clear();
			publish(false);
		}
	};
}
