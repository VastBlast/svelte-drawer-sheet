<script lang="ts">
	import * as Drawer from '$lib';
	import type { DrawerModal, DrawerSnapPoint, DrawerSwipeDirection } from '$lib';
	import './demo.css';

	const snapPoints = ['24rem', 0.7, 1] as const satisfies readonly DrawerSnapPoint[];
	const defaultSnapPoint = snapPoints[2];
	const snapOptions = [
		{ label: 'Compact', value: snapPoints[0] },
		{ label: 'Comfortable', value: snapPoints[1] },
		{ label: 'Full', value: snapPoints[2] }
	] as const;

	const directionOptions = [
		{ label: 'Bottom', value: 'down', title: 'Bottom drawer' },
		{ label: 'Top', value: 'up', title: 'Top drawer' },
		{ label: 'Left', value: 'left', title: 'Left drawer' },
		{ label: 'Right', value: 'right', title: 'Right drawer' }
	] as const satisfies readonly { label: string; value: DrawerSwipeDirection; title: string }[];

	const modalOptions = [
		{
			label: 'Modal',
			value: true,
			title: 'Modal drawer',
			description: 'Focus is trapped and page scrolling is locked.'
		},
		{
			label: 'Trap focus',
			value: 'trap-focus',
			title: 'Focus-trapping drawer',
			description: 'Focus is trapped while the page remains scrollable.'
		},
		{
			label: 'Non-modal',
			value: false,
			title: 'Non-modal drawer',
			description: 'The page stays interactive behind the drawer.'
		}
	] as const satisfies readonly {
		label: string;
		value: DrawerModal;
		title: string;
		description: string;
	}[];

	type DetailPanel = {
		label: string;
		title: string;
		description: string;
	};

	const detailPanels = [
		{
			label: 'Profile',
			title: 'Edit profile',
			description: 'Update the public details attached to your account.'
		},
		{
			label: 'Billing',
			title: 'Billing details',
			description: 'Review your payment method and billing address.'
		}
	] as const satisfies readonly DetailPanel[];
	const detailDrawer = Drawer.createHandle<DetailPanel>();

	let snapPoint = $state<DrawerSnapPoint | null>(defaultSnapPoint);
	let direction = $state<DrawerSwipeDirection>('down');
	let modal = $state<DrawerModal>(true);
	let pageInteractions = $state(0);
	let directionOption = $derived(
		directionOptions.find((option) => option.value === direction) ?? directionOptions[0]
	);
	let modalOption = $derived(
		modalOptions.find((option) => option.value === modal) ?? modalOptions[0]
	);
</script>

<svelte:head>
	<title>Drawer · Svelte Drawer Sheet</title>
	<meta
		name="description"
		content="Live examples for the svelte-drawer-sheet accessible drawer primitive."
	/>
</svelte:head>

<header class="site-header">
	<div class="header-inner">
		<a class="brand" href="#overview" aria-label="Svelte Drawer Sheet home">
			<span>svelte-drawer-sheet</span>
		</a>
		<nav class="header-nav" aria-label="Primary navigation">
			<a href="#examples">Examples</a>
		</nav>
		<code class="install-command">pnpm add svelte-drawer-sheet</code>
	</div>
</header>

