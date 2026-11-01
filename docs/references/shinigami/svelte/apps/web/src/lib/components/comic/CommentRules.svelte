<script lang="ts">
/**
 * Single source of truth for comment rules, transcribed from the
 * `detail.html` / `read.html` references. Both `series` and
 * `chapter` variants share the same rule list; only the heading
 * context differs.
 */

interface RuleSegment {
	text: string;
	strong?: boolean;
}

interface Rule {
	icon: string;
	tone: "danger" | "warning";
	segments: RuleSegment[];
}

interface Props {
	variant?: "series" | "chapter";
}

let { variant = "series" }: Props = $props();

const heading = $derived(
	variant === "chapter" ? "Rules Komentar Chapter" : "Rules Komentar Series",
);

const rules: Rule[] = [
	{
		icon: "\uD83D\uDEAB",
		tone: "danger",
		segments: [
			{
				text: "Dilarang Toxic, Rasis, atau menimbulkan kerusuhan!",
				strong: true,
			},
			{ text: " Yang ikut kerusuhan bakal " },
			{ text: "kena ban juga!", strong: true },
			{ text: " Jadi diemin aja, cukup " },
			{ text: "laporin ke admin!", strong: true },
		],
	},
	{
		icon: "\uD83D\uDE48",
		tone: "danger",
		segments: [{ text: "Dilarang pakai photo profil cabul!", strong: true }],
	},
	{
		icon: "\uD83D\uDCF5",
		tone: "danger",
		segments: [
			{
				text: "Dilarang mengirim photo atau gif cabul/tidak senonoh!",
				strong: true,
			},
		],
	},
	{
		icon: "\uD83C\uDFDB\uFE0F",
		tone: "danger",
		segments: [{ text: "DILARANG KOMENTAR SOAL POLITIK!!", strong: true }],
	},
	{
		icon: "\uD83D\uDCDA",
		tone: "warning",
		segments: [
			{
				text: "Yang belum tau cara spoiler, tolong lihat tutorial dulu yaa saudaraku!",
				strong: true,
			},
		],
	},
	{
		icon: "\uD83E\uDD2B",
		tone: "danger",
		segments: [
			{ text: "DILARANG SPOILER ENDING!!", strong: true },
			{ text: " Cukup " },
			{ text: "1–2 chapter ke depan aja!", strong: true },
		],
	},
	{
		icon: "\uD83D\uDCAC",
		tone: "danger",
		segments: [
			{ text: "DILARANG SPAM KOMENTAR BUAT LEVELING!", strong: true },
			{
				text: " Yang cuma spam emot atau komen hal yang sama tiap chapter juga ",
			},
			{ text: "kena ban!", strong: true },
			{ text: " Intinya, " },
			{ text: "leveling nggak wajar = auto ban!", strong: true },
			{ text: " Tolong yaa, yang normal aja \uD83D\uDE4F" },
		],
	},
];

const dotClass: Record<Rule["tone"], string> = {
	danger: "bg-[#E84118]",
	warning: "bg-amber-500",
};

const textClass: Record<Rule["tone"], string> = {
	danger: "text-red-400",
	warning: "text-amber-400",
};
</script>

<section aria-label={heading} class="rounded-[12px] border border-white/10 bg-[#242424] p-5">
	<div class="mb-4 flex items-center gap-3">
		<span
			class="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 text-base text-white"
			aria-hidden="true"
		>
			⚠️
		</span>
		<h3 class="text-lg font-semibold text-white">{heading}</h3>
	</div>

	<div class="space-y-3">
		{#each rules as rule (rule.segments[0].text)}
			<div class="flex gap-3">
				<span
					class={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs text-white ${dotClass[rule.tone]}`}
					aria-hidden="true"
				>
					{rule.icon}
				</span>
				<p class="text-sm leading-relaxed text-neutral-200">
					{#each rule.segments as segment, i (i)}
						{#if segment.strong}
							<span class={`font-semibold ${textClass[rule.tone]}`}>{segment.text}</span>
						{:else}
							{segment.text}
						{/if}
					{/each}
				</p>
			</div>
		{/each}
	</div>

	<div class="mt-5 border-t border-white/10 pt-4">
		<div class="mb-2 flex gap-3">
			<span
				class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs text-white"
				aria-hidden="true"
			>
				📢
			</span>
			<p class="text-sm leading-relaxed text-neutral-200">
				<span class="font-semibold text-amber-400">Noted:</span><br />
				Yang melanggar
				<span class="font-semibold text-red-400">rules di atas akan langsung kena BAN! Tanpa peringatan!</span>
			</p>
		</div>
		<div class="flex gap-3">
			<span
				class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E84118] text-xs text-white"
				aria-hidden="true"
			>
				🔒
			</span>
			<p class="text-sm leading-relaxed text-neutral-200">
				Akun komentarmu akan
				<span class="font-semibold text-red-400">dibanned permanen</span>
				dan
				<span class="font-semibold text-red-400">tidak bisa balik lagi!!!</span>
			</p>
		</div>
	</div>
</section>
