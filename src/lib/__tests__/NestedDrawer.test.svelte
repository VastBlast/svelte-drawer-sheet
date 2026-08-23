<script lang="ts">
	import * as Drawer from '../index.js';
</script>

<Drawer.Root defaultOpen>
	<Drawer.Portal disabled>
		<Drawer.Viewport data-testid="parent-viewport">
			<Drawer.Popup class="test-popup" data-testid="parent-popup">
				<Drawer.Title>Parent drawer</Drawer.Title>
				<Drawer.Description>Contains another drawer.</Drawer.Description>

				<Drawer.Root defaultOpen>
					<Drawer.Portal disabled>
						<Drawer.Viewport data-testid="child-viewport">
							<Drawer.Popup class="test-popup child-popup" data-testid="child-popup">
								<Drawer.Title>Child drawer</Drawer.Title>
								<Drawer.Description>Exits before releasing its parent.</Drawer.Description>
								<Drawer.Close>Close child drawer</Drawer.Close>
							</Drawer.Popup>
						</Drawer.Viewport>
					</Drawer.Portal>
				</Drawer.Root>
			</Drawer.Popup>
		</Drawer.Viewport>
	</Drawer.Portal>
</Drawer.Root>

<style>
	:global(.test-popup) {
		position: relative;
		pointer-events: auto;
	}

	:global(.child-popup) {
		opacity: 1;
		transition: opacity 80ms linear;
	}

	:global(.child-popup[data-ending-style]) {
		opacity: 0;
	}
</style>
