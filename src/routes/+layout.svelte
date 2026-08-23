<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Drawer from '$lib';

	let { children }: { children: Snippet } = $props();
</script>

<Drawer.Provider>
	<Drawer.Indent class="navigation-underlay">
		{@render children()}
	</Drawer.Indent>
</Drawer.Provider>
