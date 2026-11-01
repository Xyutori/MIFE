import { Elysia, t } from "elysia";
import { startChapterImageRepair } from "../jobs/images";
import { getObjectBytes } from "../storage/s3";

const IMAGE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,500}$/;

function contentTypeFor(key: string) {
	if (key.endsWith(".webp")) return "image/webp";
	if (key.endsWith(".png")) return "image/png";
	if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
	if (key.endsWith(".gif")) return "image/gif";
	if (key.endsWith(".avif")) return "image/avif";
	if (key.endsWith(".svg")) return "image/svg+xml";
	return "application/octet-stream";
}

export const imagesRoutes = new Elysia({ name: "images-routes" })
	.get("/api/admin/images/object/*", async ({ params, set }) => {
		const key = (params as { "*": string })["*"];
		if (!key || !IMAGE_KEY_PATTERN.test(key) || key.includes("..")) {
			set.status = 400;
			return { error: "Object key tidak valid" };
		}
		try {
			const bytes = await getObjectBytes(key);
			return new Response(bytes, {
				headers: {
					"content-type": contentTypeFor(key),
					"cache-control": "private, max-age=3600",
				},
			});
		} catch {
			set.status = 404;
			return { error: "Object tidak ditemukan di storage" };
		}
	})
	.post(
		"/api/admin/images/repair",
		async ({ body }) => {
			const run = await startChapterImageRepair(
				body.chapterId,
				body.workspace ?? "comic",
			);
			return { run };
		},
		{
			body: t.Object({
				chapterId: t.String(),
				workspace: t.Optional(t.String()),
			}),
		},
	);
