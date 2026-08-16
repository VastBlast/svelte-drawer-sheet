# svelte-drawer-sheet

`svelte-drawer-sheet` is an unstyled and accessible drawer for Svelte 5. It supports gestures, snap
points, nested drawers, detached triggers, custom elements, and an optional virtual keyboard.

> The API can change before version `1.0`.

[Base UI's Drawer](https://base-ui.com/react/components/drawer) inspired this library. The
`svelte-drawer-sheet` project has no maintenance connection to Base UI. The library does not provide a
compatibility layer. See the
[third-party notices](./THIRD_PARTY_NOTICES.md).

## Install

```sh
# pnpm
pnpm add svelte-drawer-sheet

# npm
npm install svelte-drawer-sheet

# Yarn
yarn add svelte-drawer-sheet
```

Use Svelte version `5.40.0` or later. Do not use Svelte 6. Use a bundler that supports Svelte.

## Basic drawer

```svelte
<script lang="ts">
	import * as Drawer from 'svelte-drawer-sheet';

	let open = $state(false);
</script>

<Drawer.Root bind:open>
	<Drawer.Trigger class="drawer-trigger">Open drawer</Drawer.Trigger>

	<Drawer.Portal>
		<Drawer.Backdrop class="drawer-backdrop" />
		<Drawer.Viewport class="drawer-viewport">
			<Drawer.Popup class="drawer-popup">
				<Drawer.Title>Account settings</Drawer.Title>
				<Drawer.Description>Update the details associated with your account.</Drawer.Description>

				<Drawer.Content class="drawer-content">
					<!-- Form or other scrollable content -->
				</Drawer.Content>

				<Drawer.Close>Done</Drawer.Close>
			</Drawer.Popup>
		</Drawer.Viewport>
	</Drawer.Portal>
</Drawer.Root>
```

The library does not supply visual CSS. Use this CSS for a bottom drawer. This example uses the
default value `swipeDirection="down"`.

```css
.drawer-backdrop {
	--backdrop-opacity: 0.2;
	position: fixed;
	inset: 0;
	min-height: 100dvh;
	background: black;
	opacity: calc(var(--backdrop-opacity) * (1 - var(--drawer-swipe-progress)));
	transition: opacity 450ms cubic-bezier(0.32, 0.72, 0, 1);
}

.drawer-backdrop[data-starting-style],
.drawer-backdrop[data-ending-style] {
	opacity: 0;
}

.drawer-viewport {
	position: fixed;
	inset: 0;
	display: flex;
	align-items: flex-end;
	pointer-events: none;
}

.drawer-viewport[hidden] {
	display: none;
}

.drawer-popup {
	--bleed: 3rem;
	box-sizing: border-box;
	width: 100%;
	max-height: calc(80dvh + var(--bleed));
	margin-bottom: calc(-1 * var(--bleed));
	padding: 1rem 1.5rem;
	padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px) + var(--bleed));
	border-radius: 1rem 1rem 0 0;
	background: white;
	box-shadow: 0 -1rem 3rem rgb(0 0 0 / 0.15);
	overflow: auto;
	overscroll-behavior: contain;
	pointer-events: auto;
	transform: translateY(calc(var(--drawer-snap-point-offset) + var(--drawer-swipe-movement-y)));
	transition: transform 450ms cubic-bezier(0.32, 0.72, 0, 1);
}
.drawer-popup[data-starting-style],
.drawer-popup[data-ending-style] {
	transform: translateY(calc(100% - var(--bleed) + 2px));
}

.drawer-popup[data-ending-style],
.drawer-backdrop[data-ending-style] {
	transition-duration: calc(var(--drawer-swipe-strength) * 400ms);
}

.drawer-popup[data-swiping],
.drawer-backdrop[data-swiping] {
	transition-duration: 0ms;
	user-select: none;
}

.drawer-content {
	overflow: auto;
	overscroll-behavior: contain;
}

@media (prefers-reduced-motion: reduce) {
	.drawer-popup,
	.drawer-backdrop {
		/* Also override the swipe-release duration. */
		transition-duration: 0ms !important;
	}
}
```

`--bleed` extends the drawer surface past the screen edge. This extension hides the page background
during overshoot. For another direction, change the edge, safe-area inset, movement variable, and
exit sign. Align `Viewport` with the same edge.

## State and change events

You can bind `open`, `snapPoint`, `triggerId`, and `actions`. Use the related `default*` prop to set
the initial uncontrolled state.

```svelte
<script lang="ts">
	import * as Drawer from 'svelte-drawer-sheet';
	import type { DrawerChangeEventDetails, DrawerRootActions } from 'svelte-drawer-sheet';

	let open = $state(false);
	let actions = $state<DrawerRootActions>();
	let hasUnsavedChanges = $state(false);

	function handleOpenChange(nextOpen: boolean, details: DrawerChangeEventDetails) {
		if (!nextOpen && hasUnsavedChanges) details.cancel();
	}
</script>

<button onclick={() => actions?.open()}>Open imperatively</button>

<Drawer.Root bind:open bind:actions onOpenChange={handleOpenChange}>
	<!-- drawer parts -->
</Drawer.Root>
```

Each change details object contains `event`, `trigger`, and `reason`. The `reason` has one of these
values:
`trigger-press`, `outside-press`, `escape-key`, `close-watcher`, `close-press`, `focus-out`,
`imperative-action`, `swipe`, or `none`.

- Call `details.cancel()` to reject the change.
- Call `details.preventUnmountOnClose()` to delay the unmount operation. Then, call
  `actions.unmount()` after the external transition.
- `Root` calls `onOpenChangeComplete` after the transition.

## Modal options

The default value of `modal` is `true`.

| `modal` value  | Focus trap | Page scroll lock | Close after outside focus |
| -------------- | ---------- | ---------------- | ------------------------- |
| `true`         | Yes        | Yes              | No                        |
| `'trap-focus'` | Yes        | No               | No                        |
| `false`        | No         | No               | Yes                       |

`disablePointerDismissal` prevents only pointer dismissal and focus-out dismissal.

## Focus behavior

`Popup` adds `role="dialog"`. It links `Title` and `Description` to the dialog. Add both parts to give
the dialog an accessible name and description.

By default, `Popup` gets focus when the drawer opens. This action prevents an unexpected mobile
keyboard. Set `initialFocus` and `finalFocus` to one of these values:

- `true`: Focus the first tabbable element. If no such element exists, focus the popup.
- `false` or `null`: Do not move focus automatically.
- An `HTMLElement`: Focus that element.
- A callback: Use the interaction type to select the focus action. Return `null` for the default
  action. Return `false` or `undefined` to prevent focus movement.

An external `initialFocus` target stays in the modal boundary. When the drawer closes, the library
usually returns focus to the opening trigger. This behavior also applies to detached triggers.

`onOpenAutoFocus`, `onCloseAutoFocus`, `onEscapeKeydown`, and `onInteractOutside` get cancelable
browser events. `onFocusOutside` gets a cancelable event wrapper. Call `event.preventDefault()` to
prevent the default action.

Use `getInsideElements` for a portaled menu, combobox, or similar control. The specified elements
stay in the interaction and accessibility boundary.

```svelte
<Drawer.Popup getInsideElements={() => [menuPopup]}>
	<!-- drawer content -->
</Drawer.Popup>
```

## Snap points

Use snap points only with vertical drawers. The library accepts these values:

- A number from `0` through `1`. The number specifies a fraction of the viewport height.
- A number greater than `1`. The number specifies pixels.
- A pixel or root-relative CSS length, such as `'320px'` or `'24rem'`.

The library limits each value to the viewport height and popup height.

```svelte
<script lang="ts">
	import * as Drawer from 'svelte-drawer-sheet';
	import type { DrawerSnapPoint } from 'svelte-drawer-sheet';

	const snapPoints = ['16rem', 0.65, 1] as const satisfies readonly DrawerSnapPoint[];
	let snapPoint = $state<DrawerSnapPoint | null>('16rem');
</script>

<Drawer.Root
	{snapPoints}
	defaultSnapPoint="16rem"
	bind:snapPoint
	snapToSequentialPoints
	onSnapPointChange={(nextPoint, details) => {
		// Call details.cancel() to reject this change.
	}}
>
	<!-- drawer parts -->
</Drawer.Root>
```

Set `snapToSequentialPoints` to move through the snap points in sequence. Add `1` for a fully
expanded state. This state adds `data-expanded` to `Popup`.

## Detached triggers and payloads

Use `createHandle` to connect external triggers to `Root`. The `Root` children snippet gets each
typed payload.

```svelte
<script lang="ts">
	import * as Drawer from 'svelte-drawer-sheet';

	type Item = { id: string; label: string };
	const drawer = Drawer.createHandle<Item>();
</script>

<Drawer.Trigger handle={drawer} payload={{ id: 'one', label: 'First item' }}>
	Edit first item
</Drawer.Trigger>

<Drawer.Root handle={drawer}>
	{#snippet children({ payload })}
		<Drawer.Portal>
			<Drawer.Backdrop class="drawer-backdrop" />
			<Drawer.Viewport class="drawer-viewport">
				<Drawer.Popup class="drawer-popup">
					<Drawer.Title>Edit {payload?.label ?? 'item'}</Drawer.Title>
					<!-- drawer content -->
				</Drawer.Popup>
			</Drawer.Viewport>
		</Drawer.Portal>
	{/snippet}
</Drawer.Root>
```

The handle also supplies imperative methods:

```ts
drawer.open();
drawer.open('trigger-element-id');
drawer.openWithPayload({ id: 'two', label: 'Second item' });
drawer.close();
```

Use `open(triggerId)` to identify the trigger for focus restoration. Use handle methods only in the
browser.

## Custom elements

Each part can accept a `child` snippet. The snippet gets merged `props` and reactive `state`. Put all
supplied `props` on exactly one element. This action keeps the required behavior and accessibility.

```svelte
{#snippet customTrigger({ props, state })}
	<div {...props} class:open={state.open}>Open with a custom element</div>
{/snippet}

<Drawer.Trigger nativeButton={false} child={customTrigger} />
```

`Trigger` and `Close` render buttons by default. If a child does not render a button, set
`nativeButton={false}`. The component adds the button semantics. You can bind `ref` on most rendered
parts.

## Swipe areas and gesture exclusions

`SwipeArea` opens a closed drawer from the edge opposite the dismissal direction.

```svelte
<Drawer.Root>
	<Drawer.SwipeArea class="bottom-edge-swipe-area" />
	<!-- portal, viewport, and popup -->
</Drawer.Root>
```

Add `data-drawer-swipe-ignore` to a region that must keep native gestures. `Content` identifies the
scroll region. A drawer gesture starts only when the content reaches its scroll boundary.

## Portals and presence

By default, `Portal` moves content to `document.body`. The `to` prop accepts a selector, a connected
element, or a connected open shadow root. The target must be in the same document. If a selector
does not find a target, `Portal` uses `body`. `Portal` does not accept closed shadow roots or targets
in other documents. Set `disabled` to keep content in its initial location.

Set `keepMounted` to keep closed content in the DOM. Closed content stays hidden or inert. By
default, a nested drawer does not show its `Backdrop`. Set `Backdrop.forceRender` to show it.

Use only one `Viewport` and one `Popup` in each `Root`. Use `child` snippets for responsive element
changes.

## Nested drawers and page indentation

A nested `Root` shares its stack measurements and state with the parent `Root`. Svelte context keeps
this connection through portals.

The library supplies the measurements. Use CSS to control the scale and visible edge.

```css
.drawer-popup--stack {
	--stack-progress: clamp(0, var(--drawer-swipe-progress), 1);
	--stack-step: 0.05;
	--stack-peek: max(0px, calc((var(--nested-drawers) - var(--stack-progress)) * 1rem));
	--stack-scale-base: max(0, calc(1 - var(--nested-drawers) * var(--stack-step)));
	--stack-scale: calc(var(--stack-scale-base) + var(--stack-step) * var(--stack-progress));
	--stack-height: max(
		0px,
		calc(var(--drawer-frontmost-height, var(--drawer-height)) - var(--bleed))
	);
	--stack-y: calc(
		var(--drawer-swipe-movement-y) - var(--stack-peek) -
			((1 - var(--stack-scale)) * var(--stack-height))
	);
	height: var(--drawer-height, auto);
	transform: translateY(var(--stack-y)) scale(var(--stack-scale));
	transform-origin: 50% calc(100% - var(--bleed));
	transition:
		transform 450ms cubic-bezier(0.32, 0.72, 0, 1),
		height 450ms cubic-bezier(0.32, 0.72, 0, 1);
}

.drawer-popup--stack[data-nested-drawer-open] {
	/* Keep the background sheet at the frontmost height. Remove its height limits in the stack. */
	height: calc(var(--stack-height) + var(--bleed));
	min-height: 0;
	max-height: none;
	overflow: hidden;
}

.drawer-popup--stack[data-swiping],
.drawer-popup--stack[data-nested-drawer-swiping] {
	transition-duration: 0ms;
}
```

Use `Provider`, `Indent`, and `IndentBackground` to send drawer progress to page-level CSS. These
parts do not change the page unless your CSS changes it.

## Virtual keyboard

Put `VirtualKeyboardProvider` around a drawer that contains text inputs.

```svelte
<Drawer.Root>
	<Drawer.VirtualKeyboardProvider>
		<Drawer.Portal>
			<!-- backdrop, viewport, and popup -->
		</Drawer.Portal>
	</Drawer.VirtualKeyboardProvider>
</Drawer.Root>
```

If the browser supports `visualViewport`, the provider keeps the focused control visible. The
provider writes `--drawer-keyboard-inset` to `Viewport`. Use this property in the popup or scroll
container.

```css
.drawer-popup {
	padding-bottom: calc(env(safe-area-inset-bottom, 0px) + var(--drawer-keyboard-inset, 0px));
	transition:
		transform 440ms cubic-bezier(0.32, 0.72, 0, 1),
		padding-bottom 440ms cubic-bezier(0.32, 0.72, 0, 1);
}
```

The provider stops while page zoom is active. On touch devices, set the input font size to `1rem` or
more. This font size prevents iOS focus zoom.

```css
@media (any-pointer: coarse) {
	.drawer-input {
		font-size: 1rem;
	}
}
```

## Style

These attributes and variables are the stable style API. Do not use other implementation details.

### Data attributes

| Part                         | Attributes                                                                                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Trigger`                    | `data-popup-open`, `data-disabled`                                                                                                                                                                                            |
| `Close`                      | `data-disabled`                                                                                                                                                                                                               |
| `Backdrop`                   | `data-open`, `data-closed`, `data-swiping`, `data-swipe-dismiss`, `data-starting-style`, `data-ending-style`                                                                                                                  |
| `Viewport`                   | `data-open`, `data-closed`, `data-nested`, `data-nested-drawer-open`                                                                                                                                                          |
| `Popup`                      | `data-open`, `data-closed`, `data-expanded`, `data-nested`, `data-nested-drawer-open`, `data-nested-drawer-swiping`, `data-swipe-direction`, `data-swipe-dismiss`, `data-swiping`, `data-starting-style`, `data-ending-style` |
| `Content`                    | `data-drawer-content`                                                                                                                                                                                                         |
| `SwipeArea`                  | `data-open`, `data-closed`, `data-disabled`, `data-swipe-direction`, `data-swiping`                                                                                                                                           |
| `Indent`, `IndentBackground` | `data-active`, `data-inactive`                                                                                                                                                                                                |

### CSS custom properties

| Variable                     | Element                       | Meaning                                                                          |
| ---------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| `--drawer-swipe-movement-x`  | `Popup`                       | Current horizontal drag distance                                                 |
| `--drawer-swipe-movement-y`  | `Popup`                       | Current vertical drag distance                                                   |
| `--drawer-swipe-progress`    | `Popup`, `Backdrop`, `Indent` | Nested drawer progress on Popup. Other elements show snap or dismissal progress. |
| `--drawer-swipe-strength`    | `Popup`, `Backdrop`           | Release duration multiplier from `0.1` through `1`                               |
| `--drawer-snap-point-offset` | `Popup`                       | Pixel offset of the active snap point                                            |
| `--drawer-height`            | `Popup`, `Backdrop`, `Indent` | `auto` at rest. Height in pixels during nesting or exit.                         |
| `--drawer-frontmost-height`  | `Popup`                       | Height of the frontmost nested drawer                                            |
| `--nested-drawers`           | `Popup`                       | Number of open nested drawers                                                    |
| `--drawer-keyboard-inset`    | `Viewport`                    | Visual viewport inset when a software keyboard is visible                        |

`Popup[data-swipe-direction]` gives the root direction to CSS.

## Component overview

| Export                         | Purpose                                                         |
| ------------------------------ | --------------------------------------------------------------- |
| `Root`                         | Drawer state, behavior, nesting, snap points, and callbacks     |
| `Trigger`                      | Native or custom trigger with optional handle connection        |
| `Portal`                       | Optional content relocation and mounted-state control           |
| `Backdrop`                     | Top-level overlay and swipe-progress surface                    |
| `Viewport`                     | Presence container, measurement limit, and dismissal controller |
| `Popup`                        | Accessible dialog surface, focus control, and style state       |
| `Content`                      | Content and scroll-region identifier                            |
| `Title`                        | Accessible dialog title with a default `level` of `2`           |
| `Description`                  | Accessible dialog description                                   |
| `Close`                        | Native or custom close control                                  |
| `SwipeArea`                    | Edge gesture that opens a closed drawer                         |
| `Provider`                     | Page indentation controller for multiple drawers                |
| `Indent`                       | Foreground page region with current drawer measurements         |
| `IndentBackground`             | Background page region with active and inactive states          |
| `VirtualKeyboardProvider`      | Optional `visualViewport` keyboard controller                   |
| `createHandle`, `DrawerHandle` | Detached trigger, payload, and imperative API                   |

The package root exports all public prop types and state types.

## Server-side rendering

You can import the package during server-side rendering. The package starts DOM operations after
the elements mount. Use refs, DOM targets, and imperative methods only in the browser. The package
has no runtime component-library dependency.

## Development

Use Node 24 and pnpm 12.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm validate
```

`pnpm package` creates `dist`. `pnpm pack --dry-run` lists the files in the npm package.

## License

The package uses the MIT License. Read [LICENSE](./LICENSE) and
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
