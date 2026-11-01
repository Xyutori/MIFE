/**
 * Mock domain data untuk rute `src/routes/*`.
 *
 * Diketik mengikuti kontrak lokal milik lane komponen
 * (`#lib/components/comic/types.ts`) karena semua komponen comic
 * memakai tipe tersebut (field `href`, bukan `link`).
 *
 * Data disalin dari prototipe `src/routes/+page.svelte` lama
 * (snapshot JSON Shinigami). Setelah API/adapter nyata tersedia,
 * ganti isi modul ini tanpa mengubah rute.
 */
import type {
	Announcement,
	BannerItem,
	Chapter,
	Reaction,
	Series,
	SeriesChapterMini,
} from "#lib/components/comic/types.js";

export type Country = "KR" | "CN" | "JP";
export type UpdateKind = "project" | "mirror";

export interface SeriesDetail extends Series {
	country: Country;
	kind: UpdateKind;
	synopsis?: string;
	genres: string[];
	status: string;
	author?: string;
	artist?: string;
	views: string;
	bookmarks: string;
	rank: number;
}

export interface ChapterDetail extends Chapter {
	id: string;
	seriesId: string;
	pages: string[];
}

interface SeriesSeed {
	id: string;
	title: string;
	cover: string;
	badge?: string;
	flag: string;
	country: Country;
	kind: UpdateKind;
	time: string;
	rating: number;
	views: string;
	bookmarks: string;
	status: string;
	genres: string[];
	synopsis?: string;
	chapters: { number: string; time: string; id: string }[];
}

function seriesFromSeed(seed: SeriesSeed, rank: number): SeriesDetail {
	return {
		id: seed.id,
		title: seed.title,
		cover: seed.cover,
		href: `/series/${seed.id}`,
		updatedAt: seed.time,
		badge: seed.badge,
		flag: seed.flag,
		rating: seed.rating,
		latestChapters: seed.chapters.map<SeriesChapterMini>((c) => ({
			number: c.number,
			time: c.time,
			href: `/read/${c.id}`,
		})),
		country: seed.country,
		kind: seed.kind,
		synopsis: seed.synopsis,
		genres: seed.genres,
		status: seed.status,
		views: seed.views,
		bookmarks: seed.bookmarks,
		rank,
	};
}

const ACTION = ["Action", "Fantasy", "Adventure"];
const MARTIAL = ["Action", "Martial Arts", "Fantasy"];

