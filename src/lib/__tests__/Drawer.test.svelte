<script lang="ts">
	import * as Drawer from '../index.js';
	import { untrack } from 'svelte';
	import type {
		DrawerChangeEventDetails,
		DrawerInteractionType,
		DrawerModal,
		DrawerRootActions,
		DrawerSnapPoint
	} from '../types.js';

	let {
		cancelOpen = false,
		captureFocusMethods = false,
		defaultOpen = false,
		modal = true,
		retainOnClose = false,
		scrollableContent = false,
		suppressAutoFocus = false,
		withBackdrop = true,
		withSnapPoints = true
	}: {
		cancelOpen?: boolean;
		captureFocusMethods?: boolean;
		defaultOpen?: boolean;
		modal?: DrawerModal;
		retainOnClose?: boolean;
		scrollableContent?: boolean;
		suppressAutoFocus?: boolean;
		withBackdrop?: boolean;
		withSnapPoints?: boolean;
	} = $props();

	let open = $state(untrack(() => defaultOpen));
	let lastReason = $state('');
	let completionHistory = $state<boolean[]>([]);
	let lastOpenMethod = $state<DrawerInteractionType>('');
	let lastCloseMethod = $state<DrawerInteractionType>('');
	let snapPoint = $state<DrawerSnapPoint | null>('160px');
	let actions = $state<DrawerRootActions>();

	function handleOpenChange(nextOpen: boolean, details: DrawerChangeEventDetails) {
		lastReason = details.reason;
		if (nextOpen && cancelOpen) details.cancel();
		if (!nextOpen && retainOnClose) details.preventUnmountOnClose();
	}

	function handleOpenChangeComplete(nextOpen: boolean) {
		completionHistory = [...completionHistory, nextOpen];
	}

	function captureInitialFocus(method: DrawerInteractionType) {
		lastOpenMethod = method;
		return null;
	}

	function captureFinalFocus(method: DrawerInteractionType) {
		lastCloseMethod = method;
		return false;
	}
</script>

{#snippet customTrigger({ props }: { props: Record<string, unknown> })}
	<div {...props}>Open custom drawer</div>
{/snippet}

{#snippet anchorTrigger({ props }: { props: Record<string, unknown> })}
	<a {...props} href="#keyboard-anchor-target">Open linked drawer</a>
{/snippet}

{#snippet customClose({ props }: { props: Record<string, unknown> })}
	<div {...props}>Close custom drawer</div>
{/snippet}

<Drawer.Root
	bind:actions
	bind:open
	bind:snapPoint
	snapPoints={withSnapPoints ? ['160px', 1] : undefined}
	onOpenChange={handleOpenChange}
	onOpenChangeComplete={handleOpenChangeComplete}
	{modal}
>
	<Drawer.Trigger data-testid="trigger">Open drawer</Drawer.Trigger>
	<Drawer.Trigger data-testid="secondary-trigger">Launch alternate panel</Drawer.Trigger>
	<Drawer.Trigger data-testid="custom-trigger" nativeButton={false} child={customTrigger} />
	<Drawer.Trigger data-testid="anchor-trigger" nativeButton={false} child={anchorTrigger} />
	<output data-testid="open-state">{open}</output>
	<output data-testid="reason">{lastReason}</output>
	<Drawer.SwipeArea data-testid="swipe-area" style="position: fixed; bottom: 0; height: 24px;" />

	<Drawer.Portal>
		{#if withBackdrop}
			<Drawer.Backdrop data-testid="backdrop" />
		{/if}
		<Drawer.Viewport
			data-testid="viewport"
			style="position: fixed; inset: 0; height: 500px; pointer-events: none;"
		>
			<Drawer.Popup
				data-testid="popup"
				style="height: 360px; pointer-events: auto;"
				initialFocus={suppressAutoFocus
					? false
					: captureFocusMethods
						? captureInitialFocus
						: undefined}
				finalFocus={suppressAutoFocus ? false : captureFocusMethods ? captureFinalFocus : undefined}
			>
				<Drawer.Title>Account settings</Drawer.Title>
				<Drawer.Description>Update the fields below.</Drawer.Description>
				<Drawer.Content
					data-testid="content"
					style={scrollableContent ? 'height: 100px; overflow-y: auto;' : undefined}
				>
					<div style:height={scrollableContent ? '500px' : undefined}>
						<label>
							Display name
							<input value="Ada" />
						</label>
						<Drawer.Close>Close drawer</Drawer.Close>
						<Drawer.Close data-testid="custom-close" nativeButton={false} child={customClose} />
					</div>
				</Drawer.Content>
			</Drawer.Popup>
		</Drawer.Viewport>
	</Drawer.Portal>
</Drawer.Root>

<output data-testid="completion-history">{completionHistory.join(',')}</output>
<output data-testid="open-method">{lastOpenMethod}</output>
<output data-testid="close-method">{lastCloseMethod}</output>
<button
	type="button"
	data-testid="open-close-cycle"
	onclick={() => {
		actions?.open();
		actions?.close();
	}}>Run closed cycle</button
>
<button
	type="button"
	data-testid="close-open-cycle"
	onclick={() => {
		actions?.close();
		actions?.open();
	}}>Run open cycle</button
>

{#if retainOnClose}
	<button type="button" onclick={() => actions?.unmount()}>Unmount retained drawer</button>
{/if}
