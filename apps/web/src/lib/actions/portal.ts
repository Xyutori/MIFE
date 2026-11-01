/**
 * Portal overlay langsung ke <body>.
 *
 * Menjamin overlay (drawer/sheet) tidak pernah terjebak stacking context,
 * filter, transform, atau overflow milik leluhur halaman — penyebab klasik
 * konten halaman (badge UP, thumbnail, dsb.) tampil DI ATAS drawer padahal
 * z-index drawer jauh lebih besar.
 *
 * Aman untuk SSR (action hanya jalan di client) dan cleanup otomatis saat
 * komponen di-unmount. Event listener Svelte ikut pindah bersama node.
 */
export function portal(node: HTMLElement) {
	if (typeof document !== "undefined" && node.parentNode !== document.body) {
		document.body.appendChild(node);
	}
	return {
		destroy() {
			node.remove();
		},
	};
}
