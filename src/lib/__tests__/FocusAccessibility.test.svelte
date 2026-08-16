<script lang="ts">
	import * as Drawer from '../index.js';
	import type { DrawerFocusTarget, DrawerModal, DrawerRootActions } from '../types.js';

	let {
		scenario
	}: {
		scenario:
			| 'dynamic-trap'
			| 'focus-targets'
			| 'labels'
			| 'focus-out'
			| 'nested'
			| 'stacked-modes'
			| 'modal-isolation'
			| 'shadow-portal'
			| 'generic-nested';
	} = $props();

	const handle = Drawer.createHandle();
	let focusActions = $state<DrawerRootActions>();
	let initialMode = $state<'null' | 'undefined' | 'false' | 'true' | 'outside'>('null');
	let outsideInitial = $state<HTMLInputElement | null>(null);
	let dynamicModal = $state<DrawerModal>(false);
	let showLabels = $state(true);
	let labelVersion = $state(1);
	let focusOutsideCancelable = $state(false);
	let focusOutsidePrevented = $state(false);
	let preventFocusOutside = $state(true);
	let genericOpen = $state(false);
	let isolationInsideA = $state<HTMLElement | null>(null);
	let isolationInsideB = $state<HTMLElement | null>(null);
	let isolationUsesB = $state(false);
	let shadowPortalTarget = $state.raw<ShadowRoot | null>(null);
	let shadowButtonPresses = $state(0);

	type TestShadowHost = HTMLElement & { drawerTestRoot?: ShadowRoot };

	function attachOpenShadowRoot(element: Element) {
		if (!(element instanceof HTMLElement)) return;
		const host = element as TestShadowHost;
		const root = host.attachShadow({ mode: 'open' });
		host.drawerTestRoot = root;
		shadowPortalTarget = root;
		return () => {
			if (shadowPortalTarget === root) shadowPortalTarget = null;
			delete host.drawerTestRoot;
		};
	}

	const initialFocus: DrawerFocusTarget = () => {
		if (initialMode === 'null') return null;
		if (initialMode === 'undefined') return undefined;
		if (initialMode === 'false') return false;
		if (initialMode === 'true') return true;
		return outsideInitial;
	};
</script>

