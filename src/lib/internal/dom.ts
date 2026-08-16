export function isElement(value: unknown): value is Element {
	return Boolean(value && typeof value === 'object' && (value as Node).nodeType === 1);
}

export function isHTMLElement(value: unknown): value is HTMLElement {
	return isElement(value) && value.namespaceURI === 'http://www.w3.org/1999/xhtml';
}

export function isValidLinkElement(value: unknown): value is HTMLAnchorElement {
	return (
		isHTMLElement(value) && value.localName === 'a' && Boolean((value as HTMLAnchorElement).href)
	);
}

export function isHTMLInputElement(value: unknown): value is HTMLInputElement {
	return isHTMLElement(value) && value.localName === 'input';
}

export function isHTMLTextAreaElement(value: unknown): value is HTMLTextAreaElement {
	return isHTMLElement(value) && value.localName === 'textarea';
}

export function shadowHost(root: Node): Element | null {
	if (root.nodeType !== 11 || !('host' in root)) return null;
	return isElement(root.host) ? root.host : null;
}

export function containingShadowRoot(node: Node): ShadowRoot | null {
	const root = node.getRootNode();
	return shadowHost(root) ? (root as ShadowRoot) : null;
}

export function composedParent(node: Node): Element | null {
	if (node.nodeType === 1) {
		const element = node as Element;
		if (element.assignedSlot) return element.assignedSlot;
		if (element.parentElement) return element.parentElement;
	}
	return shadowHost(node.getRootNode());
}

export function isComposedDescendant(container: Element, target: Node): boolean {
	let current: Node | null = target;
	while (current) {
		if (current === container) return true;
		current = composedParent(current);
	}
	return false;
}

export function deepestActiveElement(root: Document | ShadowRoot): Element | null {
	let active = root.activeElement;
	while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
	return active;
}
