const namedEntities: Record<string, string> = {
	amp: "&",
	apos: "'",
	gt: ">",
	lt: "<",
	nbsp: " ",
	quot: '"',
};

const invalidNames = new Set([
	"-",
	"—",
	"n/a",
	"na",
	"unknown",
	"not available",
]);

export function decodeEntities(value: string | null | undefined): string {
	if (!value) return "";
	let result = value;
	for (let pass = 0; pass < 2; pass += 1) {
		result = result.replace(
			/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi,
			(entity, key: string) => {
				if (key[0] === "#") {
					const codePoint =
						key[1]?.toLowerCase() === "x"
							? Number.parseInt(key.slice(2), 16)
							: Number.parseInt(key.slice(1), 10);
					return Number.isInteger(codePoint) &&
						codePoint > 0 &&
						codePoint <= 0x10ffff
						? String.fromCodePoint(codePoint)
						: entity;
				}
				return namedEntities[key.toLowerCase()] ?? entity;
			},
		);
	}
	return result;
}

export function cleanNames(values: string[]): string[] {
	return values
		.map((value) => decodeEntities(value).trim())
		.filter(
			(value) => value.length > 0 && !invalidNames.has(value.toLowerCase()),
		);
}

function withNumberedTitle(
	label: "Chapter" | "Episode",
	number: string,
	value: string | null | undefined,
): string {
	const base = `${label} ${number}`;
	const title = decodeEntities(value).trim();
	if (!title) return base;
	const escapedNumber = number.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const duplicate = title.match(
		new RegExp(
			`^(?:${label}\\s+)?${escapedNumber}(?:\\s*[-:·–—]\\s*(.*))?$`,
			"i",
		),
	);
	if (duplicate)
		return duplicate[1] ? `${base} · ${duplicate[1].trim()}` : base;
	return `${base} · ${title}`;
}

export function formatChapterLabel(
	number: string,
	title?: string | null,
): string {
	return withNumberedTitle("Chapter", number, title);
}

export function formatTimeAgo(value?: string | null): string | null {
	if (!value) return null;
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) return null;

	const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
	if (seconds < 60) return `${seconds} dtk`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes} mnt`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} jam`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days} hari`;
	const weeks = Math.floor(days / 7);
	if (days < 30) return `${weeks} minggu`;
	const months = Math.floor(days / 30);
	if (days < 365) return `${months} bln`;
	return `${Math.floor(days / 365)} thn`;
}
