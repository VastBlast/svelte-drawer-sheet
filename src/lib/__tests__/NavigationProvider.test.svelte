<script lang="ts">
	import * as Drawer from '../index.js';
</script>

<Drawer.Provider>
	<Drawer.Indent data-testid="indent">
		<Drawer.Root defaultOpen swipeBehavior="navigation" swipeDirection="right">
			<Drawer.Portal>
				<Drawer.Backdrop data-testid="backdrop" />
				<Drawer.Viewport style="position: fixed; inset: 0; width: 400px; height: 500px;">
					<Drawer.Popup data-testid="popup" style="width: 400px; height: 500px;">
						<Drawer.Title>Navigation page</Drawer.Title>
						<Drawer.Content>Swipeable content</Drawer.Content>
					</Drawer.Popup>
				</Drawer.Viewport>
			</Drawer.Portal>
		</Drawer.Root>
	</Drawer.Indent>
</Drawer.Provider>
