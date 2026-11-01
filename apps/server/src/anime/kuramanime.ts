import { type HTMLElement, parse } from "node-html-parser";
import type {
	AnimeDetails,
	AnimeEpisodeItem,
	AnimeListItem,
	AnimeSourceAdapter,
} from "../jobs/anime";
import { SourceResponseValidationError } from "../sources/http";
import type { SourceConfig } from "../sources/types";
import {
	absoluteUrl,
	attr,
	documentAt,
	idFromHref,
	numericValue,
	text,
	unwrapCssUrl,
} from "./helpers";

function posterFrom(el: HTMLElement | null | undefined): string {
	return unwrapCssUrl(attr(el, "data-setbg"));
}

function animeIdFromHref(href: string): string {
	return href.match(/\/anime\/([^/]+)/)?.[1] ?? "";
}

export const kuramanimeAdapter: AnimeSourceAdapter = {
	async listAnime(
		source: SourceConfig,
		options: { page: number; pageSize: number },
	): Promise<{
		items: AnimeListItem[];
		totalPages: number;
		totalRecords: number;
	}> {
		const document = await documentAt(
			source,
			"/anime",
			new URLSearchParams({
				order_by: "latest",
				page: String(options.page),
			}),
		);
		if (!document.querySelector("#animeList"))
			throw new SourceResponseValidationError(
				"Kuramanime anime list page tidak memiliki struktur yang dikenali",
			);
		const found = new Map<string, AnimeListItem>();
		for (const card of document.querySelectorAll("#animeList .product__item")) {
			const link = card.querySelector(".product__item__text h5 a");
			const title = text(card.querySelector(".product__item__text h5"));
			const href = attr(link, "href");
			const animeId = animeIdFromHref(href);
			const animeSlug = idFromHref(link);
			const externalId = animeId || animeSlug;
			if (!title || !externalId) continue;
			const sourceUrl = absoluteUrl(source, href);
			if (!sourceUrl) continue;
			found.set(externalId, {
				title,
				externalId,
				slug: animeSlug || null,
				sourceUrl,
				posterUrl: absoluteUrl(
					source,
					posterFrom(card.querySelector(".product__item__pic")),
				),
				latestEpisodeNumber:
					text(
						card.querySelector(".product__item__pic .ep"),
						/Ep\s*([^\s/]+)/,
					) || null,
				sourceUpdatedAt: null,
				raw: { title, href, animeId, animeSlug },
			});
		}
		const items = [...found.values()];
		if (items.length === 0)
			throw new SourceResponseValidationError(
				`${source.name} anime list dikenali tetapi tidak menghasilkan anime valid`,
			);
		const pagination = document.querySelector(".product__pagination");
		const currentPage =
			Number(text(pagination?.querySelector(".current-page"))) || options.page;
		const nextHref =
			pagination
				?.querySelector(".page__link:last-child")
				?.getAttribute("href") ?? "";
		const nextPage = Number(nextHref.match(/(?:\?|&)page=(\d+)/)?.[1]);
		const hasNextPage =
			Number.isFinite(nextPage) && (nextPage as number) > currentPage;
		const lastPageLink =
			pagination?.querySelector("a:last-child")?.previousElementSibling;
		const totalPages =
			Number(text(lastPageLink)) ||
			(hasNextPage ? currentPage + 1 : currentPage);
		return {
			items,
			totalPages: Math.max(totalPages, options.page),
			totalRecords: Math.max(totalPages, options.page) * options.pageSize,
		};
	},

	async getDetails(
		source: SourceConfig,
		item: AnimeListItem,
	): Promise<AnimeDetails> {
		if (!item.sourceUrl) throw new Error("Kuramanime anime URL tidak tersedia");
		const url = new URL(item.sourceUrl);
		const document = await documentAt(source, `${url.pathname}${url.search}`);
		if (!document.querySelector(".anime__details__title h3"))
			throw new SourceResponseValidationError(
				`${source.name} detail page tidak memiliki struktur anime yang dikenali`,
			);

		const title = text(document.querySelector(".anime__details__title h3"));
		if (!title)
			throw new SourceResponseValidationError(
				`${source.name} anime detail tidak memiliki judul yang valid`,
			);
		const alternativeTitle =
			text(
				document.querySelector(".anime__details__title h3")?.nextElementSibling,
			) || null;
		const synopsis = [
			...document
				.querySelectorAll("#synopsisField br")
				.map((line) => (line.previousSibling?.text ?? "").trim())
				.filter((line) => line && line !== "\n"),
			text(document.querySelector("#synopsisField i")),
		]
			.filter(Boolean)
			.join("\n\n");

		const infoElems = document.querySelectorAll(
			".anime__details__widget ul li .col-9",
		);
		const info = (index: number) => text(infoElems[index]);
		const propertyTitle = (index: number) =>
			text(infoElems[index]?.querySelector("a")) || null;
		const propertyTitles = (index: number) =>
			(infoElems[index]?.querySelectorAll("a") ?? [])
				.map((anchor) => text(anchor))
				.filter(Boolean);
		const genres = [...new Set(propertyTitles(9))];
		const studios = propertyTitles(13);

		const episodeContent = attr(
			document.querySelector("#episodeLists"),
			"data-content",
		);
		const episodes: AnimeEpisodeItem[] = [];
		if (episodeContent) {
			const episodeDocument = parse(episodeContent, {
				parseNoneClosedTags: true,
			});
			for (const anchor of episodeDocument.querySelectorAll("a")) {
				const anchorTitle = text(anchor);
				const href = attr(anchor, "href");
				const numberText = anchorTitle.match(/\b(\d+)\b/)?.[1] ?? anchorTitle;
				const sourceUrl = absoluteUrl(source, href);
				if (!numberText || !sourceUrl || !href) continue;
				episodes.push({
					externalId: href,
					numberText,
					title: anchorTitle || `Episode ${numberText}`,
					sourceUrl,
					releasedAt: null,
					raw: { title: anchorTitle, href },
				});
			}
		}

		return {
			title,
			alternativeTitle,
			synopsis: synopsis || null,
			status: propertyTitle(2),
			score: numericValue(info(14)),
			episodeCount: numericValue(info(1)) ?? (episodes.length || null),
			animeType: propertyTitle(0),
			studio: studios.length > 0 ? studios.join(", ") : null,
			genres,
			posterUrl:
				absoluteUrl(
					source,
					posterFrom(document.querySelector(".anime__details__pic")),
				) ?? item.posterUrl,
			episodes,
			raw: {
				aired: info(3) || null,
				season: propertyTitle(4),
				country: propertyTitle(7),
				quality: propertyTitle(6),
				fans: info(15) || null,
			},
		};
	},
};
