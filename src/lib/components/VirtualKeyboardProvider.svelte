<script lang="ts">
	import type { DrawerVirtualKeyboardProviderProps } from '../types.js';
	import { useDrawerRoot } from '../internal/context.js';
	import { attachVirtualKeyboard } from '../internal/virtual-keyboard.js';

	let { children }: DrawerVirtualKeyboardProviderProps = $props();
	const root = useDrawerRoot();

	$effect(() => {
		const viewport = root.viewport;
		if (!root.open || root.nestedInteractionOpen || !viewport) return;
		return attachVirtualKeyboard(viewport, root);
	});
</script>

{@render children?.()}
