import type { Snippet } from 'svelte';
import type { HTMLAttributes, HTMLButtonAttributes, SvelteHTMLElements } from 'svelte/elements';
import type { DrawerHandle } from './internal/handle.svelte.js';
import type { SnapPoint } from './internal/snap-points.js';

export type DrawerSwipeDirection = 'up' | 'down' | 'left' | 'right';
export type DrawerModal = boolean | 'trap-focus';
export type DrawerInteractionType = 'mouse' | 'touch' | 'pen' | 'keyboard' | '';
export type DrawerChangeEventReason =
	| 'trigger-press'
	| 'outside-press'
	| 'escape-key'
	| 'close-watcher'
	| 'close-press'
	| 'focus-out'
	| 'imperative-action'
	| 'swipe'
	| 'none';

export interface DrawerChangeEventDetails {
	readonly reason: DrawerChangeEventReason;
	readonly event: Event;
	readonly trigger: Element | undefined;
	readonly isCanceled: boolean;
	cancel(): void;
	preventUnmountOnClose(): void;
}

export type DrawerSnapPointChangeEventDetails = Omit<
	DrawerChangeEventDetails,
	'preventUnmountOnClose'
>;

export interface DrawerRootActions {
	open(): void;
	close(): void;
	unmount(): void;
}

export interface DrawerRootSnippetProps<Payload = unknown> {
	readonly open: boolean;
	readonly payload: Payload | undefined;
}

export interface DrawerRootProps<Payload = unknown> {
	defaultOpen?: boolean;
	open?: boolean;
	onOpenChange?: (open: boolean, details: DrawerChangeEventDetails) => void;
	onOpenChangeComplete?: (open: boolean) => void;
	modal?: DrawerModal;
	disablePointerDismissal?: boolean;
	swipeDirection?: DrawerSwipeDirection;
	snapPoints?: readonly SnapPoint[];
	defaultSnapPoint?: SnapPoint | null;
	snapPoint?: SnapPoint | null;
	onSnapPointChange?: (
		snapPoint: SnapPoint | null,
		details: DrawerSnapPointChangeEventDetails
	) => void;
	snapToSequentialPoints?: boolean;
	defaultTriggerId?: string | null;
	triggerId?: string | null;
	handle?: DrawerHandle<Payload>;
	actions?: DrawerRootActions;
	children?: Snippet<[DrawerRootSnippetProps<Payload>]>;
}

export interface DrawerPartChildProps<Props, State> {
	readonly props: Props;
	readonly state: State;
}

export interface DrawerTriggerState {
	readonly disabled: boolean;
	readonly open: boolean;
}

export interface DrawerTriggerProps<Payload = unknown> extends Omit<
	HTMLButtonAttributes,
	'children' | 'id'
> {
	id?: string;
	handle?: DrawerHandle<Payload>;
	payload?: Payload;
	nativeButton?: boolean;
	ref?: HTMLElement | null;
	children?: Snippet;
	child?: Snippet<[DrawerPartChildProps<Record<string, unknown>, DrawerTriggerState>]>;
}

export interface DrawerCloseState {
	readonly disabled: boolean;
}

export interface DrawerCloseProps extends Omit<HTMLButtonAttributes, 'children' | 'id'> {
	id?: string;
	nativeButton?: boolean;
	ref?: HTMLElement | null;
	children?: Snippet;
	child?: Snippet<[DrawerPartChildProps<Record<string, unknown>, DrawerCloseState>]>;
}

export interface DrawerPortalProps {
	/** A connected target in the same document as the drawer. Selectors fall back to `body`. */
	to?: Element | ShadowRoot | string;
	disabled?: boolean;
	keepMounted?: boolean;
	children?: Snippet;
}

export interface DrawerPresenceState {
	readonly open: boolean;
	readonly transitionStatus: 'starting' | 'ending' | undefined;
}

export interface DrawerBackdropState extends DrawerPresenceState {
	readonly swiping: boolean;
}

export interface DrawerBackdropProps extends Omit<
	HTMLAttributes<HTMLDivElement>,
	'children' | 'id'
