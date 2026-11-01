import type {
	AnimeDetails,
	AnimeEpisodeItem,
	AnimeListItem,
	AnimeSourceAdapter,
} from "../jobs/anime";
import { SourceResponseValidationError } from "../sources/http";
import type { SourceConfig } from "../sources/types";
import { isRelativeAnimeDate, parseAnimeSourceDate } from "./date";
import {
	absoluteUrl,
	attr,
	documentAt,
	imageSrc,
	numericValue,
	text,
} from "./helpers";

function slugFromSeriesHref(href: string): string {
	return href.split("/anime/")[1]?.replace(/\/$/, "") ?? "";
}

export const oploverzAdapter: AnimeSourceAdapter = {
	async listAnime(
		source: SourceConfig,
		options: { page: number; pageSize: number },
	): Promise<{
		items: AnimeListItem[];
		totalPages: number;
		totalRecords: number;
	}> {
		const document = await documentAt(source, "/");
		if (!document.querySelector(".listupd.normal"))
			throw new SourceResponseValidationError(
				`${source.name} home page tidak memiliki struktur feed yang dikenali`,
			);
		// The legacy `/anime/list-mode/` directory now returns 404 on the live
		// site, so the listing follows XyMI `listAnimeUpdates`: the home update
		// feed (`.listupd.normal .excstf article.stylesix`, verified live).
		const found = new Map<string, AnimeListItem>();
		for (const card of document.querySelectorAll(
			".listupd.normal .excstf article.stylesix",
		)) {
			const thumb = card.querySelector(".thumb");
			const title = text(card.querySelector(".inf h2 a"));
			const seriesAnchor = [...card.querySelectorAll(".inf ul li")]
				.find((li) => text(li).startsWith("series:"))
				?.querySelector("a");
			const seriesUrl = attr(seriesAnchor, "href");
			const slug = slugFromSeriesHref(seriesUrl);
			const seriesName = text(seriesAnchor);
			const externalId = slug || seriesName;
			if (!title || !externalId) continue;
			const sourceUrl = absoluteUrl(source, seriesUrl);
			if (!sourceUrl) continue;
			const infoTexts = [...card.querySelectorAll(".inf ul li")].map((li) =>
				text(li),
			);
			const releaseTime =
				infoTexts
					.find((line) => line.startsWith("Released on:"))
					?.replace("Released on:", "")
					.trim() ?? null;
			const episode =
				text(thumb?.querySelector(".epx")) || text(card.querySelector(".epx"));
			found.set(externalId, {
				title: seriesName || title,
				externalId,
				slug: slug || null,
				sourceUrl,
				posterUrl: absoluteUrl(
					source,
					imageSrc(thumb?.querySelector("img")).split("?")[0],
				),
				latestEpisodeNumber: episode.match(/([\d.]+)/)?.[1] ?? null,
				sourceUpdatedAt:
					releaseTime && !isRelativeAnimeDate(releaseTime)
						? parseAnimeSourceDate(source.key, releaseTime)
						: null,
				raw: {
					title,
					seriesName,
					episode,
					href: attr(thumb?.querySelector("a"), "href"),
					releaseTime,
				},
			});
		}
		const all = [...found.values()];
		if (all.length === 0)
			throw new SourceResponseValidationError(
				`${source.name} update feed dikenali tetapi tidak menghasilkan anime valid`,
			);
		return {
			items: options.page === 1 ? all : [],
			totalPages: 1,
			totalRecords: all.length,
		};
	},

	async getDetails(
		source: SourceConfig,
		item: AnimeListItem,
	): Promise<AnimeDetails> {
		if (!item.sourceUrl) throw new Error("Oploverz anime URL tidak tersedia");
		const url = new URL(item.sourceUrl);
		const document = await documentAt(source, `${url.pathname}${url.search}`);
		if (!document.querySelector("h1.entry-title"))
			throw new SourceResponseValidationError(
				`${source.name} detail page tidak memiliki struktur anime yang dikenali`,
			);

		const title = text(document.querySelector("h1.entry-title"));
		if (!title)
			throw new SourceResponseValidationError(
				`${source.name} anime detail tidak memiliki judul yang valid`,
			);
		const speElems = document.querySelectorAll(".spe span");
		const speInfo = (label: string) => {
			const span = speElems.find((el) =>
				text(el.querySelector("b")).includes(label),
			);
			if (!span) return "";
			return text(span)
				.replace(text(span.querySelector("b")), "")
				.replace(":", "")
				.trim();
		};
		const rating = text(document.querySelector(".rating strong"))
			.replace("Rating ", "")
			.trim();
		const synopsis = document
			.querySelectorAll(".entry-content p")
			.map((paragraph) => paragraph.text.trim())
			.filter(Boolean)
			.join("\n\n");
		const genres = [
			...new Set(
				document
					.querySelectorAll(".genxed a")
					.map((anchor) => text(anchor))
					.filter(Boolean),
			),
		];
		const episodes = document
			.querySelectorAll(".eplister ul li")
			.map((el): AnimeEpisodeItem | null => {
				const episode = text(el.querySelector(".epl-num"));
				const episodeTitle = text(el.querySelector(".epl-title"));
				const date = text(el.querySelector(".epl-date"));
				const href = attr(el.querySelector("a"), "href");
				const numberText = episode.match(/([\d.]+)/)?.[1] ?? episode;
				const sourceUrl = absoluteUrl(source, href);
				if (!numberText || !sourceUrl || !href) return null;
				return {
					externalId: href,
					numberText,
					title: episodeTitle || `Episode ${numberText}`,
					sourceUrl,
					releasedAt: parseAnimeSourceDate(source.key, date),
					raw: { episode, title: episodeTitle, date, href },
				};
			})
			.filter((episode): episode is AnimeEpisodeItem => Boolean(episode));

		return {
			title,
			alternativeTitle: null,
			synopsis: synopsis || null,
			status: speInfo("Status") || null,
			score: numericValue(rating),
			episodeCount: episodes.length || null,
			animeType: speInfo("Type") || null,
			studio: speInfo("Studio") || null,
			genres,
			posterUrl:
				absoluteUrl(
					source,
					imageSrc(document.querySelector(".thumbook .thumb img")).split(
						"?",
					)[0],
				) ?? item.posterUrl,
			episodes,
			raw: {
				season: speInfo("Season") || null,
				releasedOn: speInfo("Released on") || null,
				updatedOn: speInfo("Updated on") || null,
			},
		};
	},
};
