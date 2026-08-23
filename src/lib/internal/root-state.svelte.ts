import type {
	DrawerChangeEventDetails,
	DrawerChangeEventReason,
	DrawerInteractionType,
	DrawerModal,
	DrawerRootActions,
	DrawerSnapPointChangeEventDetails,
	DrawerSwipeBehavior,
	DrawerSwipeDirection
} from '../types.js';
import { CSS_VAR, isVertical } from './constants.js';
import {
	createChangeEventDetails,
	isUnmountPreventionRequested,
	toSnapPointDetails
} from './events.js';
import type { DrawerHandle, DrawerRegisteredTrigger } from './handle.svelte.js';
import type { DrawerProviderState } from './provider-state.svelte.js';
import {
	findClosestSnapPointIndex,
	resolveSnapPoint,
	resolveSnapPoints,
	type ResolvedSnapPoint,
	type SnapPoint
} from './snap-points.js';
import { waitForAnimations } from './presence.js';

interface DrawerRootStateOptions {
	getOpen: () => boolean;
	setOpen: (open: boolean) => void;
	getModal: () => DrawerModal;
	getDisablePointerDismissal: () => boolean;
	getSwipeDirection: () => DrawerSwipeDirection;
	getSwipeBehavior: () => DrawerSwipeBehavior;
	getSnapPoints: () => readonly SnapPoint[] | undefined;
	getSnapPoint: () => SnapPoint | null | undefined;
	setSnapPoint: (snapPoint: SnapPoint | null) => void;
	isSnapPointControlled: boolean;
	getDefaultSnapPoint: () => SnapPoint | null | undefined;
	getSnapToSequentialPoints: () => boolean;
	getOnOpenChange: () => ((open: boolean, details: DrawerChangeEventDetails) => void) | undefined;
	getOnSnapPointChange: () =>
		((snapPoint: SnapPoint | null, details: DrawerSnapPointChangeEventDetails) => void) | undefined;
	getTriggerId: () => string | null;
	setTriggerId: (triggerId: string | null) => void;
	parent: DrawerRootState<unknown> | null;
	provider: DrawerProviderState | null;
}

const registeredCssObjects = new WeakSet<object>();

function interactionType(event: Event): DrawerInteractionType {
	if (event.type.startsWith('key') || 'key' in event) return 'keyboard';
	if ('pointerType' in event && typeof event.pointerType === 'string') {
		if (['mouse', 'touch', 'pen'].includes(event.pointerType)) {
			return event.pointerType as DrawerInteractionType;
		}
		// Screen readers and native keyboard activation dispatch click events without a pointer type.
		if ('detail' in event && event.detail === 0) return 'keyboard';
		return '';
	}
	if ('touches' in event || 'changedTouches' in event) return 'touch';
	if ('detail' in event && event.detail === 0) return 'keyboard';
	if ('button' in event) return 'mouse';
	return '';
}

function registerSwipeProperties(element: HTMLElement): void {
	const css = element.ownerDocument.defaultView?.CSS as
		| (typeof CSS & {
				registerProperty?: (definition: PropertyDefinition) => void;
		  })
		| undefined;
	if (!css?.registerProperty || registeredCssObjects.has(css)) return;

	for (const name of [CSS_VAR.swipeMovementX, CSS_VAR.swipeMovementY, CSS_VAR.snapPointOffset]) {
		try {
			css.registerProperty({ name, syntax: '<length>', inherits: false, initialValue: '0px' });
		} catch {
			// Another library instance may have registered the same document-level property.
		}
	}
	for (const [name, initialValue] of [
		[CSS_VAR.swipeProgress, '0'],
		[CSS_VAR.swipeStrength, '1']
	] as const) {
		try {
			css.registerProperty({ name, syntax: '<number>', inherits: false, initialValue });
		} catch {
			// See above.
		}
	}
	registeredCssObjects.add(css);
}

export class DrawerRootState<Payload = unknown> {
	readonly parent: DrawerRootState<unknown> | null;
	readonly provider: DrawerProviderState | null;
	readonly nestingDepth: number;
	readonly actions: DrawerRootActions;