const SEEDS: SeriesSeed[] = [
	{
		id: "8d932279-c51c-4357-a291-3b08fb65a259",
		title: "Fighting Is Too Easy",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1790764024012_24onpk.jpg",
		badge: "UP",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "18 jam",
		rating: 8.4,
		views: "3,1 jt",
		bookmarks: "18,2 rb",
		status: "Ongoing",
		genres: MARTIAL,
		chapters: [
			{
				number: "Chapter 12",
				time: "18 jam",
				id: "672752aa-2587-4018-adae-0b7ade24bf66",
			},
			{
				number: "Chapter 11",
				time: "7 hari",
				id: "91dc21da-defd-42e7-a0ce-1ff615f41383",
			},
		],
	},
	{
		id: "f4eb0724-0874-4ce5-b9ae-b0c3ca832b50",
		title: "Demon Life Starting From A Baby",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1790767430557_52rox0.jpg",
		badge: "UP",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "10 jam",
		rating: 8.7,
		views: "5,4 jt",
		bookmarks: "32,7 rb",
		status: "Ongoing",
		genres: ["Fantasy", "Reincarnation", "Demons"],
		synopsis:
			"Terlahir kembali sebagai bayi iblis di dunia yang keras, ia harus bertahan hidup dengan kecerdasan kehidupan sebelumnya dan kekuatan iblis yang perlahan bangkit.",
		chapters: [
			{
				number: "Chapter 13",
				time: "10 jam",
				id: "6a199566-8476-4816-823b-c17c73633257",
			},
			{
				number: "Chapter 12",
				time: "7 hari",
				id: "90df5429-98ff-46af-b943-a45f8c99efa3",
			},
		],
	},
	{
		id: "854d243b-a912-4ce6-9a48-507911b55085",
		title: "A Beast Hunter's Way Of Life",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1779114368541_ylcz2v.jpg",
		badge: "UP",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "10 jam",
		rating: 8.2,
		views: "2,8 jt",
		bookmarks: "14,1 rb",
		status: "Ongoing",
		genres: ACTION,
		chapters: [
			{
				number: "Chapter 41",
				time: "10 jam",
				id: "603638c0-cc0f-4a41-a4e9-4fa1e9f3af1f",
			},
			{
				number: "Chapter 40",
				time: "7 hari",
				id: "ad3fd17e-5284-4a2f-b05e-d0e5e17ade6f",
			},
		],
	},
	{
		id: "0ee5001f-242f-439a-838b-1505a1a49cb7",
		title: "Absolute Dominion",
		cover: "https://assets.shngm.id/thumbnail/cover/66f0eee7f473.jpeg",
		badge: "UP",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "10 jam",
		rating: 8.9,
		views: "7,9 jt",
		bookmarks: "45,3 rb",
		status: "Ongoing",
		genres: MARTIAL,
		synopsis:
			"Demi membalas dendam sekte yang menghancurkannya, ia kembali ke masa lalu dengan seluruh ingatan dan bertekad menguasai dunia persilatan.",
		chapters: [
			{
				number: "Chapter 115",
				time: "10 jam",
				id: "c6b03144-2589-45f6-a8de-191e18277745",
			},
			{
				number: "Chapter 114",
				time: "6 hari",
				id: "47078890-3e72-4ba6-bb32-0073437f3160",
			},
		],
	},
	{
		id: "4a0b6c8f-1500-4e14-b2ed-364c72fa2963",
		title: "Chronicles Of The Demon Faction",
		cover: "https://assets.shngm.id/thumbnail/cover/d0289592bc07.jpeg",
		badge: "UP",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "10 jam",
		rating: 8.6,
		views: "4,6 jt",
		bookmarks: "27,9 rb",
		status: "Ongoing",
		genres: MARTIAL,
		synopsis:
			"Kronik kebangkitan faksi iblis: intrik sekte, perebutan tahta kegelapan, dan seorang pewaris yang menolak tunduk pada takdir.",
		chapters: [
			{
				number: "Chapter 195",
				time: "10 jam",
				id: "04bad11f-75c6-4d0c-b695-f6086397bfaa",
			},
			{
				number: "Chapter 194",
				time: "7 hari",
				id: "806abb82-dcfb-4c63-ab76-b0248005a24b",
			},
		],
	},
	{
		id: "c0f1d049-ff7f-474d-8ae1-2a4e5c44147",
		title: "Demonic Emperor",
		cover:
			"https://assets.shngm.id/thumbnail/image/8c4fdbee-ffb8-427d-ace7-fe1fe6b72f77.jpg",
		badge: "UP",
		flag: "🇨🇳",
		country: "CN",
		kind: "mirror",
		time: "12 jam",
		rating: 8.8,
		views: "12,3 jt",
		bookmarks: "61,5 rb",
		status: "Completed",
		genres: ACTION,
		chapters: [
			{
				number: "Chapter 929",
				time: "12 jam",
				id: "686c369b-d6bf-4a6a-b0b1-2412232ffdbd",
			},
			{
				number: "Chapter 928",
				time: "1 hari",
				id: "fdb68b5f-2949-4b31-ab08-3b394e599e2",
			},
		],
	},
	{
		id: "3f69cbfe-5e14-4562-be2c-eb0359c5c8f1",
		title: "Copy Skills With Affinity!",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1790950350431_wrvfqw.jpg",
		badge: "UP",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "18 jam",
		rating: 8.1,
		views: "1,9 jt",
		bookmarks: "9,8 rb",
		status: "Ongoing",
		genres: ["Action", "Fantasy", "System"],
		chapters: [
			{
				number: "Chapter 12",
				time: "18 jam",
				id: "1f3731bb-19a8-4dc2-8303-336938857e19",
			},
			{
				number: "Chapter 11",
				time: "7 hari",
				id: "9dcbe436-6765-4e40-b9e2-2f39297a9ebd",
			},
		],
	},
	{
		id: "a5d0bb1f-bfe4-4a5a-a72d-b7fa3695b202",
		title: "A Mercenary's Rebirth Among Nobles",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1769625749355_u2tg5s.jpg",
		badge: "UP",
		flag: "🇰🇷",
		country: "KR",
		kind: "mirror",
		time: "19 jam",
		rating: 8.3,
		views: "2,2 jt",
		bookmarks: "11,4 rb",
		status: "Ongoing",
		genres: ["Fantasy", "Reincarnation", "Nobility"],
		chapters: [
			{
				number: "Chapter 55",
				time: "19 jam",
				id: "4fab49be-8dd9-4a7e-89e1-2358933e33bd",
			},
			{
				number: "Chapter 54",
				time: "7 hari",
				id: "d9848fac-ceae-4eaa-94aa-2df1178f44db",
			},
		],
	},
	{
		id: "d0591c59-b418-409a-98f9-e6193c87baa0",
		title: "The Hero Cannot Rest",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1790771517697_pm72kv.jpg",
		badge: "UP",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "19 jam",
		rating: 8.0,
		views: "1,5 jt",
		bookmarks: "8,3 rb",
		status: "Ongoing",
		genres: ACTION,
		chapters: [
			{
				number: "Chapter 14",
				time: "19 jam",
				id: "8d00ab3e-e52c-4c4f-b7a7-f0591b79026b",
			},
			{
				number: "Chapter 13",
				time: "7 hari",
				id: "6200bcb9-8243-42a7-bb6d-7c2110a80c56",
			},
		],
	},
	{
		id: "16778db0-17c0-43d5-aa4a-3a4a0df5ec0b",
		title: "Overgeared",
		cover: "https://assets.shngm.id/thumbnail/cover/f38bf1beaa3b.jpeg",
		badge: "UP",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "20 jam",
		rating: 9.1,
		views: "15,7 jt",
		bookmarks: "88,2 rb",
		status: "Completed",
		genres: ["Action", "Fantasy", "Game"],
		synopsis:
			"Shin Youngwoo, pandai besi legendaris dalam game Satisfy, menempa jalannya dari pemain gagal menjadi legenda yang menggetarkan seluruh server.",
		chapters: [
			{
				number: "Chapter 346",
				time: "20 jam",
				id: "c2586800-28ce-457d-84c4-670d60078ad4",
			},
			{
				number: "Chapter 345",
				time: "7 hari",
				id: "b46138d8-21bf-45e6-ba5a-a9dc20e755f12",
			},
		],
	},
	{
		id: "a6dfca2a-2fde-414a-b28e-a8bc7492e69d",
		title: "The Genius Professor Wants To Take It Easy",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1790856227376_lhlvyo.jpg",
		badge: "UP",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "21 jam",
		rating: 8.5,
		views: "3,8 jt",
		bookmarks: "21,6 rb",
		status: "Ongoing",
		genres: ["Fantasy", "Academy", "Comedy"],
		chapters: [
			{
				number: "Chapter 26",
				time: "21 jam",
				id: "88c64f1b-7d2c-4fb9-af91-9a1885f78941",
			},
			{
				number: "Chapter 25",
				time: "7 hari",
				id: "8f59ce31-4851-4837-aad4-9ade4b38a653",
			},
		],
	},
	{
		id: "4f2f2720-15ed-460e-aa2b-4356353de3b7",
		title: "Helmut: The Forsaken Child",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1791647151868_dpgwjo.jpg",
		badge: "UP",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "21 jam",
		rating: 8.9,
		views: "6,2 jt",
		bookmarks: "38,4 rb",
		status: "Ongoing",
		genres: MARTIAL,
		synopsis:
			"Dibuang di Hutan Binatang Iblis sejak bayi, Helmut tumbuh di antara monster dan kini melangkah ke dunia manusia dengan kekuatan yang tak masuk akal.",
		chapters: [
			{
				number: "Chapter 139",
				time: "21 jam",
				id: "cdf61710-3d2c-4173-9659-3b794e933d0",
			},
			{
				number: "Chapter 138",
				time: "7 hari",
				id: "4ac23d8d-de31-43d4-9643-4ac23d8f80a9",
			},
		],
	},
	{
		id: "c8077427-0ad6-4358-9497-98fd338f6425",
		title: "My Dad Is The Strongest Under Heaven",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1790768510487_38qquf.jpg",
		badge: "UP",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "21 jam",
		rating: 8.2,
		views: "2,5 jt",
		bookmarks: "13,7 rb",
		status: "Ongoing",
		genres: MARTIAL,
		chapters: [
			{
				number: "Chapter 35",
				time: "21 jam",
				id: "f57fe149-26bb-4937-b54e-776f198f7d47",
			},
			{
				number: "Chapter 34",
				time: "7 hari",
				id: "07a59776-07a7-413b-9df4-adaa7ddd81a0",
			},
		],
	},
	{
		id: "846123dd-ee31-4cb3-b549-d79b88901418",
		title: "Got Dropped Into A Ghost Story, Still Gotta Work",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1790946719011_hmbrm4.jpg",
		badge: "UP",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "21 jam",
		rating: 8.6,
		views: "4,1 jt",
		bookmarks: "24,8 rb",
		status: "Ongoing",
		genres: ["Horror", "Fantasy", "Modern"],
		synopsis:
			"Sebuah acara dadakan untuk serial fantasi modern yang sangat kusukai sampai aku rela menggunakan cuti tahunanku yang berharga untuk pergi.",
		chapters: [
			{
				number: "Chapter 42",
				time: "21 jam",
				id: "da15b299-e233-480a-82b4-4e3ff978826f",
			},
			{
				number: "Chapter 41",
				time: "7 hari",
				id: "672450a5-88d1-4b98-9880-74acf1b5c530",
			},
		],
	},
	{
		id: "44b1c34e-1d54-4a00-8541-2cc8d0aec5",
		title: "Unrivaled Spear Demon",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1791162659866_4oltbk.jpg",
		badge: "UP",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "21 jam",
		rating: 8.4,
		views: "3,3 jt",
		bookmarks: "17,5 rb",
		status: "Ongoing",
		genres: MARTIAL,
		chapters: [
			{
				number: "Chapter 58",
				time: "21 jam",
				id: "af834880-fb2f-4b75-b8a8-2c301cd1d1c6",
			},
			{
				number: "Chapter 57",
				time: "7 hari",
				id: "86582164-47f6-49df-9369-91d10461b68f",
			},
		],
	},
	{
		id: "59fff84e-ee6b-4ad0-bd1d-207dd39872d",
		title: "The Villain Wants To Live",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1771185948926_9b40z6.jpg",
		badge: "UP",
		flag: "🇰🇷",
		country: "KR",
		kind: "mirror",
		time: "21 jam",
		rating: 8.7,
		views: "5,0 jt",
		bookmarks: "29,1 rb",
		status: "Ongoing",
		genres: ["Fantasy", "Villain", "Drama"],
		chapters: [
			{
				number: "Chapter 70",
				time: "21 jam",
				id: "640f95e8-97dc-44f9-9db9-ce8c36c4badf",
			},
			{
				number: "Chapter 69",
				time: "21 hari",
				id: "a621a567-56f5-4ea0-87f7-4f09879f8e42",
			},
		],
	},
	{
		id: "11adc193-f845-47c2-9740-1b696ccb5ec7",
		title: "Terminally-Ill Genius Dark Knight",
		cover:
			"https://assets.shngm.id/thumbnail/image/d0b36807-e12b-4638-b300-a851f95d756.jpg",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "1 hari",
		rating: 8.8,
		views: "6,8 jt",
		bookmarks: "40,2 rb",
		status: "Ongoing",
		genres: ["Fantasy", "Action", "Tragedy"],
		chapters: [
			{
				number: "Chapter 171",
				time: "1 hari",
				id: "ff6bc32e-c4b6-4ba4-ab92-2b2e73486221",
			},
			{
				number: "Chapter 170",
				time: "8 hari",
				id: "cf72a352-f24d-4b90-9148-40d35cfff877",
			},
		],
	},
	{
		id: "4b704ce2-4fab-4991-ab15-8bc9aa00e3c4",
		title: "Talker",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1792593678138_8fi28z.jpg",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "1 hari",
		rating: 8.0,
		views: "1,1 jt",
		bookmarks: "6,4 rb",
		status: "Ongoing",
		genres: ["Drama", "Fantasy"],
		chapters: [
			{
				number: "Chapter 9",
				time: "1 hari",
				id: "ee154265-a539-46ad-b404-2329173f8764",
			},
			{
				number: "Chapter 8",
				time: "9 hari",
				id: "28fee8de-eaa5-45bd-b8bd-2613c8690012",
			},
		],
	},
	{
		id: "15495a79-526d-4349-b23d-ba2fa866a6bd",
		title: "I Start With 13 Hidden Traits",
		cover:
			"https://assets.shngm.id/thumbnail/image/016c54be-82d5-42a5-a4e0-f14f8c67e21b.jpg",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "1 hari",
		rating: 8.1,
		views: "1,4 jt",
		bookmarks: "7,9 rb",
		status: "Ongoing",
		genres: ["Action", "Fantasy", "System"],
		chapters: [
			{
				number: "Chapter 53",
				time: "1 hari",
				id: "a617b0e5-7720-4218-85da-428c6d7d9b210",
			},
			{
				number: "Chapter 52",
				time: "7 hari",
				id: "bc5778cf-9b6a-4a15-bf92-3b394d6da9a8",
			},
		],
	},
	{
		id: "17ae038f-8876-4d1e-a679-0235fc4ae80b",
		title: "Sword Of The Undying",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1779113403834_n89aqx.jpg",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "1 hari",
		rating: 8.3,
		views: "1,7 jt",
		bookmarks: "9,1 rb",
		status: "Ongoing",
		genres: ACTION,
		chapters: [
			{
				number: "Chapter 33",
				time: "1 hari",
				id: "8393fb2b-a516-43a8-b890-7757871a5433",
			},
			{
				number: "Chapter 32",
				time: "7 hari",
				id: "899dc73b-e97e-42d4-a66e-6e01ba711ac6",
			},
		],
	},
	{
		id: "ad6fa0a8-43b5-4dd1-aa89-1a1bbde66f65",
		title: "Solo Max-Level Newbie",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1780413923682_yyo9my.jpg",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "1 hari",
		rating: 9.0,
		views: "11,2 jt",
		bookmarks: "72,6 rb",
		status: "Ongoing",
		genres: ["Action", "Fantasy", "Game"],
		synopsis:
			"Jinhyuk, streamer yang menamatkan game tower yang mustahil, terbangun di dunia nyata ketika menara itu benar-benar muncul dan ia satu-satunya yang tahu cara menaklukkannya.",
		chapters: [
			{
				number: "Chapter 283",
				time: "1 hari",
				id: "5e4a9ee9-5b54-483a-8370-6fd41ced9392",
			},
			{
				number: "Chapter 282",
				time: "8 hari",
				id: "4f8a4665-73fd-452b-8508-2d2f172ff9b07",
			},
		],
	},
	{
		id: "9c356f48-035c-40b4-9834-c491e031fb0f",
		title: "From Goblin To Goblin God",
		cover: "https://assets.shngm.id/thumbnail/cover/cc8e39a5d7f8.jpeg",
		flag: "🇨🇳",
		country: "CN",
		kind: "mirror",
		time: "1 hari",
		rating: 8.5,
		views: "4,9 jt",
		bookmarks: "26,3 rb",
		status: "Ongoing",
		genres: ["Fantasy", "Evolution", "Monsters"],
		chapters: [
			{
				number: "Chapter 129",
				time: "1 hari",
				id: "0aa5a5bf-714f-432b-a226-74f8381495f6",
			},
			{
				number: "Chapter 128",
				time: "8 hari",
				id: "9fbd4856-fa37-4d5c-ad63-6a6f487ccae3",
			},
		],
	},
	{
		id: "bd6e8536-6af4-4bf1-b159-8b79284799d0",
		title: "The Extra's Academy Survival Guide",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1769091919073_j8x1vv.jpg",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "1 hari",
		rating: 8.6,
		views: "5,8 jt",
		bookmarks: "33,1 rb",
		status: "Ongoing",
		genres: ["Fantasy", "Academy", "Survival"],
		synopsis:
			"Terlempar ke dalam novel sebagai karakter figuran yang ditakdirkan mati, ia menyusun panduan bertahan hidup dengan memanfaatkan pengetahuannya tentang alur cerita.",
		chapters: [
			{
				number: "Chapter 130",
				time: "1 hari",
				id: "359978e4-8db3-4c55-9d7e-76bed8f3d6d8",
			},
			{
				number: "Chapter 129",
				time: "8 hari",
				id: "6662fa8a-d556-4267-aad4-3e13c57ae46e1",
			},
		],
	},
	{
		id: "84561956-c987-491d-a189-ba1ab928c10",
		title: "Became The Patron Of Villains",
		cover:
			"https://assets.shngm.id/thumbnail/image/06b7fcc3-026d-4e5d-b12d-78e68f8547fd.jpg",
		flag: "🇰🇷",
		country: "KR",
		kind: "mirror",
		time: "1 hari",
		rating: 8.2,
		views: "2,0 jt",
		bookmarks: "10,5 rb",
		status: "Ongoing",
		genres: ["Fantasy", "Villain", "Regression"],
		chapters: [
			{
				number: "Chapter 59",
				time: "1 hari",
				id: "6ef9ce7f-b277-4de6-b515-dad20e4e0886",
			},
			{
				number: "Chapter 58",
				time: "8 hari",
				id: "6143b433-0b39-4bcf-9fc9-5c1d9e57b786",
			},
		],
	},
	{
		id: "a3ea51f3-eb48-4e50-9bfb-8adc83fc8588",
		title: "Martial Emperor Beyond Transcendence",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1793157816559_9x0hwl.jpg",
		badge: "NEW",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "3d",
		rating: 8.4,
		views: "980 rb",
		bookmarks: "5,2 rb",
		status: "Ongoing",
		genres: MARTIAL,
		chapters: [
			{
				number: "Chapter 10",
				time: "3d",
				id: "a3ea51f3-eb48-4e50-9bfb-8adc83fc8588-c10",
			},
			{
				number: "Chapter 9",
				time: "10d",
				id: "a3ea51f3-eb48-4e50-9bfb-8adc83fc8588-c9",
			},
		],
	},
	{
		id: "dbc0c89d-060e-47ca-ac80-a2fe32567009",
		title: "The Crimson Dragon Martial Emperor",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1790855681345_5klngk.jpg",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "3d",
		rating: 8.3,
		views: "870 rb",
		bookmarks: "4,6 rb",
		status: "Ongoing",
		genres: MARTIAL,
		chapters: [
			{
				number: "Chapter 12",
				time: "3d",
				id: "dbc0c89d-060e-47ca-ac80-a2fe32567009-c12",
			},
			{
				number: "Chapter 11",
				time: "10d",
				id: "dbc0c89d-060e-47ca-ac80-a2fe32567009-c11",
			},
		],
	},
	{
		id: "8d36d3f0-b356-45c3-a78a-695fbbde92db",
		title: "Solo Swordmaster",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1790853140048_nnazml.jpg",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "3d",
		rating: 8.1,
		views: "760 rb",
		bookmarks: "3,9 rb",
		status: "Ongoing",
		genres: ACTION,
		chapters: [
			{
				number: "Chapter 8",
				time: "3d",
				id: "8d36d3f0-b356-45c3-a78a-695fbbde92db-c8",
			},
			{
				number: "Chapter 7",
				time: "11d",
				id: "8d36d3f0-b356-45c3-a78a-695fbbde92db-c7",
			},
		],
	},
	{
		id: "db0d7504-5e1f-4159-8966-84dfa07fb08f",
		title: "The Crazy Villain Regains His Sanity",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1791476150478_1aqoiw.jpg",
		flag: "🇰🇷",
		country: "KR",
		kind: "mirror",
		time: "3d",
		rating: 8.5,
		views: "1,2 jt",
		bookmarks: "6,8 rb",
		status: "Ongoing",
		genres: ["Action", "Villain", "Regression"],
		chapters: [
			{
				number: "Chapter 15",
				time: "3d",
				id: "db0d7504-5e1f-4159-8966-84dfa07fb08f-c15",
			},
			{
				number: "Chapter 14",
				time: "10d",
				id: "db0d7504-5e1f-4159-8966-84dfa07fb08f-c14",
			},
		],
	},
	{
		id: "76ed94ae-9d0e-4004-a034-590a55de568d",
		title: "Immortal's Way Of Life",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1777845130582_6i9rxf.jpg",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "4d",
		rating: 8.0,
		views: "690 rb",
		bookmarks: "3,4 rb",
		status: "Ongoing",
		genres: ["Fantasy", "Cultivation", "Slice of Life"],
		chapters: [
			{
				number: "Chapter 22",
				time: "4d",
				id: "76ed94ae-9d0e-4004-a034-590a55de568d-c22",
			},
			{
				number: "Chapter 21",
				time: "11d",
				id: "76ed94ae-9d0e-4004-a034-590a55de568d-c21",
			},
		],
	},
	{
		id: "4f4db2f2-4e93-4c96-a992-86565da2cf0c",
		title: "I Became The Youngest Martial God",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1790764950511_1n833z.jpg",
		flag: "🇰🇷",
		country: "KR",
		kind: "mirror",
		time: "4d",
		rating: 8.2,
		views: "810 rb",
		bookmarks: "4,1 rb",
		status: "Ongoing",
		genres: MARTIAL,
		chapters: [
			{
				number: "Chapter 18",
				time: "4d",
				id: "4f4db2f2-4e93-4c96-a992-86565da2cf0c-c18",
			},
			{
				number: "Chapter 17",
				time: "11d",
				id: "4f4db2f2-4e93-4c96-a992-86565da2cf0c-c17",
			},
		],
	},
	{
		id: "e6f3b404-6613-49d1-9116-00a210d4f3b7",
		title: "Contract Killer Enrollment",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1785759902408_04b070.jpg",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "5d",
		rating: 7.9,
		views: "540 rb",
		bookmarks: "2,7 rb",
		status: "Ongoing",
		genres: ACTION,
		chapters: [
			{
				number: "Chapter 6",
				time: "5d",
				id: "e6f3b404-6613-49d1-9116-00a210d4f3b7-c6",
			},
			{
				number: "Chapter 5",
				time: "12d",
				id: "e6f3b404-6613-49d1-9116-00a210d4f3b7-c5",
			},
		],
	},
	{
		id: "5d11cfe5-76ad-4323-9694-269418d6892",
		title: "The Newbie Civil Servant Hunts Villains Before Going Home",
		cover:
			"https://assets.shngm.id/thumbnail/cover/banner_1792506671599_8xu1ep.jpg",
		flag: "🇰🇷",
		country: "KR",
		kind: "project",
		time: "5d",
		rating: 8.0,
		views: "610 rb",
		bookmarks: "3,1 rb",
		status: "Ongoing",
		genres: ["Action", "Fantasy", "Comedy"],
		chapters: [
			{
				number: "Chapter 7",
				time: "5d",
				id: "5d11cfe5-76ad-4323-9694-269418d6892-c7",
			},
			{
				number: "Chapter 6",
				time: "12d",
				id: "5d11cfe5-76ad-4323-9694-269418d6892-c6",
			},
		],
	},
];

