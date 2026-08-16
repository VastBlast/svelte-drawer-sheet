<script lang="ts">
	import * as Drawer from '../index.js';

	const firstHandle = Drawer.createHandle<{ label: string }>();
	const secondHandle = Drawer.createHandle<{ label: string }>();
	let handle = $state.raw(firstHandle);
	let triggerRef = $state<HTMLElement | null>(null);
</script>

{#snippet customTrigger({ props }: { props: Record<string, unknown> })}
	<div {...props} data-testid="detached-trigger">Open detached drawer</div>
{/snippet}

<Drawer.Trigger
	id="detached-trigger"
	bind:ref={triggerRef}
	{handle}
	payload={{ label: 'First payload' }}
	nativeButton={false}
	child={customTrigger}
/>
<output data-testid="trigger-ref">{triggerRef ? 'attached' : 'detached'}</output>
<button type="button" onclick={() => handle.openWithPayload({ label: 'Updated payload' })}>
	Update open payload
</button>
<button type="button" data-testid="switch-handle" onclick={() => (handle = secondHandle)}>
	Switch handle
</button>
<button
	type="button"
	data-testid="open-selected-handle"
	onclick={() => handle.open('detached-trigger')}
>
	Open selected handle
</button>

<Drawer.Root {handle} modal={false}>
	{#snippet children({ payload })}
		<output data-testid="payload">{payload?.label ?? ''}</output>
		<Drawer.Portal disabled>
			<Drawer.Viewport>
				<Drawer.Popup>
					<Drawer.Title>Detached drawer</Drawer.Title>
					<Drawer.Description>Exercises the public handle contract.</Drawer.Description>
					<Drawer.Close>Close detached drawer</Drawer.Close>
				</Drawer.Popup>
			</Drawer.Viewport>
		</Drawer.Portal>
	{/snippet}
</Drawer.Root>
