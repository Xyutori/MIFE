# Analisis Codebase MIFE

Tanggal: 2026-11-01
Sifat: read-only recon (5 lane Explorer paralel, 4 selesai + 1 dibatalkan dan diganti verifikasi langsung Orchestrator). Tidak ada file source yang diubah; satu-satunya tulisan adalah dokumen ini.
Catatan: dokumen `docs/codebase-analysis.md` versi 2026-10-31 sudah basi — ia mendeskripsikan status "scaffold auth-only" yang tidak lagi sesuai; analisis ini menggantikannya berdasarkan temuan baru.

> Legenda status bukti: **[T]** = dibaca langsung Orchestrator; **[E]** = klaim Explorer (laporan subagent, belum dibaca ulang). Bagian "Belum terverifikasi" menandai klaim yang gagal dikonfirmasi.

## 1. Ringkasan

MIFE adalah monorepo Bun + Nx hasil scaffold Better-T-Stack **[T]** (`bts.jsonc` dilaporkan: frontend Svelte, backend Elysia, runtime Bun, DB PostgreSQL, ORM Drizzle, auth better-auth, addons biome/evlog/lefthook/mcp/nx/skills/tauri) **[E]**.

Status implementasi saat ini: **aplikasi katalog komik + anime yang sudah berkembang**, bukan lagi scaffold auth-only:

- Backend `apps/server` (Elysia di Bun): 10 modul route dimount di `apps/server/src/index.ts:66-75` **[T]**, dengan domain katalog komik (`mife.ts`), anime (`anime.ts`), bookmark, preferences, scrape jobs, admin library, archive, images, admin users/roles, dan auth **[E, sebagian T]**.
- Database: 35 tabel (auth 4, catalog 16, anime 6, bookmarks 3, preferences 1, RBAC 5) via Drizzle ORM + PostgreSQL **[E]**; file schema terkonfirmasi ada (`packages/db/src/schema/*.ts` — 7 file) **[T]**.
- Frontend `apps/web` (SvelteKit 2 + Svelte 5, SPA `ssr=false`, adapter-static, PWA, wrapper Tauri): routes `admin/ anime/ baca/ bookmark/ dashboard/ komik/ library/ login/ profile/ settings/ super-komik/` **[T]**; komponen domain anime/admin/katalog yang ekstensif **[E]**.
- Auth: Better Auth 1.7.12 (Google/GitHub OAuth, email/password disabled) + RBAC custom (roles/permissions, admin gate middleware) **[E]**.

## 2. Struktur Arsitektur

Terverifikasi langsung **[T]**:

- Root workspace Bun: `package.json:4-8` (`apps/*`, `packages/*`), `packageManager bun@1.4.3` (`package.json:51`).
- Orkestrasi Nx 24: script `dev / build / check-types / dev:web / dev:server / db:push / db:studio / db:generate / db:migrate / docker:* / env:generate` di `package.json:20-37`.
- Env: Varlock codegen via `postinstall`/`env:generate` (`package.json:34-35`); `bunfig.toml` menonaktifkan auto-load env Bun (klaim Explorer, konsisten dengan `README.md:51-57`) **[E/T]**.
- Entry backend `apps/server/src/index.ts:1-81` **[T]**: Elysia + CORS (`ENV.CORS_ORIGIN` + desktopOrigins), evlog observability, `identifyUser` (exclude `/api/auth/**`), `adminGate`, 10 modul route, `GET / -> "OK"`, `listen(ENV.PORT)`, `startBackgroundJobs()`, serta seed saat boot (`ensureRbacSeed`, `ensureBootstrapAdmin`, `seedWorkspaceSources`, baris 37-39).
- Struktur `apps/server/src/` **[T]**: `anime/ auth/ cache/ catalog/ jobs/ media/ rbac/ routes/ sources/ storage/ env.server.ts env.ts index.ts services.ts`.
- Frontend routes **[T]** (`apps/web/src/routes`): `admin/ anime/ baca/ bookmark/ dashboard/ komik/ library/ login/ profile/ settings/ super-komik/ +layout.svelte +layout.ts +page.svelte`.
- `packages/db/src/schema/` **[T]**: `auth.ts anime.ts bookmarks.ts catalog.ts preferences.ts rbac.ts index.ts` (+ `relations.ts`, `migrate-from-xymi.ts` di parent — klaim Explorer) **[E]**.

