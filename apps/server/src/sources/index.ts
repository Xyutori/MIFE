import { komikcastAdapter } from "./komikcast";
import { shinigamiAdapter } from "./shinigami";
import { superkomikAdapter } from "./superkomik";
import type { ComicSourceAdapter } from "./types";

const adapters: Record<string, ComicSourceAdapter> = {
	komikcast: komikcastAdapter,
	shinigami: shinigamiAdapter,
	superkomik: superkomikAdapter,
};

export function adapterFor(key: string) {
	const adapter = adapters[key];
	if (!adapter) throw new Error(`No source adapter is registered for ${key}`);
	return adapter;
}

export type {
	ChapterRecord,
	ComicSourceAdapter,
	PageResult,
	SeriesRecord,
	SourceConfig,
} from "./types";
