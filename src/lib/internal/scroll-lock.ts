interface OwnedProperty {
	readonly element: HTMLElement;
	readonly name: string;
	readonly value: string;
	readonly priority: string;
	applied: string | null;
	appliedPriority: string;
}

interface SharedDocumentLock {
	count: number;
	cleanup: () => void;
}

// Symbol.for coordinates separately bundled copies of the library in the same document.
const DOCUMENT_LOCK = Symbol.for('svelte-drawer-sheet.scroll-lock');

function sharedLock(document: Document): SharedDocumentLock | undefined {
	return (document as unknown as Record<symbol, SharedDocumentLock | undefined>)[DOCUMENT_LOCK];
}

function setSharedLock(document: Document, lock: SharedDocumentLock | undefined): void {
	const target = document as unknown as Record<symbol, SharedDocumentLock | undefined>;
	if (lock) target[DOCUMENT_LOCK] = lock;
	else delete target[DOCUMENT_LOCK];
}

function snapshot(element: HTMLElement, name: string): OwnedProperty {
	return {
		element,
		name,
		value: element.style.getPropertyValue(name),
		priority: element.style.getPropertyPriority(name),
		applied: null,
		appliedPriority: ''
	};
}

function setOwnedProperty(property: OwnedProperty, value: string, priority = ''): void {
	property.applied = value;
	property.appliedPriority = priority;
	property.element.style.setProperty(property.name, value, priority);
}

function restoreOwnedProperties(properties: readonly OwnedProperty[]): void {
	for (const property of properties) {
		if (
			property.applied === null ||
			property.element.style.getPropertyValue(property.name) !== property.applied ||
			property.element.style.getPropertyPriority(property.name) !== property.appliedPriority
		) {
			continue;
		}
		if (property.value) {
			property.element.style.setProperty(property.name, property.value, property.priority);
		} else {
			property.element.style.removeProperty(property.name);
		}
	}
}

// The viewport scrolls through <html> only when it establishes an overflow container;
// otherwise the body's overflow propagates to the viewport.
function viewportScroller(document: Document, view: Window): HTMLElement {
	const html = document.documentElement;
	const overflow = view.getComputedStyle(html).overflow;
	return /auto|scroll|overlay|hidden|clip/.test(overflow) ? html : document.body;
}

function pageIsLocked(document: Document, view: Window): boolean {
	return /hidden|clip/.test(view.getComputedStyle(viewportScroller(document, view)).overflowY);
}

function acquireWhenAvailable(document: Document, lock: SharedDocumentLock): void {
	if (sharedLock(document) !== lock || lock.count === 0) return;
	const view = document.defaultView;
	const body = document.body;
	const html = document.documentElement;
	if (!view || !body || !html) return;
	const ownerWindow = view;

	// Cooperate with a lock that was already active. Taking a snapshot of its hidden state
	// would restore that stale lock after the other overlay has finished closing.
	if (pageIsLocked(document, view)) {
		const observer = new view.MutationObserver(() => {
			if (pageIsLocked(document, view)) return;
			observer.disconnect();
			lock.cleanup = () => {};
			acquireWhenAvailable(document, lock);
		});
		observer.observe(html, { attributes: true });
		observer.observe(body, { attributes: true });
		lock.cleanup = () => observer.disconnect();
		return;
	}

	const scroller = viewportScroller(document, view);
	const direction = view.getComputedStyle(body).direction;
	const paddingName = direction === 'rtl' ? 'padding-left' : 'padding-right';
	const overflowX = snapshot(scroller, 'overflow-x');
	const overflowY = snapshot(scroller, 'overflow-y');
	const padding = snapshot(body, paddingName);
	const scrollbarVariable = snapshot(body, '--scrollbar-width');
	const properties = [overflowX, overflowY, padding, scrollbarVariable];
	const initialPadding =
		Number.parseFloat(view.getComputedStyle(body).getPropertyValue(paddingName)) || 0;
	const hasStableGutter =
		view.getComputedStyle(html).scrollbarGutter.includes('stable') ||
		view.getComputedStyle(body).scrollbarGutter.includes('stable');
	// Hiding overflow can synchronously expand clientWidth, so the gutter must be measured first.
	const scrollbarWidth = Math.max(0, ownerWindow.innerWidth - html.clientWidth);

	// A modal lock must beat application utility rules that intentionally use `!important`.
	setOwnedProperty(overflowX, 'hidden', 'important');
	setOwnedProperty(overflowY, 'hidden', 'important');

	if (!hasStableGutter && scrollbarWidth > 0) {
		setOwnedProperty(padding, `${initialPadding + scrollbarWidth}px`, 'important');
		setOwnedProperty(scrollbarVariable, `${scrollbarWidth}px`, 'important');
	}

	lock.cleanup = () => restoreOwnedProperties(properties);
}

/** Locks the actual viewport scroller and reference-counts across roots and library copies. */
export function lockDocumentScroll(document: Document): () => void {
	let lock = sharedLock(document);
	if (lock) {
		lock.count += 1;
	} else {
		lock = { count: 1, cleanup: () => {} };
		setSharedLock(document, lock);
		acquireWhenAvailable(document, lock);
	}

	let released = false;
	return () => {
		if (released || sharedLock(document) !== lock) return;
		released = true;
		lock.count -= 1;
		if (lock.count > 0) return;
		lock.cleanup();
		setSharedLock(document, undefined);
	};
}