export const mockSeries: SeriesDetail[] = SEEDS.map((seed, i) =>
	seriesFromSeed(seed, i + 1),
);

export const mockBanners: BannerItem[] = [
	{
		title: "Got Dropped Into A Ghost Story, Still Gotta Work",
		rating: "8.6",
		tags: [
			{ label: "New", color: "#f79f1f" },
			{ label: "Popular", color: "#e84118" },
		],
		description:
			"Sebuah acara dadakan untuk serial fantasi modern yang sangat kusukai sampai aku rela menggunakan cuti tahunanku yang berharga untuk pergi.",
		href: "/series/846123dd-ee31-4cb3-b549-d79b88901418",
		banner:
			"https://assets.shngm.id/thumbnail/banner/banner_1786001844086_z7n82u.webp",
		character:
			"https://assets.shngm.id/thumbnail/banner/banner_1786001852291_83yhz4.png",
	},
];

export const mockAnnouncements: Announcement[] = [
	{
		id: "8dfa0456-9c8a-4f0e-a1de-5153a26e13e5",
		title: "Premium Sekarang Cuma 12500!!!",
		date: "16 November 2025",
		image:
			"https://assets.shngm.id/thumbnail/image/72cea7ce-532f-4fea-b83f-80a41ecc340c.jpg",
		href: "/announcement/8dfa0456-9c8a-4f0e-a1de-5153a26e13e5",
	},
	{
		id: "39d20eb5-ddd1-419b-a7d4-1bba6b6f8e43",
		title: "Pengumuman Rekrutmen Pengembangan Aplikasi",
		date: "03 August 2025",
		image:
			"https://assets.shngm.id/thumbnail/image/3461e783-5411-4798-8d3e-2a2a7a566953.jpg",
		href: "/announcement/39d20eb5-ddd1-419b-a7d4-1bba6b6f8e43",
	},
	{
		title: "⚠️ Pengumuman Maintenance",
		date: "20 July 2025",
		image:
			"https://assets.shngm.id/thumbnail/image/70cd5f82-c47d-462e-8a3a-6283ef54705e.jpg",
		href: "/announcement/d25df221-3d65-439b-a128-119ce88ab882",
	},
	{
		title: "RULES KOMENTAR !! DIBACA ATAU KENA BAN !!",
		date: "12 June 2025",
		image:
			"https://assets.shngm.id/thumbnail/image/dc7585f8-e7f6-46c0-9187-a4bbe037b717.jpg",
		href: "/announcement/aa1c0c53-924d-4f68-8040-25d4a2685dc3",
	},
	{
		title: "Bang udah bang",
		date: "09 June 2025",
		image:
			"https://assets.shngm.id/thumbnail/image/445f614a-a416-4785-b356-55d2294c97d.jpg",
		href: "/announcement/fcdf9772-aacc-4c37-bfa7-2b2f74444c97",
	},
	{
		title: "BACA SUPAYA GAK BANYAK TANYA",
		date: "04 June 2025",
		image:
			"https://assets.shngm.id/thumbnail/image/b483418e-826a-4a2c-81c9-b0f5bda31564.jpg",
		href: "/announcement/ccd084e7-82d3-47fe-b7e1-0bf5bda6164",
	},
	{
		title: "Link Baru Shinigami",
		date: "29 May 2025",
		image:
			"https://assets.shngm.id/thumbnail/image/42541925-c2a3-47be-8e38-64438a2a31aa.jpg",
		href: "/announcement/11c244f5-d91d-4b5e-8309-06f96c6401c9",
	},
	{
		title: "Komentar Baru Shinigami 🔥🔥🔥",
		date: "17 May 2025",
		image:
			"https://assets.shngm.id/thumbnail/image/68fc6e3e-30fd-4d9d-ae9b-eb2c32f13121.jpg",
		href: "/announcement/a47f45ef-0e19-466e-a83a-eb2c6ffa46e",
	},
];

