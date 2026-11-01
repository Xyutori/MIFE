import { scrapeRuns } from "@SyMi/db/schema/index";
import { and, asc, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "../services";
import { resumeAnimeScrape } from "./anime";
import { resumeImageRun } from "./images";
import { resumeMetadataRun } from "./metadata";

// Tidak ada lagi status "paused" yang bisa di-recovery: jeda oleh pengguna
// ("Dijeda oleh pengguna", ditulis pauseRun di routes/scrapes.ts) TIDAK
// pernah dilanjutkan otomatis oleh recovery — resume hanya via API.
// Konstanta LEGACY_RESTART_PAUSE_STEP yang duplikat di worker-lease.ts
// dihapus bersama cabang mati ini (bug #4).
const ACTIVE_STATUSES = ["queued", "running"] as const;

function recoverableStatus(run: typeof scrapeRuns.$inferSelect) {
	return run.status === "queued" || run.status === "running";
}

export async function launchRecoveredRun(run: typeof scrapeRuns.$inferSelect) {
	if (run.workspaceId === "anime") {
		await resumeAnimeScrape(run.id);
		return;
	}
	if (
		(run.workspaceId === "comic" || run.workspaceId === "superkomik") &&
		run.kind === "metadata"
	) {
		await resumeMetadataRun(run.id);
		return;
	}
	if (
		(run.workspaceId === "comic" || run.workspaceId === "superkomik") &&
		run.kind === "images"
	) {
		await resumeImageRun(run.id, {
			workerMode: "recovery",
		});
		return;
	}
	throw new Error(`Jenis worker tidak dikenal: ${run.workspaceId}/${run.kind}`);
}

export async function resumeInterruptedWorkers() {
	const now = new Date();
	const candidates = await db
		.select()
		.from(scrapeRuns)
		.where(
			and(
				inArray(scrapeRuns.workspaceId, ["comic", "superkomik", "anime"]),
				// Hanya run aktif yang tidak dipegang worker hidup yang di-recovery.
				// Run "paused" (jeda pengguna) sengaja dikecualikan: tidak ada
				// penulis status restart-legacy, dan jeda pengguna tidak boleh
				// dilanjutkan otomatis.
				inArray(scrapeRuns.status, ACTIVE_STATUSES),
				or(
					isNull(scrapeRuns.workerToken),
					isNull(scrapeRuns.workerLeaseExpiresAt),
					lte(scrapeRuns.workerLeaseExpiresAt, now),
				),
			),
		)
		.orderBy(asc(scrapeRuns.createdAt));
	let resumedCount = 0;

	for (const run of candidates) {
		if (!recoverableStatus(run)) continue;
		try {
			await launchRecoveredRun(run);
			resumedCount += 1;
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "Kesalahan pemulihan worker tidak diketahui";
			console.warn("Worker recovery could not be scheduled", {
				runId: run.id,
				error: message,
			});
		}
	}

	return resumedCount;
}
