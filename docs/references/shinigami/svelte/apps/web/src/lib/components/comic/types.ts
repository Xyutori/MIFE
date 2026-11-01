/**
 * Local domain types for `src/lib/components/comic/*`.
 *
 * These mirror the design-spec contracts expected from
 * `#lib/types/comic.ts` (foundation lane). Once that module lands,
 * re-export from there and remove this file:
 *
 *   export type {
 *     Series, SeriesChapterMini, Chapter,
 *     BannerTag, BannerItem, Announcement,
 *     Reaction, ComicComment, CommentSort
 *   } from "#lib/types/comic";
 */

export interface SeriesChapterMini {
	number: string;
	time: string;
	href: string;
}

export interface Series {
	id: string;
	title: string;
	cover: string;
	href: string;
	/** Relative update label, e.g. "10h", "3d", "18 jam". */
	updatedAt?: string;
	/** e.g. "UP" | "NEW" | "" */
	badge?: string;
	/** Country flag emoji, e.g. "\uD83C\uDDF0\uD83C\uDDF7" */
	flag?: string;
	latestChapters?: SeriesChapterMini[];
	rating?: string | number;
}

export interface Chapter {
	number: string;
	time?: string;
	href: string;
}

export interface BannerTag {
	label: string;
	color: string;
}

export interface BannerItem {
	title: string;
	rating?: string | number;
	tags?: BannerTag[];
	description?: string;
	href: string;
	banner: string;
	character?: string;
}

export interface Announcement {
	id?: string;
	title: string;
	date: string;
	image: string;
	href: string;
}

export interface Reaction {
	id: string;
	label: string;
	image: string;
	votes: number;
}

export interface ComicComment {
	id: string;
	nick: string;
	avatar?: string;
	level?: string;
	time: string;
	body: string;
	spoiler?: string;
	likes: number;
	replies?: ComicComment[];
	replyCount?: number;
}

export type CommentSort = "latest" | "oldest" | "hottest";
