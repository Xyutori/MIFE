import { sql } from "drizzle-orm";
import {
	check,
	index,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

/**
 * Dedup ledger untuk penghitung view lokal (lane VISITOR-SERVER).
 *
 * Satu baris = satu visitor melihat satu konten dalam satu hari kalender.
 * `visitorKey` berbentuk `u:{userId}` untuk user login atau `a:{12 hex}`
 * (HMAC-SHA256 harian atas ip+UA) untuk anonim — lihat
 * `apps/server/src/visits/visitor.ts`.
 *
 * `expiresAt` ≈ createdAt + 24 jam; scheduler menghapus baris kedaluwarsa
 * sekali sehari (`apps/server/src/jobs/scheduler.ts`). `contentType`
 * dibatasi CHECK agar hanya 4 kind endpoint `POST /api/v1/views` yang sah.
 */
export const contentVisits = pgTable(
	"content_visits",
	{
		contentType: text("content_type").notNull(),
		contentId: text("content_id").notNull(),
		visitorKey: text("visitor_key").notNull(),
		expiresAt: timestamp("expires_at", {
			withTimezone: true,
			mode: "date",
		}).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.contentType, table.contentId, table.visitorKey],
			name: "content_visits_pkey",
		}),
		index("content_visits_expires_at_idx").on(table.expiresAt),
		check(
			"content_visits_type_check",
			sql`${table.contentType} in ('comic', 'chapter', 'anime', 'episode')`,
		),
	],
);