export const mockReactions: Reaction[] = [
	{
		id: "seru",
		label: "Seru",
		image:
			"https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f525.png",
		votes: 128,
	},
	{
		id: "suka",
		label: "Suka",
		image:
			"https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2764.png",
		votes: 210,
	},
	{
		id: "kaget",
		label: "Kaget",
		image:
			"https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f631.png",
		votes: 64,
	},
	{
		id: "sedih",
		label: "Sedih",
		image:
			"https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f62d.png",
		votes: 86,
	},
	{
		id: "keren",
		label: "Keren",
		image:
			"https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f44f.png",
		votes: 45,
	},
];

function chapterPages(chapterId: string): string[] {
	return Array.from(
		{ length: 8 },
		(_, i) => `https://picsum.photos/seed/symi-${chapterId}-${i}/800/1200`,
	);
}

function toChapterDetail(
	seriesId: string,
	c: { number: string; time: string; id: string },
): ChapterDetail {
	return {
		id: c.id,
		seriesId,
		number: c.number,
		time: c.time,
		href: `/read/${c.id}`,
		pages: chapterPages(c.id),
	};
}

export function getSeriesById(id: string): SeriesDetail | undefined {
	return mockSeries.find((s) => s.id === id);
}

export function getSeriesChapters(seriesId: string): ChapterDetail[] {
	const series = getSeriesById(seriesId);
	if (!series) return [];
	return (series.latestChapters ?? []).map((c) =>
		toChapterDetail(seriesId, {
			number: c.number,
			time: c.time,
			id: c.href.replace("/read/", ""),
		}),
	);
}

export interface ChapterContext {
	series: SeriesDetail;
	chapter: ChapterDetail;
	prevId: string | null;
	nextId: string | null;
}

export function getChapterContext(
	chapterId: string,
): ChapterContext | undefined {
	for (const series of mockSeries) {
		const chapters = getSeriesChapters(series.id);
		const index = chapters.findIndex((c) => c.id === chapterId);
		if (index === -1) continue;
		return {
			series,
			chapter: chapters[index],
			prevId: chapters[index + 1]?.id ?? null,
			nextId: chapters[index - 1]?.id ?? null,
		};
	}
	return undefined;
}
