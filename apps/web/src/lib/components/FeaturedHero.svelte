<script lang="ts">
import {
	BookOpen,
	ChevronLeft,
	ChevronRight,
	Clapperboard,
	Star,
} from "lucide-svelte";
import { decodeEntities } from "#lib/text.ts";

const AUTO_ADVANCE_DELAY = 6500;
const SWIPE_THRESHOLD = 48;
const DRAG_AXIS_THRESHOLD = 8;

export interface FeaturedHeroTag {
	text: string;
	tone?: "new" | "popular" | "chapters";
}

export interface FeaturedHeroSlide {
	id: string;
	title: string;
	imageUrl: string | null;
	href: string;
	linkLabel: string;
	label: string;
	description?: string | null;
	stats: string[];
	tags: FeaturedHeroTag[];
	rating?: string | null;
	ctaText: string;
	emptyIcon: "comic" | "anime";
}

type PointerStart = {
	x: number;
	y: number;
	pointerId: number;
	ignoreSwipe: boolean;
	isHorizontal: boolean;
	didDrag: boolean;
};

interface Props {
	slides: FeaturedHeroSlide[];
	ariaLabel: string;
	id: string;
}

let { slides, ariaLabel, id }: Props = $props();

let activeIndex = $state(0);
let isHolding = $state(false);
let isHovered = $state(false);
let dragOffset = $state(0);
let isDragging = $state(false);
let isRepositioning = $state(false);
let viewport: HTMLDivElement | null = $state(null);
let pointerStart: PointerStart | null = null;
let pendingIndex: number | null = null;
let suppressNextClick = false;

const trackItems = $derived<FeaturedHeroSlide[]>(
	slides.length > 1
		? [slides[slides.length - 1], ...slides, slides[0]]
		: slides,
);
const activeTrackPosition = $derived(slides.length > 1 ? activeIndex + 1 : 0);
const slideWidth = $derived(100 / Math.max(1, trackItems.length));
const trackTransform = $derived(
	`translate3d(calc(-${activeTrackPosition * slideWidth}% + ${dragOffset}px), 0, 0)`,
);
const trackInlineStyle = $derived(
	`width: ${trackItems.length * 100}%; transform: ${trackTransform};` +
		(isDragging || isRepositioning ? " transition: none;" : ""),
);

function wrapIndex(index: number, length: number): number {
	return (index + length) % length;
}

function beginSlide(direction: -1 | 1, targetIndex?: number): void {
	if (slides.length < 2 || pendingIndex !== null) return;

	const currentIndex = activeIndex;
	const nextIndex =
		targetIndex ?? wrapIndex(currentIndex + direction, slides.length);
	if (nextIndex === currentIndex) return;

	let targetTrackPosition = nextIndex + 1;
	if (
		targetIndex === undefined &&
		direction === 1 &&
		currentIndex === slides.length - 1
	)
		targetTrackPosition = slides.length + 1;
	if (targetIndex === undefined && direction === -1 && currentIndex === 0)
		targetTrackPosition = 0;

	const currentTrackPosition = slides.length > 1 ? currentIndex + 1 : 0;
	const viewportWidth = viewport?.clientWidth ?? 0;
	const reducedMotion = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	).matches;

	if (!viewportWidth || reducedMotion) {
		activeIndex = nextIndex;
		isDragging = false;
		dragOffset = 0;
		return;
	}

	pendingIndex = nextIndex;
	isRepositioning = false;
	isDragging = false;
	dragOffset = (currentTrackPosition - targetTrackPosition) * viewportWidth;
}

// Jaga index tetap valid saat daftar hero dimuat ulang secara async.
$effect(() => {
	const length = slides.length;
	if (length === 0) {
		activeIndex = 0;
		pendingIndex = null;
		dragOffset = 0;
		isDragging = false;
		return;
	}
	if (activeIndex >= length) activeIndex = 0;
});

// Autoplay: jeda saat ditahan/di-hover + hormati reduced motion.
$effect(() => {
	activeIndex;
	isHolding;
	isHovered;
	const length = slides.length;
	if (
		length < 2 ||
		isHolding ||
		isHovered ||
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	)
		return;
	const timer = window.setTimeout(() => beginSlide(1), AUTO_ADVANCE_DELAY);
	return () => window.clearTimeout(timer);
});

