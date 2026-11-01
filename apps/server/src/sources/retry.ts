import type { SourceConfig } from "./types";

export function maxRetriesFor(
	source: Pick<SourceConfig, "maxRetries" | "runId">,
) {
	return source.maxRetries ?? (source.runId ? 5 : 2);
}

export function hasRetryBudget(retriesUsed: number, maxRetries: number) {
	return retriesUsed < maxRetries;
}
