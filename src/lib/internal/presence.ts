/**
 * Runs `callback` after the element's current CSS animations and transitions settle.
 * The returned cleanup and `signal` are interchangeable ways to cancel the pending work.
 */
export function waitForAnimations(
	element: HTMLElement | null,
	callback: () => void,
	signal: AbortSignal | null = null
): () => void {
	const ownerWindow = element?.ownerDocument.defaultView ?? null;
	let active = !signal?.aborted;
	let frame: number | undefined;

	function cleanup(): void {
		if (!active) return;
		active = false;
		if (frame !== undefined) ownerWindow?.cancelAnimationFrame(frame);
		frame = undefined;
		signal?.removeEventListener('abort', cleanup);
	}

	function finish(): void {
		if (!active) return;
		active = false;
		frame = undefined;
		signal?.removeEventListener('abort', cleanup);
		callback();
	}

	function animations(): Animation[] | null {
		if (!element || typeof element.getAnimations !== 'function') return null;
		try {
			return element.getAnimations().filter((animation) => {
				// A paused, idle, or infinite consumer animation has no completion edge. It must not
				// retain the drawer, focus trap, and scroll lock forever during an exit.
				if (
					animation.playState === 'paused' ||
					animation.playState === 'idle' ||
					animation.playbackRate === 0
				) {
					return false;
				}
				const endTime = animation.effect?.getComputedTiming().endTime;
				return typeof endTime !== 'number' || Number.isFinite(endTime);
			});
		} catch {
			// A detached or cross-document element must not strand presence state.
			return null;
		}
	}

	function wait(): void {
		if (!active) return;
		const current = animations();
		if (!current?.length) {
			finish();
			return;
		}

		Promise.all(current.map((animation) => animation.finished)).then(finish, () => {
			if (!active) return;
			const replacements = animations()?.filter(
				(animation) =>
					animation.pending ||
					(animation.playState !== 'finished' && animation.playState !== 'idle')
			);

			// Canceled CSS transitions can be replaced in the same style update. Re-read the
			// element instead of treating the rejected `finished` promise as completion.
			if (replacements?.length) wait();
			else finish();
		});
	}

	if (!active) return cleanup;
	signal?.addEventListener('abort', cleanup, { once: true });

	if (
		!element ||
		typeof element.getAnimations !== 'function' ||
		!ownerWindow?.requestAnimationFrame
	) {
		finish();
		return cleanup;
	}

	// Style changes made in the current task are not guaranteed to expose their animations yet.
	frame = ownerWindow.requestAnimationFrame(() => {
		frame = undefined;
		wait();
	});
	return cleanup;
}