// Swipe/drag horizontal (registered sekali, baca state terbaru).
$effect(() => {
	const handlePointerMove = (event: PointerEvent) => {
		const start = pointerStart;
		if (!start || event.pointerId !== start.pointerId || start.ignoreSwipe)
			return;

		const deltaX = event.clientX - start.x;
		const deltaY = event.clientY - start.y;
		if (!start.isHorizontal) {
			if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < DRAG_AXIS_THRESHOLD)
				return;
			if (Math.abs(deltaY) > Math.abs(deltaX) * 1.15) {
				start.ignoreSwipe = true;
				return;
			}
			if (Math.abs(deltaX) <= Math.abs(deltaY) * 1.15) return;
			start.isHorizontal = true;
			isDragging = true;
		}

		start.didDrag = Math.abs(deltaX) >= DRAG_AXIS_THRESHOLD;
		event.preventDefault();
		dragOffset = deltaX;
	};

	const finishPointer = (event: PointerEvent) => {
		const start = pointerStart;
		if (!start || event.pointerId !== start.pointerId) return;

		pointerStart = null;
		isHolding = false;
		if (event.type !== "pointerup" || start.ignoreSwipe) {
			isDragging = false;
			dragOffset = 0;
			return;
		}

		const deltaX = event.clientX - start.x;
		const deltaY = event.clientY - start.y;
		if (!start.isHorizontal || Math.abs(deltaX) <= Math.abs(deltaY) * 1.15) {
			isDragging = false;
			dragOffset = 0;
			return;
		}

		if (start.didDrag) {
			suppressNextClick = true;
			window.setTimeout(() => {
				suppressNextClick = false;
			}, 500);
		}

		const threshold = Math.max(
			SWIPE_THRESHOLD,
			(viewport?.clientWidth ?? 0) * 0.14,
		);
		if (Math.abs(deltaX) >= threshold) {
			beginSlide(deltaX < 0 ? 1 : -1);
			return;
		}

		isDragging = false;
		dragOffset = 0;
	};

	window.addEventListener("pointermove", handlePointerMove, {
		passive: false,
	});
	window.addEventListener("pointerup", finishPointer);
	window.addEventListener("pointercancel", finishPointer);
	return () => {
		window.removeEventListener("pointermove", handlePointerMove);
		window.removeEventListener("pointerup", finishPointer);
		window.removeEventListener("pointercancel", finishPointer);
	};
});

function handlePointerDown(event: PointerEvent): void {
	if (event.pointerType === "mouse" && event.button !== 0) return;
	if (pendingIndex !== null) return;
	pointerStart = {
		x: event.clientX,
		y: event.clientY,
		pointerId: event.pointerId,
		ignoreSwipe:
			event.target instanceof Element &&
			Boolean(event.target.closest(".featured-hero-controls")),
		isHorizontal: false,
		didDrag: false,
	};
	isHolding = true;
}

function handleTrackTransitionEnd(event: TransitionEvent): void {
	if (
		event.target !== event.currentTarget ||
		event.propertyName !== "transform"
	)
		return;
	const nextIndex = pendingIndex;
	if (nextIndex === null) return;

	pendingIndex = null;
	isRepositioning = true;
	activeIndex = nextIndex;
	dragOffset = 0;
	window.requestAnimationFrame(() => {
		isRepositioning = false;
	});
}

function handleClickCapture(event: MouseEvent): void {
	if (!suppressNextClick) return;
	event.preventDefault();
	event.stopPropagation();
	suppressNextClick = false;
}
</script>

