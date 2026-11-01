import { getScrapeSettingsFresh } from "../scrape-settings";

/**
 * Ukuran batch / konkurensi / batas incremental dibaca dari
 * `getScrapeSettingsFresh()` (DB `app_settings` dengan fallback ENV).
 * Konstanta *_FALLBACK hanya dipakai bila DB tidak terjangkau — nilainya
 * identik dengan default ENV lama (20/3/5 + clamp yang sama).
 */

const FALLBACK_BATCH_SIZE = 20;
const FALLBACK_BATCH_CONCURRENCY = 3;
const FALLBACK_INCREMENTAL_MAX_PAGES = 5;

export async function getScrapeBatchSize(): Promise<number> {
	try {
		return (await getScrapeSettingsFresh()).values.batchSize;
	} catch {
		return FALLBACK_BATCH_SIZE;
	}
}

export async function getScrapeBatchConcurrency(): Promise<number> {
	try {
		return (await getScrapeSettingsFresh()).values.batchConcurrency;
	} catch {
		return FALLBACK_BATCH_CONCURRENCY;
	}
}

export async function getScrapeIncrementalMaxPages(): Promise<number> {
	try {
		return (await getScrapeSettingsFresh()).values.incrementalMaxPages;
	} catch {
		return FALLBACK_INCREMENTAL_MAX_PAGES;
	}
}

export function* batches<T>(items: readonly T[], size = FALLBACK_BATCH_SIZE) {
	for (let offset = 0; offset < items.length; offset += size)
		yield items.slice(offset, offset + size);
}

export async function withConcurrency<T>(
	items: readonly T[],
	concurrency: number,
	action: (item: T, index: number) => Promise<void>,
) {
	let nextIndex = 0;
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, async () => {
			while (nextIndex < items.length) {
				const index = nextIndex;
				nextIndex += 1;
				const item = items[index];
				if (item !== undefined) await action(item, index);
			}
		}),
	);
}
