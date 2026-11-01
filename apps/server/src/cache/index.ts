// Cache in-memory sebagai default (fase 1 tanpa Redis).
// Interface `Cache` dipertahankan agar driver Redis bisa dipasang lagi nanti
// tanpa mengubah call site. Helper `cacheRemember` / `invalidateCache` /
// `cacheConfiguration` mengikuti signature pemakaian XyMI (`src/cache/index.ts`).

export interface Cache {
	get(key: string): Promise<string | null>;
	set(key: string, value: string, ttlSeconds?: number): Promise<void>;
	del(key: string): Promise<void>;
}

type CacheEntry = { value: string; expiresAt: number };

const MAX_MEMORY_ENTRIES = 1_000;
const DEFAULT_TTL_SECONDS = 120;

export class MemoryCache implements Cache {
	private entries = new Map<string, CacheEntry>();

	async get(key: string) {
		const entry = this.entries.get(key);
		if (!entry) return null;
		if (entry.expiresAt <= Date.now()) {
			this.entries.delete(key);
			return null;
		}
		// Refresh LRU: pindahkan ke akhir.
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.value;
	}

	async set(key: string, value: string, ttlSeconds = DEFAULT_TTL_SECONDS) {
		const ttl = Math.max(1, Math.floor(ttlSeconds));
		this.entries.delete(key);
		this.entries.set(key, { value, expiresAt: Date.now() + ttl * 1_000 });
		while (this.entries.size > MAX_MEMORY_ENTRIES) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.entries.delete(oldest);
		}
	}

	async del(key: string) {
		this.entries.delete(key);
	}

	keys() {
		return this.entries.keys();
	}
}

export const cache: Cache = new MemoryCache();

const pendingLoads = new Map<string, Promise<unknown>>();
const cacheStats = { hits: 0, misses: 0, coalescedLoads: 0, invalidations: 0 };

export async function cacheRemember<T>(
	key: string,
	load: () => Promise<T>,
	ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<T> {
	const local = await cache.get(key);
	if (local !== null) {
		try {
			cacheStats.hits += 1;
			return JSON.parse(local) as T;
		} catch {
			await cache.del(key);
		}
	}
	const pending = pendingLoads.get(key);
	if (pending) {
		cacheStats.coalescedLoads += 1;
		return pending as Promise<T>;
	}
	cacheStats.misses += 1;
	const ttl = Math.max(1, Math.floor(ttlSeconds));
	const task = (async () => {
		const value = await load();
		await cache.set(key, JSON.stringify(value), ttl);
		return value;
	})();
	pendingLoads.set(key, task);
	try {
		return await task;
	} finally {
		if (pendingLoads.get(key) === task) pendingLoads.delete(key);
	}
}

export async function invalidateCache(prefix: string) {
	cacheStats.invalidations += 1;
	if (cache instanceof MemoryCache) {
		for (const key of [...cache.keys()])
			if (key.startsWith(prefix)) await cache.del(key);
	}
	for (const key of [...pendingLoads.keys()])
		if (key.startsWith(prefix)) pendingLoads.delete(key);
}

export function cacheConfiguration() {
	return {
		driver: "memory" as const,
		fallback: "memory" as const,
		ttlSeconds: DEFAULT_TTL_SECONDS,
		stats: { ...cacheStats, pendingLoads: pendingLoads.size },
	} as const;
}