	payload = $state.raw<Payload | undefined>(undefined);
	activeTrigger = $state.raw<Element | undefined>(undefined);
	popup = $state.raw<HTMLElement | null>(null);
	viewport = $state.raw<HTMLElement | null>(null);
	backdrop = $state.raw<HTMLElement | null>(null);
	ownerDocument: Document | undefined;
	titleId = $state<string | undefined>(undefined);
	descriptionId = $state<string | undefined>(undefined);
	contentId = $state<string | undefined>(undefined);
	popupHeight = $state(0);
	viewportHeight = $state(0);
	rootFontSize = $state(16);
	swiping = $state(false);
	swipeDismissed = $state(false);
	swipeStrength = $state(1);
	swipeEasing = $state('');
	swipeAreaActive = $state(false);
	outsideDismissSuppressed = false;
	preventUnmount = $state(false);
	mounted = $state(false);
	transitionStatus = $state<'starting' | 'ending' | undefined>(undefined);
	nestedOpenCount = $state(0);
	// CSS-facing mirror of `nestedOpenCount`. Its first activation waits for the frozen
	// `--drawer-height` pixel value to reach the style system so consumer height transitions
	// interpolate from a length instead of snapping from `auto`.
	nestedVisualCount = $state(0);
	nestedPresenceCount = $state(0);
	// This broader flag also coordinates a newly opened non-Drawer dialog discovered by Popup's
	// document observer.
	nestedDialogOpen = $state(false);
	nestedSwiping = $state(false);
	nestedFrontmostHeight = $state(0);
	nestedProgress = 0;
	// These mirror imperative pointer-frame writes without making them reactive. A low-frequency
	// Svelte rerender can then preserve the engine-owned inline values instead of replacing them.
	popupSwipeMovementX = 0;
	popupSwipeMovementY = 0;
	popupSwipeProgress = 0;
	popupSnapPointOffset = 0;
	backdropSwipeProgress = 0;
	backdropHeight = 0;
	keyboardInset = 0;
	openMethod = $state<DrawerInteractionType>('');
	closeMethod = $state<DrawerInteractionType>('');
	closeReason = $state<DrawerChangeEventReason>('none');
	closeWatcherGeneration = $state(0);

