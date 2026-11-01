export type MetadataProgressOutcome = "completed" | "failed";
export type MetadataScrapeMode = "full" | "incremental";

export type MetadataProgressLedger = {
	runId: string;
	total: number | null;
	totalByCategory?: Record<string, number>;
	accounted: Record<string, MetadataProgressOutcome>;
	baseCompleted?: number;
	baseFailed?: number;
	legacyUnaccountedPage?: string;
};

export function createMetadataProgressLedger(
	runId: string,
	total: number | null = null,
): MetadataProgressLedger {
	return { runId, total, totalByCategory: {}, accounted: {} };
}

export function metadataDetectionMode(
	mode: MetadataScrapeMode,
	resuming: boolean,
): MetadataScrapeMode {
	return mode === "full" ? "full" : resuming ? "incremental" : mode;
}

export function metadataCandidates<T>(options: {
	mode: MetadataScrapeMode;
	pageRecords: T[];
	changedRecords: T[];
	pendingRecords: T[];
	externalId: (record: T) => string;
}) {
	const { mode, pageRecords, changedRecords, pendingRecords, externalId } =
		options;
	const records = [
		...pendingRecords,
		...(mode === "full" ? pageRecords : changedRecords),
	];
	const byId = new Map(
		records
			.filter((record) => externalId(record))
			.map((record) => [externalId(record), record]),
	);
	return mode === "full"
		? [...byId.values(), ...pageRecords.filter((record) => !externalId(record))]
		: [...byId.values()];
}

export function setMetadataProgressTotal(
	ledger: MetadataProgressLedger,
	categoryKey: string,
	total: number,
) {
	ledger.totalByCategory ??= {};
	ledger.totalByCategory[categoryKey] = total;
	ledger.total = Object.values(ledger.totalByCategory).reduce(
		(sum, value) => sum + value,
		0,
	);
}

export function metadataProgressKey(
	categoryKey: string,
	page: number,
	externalId: string,
	index: number,
) {
	return externalId
		? `${categoryKey}:id:${externalId}`
		: `${categoryKey}:page:${page}:index:${index}`;
}

export function accountMetadataProgress(
	ledger: MetadataProgressLedger,
	key: string,
	outcome: MetadataProgressOutcome,
) {
	ledger.accounted[key] = outcome;
	return metadataProgressCounts(ledger);
}

export function metadataProgressCounts(ledger: MetadataProgressLedger) {
	let completed = ledger.baseCompleted ?? 0;
	let failed = ledger.baseFailed ?? 0;
	for (const outcome of Object.values(ledger.accounted)) {
		completed += 1;
		if (outcome === "failed") failed += 1;
	}
	return {
		total:
			ledger.totalByCategory && Object.keys(ledger.totalByCategory).length > 0
				? Object.values(ledger.totalByCategory).reduce(
						(sum, value) => sum + value,
						0,
					)
				: (ledger.total ?? 0),
		completed,
		failed,
	};
}
