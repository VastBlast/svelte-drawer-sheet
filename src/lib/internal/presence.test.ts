import { describe, expect, it, vi } from 'vitest';
import { waitForAnimations } from './presence.js';

interface ControlledAnimation {
	readonly animation: Animation;
	cancel(): void;
	finish(): void;
}

function controlledAnimation(): ControlledAnimation {
	let resolve!: () => void;
	let reject!: () => void;
	let playState: AnimationPlayState = 'running';
	const finished = new Promise<void>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	const animation = {
		finished,
		pending: false,
		playbackRate: 1,
		effect: { getComputedTiming: () => ({ endTime: 100 }) },
		get playState() {
			return playState;
		}
	} as unknown as Animation;

	return {
		animation,
		cancel() {
			playState = 'idle';
			reject();
		},
		finish() {
			playState = 'finished';
			resolve();
		}
	};
}

function environment(getAnimations?: () => Animation[]) {
	let frame: FrameRequestCallback | undefined;
	const ownerWindow = {
		requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
			frame = callback;
			return 41;
		}),
		cancelAnimationFrame: vi.fn()
	} as unknown as Window;
	const element = {
		ownerDocument: { defaultView: ownerWindow },
		...(getAnimations ? { getAnimations } : {})
	} as unknown as HTMLElement;

	return {
		element,
		ownerWindow,
		runFrame() {
			const callback = frame;
			frame = undefined;
			callback?.(0);
		}
	};
}

describe('waitForAnimations', () => {
	it('uses the owner window and completes an element without animations after one frame', () => {
		const callback = vi.fn();
		const fixture = environment(() => []);

		waitForAnimations(fixture.element, callback);

		expect(fixture.ownerWindow.requestAnimationFrame).toHaveBeenCalledOnce();
		expect(callback).not.toHaveBeenCalled();
		fixture.runFrame();
		expect(callback).toHaveBeenCalledOnce();
	});

	it('waits for an animation that replaces a canceled transition', async () => {
		const initial = controlledAnimation();
		const replacement = controlledAnimation();
		const callback = vi.fn();
		let animations = [initial.animation];
		const fixture = environment(() => animations);

		waitForAnimations(fixture.element, callback);
		fixture.runFrame();
		animations = [replacement.animation];
		initial.cancel();
		await Promise.resolve();
		expect(callback).not.toHaveBeenCalled();

		animations = [];
		replacement.finish();
		await Promise.resolve();
		expect(callback).toHaveBeenCalledOnce();
	});

	it('cancels both a scheduled frame and animation completion without invoking the callback', async () => {
		const animation = controlledAnimation();
		const callbackBeforeFrame = vi.fn();
		const beforeFrame = environment(() => [animation.animation]);
		const abort = new AbortController();

		waitForAnimations(beforeFrame.element, callbackBeforeFrame, abort.signal);
		abort.abort();
		expect(beforeFrame.ownerWindow.cancelAnimationFrame).toHaveBeenCalledWith(41);
		beforeFrame.runFrame();
		expect(callbackBeforeFrame).not.toHaveBeenCalled();

		const callbackDuringAnimation = vi.fn();
		const duringAnimation = environment(() => [animation.animation]);
		const cleanup = waitForAnimations(duringAnimation.element, callbackDuringAnimation);
		duringAnimation.runFrame();
		cleanup();
		animation.finish();
		await Promise.resolve();
		expect(callbackDuringAnimation).not.toHaveBeenCalled();
	});

	it('does not retain presence for animations that cannot finish', () => {
		const never = new Promise<void>(() => {});
		const infinite = {
			finished: never,
			pending: false,
			playState: 'running',
			playbackRate: 1,
			effect: { getComputedTiming: () => ({ endTime: Infinity }) }
		} as unknown as Animation;
		const paused = {
			finished: never,
			pending: false,
			playState: 'paused',
			playbackRate: 1,
			effect: { getComputedTiming: () => ({ endTime: 100 }) }
		} as unknown as Animation;
		const callback = vi.fn();
		const fixture = environment(() => [infinite, paused]);

		waitForAnimations(fixture.element, callback);
		fixture.runFrame();

		expect(callback).toHaveBeenCalledOnce();
	});

	it('completes synchronously when browser animation APIs are unavailable', () => {
		const callback = vi.fn();
		const fixture = environment();

		waitForAnimations(fixture.element, callback);

		expect(callback).toHaveBeenCalledOnce();
		expect(fixture.ownerWindow.requestAnimationFrame).not.toHaveBeenCalled();
	});
});
