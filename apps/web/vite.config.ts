import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { varlockVitePlugin } from "@varlock/vite-integration";
import evlog from "evlog/vite";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	const port = Number(env.PORT ?? process.env.PORT ?? 4001);

	return {
		plugins: [
			varlockVitePlugin({ ssrInjectMode: "auto-load" }),
			tailwindcss(),
			sveltekit({
				preprocess: vitePreprocess(),
				adapter: adapter({
					pages: "build",
					assets: "build",
					fallback: "index.html",
				}),
			}),
			evlog({ service: "MIFE-web" }),
			VitePWA({
				registerType: "autoUpdate",
				manifest: {
					name: "MIFE",
					short_name: "MIFE",
					description: "Baca komik online dan offline.",
					start_url: "/",
					scope: "/",
					display: "standalone",
					orientation: "portrait",
					background_color: "#0b0b0f",
					theme_color: "#0b0b0f",
					icons: [
						{
							src: "/logo/mife-mark-192.png",
							sizes: "192x192",
							type: "image/png",
							purpose: "any",
						},
						{
							src: "/logo/mife-mark-512.png",
							sizes: "512x512",
							type: "image/png",
							purpose: "any",
						},
						{
							src: "/logo/mife-mark-512.png",
							sizes: "512x512",
							type: "image/png",
							purpose: "maskable",
						},
					],
				},
				workbox: {
					// Precache app-shell: JS/CSS/fonts hasil build (+ aset statis).
					globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2,ttf}"],
				},
			}),
		],
		server: {
			port,
			// Listen on all interfaces so a physical Android device/emulator can
			// reach the dev server over LAN. Keep the port from env (PORT).
			// To point Tauri at this machine from a device, either set
			// TAURI_DEV_HOST=<lan-ip> before `tauri android dev`, or run
			// `tauri android dev --host` so the CLI picks the LAN IP as devUrl.
			host: "0.0.0.0",
			hmr: {
				// HMR client defaults to window.location.hostname, which works
				// once devUrl resolves to this host. Override via env when needed,
				// e.g. HMR_HOST=<lan-ip> vite dev --hmr-host.
				host: env.HMR_HOST ?? process.env.HMR_HOST ?? undefined,
				clientPort: port,
			},
		},
		preview: { port },
	};
});