{#if scenario === 'focus-targets'}
	<input data-testid="outside-initial" bind:this={outsideInitial} />
	<button type="button" onclick={() => (initialMode = 'null')}>Return null</button>
	<button type="button" onclick={() => (initialMode = 'undefined')}>Return undefined</button>
	<button type="button" onclick={() => (initialMode = 'false')}>Return false</button>
	<button type="button" onclick={() => (initialMode = 'true')}>Return true</button>
	<button type="button" onclick={() => (initialMode = 'outside')}>Return outside</button>
	<button type="button" onclick={() => handle.open('detached-trigger')}>Open by trigger id</button>
	<button type="button" data-testid="imperative-close" onclick={() => focusActions?.close()}
		>Close imperatively</button
	>

	<Drawer.Trigger id="detached-trigger" data-testid="detached-trigger" {handle}
		>Detached trigger</Drawer.Trigger
	>
	<Drawer.Root {handle} bind:actions={focusActions}>
		<Drawer.Portal disabled>
			<Drawer.Viewport>
				<Drawer.Popup {initialFocus}>
					<Drawer.Title>Focus targets</Drawer.Title>
					<Drawer.Description>Exercises the complete focus result contract.</Drawer.Description>
					<Drawer.Close>Close focus targets</Drawer.Close>
				</Drawer.Popup>
			</Drawer.Viewport>
		</Drawer.Portal>
	</Drawer.Root>
{:else if scenario === 'dynamic-trap'}
	<input data-testid="dynamic-outside" />
	<button type="button" onclick={() => (dynamicModal = 'trap-focus')}>Enable focus trap</button>
	<button type="button" data-testid="disable-focus-trap" onclick={() => (dynamicModal = false)}
		>Disable focus trap</button
	>

	<Drawer.Root defaultOpen modal={dynamicModal} disablePointerDismissal>
		<Drawer.Portal disabled>
			<Drawer.Viewport>
				<Drawer.Popup data-testid="dynamic-popup">
					<Drawer.Title>Dynamic focus trap</Drawer.Title>
					<Drawer.Description>The focus mode can change while mounted.</Drawer.Description>
					<button type="button">Inside dynamic drawer</button>
					<Drawer.Close>Close dynamic drawer</Drawer.Close>
				</Drawer.Popup>
			</Drawer.Viewport>
		</Drawer.Portal>
	</Drawer.Root>
{:else if scenario === 'labels'}
	<button type="button" onclick={() => (showLabels = !showLabels)}>Toggle labels</button>
	<button type="button" onclick={() => (labelVersion += 1)}>Change label ids</button>
	<Drawer.Root defaultOpen defaultTriggerId="labels-trigger" modal={false} disablePointerDismissal>
		<Drawer.Trigger id="labels-trigger" data-testid="labels-trigger">Labels trigger</Drawer.Trigger>
		<Drawer.Portal disabled>
			<Drawer.Viewport>
				<Drawer.Popup id={`registered-popup-${labelVersion}`} data-testid="labels-popup">
					{#if showLabels}
						<Drawer.Title id={`registered-title-${labelVersion}`} data-testid="registered-title"
							>Registered title</Drawer.Title
						>
						<Drawer.Description
							id={`registered-description-${labelVersion}`}
							data-testid="registered-description"
						>
							Registered description
						</Drawer.Description>
					{/if}
					<Drawer.Close>Close labels drawer</Drawer.Close>
				</Drawer.Popup>
			</Drawer.Viewport>
		</Drawer.Portal>
	</Drawer.Root>
{:else if scenario === 'focus-out'}
	<input data-testid="focus-outside-target" />
	<output data-testid="focus-event-cancelable">{focusOutsideCancelable}</output>
	<output data-testid="focus-event-prevented">{focusOutsidePrevented}</output>
	<button type="button" onclick={() => (preventFocusOutside = false)}
		>Allow next focus outside</button
	>
	<Drawer.Root defaultOpen modal={false}>
		<Drawer.Portal disabled>
			<Drawer.Viewport>
				<Drawer.Popup
					onFocusOutside={(event) => {
						focusOutsideCancelable = event.cancelable;
						if (preventFocusOutside) event.preventDefault();
						focusOutsidePrevented = event.defaultPrevented;
					}}
				>
					<Drawer.Title>Cancelable focus outside</Drawer.Title>
					<Drawer.Description>Focus-out dismissal can be canceled.</Drawer.Description>
					<Drawer.Close>Close focus-out drawer</Drawer.Close>
				</Drawer.Popup>
			</Drawer.Viewport>
		</Drawer.Portal>
	</Drawer.Root>
{:else if scenario === 'nested'}
	<input data-testid="nested-outside" />
	<Drawer.Root defaultOpen>
		<Drawer.Portal disabled>
			<Drawer.Viewport>
				<Drawer.Popup
					data-testid="focus-parent-popup"
					class="nested-parent"
					style="pointer-events: all; --consumer-marker: intact;"
				>
					<Drawer.Title>Parent focus scope</Drawer.Title>
					<Drawer.Description>Contains a newer child focus scope.</Drawer.Description>
					<button type="button" data-testid="parent-focus-target">Parent target</button>

					<Drawer.Root defaultOpen>
						<Drawer.Portal disabled>
							<Drawer.Viewport>
								<Drawer.Popup data-testid="focus-child-popup" style="pointer-events: auto;">
									<Drawer.Title>Child focus scope</Drawer.Title>
									<Drawer.Description>The newest scope owns focus.</Drawer.Description>
									<button type="button" data-testid="child-focus-target">Child target</button>
									<Drawer.Close>Close child focus scope</Drawer.Close>
								</Drawer.Popup>
							</Drawer.Viewport>
						</Drawer.Portal>
					</Drawer.Root>

					<Drawer.Close>Close parent focus scope</Drawer.Close>
				</Drawer.Popup>
			</Drawer.Viewport>
		</Drawer.Portal>
	</Drawer.Root>
{:else if scenario === 'stacked-modes'}
	<input data-testid="stacked-outside" />
	<Drawer.Root defaultOpen>
		<Drawer.Portal disabled>
			<Drawer.Viewport>
				<Drawer.Popup data-testid="stacked-modal-popup">
					<Drawer.Title>Older modal drawer</Drawer.Title>
					<button type="button">Older modal target</button>
				</Drawer.Popup>
			</Drawer.Viewport>
		</Drawer.Portal>
	</Drawer.Root>
	<Drawer.Root defaultOpen modal={false} disablePointerDismissal>
		<Drawer.Portal disabled>
			<Drawer.Viewport>
				<Drawer.Popup data-testid="stacked-nonmodal-popup">
					<Drawer.Title>Newer nonmodal drawer</Drawer.Title>
					<button type="button" data-testid="stacked-nonmodal-target">Newer nonmodal target</button>
				</Drawer.Popup>
			</Drawer.Viewport>
		</Drawer.Portal>
	</Drawer.Root>
{:else if scenario === 'modal-isolation'}
	<main data-testid="isolation-outside">Outside application content</main>
	<div data-testid="isolation-owned" aria-hidden="false" inert>Externally inert content</div>
	<div data-testid="isolation-prehidden" aria-hidden="true">Externally hidden content</div>
	<div data-testid="isolation-live" aria-live="polite">Live status</div>

	<Drawer.Root>
		<Drawer.Trigger data-testid="isolation-trigger">Open isolated drawer</Drawer.Trigger>
		<button
			type="button"
			data-testid="isolation-inside-a"
			style="position: fixed; z-index: 1; top: 8px; right: 8px;"
			bind:this={isolationInsideA}>First portaled menu surface</button
		>
		<button
			type="button"
			data-testid="isolation-inside-b"
			style="position: fixed; z-index: 1; top: 40px; right: 8px;"
			bind:this={isolationInsideB}>Second portaled menu surface</button
		>
		<Drawer.Portal disabled>
			<Drawer.Viewport>
				<Drawer.Popup
					data-testid="isolation-popup"
					getInsideElements={() => [isolationUsesB ? isolationInsideB : isolationInsideA]}
				>
					<Drawer.Title>Isolated drawer</Drawer.Title>
					<Drawer.Description>Only this modal surface is exposed.</Drawer.Description>
					<button type="button" onclick={() => (isolationUsesB = true)}
						>Switch portaled surface</button
					>
					<Drawer.Close>Close isolated drawer</Drawer.Close>
				</Drawer.Popup>
			</Drawer.Viewport>
		</Drawer.Portal>
	</Drawer.Root>
{:else if scenario === 'shadow-portal'}
	<div data-testid="open-shadow-host" {@attach attachOpenShadowRoot}></div>
	{#if shadowPortalTarget}
		<Drawer.Root defaultOpen>
			<Drawer.Portal to={shadowPortalTarget}>
				<Drawer.Backdrop style="position: fixed; inset: 0;" />
				<Drawer.Viewport style="position: fixed; inset: 0; pointer-events: none;">
					<Drawer.Popup
						data-testid="shadow-popup"
						style="position: fixed; left: 24px; bottom: 24px; width: 240px; height: 180px; pointer-events: auto;"
					>
						<Drawer.Title>Shadow drawer</Drawer.Title>
						<Drawer.Description>Portaled into an open shadow root.</Drawer.Description>
						<button
							type="button"
							data-testid="shadow-inside-target"
							onclick={() => (shadowButtonPresses += 1)}>Inside shadow target</button
						>
						<output data-testid="shadow-button-presses">{shadowButtonPresses}</output>
						<Drawer.Close>Close shadow drawer</Drawer.Close>
					</Drawer.Popup>
				</Drawer.Viewport>
			</Drawer.Portal>
		</Drawer.Root>
	{/if}
{:else}
	<Drawer.Root defaultOpen>
		<Drawer.Portal disabled>
			<Drawer.Viewport>
				<Drawer.Popup data-testid="generic-parent-popup" style="pointer-events: all;">
					<Drawer.Title>Drawer around generic dialog</Drawer.Title>
					<Drawer.Description>A nested dialog temporarily owns interaction.</Drawer.Description>
					<button type="button" data-testid="generic-parent-target">Drawer target</button>

					<button
						type="button"
						data-testid="generic-dialog-trigger"
						onclick={() => (genericOpen = true)}>Open generic dialog</button
					>
					{#if genericOpen}
						<div
							role="dialog"
							aria-modal="true"
							aria-label="Generic dialog"
							data-testid="generic-dialog"
							style="pointer-events: auto;"
						>
							<button type="button" data-testid="generic-dialog-target"
								>Generic dialog target</button
							>
							<button type="button" onclick={() => (genericOpen = false)}
								>Close generic dialog</button
							>
						</div>
					{/if}

					<Drawer.Close>Close generic parent drawer</Drawer.Close>
				</Drawer.Popup>
			</Drawer.Viewport>
		</Drawer.Portal>
	</Drawer.Root>
{/if}

<style>
	:global(.nested-parent) {
		height: 160px;
	}

	:global(.nested-parent[data-nested-drawer-open]) {
		height: 64px;
	}
</style>
