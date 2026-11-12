/**
 * Small Tauri runtime helpers.
 *
 * Kept dependency-free (no `@tauri-apps/api` import) so web/PWA builds never
 * pay for native bindings. UI lanes can use `isTauri()` for back-handler and
 * other native-only branches later.
 */

/** True when running inside the Tauri webview (desktop or Android). */
export function isTauri(): boolean {
	if (typeof window === "undefined") return false;
	return "__TAURI_INTERNALS__" in window;
}

/** True when running on Android (Tauri mobile webview user-agent check). */
export function isAndroid(): boolean {
	if (typeof navigator === "undefined") return false;
	return /android/i.test(navigator.userAgent);
}

/**
 * Re-export guard: import native plugin APIs lazily behind `isTauri()` to
 * avoid breaking plain web/PWA builds, e.g.:
 *
 * ```ts
 * import { isTauri } from "$lib/tauri";
 * if (isTauri()) {
 *   const { confirm } = await import("@tauri-apps/plugin-dialog");
 *   await confirm("Hapus unduhan?");
 * }
 * ```
 */
export const tauriGuard = { isTauri, isAndroid };