{#if slides.length > 0}
	<section
		{id}
		class="featured-hero"
		aria-label={ariaLabel}
		aria-roledescription="carousel"
		onpointerdown={handlePointerDown}
		onpointerenter={(event) => {
			if (event.pointerType === "mouse") isHovered = true;
		}}
		onpointerleave={(event) => {
			if (event.pointerType === "mouse") isHovered = false;
		}}
		onclickcapture={handleClickCapture}
	>
		<div class="featured-hero-viewport" bind:this={viewport}>
			<div
				class="featured-hero-track"
				class:is-dragging={isDragging}
				style={trackInlineStyle}
				ontransitionend={handleTrackTransitionEnd}
			>
				{#each trackItems as slide, trackIndex (`${trackIndex}-${slide.id}`)}
					{@const isDuplicate =
						slides.length > 1 &&
						(trackIndex === 0 || trackIndex === trackItems.length - 1)}
					{@const slideIndex =
						slides.length === 1
							? trackIndex
							: isDuplicate
								? trackIndex === 0
									? slides.length - 1
									: 0
								: trackIndex - 1}
					{@const isInactive = isDuplicate || slideIndex !== activeIndex}
					<div
						class="featured-hero-slide"
						style={`flex: 0 0 ${slideWidth}%; width: ${slideWidth}%;`}
						aria-hidden={isInactive}
						inert={isInactive}
					>
						{#if slide.imageUrl}
							<img
								src={slide.imageUrl}
								alt=""
								aria-hidden="true"
								class="featured-hero-backdrop"
							/>
						{/if}
						<div class="featured-hero-shade" aria-hidden="true"></div>
						<div class="featured-hero-inner">
							<a
								class="featured-hero-poster"
								href={slide.href}
								aria-label={slide.linkLabel}
							>
								{#if slide.imageUrl}
									<img
										src={slide.imageUrl}
										alt={`Sampul ${decodeEntities(slide.title)}`}
										fetchpriority="high"
										class="size-full object-cover"
									/>
								{:else if slide.emptyIcon === "anime"}
									<Clapperboard aria-hidden="true" class="size-12" />
								{:else}
									<BookOpen aria-hidden="true" class="size-12" />
								{/if}
							</a>
							<div class="featured-hero-copy">
								<p class="featured-hero-label">
									{slide.label}
								</p>
								<h2>
									<a href={slide.href}>
										{decodeEntities(slide.title)}
									</a>
								</h2>
								<div class="featured-hero-mobile-meta">
									{#if slide.rating}
										<span class="featured-hero-rating">
											<Star aria-hidden="true" fill="currentColor" />
											{slide.rating}
										</span>
									{/if}
									{#each slide.tags as tag (tag.text)}
										<span
											class="featured-hero-tag {tag.tone
												? `featured-hero-tag--${tag.tone}`
												: ''}"
										>
											{tag.tone === "new"
												? "Baru"
												: tag.tone === "popular"
													? "Populer"
													: tag.tone === "chapters"
														? "Teratas"
														: decodeEntities(tag.text)}
										</span>
									{/each}
								</div>
								{#if slide.description}
									<p class="featured-hero-description">
										{decodeEntities(slide.description)}
									</p>
								{/if}
								{#if slide.stats.length > 0}
									<div class="featured-hero-stats">
										{#each slide.stats as stat (stat)}
											<span>{stat}</span>
										{/each}
									</div>
								{/if}
								<a class="featured-hero-link" href={slide.href}>
									{slide.ctaText}
									<ChevronRight aria-hidden="true" />
								</a>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>
		{#if slides.length > 1}
			<div class="featured-hero-controls">
				<button
					type="button"
					aria-label={`${ariaLabel} sebelumnya`}
					onclick={() => beginSlide(-1)}
				>
					<ChevronLeft aria-hidden="true" />
				</button>
				<div class="featured-hero-dots" aria-label={`Pilih ${ariaLabel}`}>
					{#each slides as item, dot (item.id)}
						<button
							type="button"
							class={dot === activeIndex ? "is-active" : ""}
							aria-label={`Tampilkan ${decodeEntities(item.title)}`}
							aria-current={dot === activeIndex ? "true" : undefined}
							onclick={() => beginSlide(1, dot)}
						></button>
					{/each}
				</div>
				<button
					type="button"
					aria-label={`${ariaLabel} berikutnya`}
					onclick={() => beginSlide(1)}
				>
					<ChevronRight aria-hidden="true" />
				</button>
			</div>
		{/if}
	</section>
{/if}