Klaim Explorer belum dibaca ulang **[E]**:

- `apps/server`: entry `package.json` main `src/index.ts`, dev `bun run --hot`, build `tsdown`; dependensi workspace `@SyMi/auth`, `@SyMi/db` + AWS S3, evlog, sharp.
- `apps/web`: layout `+layout.svelte`, hook `hooks.server.ts` (evlog), `src/lib/api.ts` + `auth-client.ts`; Tauri conf (`frontendDist ../build`); `apps/web` tidak mengimpor `@SyMi/*` — komunikasi ke server via HTTP (`PUBLIC_SERVER_URL`).
- `packages/auth`: factory `createAuth` (`packages/auth/src/index.ts`), OAuth providers, drizzle adapter. `packages/config`: hanya `tsconfig.base.json` (strict), tanpa build script.
- Relasi: `apps/server/src/services.ts` import `createAuth`/`createDb`; `packages/auth` import schema `@SyMi/db`.

## 3. Modul Terkait Kebutuhan

| Modul | Path | Tanggung jawab |
|---|---|---|
| server bootstrap | `apps/server/src/index.ts` **[T]** | Elysia setup, CORS, adminGate, mount 10 route, seed, background jobs |
| komik/library API | `apps/server/src/routes/mife.ts` **[E]** | Katalog komik: library, chapters, pages, images (endpoint `GET /api/v1/library` di `mife.ts:222`) |
| anime API | `apps/server/src/routes/anime.ts` **[E]** | Read anime (`GET /api/v1/anime/sources` di `anime.ts:91`); adapter situs `apps/server/src/anime/sources` (otakudesu/kuramanime/oploverz — side-effect import di `index.ts:16`) |
| bookmark API | `apps/server/src/routes/bookmarks.ts` **[E]** | CRUD grup bookmark + item (`GET /api/v1/bookmarks` di `:354`, auth required) |
| preferences API | `apps/server/src/routes/preferences.ts` **[E]** | Preferensi user (`GET` di `:90`, session required) |
| scrape jobs | `apps/server/src/routes/scrapes.ts`, `apps/server/src/jobs/scheduler.ts` **[E]** | Admin scrape job routes (`:103-289`), background scheduler (`:94-138`), worker-lease |
| library admin | `apps/server/src/routes/library-admin.ts` **[E]** | Mutasi admin (`:54,78,99`) |
| archive | `apps/server/src/routes/archive.ts` **[E]** | Export/import (`:289,390`) |
| images | `apps/server/src/routes/images.ts` **[E]** | Image proxy/repair (`:18,38`) |
| admin users/roles | `apps/server/src/routes/admin.ts` **[E]** | `GET /api/admin/users` (`:36`, permission `users.read`) |
| auth | `apps/server/src/routes/auth.ts`, `packages/auth/src/index.ts` **[E]** | Profile (`GET/PATCH /api/auth/profile` `:148/:174`), better-auth handler |
| katalog read | `apps/server/src/catalog/series.ts`, `apps/server/src/catalog/anime.ts` **[E]** | Query FTS/ILIKE + pagination |
| storage/cache | `apps/server/src/storage/s3.ts`, `apps/server/src/cache/index.ts` **[E]** | Private bucket S3 + proxy; in-memory LRU `cacheRemember` |
| RBAC | `apps/server/src/rbac/{seed,bootstrap,permissions,gates}.ts` **[E]** | Seed role, bootstrap admin, `isAdmin/hasPermission` (raw SQL), `adminGate` (403 non-admin di `/api/admin`) |
| web anime/komik UI | `apps/web/src/lib/components/{anime,catalog,comic}/`, `src/routes/{anime,komik,baca,library,super-komik}/` **[E/T]** | Card/carousel/filter/reader views |
| web admin UI | `apps/web/src/lib/components/admin/`, `src/routes/admin/` **[E]** | Gate/shell/panel statistik, scrape runs, media integrity, roles, users |

