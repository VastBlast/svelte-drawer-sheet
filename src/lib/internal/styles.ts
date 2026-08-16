function cssPropertyName(name: string): string {
	if (name.startsWith('--')) return name;
	return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function styleText(style: unknown): string | undefined {
	if (typeof style === 'string') return style.trim() || undefined;
	if (!style || typeof style !== 'object' || Array.isArray(style)) return undefined;

	const declarations: string[] = [];
	for (const [name, value] of Object.entries(style)) {
		if (value === null || value === undefined || value === '') continue;
		declarations.push(`${cssPropertyName(name)}: ${String(value)}`);
	}
	return declarations.length > 0 ? declarations.join('; ') : undefined;
}

/** Serializes Svelte style values while keeping later engine declarations authoritative. */
export function mergeStyles(...styles: unknown[]): string | undefined {
	const declarations = styles.map(styleText).filter((style) => style !== undefined);
	return declarations.length > 0 ? declarations.join('; ') : undefined;
}
