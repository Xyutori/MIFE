/**
 * Jadwal scrape otomatis multi-slot per hari ("07:00", "11:00", …).
 *
 * Scheduler tick tiap 30 detik menghitung slot terakhir yang sudah lewat
 * hari ini (`latestDueSlot`) lalu menjalankan scrape sekali per slot per
 * sumber. Penanda monoton per sumber (`last_auto_scrape_date` +
 * `last_auto_scrape_slot`) dibandingkan leksikografis sebagai
 * "YYYY-MM-DD HH:MM" — format zero-padded sehingga perbandingan string
 * setara perbandingan kronologis tanpa hitung offset zona waktu.
 */

export interface DueSlot {
	/** Tanggal zona scrape "YYYY-MM-DD". */
	today: string;
	/** Slot "HH:MM" yang sudah lewat hari ini. */
	time: string;
}

export function todayInZone(timeZone: string, at = new Date()): string {
	return new Intl.DateTimeFormat("sv-SE", { timeZone }).format(at);
}

export function minutesInZone(timeZone: string, at = new Date()): number {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(at);
	const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
	const minute = Number(
		parts.find((part) => part.type === "minute")?.value ?? 0,
	);
	return hour * 60 + minute;
}

function slotMinutes(slot: string): number | null {
	const match = /^(\d{2}):(\d{2})$/.exec(slot.trim());
	if (!match) return null;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (
		!Number.isInteger(hour) ||
		!Number.isInteger(minute) ||
		hour < 0 ||
		hour > 23 ||
		minute < 0 ||
		minute > 59
	)
		return null;
	return hour * 60 + minute;
}

/** Slot terakhir hari ini yang sudah lewat (null bila belum ada). */
export function latestDueSlot(
	timeZone: string,
	dailyTimes: string[],
	at = new Date(),
): DueSlot | null {
	const today = todayInZone(timeZone, at);
	const current = minutesInZone(timeZone, at);
	let latest: string | null = null;
	let latestMinutes = -1;
	for (const slot of dailyTimes) {
		const minutes = slotMinutes(slot);
		if (minutes === null || minutes > current || minutes <= latestMinutes)
			continue;
		latestMinutes = minutes;
		latest = slot.trim();
	}
	if (!latest) return null;
	return { today, time: latest };
}

export interface SlotMarker {
	lastAutoScrapeDate?: string | null;
	lastAutoScrapeSlot?: string | null;
}

/**
 * True bila sumber belum menjalankan slot ini hari ini.
 * Baris legacy (tanggal terisi, slot kosong) dianggap sudah jalan bila
 * tanggalnya hari ini — blip satu hari pasca-deploy, sembuh sendiri besok.
 */
export function isSourceDueForSlot(
	state: SlotMarker | undefined,
	slot: DueSlot,
): boolean {
	if (!state) return true;
	const date = state.lastAutoScrapeDate ?? null;
	const ran = state.lastAutoScrapeSlot ?? null;
	if (!date) return true;
	if (date < slot.today) return true;
	if (date > slot.today) return false;
	if (!ran) return false;
	return ran < slot.time;
}