## 4. Database Schema dan Relasi

Seluruh bagian ini **[E]** (skema belum dibaca ulang Orchestrator; keberadaan file schema terkonfirmasi **[T]**):

- ORM: Drizzle ORM (`drizzle-orm`, driver `pg`), dialect PostgreSQL; koneksi `createDb(env)` via `DATABASE_URL` (`packages/db/src/index.ts:6-8`); Drizzle Kit config (`drizzle.config.ts:4-11`, schema `./src/schema/index.ts`, out `./src/migrations`).
- Tidak ada service database di `docker-compose.yml` (hanya service `server`) — PostgreSQL diasumsikan eksternal.
- Ekstensi `pg_trgm`; search via `tsvector` + index GIN di `series` dan `anime_series`.
- 35 tabel: auth 4 (`user, session, account, verification` — FK user ON DELETE CASCADE), catalog 16 (`workspaces, sources, series, series_aliases, series_genres, series_sources, chapters, chapter_sources, image_blobs, chapter_pages, image_variants, media_assets, scrape_runs, scrape_events, source_scrape_state, app_settings`), anime 6 (`anime_series, anime_series_genres, anime_sources, anime_episodes, anime_episode_sources, anime_thumbnails`), bookmarks 3 (`bookmark_groups, comic_bookmark_entries, anime_bookmark_entries`), preferences 1 (`user_preferences`), RBAC 5 (`rbac_roles, rbac_permissions, rbac_role_permissions, rbac_user_roles, user_media`).
- PK mayoritas `text`; kolom user/owner tertentu (`bookmark_groups.user_id`, `rbac_user_roles.user_id`, `user_media.owner_user_id`) **sengaja tanpa FK** ke `user` (decouple dari auth adapter).
- Status/reader enums via CHECK (`reader_url_status` pending/running/complete/complete_empty/failed; `media_type` comic/anime; `user_media.media_type` profile_avatar/profile_header/bookmark_group_cover).
- Relasi digabung di `packages/db/src/relations.ts` (`defineRelations(schema)` + `authRelations` dari better-auth drizzle adapter).
- Seed runtime saat boot (`index.ts:38-39`): `ensureRbacSeed` (upsert roles/permissions + grant ke `admin`), `ensureBootstrapAdmin` (promosi email bootstrap bila belum ada admin), `seedWorkspaceSources` (workspaces `mife, superkomik, anime` + 7 sources + scrape state).
- Migrasi data one-shot `packages/db/src/migrate-from-xymi.ts` (SQLite legacy → Postgres), bukan runtime. 2 file migrasi SQL dilaporkan ada (DDL awal + ALTER user).

## 5. API dan Business Logic

Terverifikasi langsung **[T]**: daftar 10 modul route yang dimount (`index.ts:66-75`): `mifeRoutes, animeRoutes, bookmarkRoutes, preferenceRoutes, scrapesRoutes, imagesRoutes, libraryAdminRoutes, archiveRoutes, adminRoutes, authRoutes`.

Detail endpoint (klaim Explorer **[E]**, kecuali pola umum yang konsisten dengan mount di atas):

