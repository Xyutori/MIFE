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
		server: { port },
		preview: { port },
	};
});
