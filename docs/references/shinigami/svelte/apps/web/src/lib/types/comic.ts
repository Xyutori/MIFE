export type Country = "KR" | "JP" | "CN";

export type UpdateKind = "project" | "mirror";

export interface BannerTag {
	label: string;
	color: string;
}

export interface BannerItem {
	title: string;
	rating: string;
	tags: BannerTag[];
	description: string;
	link: string;
	banner: string;
	character: string;
}

export interface Announcement {
	title: string;
	date: string;
	image: string;
	link: string;
}

export interface Chapter {
	/** Display label, e.g. "Chapter 12". */
	number: string;
	/** Relative time label, e.g. "18 jam". */
	time: string;
	link: string;
	/** Optional chapter subtitle, e.g. "SEASON 4 END". */
	subtitle?: string;
	/** Optional chapter thumbnail (detail page). */
	image?: string;
}

export interface Series {
	id: string;
	title: string;
	cover: string;
	link: string;
	country: Country;
	kind: UpdateKind;
	/** Update badge, e.g. "UP" or "NEW". */
	badge?: string;
	/** Country flag emoji, e.g. "🇰🇷". */
	flag?: string;
	/** Relative update label for recommendation cards, e.g. "10h". */
	time?: string;
	rating?: number;
	latestChapter?: string;
	updatedAgo?: string;
	/** Latest chapters for update-grid cards. */
	chapters?: Chapter[];
}

export interface Reaction {
	image: string;
	votes: number;
	label: string;
}