> {
	id?: string;
	forceRender?: boolean;
	ref?: HTMLElement | null;
	children?: Snippet;
	child?: Snippet<[DrawerPartChildProps<Record<string, unknown>, DrawerBackdropState>]>;
}

export interface DrawerViewportState extends DrawerPresenceState {
	readonly nested: boolean;
	readonly nestedDrawerOpen: boolean;
}

export interface DrawerViewportProps extends Omit<
	HTMLAttributes<HTMLDivElement>,
	'children' | 'id'
> {
	id?: string;
	ref?: HTMLElement | null;
	children?: Snippet;
	child?: Snippet<[DrawerPartChildProps<Record<string, unknown>, DrawerViewportState>]>;
}

export type DrawerFocusTarget =
	| boolean
	| HTMLElement
	| null
	| ((interaction: DrawerInteractionType) => boolean | HTMLElement | null | void);

export interface DrawerPopupState extends DrawerPresenceState {
	readonly expanded: boolean;
	readonly nested: boolean;
	readonly nestedDrawerOpen: boolean;
	readonly nestedDrawerSwiping: boolean;
	readonly swipeDirection: DrawerSwipeDirection;
	readonly swiping: boolean;
}

export interface DrawerPopupProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'id'> {
	id?: string;
	initialFocus?: DrawerFocusTarget;
	finalFocus?: DrawerFocusTarget;
	/**
	 * Returns portaled controls that belong to the drawer's interaction boundary, such as a menu
	 * or combobox popup rendered elsewhere in the document.
	 */
	getInsideElements?: () => readonly (Element | null | undefined)[];
	ref?: HTMLElement | null;
	onOpenAutoFocus?: (event: Event) => void;
	onCloseAutoFocus?: (event: Event) => void;
	onEscapeKeydown?: (event: KeyboardEvent) => void;
	onInteractOutside?: (event: PointerEvent | MouseEvent) => void;
	onFocusOutside?: (event: FocusEvent) => void;
	children?: Snippet;
	child?: Snippet<[DrawerPartChildProps<Record<string, unknown>, DrawerPopupState>]>;
}

export interface DrawerContentProps extends Omit<
	HTMLAttributes<HTMLDivElement>,
	'children' | 'id'
> {
	id?: string;
	ref?: HTMLElement | null;
	children?: Snippet;
	child?: Snippet<[DrawerPartChildProps<Record<string, unknown>, Record<never, never>>]>;
}

export interface DrawerTitleProps extends Omit<SvelteHTMLElements['h2'], 'children' | 'id'> {
	id?: string;
	level?: 1 | 2 | 3 | 4 | 5 | 6;
	ref?: HTMLElement | null;
	children?: Snippet;
	child?: Snippet<[DrawerPartChildProps<Record<string, unknown>, Record<never, never>>]>;
}

export interface DrawerDescriptionProps extends Omit<SvelteHTMLElements['p'], 'children' | 'id'> {
	id?: string;
	ref?: HTMLElement | null;
	children?: Snippet;
	child?: Snippet<[DrawerPartChildProps<Record<string, unknown>, Record<never, never>>]>;
}

export interface DrawerIndentState {
	readonly active: boolean;
}

export interface DrawerIndentProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'id'> {
	id?: string;
	ref?: HTMLElement | null;
	children?: Snippet;
	child?: Snippet<[DrawerPartChildProps<Record<string, unknown>, DrawerIndentState>]>;
}

export interface DrawerSwipeAreaState {
	readonly open: boolean;
	readonly swiping: boolean;
	readonly swipeDirection: DrawerSwipeDirection;
	readonly disabled: boolean;
}

export interface DrawerSwipeAreaProps extends Omit<
	HTMLAttributes<HTMLDivElement>,
	'children' | 'id'
> {
	id?: string;
	disabled?: boolean;
	swipeDirection?: DrawerSwipeDirection;
	ref?: HTMLElement | null;
	children?: Snippet;
	child?: Snippet<[DrawerPartChildProps<Record<string, unknown>, DrawerSwipeAreaState>]>;
}

export interface DrawerProviderProps {
	children?: Snippet;
}

export interface DrawerVirtualKeyboardProviderProps {
	children?: Snippet;
}

export type DrawerSnapPoint = SnapPoint;
