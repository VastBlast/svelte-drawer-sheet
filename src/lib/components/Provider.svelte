<script lang="ts">
	import type { DrawerProviderProps } from '../types.js';
	import { provideDrawerProvider } from '../internal/context.js';
	import { DrawerProviderState } from '../internal/provider-state.svelte.js';

	let { children }: DrawerProviderProps = $props();
	provideDrawerProvider(new DrawerProviderState());
</script>

{@render children?.()}
