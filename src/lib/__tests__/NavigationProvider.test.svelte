<script lang="ts">
	import * as Drawer from '../index.js';
</script>

<Drawer.Root defaultOpen>
	<Drawer.Portal>
		<Drawer.Viewport style="position: fixed; inset: 0; width: 400px; height: 500px;">
			<Drawer.Provider>
				<Drawer.Indent data-testid="indent">
					<Drawer.Popup style="width: 400px; height: 500px;">
						<Drawer.Title>Parent page</Drawer.Title>
						<Drawer.Root defaultOpen swipeBehavior="navigation" swipeDirection="right">
							<Drawer.Portal>
								<Drawer.Viewport style="position: fixed; inset: 0; width: 400px; height: 500px;">
									<Drawer.Popup data-testid="popup" style="width: 400px; height: 500px;">
										<Drawer.Title>Navigation page</Drawer.Title>
										<Drawer.Content>Swipeable content</Drawer.Content>
									</Drawer.Popup>
								</Drawer.Viewport>
							</Drawer.Portal>
						</Drawer.Root>
					</Drawer.Popup>
				</Drawer.Indent>
			</Drawer.Provider>
		</Drawer.Viewport>
	</Drawer.Portal>
</Drawer.Root>