	#options!: DrawerRootStateOptions;
	#destroyed = false;
	// These collections are mirrored into reactive scalar fields and never read by templates.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#nestedOpen = new Set<object>();
	// Presence outlives logical open state so the parent can keep a stable height during child exit.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#nestedPresent = new Set<object>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#nestedSwipers = new Set<object>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#nestedHeights = new Map<object, number>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#nestedProgresses = new Map<object, number>();
	// Multiple instances are unusual but valid; retaining every registration prevents an older
	// component's cleanup from clearing the id of a newer label.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#titleIds = new Map<object, string>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#descriptionIds = new Map<object, string>();
	#contentOwner: object | null = null;
	#triggers = $state.raw<DrawerRegisteredTrigger<Payload>[]>([]);
	#handle: DrawerHandle<Payload> | null = null;
	#transitionSnapshot: {
		readonly popup: HTMLElement | null;
		readonly popupTransition: string;
		readonly backdrop: HTMLElement | null;
		readonly backdropTransition: string;
	} | null = null;
	#measurePopup: (() => void) | null = null;
	#popupMeasureFrame = 0;
	#nestedVisualFrame = 0;
	#swipeSettleCleanup: (() => void) | null = null;
	#resolvedSnapPoints = $derived.by<ResolvedSnapPoint[]>(() => {
		if (!isVertical(this.swipeDirection)) return [];
		return resolveSnapPoints(this.snapPoints ?? [], {
			viewportHeight: this.viewportHeight,
			drawerHeight: this.popupHeight,
			rootFontSize: this.rootFontSize
		});
	});
	#activeSnapPoint = $derived.by<SnapPoint | null>(() => {
		const value = this.#options.getSnapPoint();
		if (this.#options.isSnapPointControlled) return value ?? null;
		if (!this.snapPoints?.length) return value ?? this.defaultSnapPoint;
		return value !== null &&
			value !== undefined &&
			this.snapPoints.some((point) => Object.is(point, value))
			? value
			: this.defaultSnapPoint;
	});
	#activeSnapPointOffset = $derived.by<number | null>(() => {
		const value = this.#activeSnapPoint;
		if (value === null || this.#resolvedSnapPoints.length === 0) return null;
		const exact = this.#resolvedSnapPoints.find((point) => Object.is(point.value, value));
		if (exact) return exact.offset;
		const height = resolveSnapPoint(value, this.viewportHeight, this.rootFontSize);
		if (height === null) return null;
		const index = findClosestSnapPointIndex(
			this.#resolvedSnapPoints.map((point) => point.height),
			Math.min(this.popupHeight, Math.max(0, height))
		);
		return this.#resolvedSnapPoints[index]?.offset ?? null;
	});
	#snapPointRange = $derived.by<{ minimum: number; range: number } | null>(() => {
		if (this.#resolvedSnapPoints.length < 2) return null;
		const offsets = this.#resolvedSnapPoints.map((point) => point.offset).sort((a, b) => a - b);
		const range = offsets[1] - offsets[0];
		return range > 0 ? { minimum: offsets[0], range } : null;
	});
	#settledSwipeProgress = $derived.by(() => {
		const snapRange = this.#snapPointRange;
		const activeOffset = this.#activeSnapPointOffset;
		if (!snapRange || activeOffset === null) return 0;
		return Math.min(1, Math.max(0, (activeOffset - snapRange.minimum) / snapRange.range));
	});
	constructor(options: DrawerRootStateOptions) {
		this.#options = options;
		this.parent = options.parent;
		this.provider = options.provider;
		this.nestingDepth = (this.parent?.nestingDepth ?? -1) + 1;
		this.mounted = options.getOpen();
		// A root constructed already open — a conditionally mounted drawer, or `defaultOpen` —
		// still enters through its starting styles: the popup's first insertion is the enter
		// transition. On the server the status stays unset so prerendered markup rests at the
		// open styles and needs no JavaScript; hydration then runs the entrance.
		if (this.mounted && typeof document !== 'undefined') this.transitionStatus = 'starting';
		this.actions = {
			open: () => {
				if (!this.#destroyed) this.requestOpen(true, createChangeEventDetails('imperative-action'));
			},
			close: () => {
				if (!this.#destroyed)
					this.requestOpen(false, createChangeEventDetails('imperative-action'));
			},
			unmount: () => {
				if (this.#destroyed) return;
				this.preventUnmount = false;
				if (!this.open) this.mounted = false;
			}
		};
	}

	get open(): boolean {
		return this.#options.getOpen();
	}

	get modal(): DrawerModal {
		return this.#options.getModal();
	}

	get disablePointerDismissal(): boolean {
		return this.#options.getDisablePointerDismissal();
	}

	get swipeDirection(): DrawerSwipeDirection {
		return this.#options.getSwipeDirection();
	}

	get swipeBehavior(): DrawerSwipeBehavior {
		const behavior = this.#options.getSwipeBehavior();
		return behavior === 'navigation' && isVertical(this.swipeDirection) ? 'drawer' : behavior;
	}

	get snapPoints(): readonly SnapPoint[] | undefined {
		return this.#options.getSnapPoints();
	}

	get snapToSequentialPoints(): boolean {
		return this.#options.getSnapToSequentialPoints();
	}

	get triggerId(): string | null {
		return this.#options.getTriggerId();
	}

	get resolvedSnapPoints(): ResolvedSnapPoint[] {
		return this.#resolvedSnapPoints;
	}

	get defaultSnapPoint(): SnapPoint | null {
		const configured = this.#options.getDefaultSnapPoint();
		return configured !== undefined ? configured : (this.snapPoints?.[0] ?? null);
	}

	get activeSnapPoint(): SnapPoint | null {
		return this.#activeSnapPoint;
	}

	get activeSnapPointOffset(): number | null {
		return this.#activeSnapPointOffset;
	}

	get frontmostHeight(): number {
		return this.nestedFrontmostHeight || this.popupHeight;
	}

	get settledSwipeProgress(): number {
		return this.#settledSwipeProgress;
	}

	get nestedInteractionOpen(): boolean {
		return this.nestedOpenCount > 0 || this.nestedDialogOpen;
	}

	registerTitle(owner: object, id: string): () => void {
		return this.#registerLabel(this.#titleIds, owner, id, (value) => (this.titleId = value));
	}

	registerDescription(owner: object, id: string): () => void {
		return this.#registerLabel(
			this.#descriptionIds,
			owner,
			id,
			(value) => (this.descriptionId = value)
		);
	}

	#registerLabel(
		ids: Map<object, string>,
		owner: object,
		id: string,
		publish: (value: string | undefined) => void
	): () => void {
		ids.set(owner, id);
		publish([...ids.values()].at(-1));
		return () => {
			if (ids.get(owner) !== id) return;
			ids.delete(owner);
			publish([...ids.values()].at(-1));
		};
	}

	registerContent(owner: object, id: string): () => void {
		this.#contentOwner = owner;
		this.contentId = id;
		return () => {
			if (this.#contentOwner !== owner || this.contentId !== id) return;
			this.#contentOwner = null;
			this.contentId = undefined;
		};
	}

	registerTrigger(element: Element, payload: () => Payload | undefined): () => void {
		this.ownerDocument = element.ownerDocument;
		const registration = { element, payload };
		this.#triggers = [...this.#triggers, registration];
		return () => {
			const index = this.#triggers.lastIndexOf(registration);
			if (index !== -1) this.#triggers = this.#triggers.toSpliced(index, 1);
			if (this.activeTrigger === element) {
				this.activeTrigger = this.resolveTrigger(element.id)?.element;
			}
		};
	}

	resolveTrigger(id: string): DrawerRegisteredTrigger<Payload> | undefined {
		return this.#triggers.findLast((registration) => registration.element.id === id);
	}

	get triggerElements(): readonly Element[] {
		return [
			...this.#triggers.map((registration) => registration.element),
			...(this.#handle?._triggerElements() ?? [])
		];
	}

	syncActiveTrigger(id: string | null, external?: DrawerRegisteredTrigger<Payload>): void {
		if (id) {
			const registered = this.resolveTrigger(id) ?? external;
			this.activeTrigger =
				registered?.element ?? this.popup?.ownerDocument.getElementById(id) ?? undefined;
			if (this.open && registered) this.payload = registered.payload();
		} else if (this.activeTrigger?.id) {
			this.activeTrigger = undefined;
		}
	}

	getSwipeProgress(
		displacement: number,
		size: number,
		baseOffset = this.#activeSnapPointOffset
	): number {
		const snapRange = this.#snapPointRange;
		if (!snapRange || baseOffset === null) {
			return size > 0 ? Math.max(0, displacement) / size : 0;
		}

		const nextOffset = Math.min(this.popupHeight, Math.max(0, baseOffset + displacement));
		return Math.min(1, Math.max(0, (nextOffset - snapRange.minimum) / snapRange.range));
	}

	syncSnapPointOffset(): void {
		const offset = this.activeSnapPointOffset ?? 0;
		this.popupSnapPointOffset = offset;
		this.popup?.style.setProperty(
			CSS_VAR.snapPointOffset,
			`${this.swipeDirection === 'up' ? -offset : offset}px`
		);
	}

	attachHandle(handle: DrawerHandle<Payload>): () => void {
		this.#handle = handle;
		const getRoot = () => this;
		const detach = handle._attach({
			get open() {
				return getRoot().open;
			},
			get contentId() {
				return getRoot().contentId;
			},
			get activeTrigger() {
				return getRoot().activeTrigger;
			},
			get document() {
				return getRoot().ownerDocument;
			},
			resolveTrigger: (id) => this.resolveTrigger(id),
			requestOpen: (open, options) =>
				this.requestFromHandle(open, options?.payload, options?.trigger, options?.event)
		});
		return () => {
			detach();
			if (this.#handle === handle) this.#handle = null;
		};
	}

	requestFromHandle(open: boolean, payload?: Payload, trigger?: Element, event?: Event): boolean {
		return this.requestOpen(
			open,
			createChangeEventDetails(trigger && event ? 'trigger-press' : 'imperative-action', event, {
				trigger
			}),
			{ payload, trigger }
		);
	}

	requestOpen(
		open: boolean,
		details: DrawerChangeEventDetails,
		opening?: { payload?: Payload; trigger?: Element }
	): boolean {
		if (this.#destroyed) return false;
		if (open === this.open) {
			if (open && opening) {
				this.payload = opening.payload;
				const trigger = opening.trigger ?? details.trigger;
				if (trigger) {
					this.activeTrigger = trigger;
					this.#options.setTriggerId(trigger.id || null);
				}
				this.openMethod = interactionType(details.event);
			}
			return true;
		}

		this.#options.getOnOpenChange()?.(open, details);
		if (details.isCanceled) return false;

		if (open) {
			this.closeReason = 'none';
			this.preventUnmount = false;
			this.mounted = true;
			this.transitionStatus = 'starting';
			// An interrupted swipe dismissal can reopen before its close transition completes.
			// Clear those imperative exit styles synchronously; SwipeArea owns its opening movement.
			if (!this.swipeAreaActive) this.resetDrag();
			this.clearSwipeRelease();
			this.payload = opening?.payload;
			this.activeTrigger = opening?.trigger ?? details.trigger;
			this.#options.setTriggerId(this.activeTrigger?.id || null);
			this.openMethod = interactionType(details.event);
		} else {
			this.setNestedSwipeActive(false);
			this.parent?.setNestedProgress(this, 0);
			this.closeReason = details.reason;
			if (isUnmountPreventionRequested(details)) this.preventUnmount = true;
			this.transitionStatus = 'ending';
			this.closeMethod = interactionType(details.event);
			if (this.snapPoints?.length) {
				this.requestSnapPoint(this.defaultSnapPoint, toSnapPointDetails(details));
			}
		}

		this.#options.setOpen(open);
		return true;
	}

	requestSnapPoint(value: SnapPoint | null, details: DrawerSnapPointChangeEventDetails): boolean {
		this.#options.getOnSnapPointChange()?.(value, details);
		if (details.isCanceled) return false;
		this.#options.setSnapPoint(value);
		return true;
	}

	completeOpenChange(open: boolean): void {
		this.transitionStatus = undefined;
		if (!open) {
			this.payload = undefined;
			this.clearSwipeRelease();
			this.resetDrag();
			this.provider?.visualState.remove(this);
			if (!this.preventUnmount) this.mounted = false;
		}
	}

	setNestedOpen(drawer: object, open: boolean): void {
		if (this.#nestedOpen.has(drawer) === open) return;
		if (open) this.#nestedOpen.add(drawer);
		else this.#nestedOpen.delete(drawer);
		this.nestedOpenCount = this.#nestedOpen.size;
		this.#syncNestedVisualCount();
		this.parent?.setNestedOpen(drawer, open);
	}

	#syncNestedVisualCount(): void {
		const view = this.popup?.ownerDocument.defaultView;
		if (view) view.cancelAnimationFrame(this.#nestedVisualFrame);
		this.#nestedVisualFrame = 0;
		if (this.nestedOpenCount === 0 || this.nestedVisualCount > 0 || !view) {
			this.nestedVisualCount = this.nestedOpenCount;
			return;
		}
		// First nested open: force a recalc with the frozen height applied before the nested
		// attributes land, then flip them, so height and transform animate together from rest.
		this.#nestedVisualFrame = view.requestAnimationFrame(() => {
			this.#nestedVisualFrame = 0;
			void this.popup?.offsetHeight;
			this.nestedVisualCount = this.nestedOpenCount;
		});
	}

	setNestedPresence(drawer: object, present: boolean): void {
		if (this.#nestedPresent.has(drawer) === present) return;
		const hadNested = this.#nestedPresent.size > 0;
		if (present) this.#nestedPresent.add(drawer);
		else this.#nestedPresent.delete(drawer);
		this.nestedPresenceCount = this.#nestedPresent.size;
		if (hadNested && this.#nestedPresent.size === 0 && this.#measurePopup) {
			const view = this.popup?.ownerDocument.defaultView;
			if (view) {
				view.cancelAnimationFrame(this.#popupMeasureFrame);
				this.#popupMeasureFrame = view.requestAnimationFrame(() => {
					this.#popupMeasureFrame = 0;
					this.#measurePopup?.();
				});
			} else {
				queueMicrotask(() => this.#measurePopup?.());
			}
		}
		this.parent?.setNestedPresence(drawer, present);
	}

	setNestedSwiping(drawer: object, swiping: boolean): void {
		if (this.#nestedSwipers.has(drawer) === swiping) return;
		if (swiping) this.#nestedSwipers.add(drawer);
		else this.#nestedSwipers.delete(drawer);
		this.nestedSwiping = this.#nestedSwipers.size > 0;
		this.parent?.setNestedSwiping(drawer, swiping);
	}

	setNestedHeight(drawer: object, height: number): void {
		if (height > 0) this.#nestedHeights.set(drawer, height);
		else this.#nestedHeights.delete(drawer);
		this.nestedFrontmostHeight = [...this.#nestedHeights.values()].at(-1) ?? 0;
		this.parent?.setNestedHeight(drawer, height);
	}

	setNestedProgress(drawer: object, progress: number): void {
		const resolved = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
		if (resolved > 0) this.#nestedProgresses.set(drawer, resolved);
		else this.#nestedProgresses.delete(drawer);
		this.nestedProgress = [...this.#nestedProgresses.values()].at(-1) ?? 0;
		this.popupSwipeProgress = this.nestedProgress;
		this.popup?.style.setProperty(CSS_VAR.swipeProgress, `${this.nestedProgress}`);
		this.parent?.setNestedProgress(drawer, resolved);
	}

	setNestedSwipeActive(active: boolean): void {
		this.parent?.setNestedSwiping(this, active);
	}

	setSwiping(value: boolean): void {
		if (this.swiping === value) return;
		if (value) {
			this.#transitionSnapshot = {
				popup: this.popup,
				popupTransition: this.popup?.style.transition ?? '',
				backdrop: this.backdrop,
				backdropTransition: this.backdrop?.style.transition ?? ''
			};
			if (this.popup) this.popup.style.transition = 'none';
			if (this.backdrop) this.backdrop.style.transition = 'none';
			this.#clearSwipeSettle();
		} else if (this.#transitionSnapshot) {
			const snapshot = this.#transitionSnapshot;
			if (snapshot.popup?.isConnected) snapshot.popup.style.transition = snapshot.popupTransition;
			if (snapshot.backdrop?.isConnected) {
				snapshot.backdrop.style.transition = snapshot.backdropTransition;
			}
			this.#transitionSnapshot = null;
		}
		if (!value) this.setNestedSwipeActive(false);
		this.swiping = value;
		this.popup?.toggleAttribute('data-swiping', value);
		this.backdrop?.toggleAttribute('data-swiping', value);
		this.#publishProviderVisualState();
	}

	/** `retainHeight` keeps the height variables published through zero-progress gesture frames. */
	applyDrag(deltaX: number, deltaY: number, progress: number, retainHeight = false): void {
		const resolvedProgress = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
		const height = resolvedProgress > 0 || retainHeight ? this.frontmostHeight : 0;
		this.popupSwipeMovementX = deltaX;
		this.popupSwipeMovementY = deltaY;
		this.backdropSwipeProgress = resolvedProgress;
		this.backdropHeight = height;
		this.popup?.style.setProperty(CSS_VAR.swipeMovementX, `${deltaX}px`);
		this.popup?.style.setProperty(CSS_VAR.swipeMovementY, `${deltaY}px`);
		if (this.backdrop) {
			this.backdrop.style.setProperty(CSS_VAR.swipeProgress, `${resolvedProgress}`);
			if (height > 0) {
				this.backdrop.style.setProperty(CSS_VAR.height, `${height}px`);
			} else {
				this.backdrop.style.removeProperty(CSS_VAR.height);
			}
		}
		this.#publishProviderVisualState();
		this.parent?.setNestedProgress(this, resolvedProgress);
	}

	resetDrag(): void {
		const restingProgress = this.open && !this.parent ? this.settledSwipeProgress : 0;
		// Publish the value before `swiping` invalidates declarative Backdrop props, then restore
		// transitions before applying the movement so a canceled drag animates back into place.
		this.backdropSwipeProgress = restingProgress;
		this.setSwiping(false);
		this.syncSnapPointOffset();
		this.applyDrag(0, 0, restingProgress);
	}

	syncRestingProgress(): void {
		if (this.swiping || this.swipeAreaActive) return;
		const ownProgress = this.open && !this.parent ? this.settledSwipeProgress : 0;
		const childProgress = this.open ? this.nestedProgress : 0;
		this.backdropSwipeProgress = ownProgress;
		this.backdropHeight = ownProgress > 0 ? this.frontmostHeight : 0;
		this.popupSwipeProgress = childProgress;
		this.popup?.style.setProperty(CSS_VAR.swipeProgress, `${childProgress}`);
		this.backdrop?.style.setProperty(CSS_VAR.swipeProgress, `${ownProgress}`);
		if (this.backdrop) {
			if (this.backdropHeight > 0) {
				this.backdrop.style.setProperty(CSS_VAR.height, `${this.backdropHeight}px`);
			} else {
				this.backdrop.style.removeProperty(CSS_VAR.height);
			}
		}
		this.#publishProviderVisualState();
		// A nested drawer only reports progress while it is actively moving. Its resting
		// snap position must not visually indent the parent drawer.
		this.parent?.setNestedProgress(this, 0);
	}

	setSwipeRelease(
		velocity: number,
		displacement: number,
		size: number,
		baseOffset = this.activeSnapPointOffset,
		strength?: number,
		easing?: string
	): void {
		this.#cancelSwipeSettleCleanup();
		if (strength === undefined) {
			const currentOffset = Math.min(size, Math.max(0, (baseOffset ?? 0) + displacement));
			const remainingDistance = Math.max(0, size - currentOffset);
			if (size <= 0 || velocity <= 0.2 || remainingDistance <= 0) {
				strength = 1;
			} else {
				const duration = Math.min(360, Math.max(80, remainingDistance / Math.min(4, velocity)));
				strength = 0.1 + ((duration - 80) / 280) * 0.9;
			}
		}
		this.#setSwipeSettle(strength, easing);
		this.swipeDismissed = true;
		this.popup?.setAttribute('data-swipe-dismiss', '');
		this.backdrop?.setAttribute('data-swipe-dismiss', '');
		this.#publishProviderVisualState();
	}

	settleDrag(strength: number, easing?: string): void {
		this.#clearSwipeSettle();
		this.#setSwipeSettle(strength, easing);
		this.resetDrag();

		let completed = false;
		const cleanup = waitForAnimations(this.popup, () => {
			completed = true;
			if (this.open && !this.swiping && !this.swipeDismissed) this.#clearSwipeSettle();
		});
		if (!completed) this.#swipeSettleCleanup = cleanup;
	}

	clearSwipeRelease(): void {
		this.#cancelSwipeSettleCleanup();
		this.swipeDismissed = false;
		this.popup?.removeAttribute('data-swipe-dismiss');
		this.backdrop?.removeAttribute('data-swipe-dismiss');
		this.#setSwipeSettle(1);
		this.#publishProviderVisualState();
	}

	#setSwipeSettle(value: number, easing = ''): void {
		const resolved = Number.isFinite(value) ? Math.min(1, Math.max(0.1, value)) : 1;
		if (resolved === this.swipeStrength && easing === this.swipeEasing) return;
		this.swipeStrength = resolved;
		this.swipeEasing = easing;
		this.popup?.style.setProperty(CSS_VAR.swipeStrength, `${this.swipeStrength}`);
		this.backdrop?.style.setProperty(CSS_VAR.swipeStrength, `${this.swipeStrength}`);
		if (easing) {
			this.popup?.style.setProperty(CSS_VAR.swipeEasing, easing);
			this.backdrop?.style.setProperty(CSS_VAR.swipeEasing, easing);
		} else {
			this.popup?.style.removeProperty(CSS_VAR.swipeEasing);
			this.backdrop?.style.removeProperty(CSS_VAR.swipeEasing);
		}
	}

	#cancelSwipeSettleCleanup(): void {
		this.#swipeSettleCleanup?.();
		this.#swipeSettleCleanup = null;
	}

	#clearSwipeSettle(): void {
		this.#cancelSwipeSettleCleanup();
		if (!this.swipeDismissed) this.#setSwipeSettle(1);
		this.#publishProviderVisualState();
	}

	#publishProviderVisualState(): void {
		// Nested roots share their parent's provider by default. Only a deliberately nested
		// provider scope should drive a separate page-level Indent.
		if (this.parent && this.provider === this.parent.provider) return;
		this.provider?.visualState.set(this, {
			swipeProgress: this.backdropSwipeProgress,
			frontmostHeight: this.backdropHeight,
			swiping: this.swiping,
			swipeStrength: this.swipeStrength,
			swipeEasing: this.swipeEasing,
			swipeBehavior: this.swipeBehavior
		});
	}

	attachPopup = (element: HTMLElement): (() => void) => {
		this.ownerDocument = element.ownerDocument;
		this.popup = element;
		registerSwipeProperties(element);
		const measure = () => {
			if (!element.isConnected) return;
			const height = element.offsetHeight;
			// Nested CSS commonly sizes the parent to its child. Preserve the parent's intrinsic
			// measurement until every child has closed instead of learning that temporary size.
			if (this.nestedPresenceCount > 0 && this.popupHeight > 0) return;
			this.popupHeight = height;
		};
		this.#measurePopup = measure;
		measure();
		// A replaced popup element may have interrupted a pending visual-count frame.
		this.#syncNestedVisualCount();
		const Observer = element.ownerDocument.defaultView?.ResizeObserver;
		const observer = Observer ? new Observer(measure) : null;
		observer?.observe(element);
		return () => {
			observer?.disconnect();
			if (this.popup === element) {
				const view = element.ownerDocument.defaultView;
				view?.cancelAnimationFrame(this.#popupMeasureFrame);
				view?.cancelAnimationFrame(this.#nestedVisualFrame);
				this.#popupMeasureFrame = 0;
				this.#nestedVisualFrame = 0;
				this.#measurePopup = null;
				this.popup = null;
				this.popupHeight = 0;
				this.#syncNestedVisualCount();
			}
		};
	};

	destroy(): void {
		this.#cancelSwipeSettleCleanup();
		this.#destroyed = true;
	}

	attachBackdrop = (element: HTMLElement): (() => void) => {
		this.backdrop = element;
		this.syncRestingProgress();
		return () => {
			if (this.backdrop === element) this.backdrop = null;
		};
	};

	attachViewport = (element: HTMLElement): (() => void) => {
		this.ownerDocument = element.ownerDocument;
		this.viewport = element;
		const measure = () => {
			this.viewportHeight =
				element.offsetHeight || element.ownerDocument.documentElement.clientHeight;
			const size = Number.parseFloat(
				element.ownerDocument.defaultView?.getComputedStyle(element.ownerDocument.documentElement)
					.fontSize ?? ''
			);
			if (Number.isFinite(size)) this.rootFontSize = size;
		};
		measure();
		const Observer = element.ownerDocument.defaultView?.ResizeObserver;
		const observer = Observer ? new Observer(measure) : null;
		observer?.observe(element);
		return () => {
			observer?.disconnect();
			if (this.viewport === element) this.viewport = null;
		};
	};
}
