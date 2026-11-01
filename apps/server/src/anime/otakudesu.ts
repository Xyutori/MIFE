import type { HTMLElement } from "node-html-parser";
import type {
	AnimeDetails,
	AnimeEpisodeItem,
	AnimeListItem,
	AnimeSourceAdapter,
} from "../jobs/anime";
import { SourceResponseValidationError } from "../sources/http";
import type { SourceConfig } from "../sources/types";
import { parseAnimeSourceDate } from "./date";
import {
	absoluteUrl,
	decodeEntities,
	documentAt,
	fetchHtml,
	idFromHref,
	imageSrc,
	numericValue,
	text,
} from "./helpers";

function infoAt(bolds: HTMLElement[], index: number): string {
	const sibling = bolds[index]?.nextSibling;
	const raw =
		sibling && "text" in sibling
			? String((sibling as unknown as HTMLElement).text ?? "")
			: "";
	return raw.match(/:\s*(.+)/s)?.[1]?.trim() ?? "";
}

/**
 * Pure extraction of directory entries from raw HTML.
 *
 * The live `/anime-list/` markup embeds a malformed `<color <span ...>`
 * fragment inside every entry anchor, which makes node-html-parser (v9)
 * drop the `<a>` elements entirely (verified: `.jdlbar a` matches 0 of
 * ~1900 live entries). Regex extraction on the raw markup is
 * deterministic: every entry block carries `href` + `title` on its anchor.
 */
export function parseOtakudesuDirectory(
	html: string,
): Array<{ title: string; externalId: string; href: string }> {
	const entries = new Map<
		string,
		{ title: string; externalId: string; href: string }
	>();
	const blocks = html.matchAll(/<div class="jdlbar">([\s\S]*?)<\/div>/g);
	for (const block of blocks) {
		const inner = block[1] ?? "";
		const href = inner.match(/<a\b[^>]*?href="([^"]+)"/)?.[1]?.trim() ?? "";
		const externalId =
			href.split("?")[0]?.split("/").filter(Boolean).at(-1) ?? "";
		if (!href || !externalId) continue;
		const anchorInner = inner.match(/<a\b[^>]*?>([\s\S]*?)<\/a>/)?.[1] ?? "";
		const textBeforeColor = anchorInner.split("<color")[0] ?? "";
		const title =
			decodeEntities(textBeforeColor.replace(/<[^>]*>/g, "").trim()) ||
			decodeEntities(
				(inner.match(/<a\b[^>]*?title="([^"]*)"/)?.[1] ?? "").trim(),
			);
		if (!title) continue;
		entries.set(externalId, { title, externalId, href });
	}
	return [...entries.values()];
}

export const otakudesuAdapter: AnimeSourceAdapter = {
	async listAnime(
		source: SourceConfig,
		options: { page: number; pageSize: number },
	): Promise<{
		items: AnimeListItem[];
		totalPages: number;
		totalRecords: number;
	}> {
		const html = await fetchHtml(source, "/anime-list/");
		if (!html.includes("bariskelom") || !html.includes("jdlbar"))
			throw new SourceResponseValidationError(
				`${source.name} anime directory tidak memiliki struktur yang dikenali`,
			);
		const found = new Map<string, AnimeListItem>();
		for (const entry of parseOtakudesuDirectory(html)) {
			const sourceUrl =
				absoluteUrl(source, entry.href) ??
				absoluteUrl(source, `/anime/${entry.externalId}/`);
			if (!sourceUrl) continue;
			found.set(entry.externalId, {
				title: entry.title,
				externalId: entry.externalId,
				slug: entry.externalId,
				sourceUrl,
				posterUrl: null,
				latestEpisodeNumber: null,
				sourceUpdatedAt: null,
				raw: { title: entry.title, href: entry.href },
			});
		}
		const all = [...found.values()];
		if (all.length === 0)
			throw new SourceResponseValidationError(
				`${source.name} anime directory dikenali tetapi tidak menghasilkan anime valid`,
			);
		const totalPages = Math.max(1, Math.ceil(all.length / options.pageSize));
		const start = (options.page - 1) * options.pageSize;
		return {
			items: all.slice(start, start + options.pageSize),
			totalPages,
			totalRecords: all.length,
		};
	},

	async getDetails(
		source: SourceConfig,
		item: AnimeListItem,
	): Promise<AnimeDetails> {
		if (!item.sourceUrl) throw new Error("Otakudesu anime URL tidak tersedia");
		const url = new URL(item.sourceUrl);
		const document = await documentAt(source, `${url.pathname}${url.search}`);
		if (!document.querySelector(".infozingle"))
			throw new SourceResponseValidationError(
				`${source.name} detail page tidak memiliki struktur anime yang dikenali`,
			);

		const bolds = document.querySelectorAll(".infozingle b");
		const title = infoAt(bolds, 0);
		if (!title)
			throw new SourceResponseValidationError(
				`${source.name} anime detail tidak memiliki judul yang valid`,
			);
		const episodeCountText = infoAt(bolds, 6);
		const genres = [
			...new Set(
				(
					document
						.querySelector(".infozingle")
						?.lastElementChild?.querySelectorAll("a") ?? []
				)
					.map((anchor) => text(anchor))
					.filter(Boolean),
			),
		];
		const synopsis = document
			.querySelectorAll(".sinopc p")
			.map((paragraph) => paragraph.text.trim())
			.filter(Boolean)
			.join("\n\n");

		let episodeAnchors: HTMLElement[] = [];
		for (const header of document.querySelectorAll(".smokelister")) {
			const label = (header.text ?? "").toLowerCase();
			if (label.includes("episode") && !label.includes("batch")) {
				const anchors =
					header.nextElementSibling?.querySelectorAll("li a") ?? [];
				if (anchors.length > 0) {
					episodeAnchors = anchors;
					break;
				}
			}
		}
		const episodes = episodeAnchors
			.map((anchor): AnimeEpisodeItem | null => {
				const anchorTitle = text(anchor);
				const numberText =
					anchorTitle.match(/Episode\s+([\d.]+)/i)?.[1] ??
					anchorTitle.match(/([\d.]+)/)?.[1] ??
					anchorTitle;
				const sourceUrl = absoluteUrl(source, anchor.getAttribute("href"));
				const externalId = idFromHref(anchor);
				if (!numberText || !sourceUrl || !externalId) return null;
				return {
					externalId,
					numberText,
					title: anchorTitle || `Episode ${numberText}`,
					sourceUrl,
					releasedAt: null,
					raw: { title: anchorTitle, href: anchor.getAttribute("href") },
				};
			})
			.filter((episode): episode is AnimeEpisodeItem => Boolean(episode));

		return {
			title,
			alternativeTitle: infoAt(bolds, 1) || null,
			synopsis: synopsis || null,
			status: infoAt(bolds, 5) || null,
			score: numericValue(infoAt(bolds, 2)),
			episodeCount: numericValue(episodeCountText) ?? (episodes.length || null),
			animeType: infoAt(bolds, 4) || null,
			studio: infoAt(bolds, 9) || null,
			genres,
			posterUrl:
				absoluteUrl(
					source,
					imageSrc(document.querySelector(".fotoanime img")),
				) ?? item.posterUrl,
			episodes,
			raw: {
				producers: infoAt(bolds, 3) || null,
				duration: infoAt(bolds, 7) || null,
				aired: infoAt(bolds, 8) || null,
				sourceUpdatedAt: parseAnimeSourceDate(source.key, infoAt(bolds, 8)),
			},
		};
	},
};