- Framework murni Elysia (tanpa tRPC); web konsumsi via `apps/web/src/lib/api.ts` (helper `apiBase/fetchUntilConnected/readJson`).
- Auth: better-auth 1.7.12, provider Google/GitHub, email/password disabled; banned-user gating di handler + DB hooks; `adminGate` blokir `/api/admin` non-admin (403, kecuali OPTIONS).
- Validasi input: Elysia TypeBox `t`; **tidak** ditemukan zod/valibot di `apps/server/src` (zod hanya dependency catalog, tanpa import).
- Contoh endpoint penting: `GET /api/auth/profile` (`auth.ts:148`, 401 bila tanpa session), `PATCH /api/auth/profile` (`auth.ts:174`), `GET /api/v1/bookmarks?type=comic|anime` (`bookmarks.ts:354`), `GET /api/v1/anime/sources` (`anime.ts:91`, public), `GET /api/admin/users` (`admin.ts:36`, permission `users.read`), `GET /api/v1/preferences` (`preferences.ts:90`), `GET /api/v1/library` (`mife.ts:222`).
- Background jobs: `startBackgroundJobs()` (`jobs/scheduler.ts:94-138`).

**Belum terverifikasi**: klaim `POST /api/v1/media/uploads` di `routes/uploads.ts:39` **gagal konfirmasi** — glob `apps/server/src/routes/*.ts` hanya menemukan 10 file (tanpa `uploads.ts`) dan grep `uploads` di `apps/server/src` nol hasil. Anggap klaim ini tidak berlaku sampai ada bukti.

## 6. Komponen UI yang Dapat Digunakan Kembali

Seluruh bagian ini **[E]** (belum dibaca ulang; daftar route web terkonfirmasi **[T]**):

- Framework: SvelteKit 2 + Svelte 5 (runes `$state/$derived/$effect`), Tailwind v4 (design tokens di `src/app.css`, dark default); SPA `ssr=false/prerender=false` (`routes/+layout.ts:2-3`), adapter-static fallback `index.html`; PWA (workbox precache) + IndexedDB offline chapter cache (`src/lib/offline/chapters.ts`, via `idb`).
- Tidak ada `packages/ui` terpisah; komponen di `apps/web/src/lib/components/` (+ `src/components/`): `Header.svelte`, `UserMenu.svelte`.
- UI primitives: `ui/select/Select.svelte` (satu-satunya pemakai bits-ui), `ui/combobox/GenreMultiSelect.svelte` (+ `genres.ts`). `class-variance-authority` terpasang tapi grep tidak menemukan pemakaian di `src`.
- Domain: `anime/` (AnimeCard, AnimeCatalog, AnimeDetailView, AnimeFilterPanel, AnimeHeroCarousel, AnimeWatchView), `catalog/` (CatalogFilterPanel, HeroSkeleton), `comic/` (ThumbnailImage), umum (HeroCarousel, MangaCard, Pagination, BookmarkButton, DownloadButton, ReaderView).
- Admin: AdminGate, AdminShell, AdminPanel, AdminNotice, AdminStatCard, AdminSourceFormCard, ErrorState, LibraryArchiveActions, ScrapeEventList (+ ScrapeRunsPanel, AdminMediaPanel, AdminRolesPanel, AdminUsersPanel, AnimeSourcesPanel, ComicLibraryPanel, ComicScrapeOverview, ComicScrapePanel, MediaIntegrityOverview, SuperKomikJobsPanel).
- Profile/auth: ProfilePage, SettingsPanel, LoginCta, ProviderLogo, SocialLogin.
- State: runes lokal dominan; session via `authClient.useSession()` (better-auth Svelte client); tidak ditemukan `svelte/store` maupun TanStack Query.
- Data fetching: fetch per-komponen ke API server via helper `api.ts`; load SvelteKit minimal (params/redirect).

## 7. Conventions dan Patterns yang Ada

Terverifikasi langsung **[T]**:

