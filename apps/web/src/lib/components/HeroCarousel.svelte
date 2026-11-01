<script lang="ts">
import { coverUrl, type HeroItem } from "#lib/api.ts";
import { decodeEntities } from "#lib/text.ts";
import FeaturedHero, {
	type FeaturedHeroSlide,
	type FeaturedHeroTag,
} from "./FeaturedHero.svelte";

type HeroDisplay = HeroItem & {
	featureLabel?: string | null;
	featureType?: string | null;
	viewCount?: number | null;
	rating?: number | null;
	chapterCount?: number | null;
};

interface Props {
	items: HeroItem[];
}

let { items }: Props = $props();

function formatCompact(value: number): string {
	return new Intl.NumberFormat("id-ID", {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(value);
}

const slides = $derived<FeaturedHeroSlide[]>(
	(items as HeroDisplay[]).map((comic) => {
		const label = (comic.featureLabel ?? "").toLocaleLowerCase("id-ID");
		const tags: FeaturedHeroTag[] = [];
		if (comic.featureType === "new" || label.includes("rilis"))
			tags.push({ text: "Baru", tone: "new" });
		if (comic.featureType === "views" || label.includes("views terbanyak"))
			tags.push({ text: "Populer", tone: "popular" });
		if (comic.featureType === "chapters" || label.includes("chapter terbanyak"))
			tags.push({ text: "Teratas", tone: "chapters" });
		const stats: string[] = [];
		if (comic.viewCount != null)
			stats.push(`${formatCompact(comic.viewCount)} views`);
		if (comic.chapterCount != null)
			stats.push(`${comic.chapterCount.toLocaleString("id-ID")} chapter`);
		return {
			id: comic.id,
			title: comic.title,
			imageUrl: comic.coverImageUrl
				? coverUrl(comic.id, comic.updatedAt)
				: null,
			href: `/komik/${comic.slug}`,
			linkLabel: `Buka ${decodeEntities(comic.title)}`,
			label: comic.featureLabel ?? "Komik pilihan",
			description: comic.description,
			stats,
			tags,
			rating:
				comic.rating != null && Number.isFinite(comic.rating)
					? comic.rating.toFixed(1)
					: null,
			ctaText: "Lihat komik",
			emptyIcon: "comic",
		} satisfies FeaturedHeroSlide;
	}),
);
</script>

<FeaturedHero slides={slides} ariaLabel="Komik pilihan" id="comic-hero" />
