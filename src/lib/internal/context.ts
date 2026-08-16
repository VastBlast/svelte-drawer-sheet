import { createContext } from 'svelte';
import type { DrawerProviderState } from './provider-state.svelte.js';
import type { DrawerRootState } from './root-state.svelte.js';

const [getDrawerRoot, setDrawerRoot] = createContext<DrawerRootState<unknown>>();
const [getDrawerProvider, setDrawerProvider] = createContext<DrawerProviderState>();
const [getDrawerPortal, setDrawerPortal] = createContext<{ readonly keepMounted: boolean }>();

function optional<T>(get: () => T): T | null {
	try {
		return get();
	} catch {
		return null;
	}
}

export function useDrawerRoot<Payload = unknown>(): DrawerRootState<Payload> {
	return getDrawerRoot() as DrawerRootState<Payload>;
}

export function useOptionalDrawerRoot(): DrawerRootState<unknown> | null {
	return optional(getDrawerRoot);
}

export function provideDrawerRoot<Payload>(state: DrawerRootState<Payload>): void {
	setDrawerRoot(state as DrawerRootState<unknown>);
}

export function useOptionalDrawerProvider(): DrawerProviderState | null {
	return optional(getDrawerProvider);
}

export function provideDrawerProvider(state: DrawerProviderState): void {
	setDrawerProvider(state);
}

export function useOptionalDrawerPortal(): { readonly keepMounted: boolean } | null {
	return optional(getDrawerPortal);
}

export function provideDrawerPortal(context: { readonly keepMounted: boolean }): void {
	setDrawerPortal(context);
}
