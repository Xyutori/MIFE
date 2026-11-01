import { type HTMLElement, parse } from "node-html-parser";
import {
	fetchSource,
	readSourceText,
	SourceResponseValidationError,
	sourceUrl,
	withSourceNetworkRetry,
} from "../sources/http";
import type { SourceConfig } from "../sources/types";

export function text(
	el: HTMLElement | null | undefined,
	regexp?: RegExp,
): string {
	const value = el?.text ?? "";
	if (regexp) {
		const match = value.match(regexp);
		if (match) return (match[1] ?? "").trim();
	}
	return value.trim();
}

export function attr(el: HTMLElement | null | undefined, name: string): string {
	return el?.getAttribute(name)?.trim() ?? "";
}

export function imageSrc(el: HTMLElement | null | undefined): string {
	return attr(el, "data-src") || attr(el, "src");
}

export function idFromHref(el: HTMLElement | null | undefined): string {
	const href = el?.getAttribute("href") ?? "";
	const clean = href.split("?")[0] ?? "";
	const parts = clean.split("/").filter(Boolean);
	return parts.at(-1) ?? "";
}

const legacyHosts: Record<string, string> = {
	otakudesu: "otakudesu.blog",
	oploverz: "oploverz.am",
	kuramanime: "kuramanime.ing",
};

export function absoluteUrl(
	source: SourceConfig,
	value: string | null | undefined,
): string | null {
	if (!value?.trim()) return null;
	try {
		const url = new URL(value.trim(), `${source.baseUrl.replace(/\/+$/, "")}/`);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		const legacy = legacyHosts[source.key];
		if (legacy && url.hostname === legacy)
			url.host = new URL(source.baseUrl).host;
		return url.toString();
	} catch {
		return null;
	}
}

/** Unwrap CSS `url("...")` wrappers found in `data-setbg` attributes. */
export function unwrapCssUrl(value: string): string {
	const match = value.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
	return ((match?.[1] ?? value).trim() ?? "").replace(/^['"]|['"]$/g, "");
}

export async function fetchHtml(
	source: SourceConfig,
	path: string,
	query?: URLSearchParams,
): Promise<string> {
	return withSourceNetworkRetry(source, async () => {
		const response = await fetchSource(
			source,
			sourceUrl(source, path, query),
			"text/html,application/xhtml+xml",
			{
				lane: "api",
				timeoutMs: 45_000,
				maxResponseBytes: 12 * 1024 * 1024,
			},
		);
		const html = await readSourceText(response, source.name);
		const head = html.slice(0, 100_000);
		const title =
			html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
		if (
			/just a moment|attention required|access denied|verify you are human|security check/i.test(
				title,
			) ||
			(/cloudflare|cf-ray/i.test(head) &&
				/challenge|checking your browser/i.test(head))
		)
			throw new SourceResponseValidationError(
				`${source.name} mengembalikan halaman challenge, bukan konten anime`,
			);
		return html;
	});
}

export async function documentAt(
	source: SourceConfig,
	path: string,
	query?: URLSearchParams,
): Promise<HTMLElement> {
	const html = await fetchHtml(source, path, query);
	return parse(html, { parseNoneClosedTags: true });
}

const namedEntities: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	ndash: "–",
	mdash: "—",
	lsquo: "'",
	rsquo: "'",
	ldquo: "\u201C",
	rdquo: "\u201D",
	hellip: "…",
};

/** Decode the HTML entities found in raw-markup attribute/text extraction. */
export function decodeEntities(value: string): string {
	return value
		.replace(/&#(\d+);/g, (_, code: string) =>
			String.fromCodePoint(Number(code)),
		)
		.replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
			String.fromCodePoint(Number.parseInt(code, 16)),
		)
		.replace(
			/&([a-zA-Z]+);/g,
			(match, name: string) => namedEntities[name] ?? match,
		);
}

export function stringValue(value: unknown): string | null {
	if (typeof value === "string" && value.trim()) return value.trim();
	return null;
}

export function numericValue(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const match = value.match(/\d+(?:[.,]\d+)?/);
		if (match) {
			const parsed = Number((match[0] ?? "").replace(",", "."));
			return Number.isFinite(parsed) ? parsed : null;
		}
	}
	return null;
}
