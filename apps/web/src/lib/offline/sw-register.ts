/**
 * Registrasi Service Worker (generateSW dari vite-plugin-pwa).
 * Dipanggil sekali dari root layout saat client-side mount.
 * Aman dipanggil berulang; no-op saat SSR / SW tidak didukung.
 */
let registered = false;

export async function registerServiceWorker(): Promise<boolean> {
	if (registered) return true;
	if (typeof window === "undefined") return false;
	if (!("serviceWorker" in navigator)) return false;
	// Hanya aktif di production build (SW + precache ada di build).
	if (!import.meta.env.PROD) return false;

	try {
		await navigator.serviceWorker.register("/sw.js", { scope: "/" });
		registered = true;
		return true;
	} catch {
		return false;
	}
}