- `package.json`: scope monorepo, katalog versi terpusat (`zod ^4.5.4`, `typescript ^6.0.3`, `better-auth 1.7.12`, `drizzle-orm 1.0.0-rc.5`, `evlog ^2.33.1`, `varlock 1.23.0`), script Nx (`dev/build/check-types/db:*`), `postinstall` Varlock codegen.
- Biome (`biome.json`): indent tab, quote ganda, preset recommended + style rules ketat (`noParameterAssign`, `useSelfClosingElements`, dll — error), Tailwind class sorting (warn, nursery), override Svelte/Vue melonggarkan `useConst/useImportType/noUnusedVariables/noUnusedImports`.
- Lefthook (`lefthook.yml`): pre-commit paralel Biome `check --write` pada file staged JS/TS/JSON.
- README: panduan instalasi, setup PostgreSQL + `db:push`, Varlock env workflow, Docker Compose (target server), script Tauri desktop, alur `auth:generate` (Better Auth CLI via `varlock run`, output ke `packages/db/src/schema/auth.ts`).
- Tidak ada script test di root `package.json`; satu-satunya hit grep test adalah script `auth:generate` di `apps/server/package.json` — **tidak ditemukan infra test** (vitest/jest/playwright) **[T]**.

Klaim Explorer **[E]**: factory pattern (`createDb`, `createAuth`), validasi Elysia TypeBox, seed-on-boot idempotent (`onConflictDoNothing`).

## 8. Potensi Masalah dan Risiko

Fakta (dengan bukti):

1. **Tidak ada automated test** — tanpa script test maupun config vitest/jest/playwright **[T]**. Risiko regresi tinggi mengingat 35 tabel + 10 modul route + background jobs.
2. **DB eksternal tak terdefinisi di compose** — `docker-compose.yml` hanya service `server` (klaim **[E]**); onboarding lokal butuh PostgreSQL manual (`README:29-38` **[T]**).
3. **Kolom user tanpa FK** (`bookmark_groups.user_id`, `rbac_user_roles.user_id`, `user_media.owner_user_id`) **[E]** — integritas referensial user-group/role/media tidak ditegakkan DB; penghapusan user bisa meninggalkan orphan (perlu verifikasi aturan cleanup di code).
4. **Drizzle `1.0.0-rc.5`** (release candidate) di katalog root **[T]** — API bisa berubah sebelum stabil.
5. **Cookie `sameSite: none + secure: true`** (klaim **[E]** dari auth config lama) — bila masih berlaku, dev HTTP localhost berpotensi gagal menyimpan session; perlu verifikasi di `packages/auth/src/index.ts` saat ini.
6. **Dokumen analisis lama basi** — versi 2026-10-31 mengklaim "scaffold auth-only / tanpa tabel domain / tanpa endpoint bisnis", yang bertentangan dengan temuan ini. Jangan pakai dokumen lama sebagai acuan.

Perlu verifikasi lanjutan (belum ada bukti):

- Aturan cleanup orphan user, kebijakan retry/idempotensi scrape worker-lease, penanganan N+1 di query katalog, dan sanitasi URL eksternal (`safeExternalUrl` dilaporkan ada di `catalog/series.ts`).
- Riwayat git belum diperiksa (secret, baseline uncommitted).
- Build/lint/typecheck belum dijalankan (sengaja, sesuai instruksi read-only).

## 9. Ketidakpastian / Batasan

- 4 dari 5 lane Explorer selesai; lane conventions/risiko dibatalkan dan diganti verifikasi langsung Orchestrator (bagian 7-8 di atas) — cakupan grep risiko (TODO/FIXME, hardcoded secret) belum dijalankan.
- Klaim bertanda **[E]** belum dibaca ulang file-per-file; gunakan sebagai peta awal, verifikasi path:line yang dirujuk sebelum mengambil keputusan implementasi.
- Satu klaim terbukti salah (route `uploads.ts` tidak ada di disk) — ekspektasikan sebagian kecil klaim **[E]** lain ikut meleset.
- Tidak ada perubahan code yang dilakukan; tidak ada build/lint/typecheck/test yang dijalankan.
