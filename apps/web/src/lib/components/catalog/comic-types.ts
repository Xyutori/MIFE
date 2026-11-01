export const COMIC_TYPES = [
	{
		id: "manga",
		label: "Manga",
		flag: "🇯🇵",
		country: "Jepang",
		typeAliases: ["manga", "doujinshi", "japan", "japanese"],
		countryAliases: ["jp", "jpn", "japan", "japanese", "jepang"],
	},
	{
		id: "manhua",
		label: "Manhua",
		flag: "🇨🇳",
		country: "Tiongkok",
		typeAliases: ["manhua", "china", "chinese"],
		countryAliases: ["cn", "chn", "china", "chinese", "tiongkok", "cina"],
	},
	{
		id: "manhwa",
		label: "Manhwa",
		flag: "🇰🇷",
		country: "Korea Selatan",
		typeAliases: ["manhwa", "korea", "korean", "webtoon"],
		countryAliases: ["kr", "kor", "korea", "korean", "south korea"],
	},
] as const;

function normalize(value: string | null): string {
	return (
		value
			?.normalize("NFKD")
			.replace(/\p{Diacritic}/gu, "")
			.toLowerCase()
			.trim() ?? ""
	);
}

function matchesAlias(value: string, alias: string): boolean {
	return value === alias || (alias.length > 2 && value.includes(alias));
}

export function comicTypeInfo(
	type: string | null,
	countryId: string | null,
): (typeof COMIC_TYPES)[number] | undefined {
	const normalizedType = normalize(type);
	const typeMatch = COMIC_TYPES.find(({ typeAliases }) =>
		typeAliases.some((alias) =>
			normalizedType ? matchesAlias(normalizedType, alias) : false,
		),
	);
	if (typeMatch) return typeMatch;

	const normalizedCountry = normalize(countryId);
	return COMIC_TYPES.find(({ countryAliases }) =>
		countryAliases.some((alias) =>
			normalizedCountry ? matchesAlias(normalizedCountry, alias) : false,
		),
	);
}