<div class="docs-layout">
	<aside class="side-nav" aria-label="On this page">
		<p>On this page</p>
		<a href="#overview">Overview</a>
		<a href="#basic">Basic drawer</a>
		<p>Examples</p>
		<a href="#position">Position</a>
		<a href="#snap-points">Snap points</a>
		<a href="#virtual-keyboard">Virtual keyboard</a>
		<a href="#nested">Nested drawers</a>
		<a href="#modal">Modal behavior</a>
		<a href="#detached">Detached triggers</a>
	</aside>

	<main class="docs-content">
		<section class="hero" id="overview">
			<p class="eyebrow">Svelte / Components</p>
			<div class="title-row">
				<h1>Drawer</h1>
				<span class="version-badge">Svelte 5</span>
			</div>
			<p class="lede">A panel that slides from a screen edge and supports gesture dismissal.</p>
		</section>

		<section class="example-section example-section--lead" id="basic" aria-labelledby="basic-title">
			<div class="section-heading">
				<p class="section-index">Overview</p>
				<h2 id="basic-title">Basic drawer</h2>
				<p>Compose the parts you need and style every surface yourself.</p>
			</div>

			<div class="demo-frame demo-frame--lead">
				<span class="demo-label">Live example</span>
				<Drawer.Root swipeDirection="right">
					<Drawer.Trigger class="button button--primary">Open drawer</Drawer.Trigger>
					<Drawer.Portal>
						<Drawer.Backdrop class="scrim" />
						<Drawer.Viewport class="sheet-viewport sheet-viewport--right">
							<Drawer.Popup class="sheet">
								<Drawer.Content class="sheet-body">
									<span class="sheet-label">Inbox</span>
									<div>
										<Drawer.Title>Notifications</Drawer.Title>
										<Drawer.Description>You are all caught up.</Drawer.Description>
									</div>
									<div class="empty-state" aria-hidden="true">
										<span></span>
										<span></span>
										<span></span>
									</div>
									<div class="sheet-actions">
										<Drawer.Close class="button button--secondary">Close</Drawer.Close>
									</div>
								</Drawer.Content>
							</Drawer.Popup>
						</Drawer.Viewport>
					</Drawer.Portal>
				</Drawer.Root>
			</div>
		</section>

		<div class="examples-heading" id="examples">
			<p class="eyebrow">Examples</p>
			<h2>Common patterns</h2>
		</div>

		<section class="example-section" id="position" aria-labelledby="position-title">
			<div class="section-heading">
				<p class="section-index">swipeDirection</p>
				<h2 id="position-title">Position</h2>
				<p>Anchor a drawer to any screen edge.</p>
			</div>

			<div class="demo-frame">
				<Drawer.Root swipeDirection={direction}>
					<div class="demo-controls" aria-label="Drawer position">
						{#each directionOptions as option (option.value)}
							<Drawer.Trigger class="button" onclick={() => (direction = option.value)}>
								{option.label}
							</Drawer.Trigger>
						{/each}
					</div>
					<Drawer.Portal>
						<Drawer.Backdrop class="scrim" />
						<Drawer.Viewport class="sheet-viewport sheet-viewport--{direction}">
							<Drawer.Popup class="sheet">
								<Drawer.Content class="sheet-body">
									<span class="sheet-label">Position</span>
									<div>
										<Drawer.Title>{directionOption.title}</Drawer.Title>
										<Drawer.Description>
											Swipe toward the {directionOption.label.toLowerCase()} edge to dismiss.
										</Drawer.Description>
									</div>
									<div class="sheet-actions">
										<Drawer.Close class="button button--secondary">Close</Drawer.Close>
									</div>
								</Drawer.Content>
							</Drawer.Popup>
						</Drawer.Viewport>
					</Drawer.Portal>
				</Drawer.Root>
			</div>
		</section>

		<section class="example-section" id="snap-points" aria-labelledby="snap-title">
			<div class="section-heading">
				<p class="section-index">snapPoints · SwipeArea</p>
				<h2 id="snap-title">Snap points</h2>
				<p>Drag between three heights, or swipe up from the bottom edge to open.</p>
			</div>

			<div class="demo-frame">
				<Drawer.Root bind:snapPoint {snapPoints} {defaultSnapPoint}>
					<Drawer.Trigger class="button button--primary">Try the drawer</Drawer.Trigger>
					<Drawer.Portal>
						<Drawer.SwipeArea class="swipe-area" aria-label="Swipe up to open the snap drawer">
							<span>Swipe up to open</span>
						</Drawer.SwipeArea>
						<Drawer.Backdrop class="scrim" />
						<Drawer.Viewport class="sheet-viewport sheet-viewport--down">
							<Drawer.Popup class="sheet sheet--snap">
								<div class="drag-region">
									<div class="grabber" aria-hidden="true"></div>
									<div class="sheet-header">
										<div>
											<Drawer.Title>Plan a calmer day</Drawer.Title>
											<Drawer.Description>Drag this header to resize.</Drawer.Description>
										</div>
										<Drawer.Close class="icon-button" aria-label="Close drawer">×</Drawer.Close>
									</div>
								</div>

								<Drawer.Content class="sheet-body">
									<div class="snap-tabs" aria-label="Drawer height">
										{#each snapOptions as option (option.label)}
											<button
												class:active={snapPoint === option.value}
												type="button"
												onclick={() => (snapPoint = option.value)}
											>
												{option.label}
											</button>
										{/each}
									</div>

									<div class="task-list">
										<label><input type="checkbox" checked /> Review pull requests</label>
										<label><input type="checkbox" /> Prepare release notes</label>
										<label><input type="checkbox" /> Publish the package</label>
									</div>

									<label class="field">
										<span>Quick note</span>
										<input placeholder="Add a note" />
									</label>
								</Drawer.Content>
							</Drawer.Popup>
						</Drawer.Viewport>
					</Drawer.Portal>
				</Drawer.Root>
			</div>
		</section>

		<section class="example-section" id="virtual-keyboard" aria-labelledby="keyboard-title">
			<div class="section-heading">
				<p class="section-index">VirtualKeyboardProvider</p>
				<h2 id="keyboard-title">Virtual keyboard</h2>
				<p>On a phone, open each drawer and focus the last field.</p>
			</div>

			<div class="demo-frame demo-frame--comparison">
				<div class="comparison-grid">
					<div class="comparison-item">
						<div>
							<strong>Default</strong>
							<span>The keyboard can cover the field.</span>
						</div>
						<Drawer.Root>
							<Drawer.Trigger class="button">Open default</Drawer.Trigger>
							<Drawer.Portal>
								<Drawer.Backdrop class="scrim" />
								<Drawer.Viewport class="sheet-viewport sheet-viewport--down">
									<Drawer.Popup class="sheet sheet--keyboard">
										<div class="handle" aria-hidden="true"></div>
										<Drawer.Content class="sheet-body keyboard-body">
											<span class="sheet-label">Without provider</span>
											<div>
												<Drawer.Title>New message</Drawer.Title>
												<Drawer.Description
													>The last field stays at the viewport edge.</Drawer.Description
												>
											</div>
											<div class="message-fields">
												<label class="field">
													<span>To</span>
													<input value="team@example.com" />
												</label>
												<label class="field">
													<span>Subject</span>
													<input value="Friday update" />
												</label>
											</div>
											<label class="field field--message">
												<span>Message</span>
												<textarea rows="3" placeholder="Write a message"></textarea>
											</label>
											<div class="sheet-actions">
												<Drawer.Close class="button button--secondary">Cancel</Drawer.Close>
											</div>
										</Drawer.Content>
									</Drawer.Popup>
								</Drawer.Viewport>
							</Drawer.Portal>
						</Drawer.Root>
					</div>

					<div class="comparison-item comparison-item--recommended">
						<div>
							<strong>Keyboard aware <span>Recommended</span></strong>
							<span>The field is lifted and scrolled into view.</span>
						</div>
						<Drawer.Root>
							<Drawer.Trigger class="button button--primary">Open keyboard-aware</Drawer.Trigger>
							<Drawer.VirtualKeyboardProvider>
								<Drawer.Portal>
									<Drawer.Backdrop class="scrim" />
									<Drawer.Viewport class="sheet-viewport sheet-viewport--down">
										<Drawer.Popup class="sheet sheet--keyboard sheet--keyboard-aware">
											<div class="handle" aria-hidden="true"></div>
											<Drawer.Content class="sheet-body keyboard-body">
												<span class="sheet-label">With provider</span>
												<div>
													<Drawer.Title>New message</Drawer.Title>
													<Drawer.Description
														>The focused field remains above the keyboard.</Drawer.Description
													>
												</div>
												<div class="message-fields">
													<label class="field">
														<span>To</span>
														<input value="team@example.com" />
													</label>
													<label class="field">
														<span>Subject</span>
														<input value="Friday update" />
													</label>
												</div>
												<label class="field field--message">
													<span>Message</span>
													<textarea rows="3" placeholder="Write a message"></textarea>
												</label>
												<div class="sheet-actions">
													<Drawer.Close class="button button--secondary">Cancel</Drawer.Close>
												</div>
											</Drawer.Content>
										</Drawer.Popup>
									</Drawer.Viewport>
								</Drawer.Portal>
							</Drawer.VirtualKeyboardProvider>
						</Drawer.Root>
					</div>
				</div>
			</div>
		</section>

		<section class="example-section" id="nested" aria-labelledby="nested-title">
			<div class="section-heading">
				<p class="section-index">nested drawers</p>
				<h2 id="nested-title">Nested drawers</h2>
				<p>Open all three levels; the frontmost drawer owns focus and dismissal.</p>
			</div>

			<div class="demo-frame">
				<Drawer.Root>
					<Drawer.Trigger class="button button--primary">Open drawer stack</Drawer.Trigger>
					<Drawer.Portal>
						<Drawer.Backdrop class="scrim" />
						<Drawer.Viewport class="sheet-viewport sheet-viewport--down">
							<Drawer.Popup class="sheet sheet--stack">
								<div class="handle" aria-hidden="true"></div>
								<Drawer.Content class="sheet-body">
									<span class="sheet-label">Level one</span>
									<div>
										<Drawer.Title>Account settings</Drawer.Title>
										<Drawer.Description
											>Open security settings to add a second layer.</Drawer.Description
										>
									</div>
									<div class="sheet-actions sheet-actions--split">
										<Drawer.Root>
											<Drawer.Trigger class="button button--primary"
												>Security settings</Drawer.Trigger
											>
											<Drawer.Portal>
												<Drawer.Viewport class="sheet-viewport sheet-viewport--down">
													<Drawer.Popup class="sheet sheet--stack sheet--stack-2">
														<div class="handle" aria-hidden="true"></div>
														<Drawer.Content class="sheet-body">
															<span class="sheet-label">Level two</span>
															<div>
																<Drawer.Title>Security</Drawer.Title>
																<Drawer.Description
																	>Open active sessions to add the third layer.</Drawer.Description
																>
															</div>
															<label class="field">
																<span>Recovery email</span>
																<input value="ada@example.com" />
															</label>
															<div class="sheet-actions sheet-actions--split">
																<Drawer.Root>
																	<Drawer.Trigger class="button button--primary"
																		>Active sessions</Drawer.Trigger
																	>
																	<Drawer.Portal>
																		<Drawer.Viewport class="sheet-viewport sheet-viewport--down">
																			<Drawer.Popup class="sheet sheet--stack sheet--stack-3">
																				<div class="handle" aria-hidden="true"></div>
																				<Drawer.Content class="sheet-body">
																					<span class="sheet-label">Level three</span>
																					<div>
																						<Drawer.Title>Active sessions</Drawer.Title>
																						<Drawer.Description
																							>This layer closes first on Escape, outside press, or
																							swipe.</Drawer.Description
																						>
																					</div>
																					<ul class="session-list">
																						<li>
																							<span
																								class="session-dot session-dot--current"
																								aria-hidden="true"
																							></span>
																							<div>
																								<strong>MacBook Pro</strong><span
																									>New York · Current</span
																								>
																							</div>
																						</li>
																						<li>
																							<span class="session-dot" aria-hidden="true"></span>
																							<div>
																								<strong>iPhone</strong><span
																									>Brooklyn · 2 hours ago</span
																								>
																							</div>
																						</li>
																					</ul>
																					<div class="sheet-actions">
																						<Drawer.Close class="button button--secondary"
																							>Close sessions</Drawer.Close
																						>
																					</div>
																				</Drawer.Content>
																			</Drawer.Popup>
																		</Drawer.Viewport>
																	</Drawer.Portal>
																</Drawer.Root>
																<Drawer.Close class="button button--secondary">Done</Drawer.Close>
															</div>
														</Drawer.Content>
													</Drawer.Popup>
												</Drawer.Viewport>
											</Drawer.Portal>
										</Drawer.Root>
										<Drawer.Close class="button button--secondary">Close</Drawer.Close>
									</div>
								</Drawer.Content>
							</Drawer.Popup>
						</Drawer.Viewport>
					</Drawer.Portal>
				</Drawer.Root>
			</div>
		</section>

		<section class="example-section" id="modal" aria-labelledby="modal-title">
			<div class="section-heading">
				<p class="section-index">modal</p>
				<h2 id="modal-title">Modal behavior</h2>
				<p>Choose focus containment and scroll locking independently.</p>
			</div>

			<div class="demo-frame demo-frame--modal">
				<Drawer.Root swipeDirection="right" {modal} disablePointerDismissal={modal === false}>
					<div class="modal-demo">
						<div class="demo-controls" aria-label="Modal behavior">
							{#each modalOptions as option (option.label)}
								<Drawer.Trigger class="button" onclick={() => (modal = option.value)}>
									{option.label}
								</Drawer.Trigger>
							{/each}
						</div>
						<button class="page-control" type="button" onclick={() => (pageInteractions += 1)}>
							Page control · {pageInteractions}
						</button>
					</div>
					<Drawer.Portal>
						{#if modal === true}<Drawer.Backdrop class="scrim" />{/if}
						<Drawer.Viewport class="sheet-viewport sheet-viewport--right">
							<Drawer.Popup class="sheet">
								<Drawer.Content class="sheet-body">
									<span class="sheet-label">Behavior</span>
									<div>
										<Drawer.Title>{modalOption.title}</Drawer.Title>
										<Drawer.Description>{modalOption.description}</Drawer.Description>
									</div>
									<div class="sheet-actions">
										<Drawer.Close class="button button--secondary">Close</Drawer.Close>
									</div>
								</Drawer.Content>
							</Drawer.Popup>
						</Drawer.Viewport>
					</Drawer.Portal>
				</Drawer.Root>
			</div>
		</section>

		<section class="example-section" id="detached" aria-labelledby="detached-title">
			<div class="section-heading">
				<p class="section-index">createHandle · payload</p>
				<h2 id="detached-title">Detached triggers</h2>
				<p>One drawer can receive data from triggers anywhere on the page.</p>
			</div>

			<div class="demo-frame">
				<div class="demo-controls">
					{#each detailPanels as panel (panel.label)}
						<Drawer.Trigger handle={detailDrawer} payload={panel} class="button">
							{panel.label}
						</Drawer.Trigger>
					{/each}
				</div>

				<Drawer.Root handle={detailDrawer}>
					{#snippet children({ payload })}
						<Drawer.Portal>
							<Drawer.Backdrop class="scrim" />
							<Drawer.Viewport class="sheet-viewport sheet-viewport--down">
								<Drawer.Popup class="sheet">
									<div class="handle" aria-hidden="true"></div>
									<Drawer.Content class="sheet-body">
										<span class="sheet-label">{payload?.label ?? 'Details'}</span>
										<div>
											<Drawer.Title>{payload?.title ?? 'Details'}</Drawer.Title>
											<Drawer.Description>{payload?.description ?? ''}</Drawer.Description>
										</div>
										<div class="sheet-actions">
											<Drawer.Close class="button button--secondary">Done</Drawer.Close>
										</div>
									</Drawer.Content>
								</Drawer.Popup>
							</Drawer.Viewport>
						</Drawer.Portal>
					{/snippet}
				</Drawer.Root>
			</div>
		</section>
	</main>
</div>

<footer class="site-footer">
	<span>svelte-drawer-sheet</span>
	<span>MIT · Svelte 5</span>
</footer>
