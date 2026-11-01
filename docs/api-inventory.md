# API Inventory — MIFE Server

> Digenerate manual dari source `apps/server/src/routes/*.ts` + `apps/server/src/index.ts`.
> Terakhir disinkron: 2026-11-01. Total **73 endpoint**.
>
> Catatan rename: `routes/mife.ts` → **`routes/comic.ts`** (export `comicRoutes`,
> nama Elysia `comic-routes`); workspace komik kini `comic` (dulu `mife`).
> File lama `mife.ts` sudah tidak ada.

Legenda auth:

- **publik** — tanpa sesi; endpoint `settings`/`library` hanya personalisasi opsional bila header sesi ada.
- **sesi** — wajib sesi Better Auth, 401 bila tidak ada.
- **admin** — semua `/api/admin/*` dijaga `adminGate` (`apps/server/src/rbac/gates.ts`):
  sesi + role `admin`, selain itu 403 (preflight `OPTIONS` lolos).

## `routes/comic.ts` — baca komik (publik, 24 endpoint)

| Method | Path                                                      | Auth   | File:Line    | Deskripsi                                                   |
| ------ | --------------------------------------------------------- | ------ | ------------ | ----------------------------------------------------------- |
| GET    | `/api/v1/health`                                          | publik | comic.ts:126 | Health check, balas `{ status: "ok", workspace: "Comic" }`. |
| GET    | `/api/v1/workspaces`                                      | publik | comic.ts:127 | Daftar workspace yang tersedia.                             |
| GET    | `/api/v1/sources`                                         | publik | comic.ts:128 | Daftar sumber komik workspace `comic`.                      |
| GET    | `/api/v1/settings`                                        | publik | comic.ts:129 | Opsi reader + preferensi gambar (personalisasi bila login). |
| GET    | `/api/v1/genres`                                          | publik | comic.ts:158 | Daftar genre (`?workspace=comic\|anime`).                   |
| GET    | `/api/v1/library`                                         | publik | comic.ts:169 | Katalog seri komik (paginasi, cari, filter, sort).          |
| GET    | `/api/v1/library/hero`                                    | publik | comic.ts:203 | Item hero pilihan untuk halaman utama.                      |
| GET    | `/api/v1/library/:id`                                     | publik | comic.ts:210 | Detail satu seri komik.                                     |
| GET    | `/api/v1/library/:id/chapters`                            | publik | comic.ts:226 | Daftar chapter satu seri (paginasi, cari, sort).            |
| GET    | `/api/v1/library/:id/cover`                               | publik | comic.ts:271 | Byte sampul seri (storage lokal atau redirect eksternal).   |
| GET    | `/api/v1/chapters/by-slug/:seriesSlug/:chapterSlug`       | publik | comic.ts:295 | Resolusi chapter via slug SEO.                              |
| GET    | `/api/v1/chapters/:id`                                    | publik | comic.ts:315 | Detail satu chapter.                                        |
| GET    | `/api/v1/chapters/:id/thumbnail`                          | publik | comic.ts:327 | Redirect thumbnail chapter.                                 |
| GET    | `/api/v1/chapters/:id/pages`                              | publik | comic.ts:347 | Daftar halaman baca chapter (`?source=` opsional).          |
| GET    | `/api/v1/images/source/:id`                               | publik | comic.ts:384 | Redirect URL gambar sumber eksternal.                       |
| GET    | `/api/v1/images/:id`                                      | publik | comic.ts:400 | Byte halaman tersimpan (immutable, cache 1 tahun).          |
| GET    | `/api/v1/super-komik/access-check`                        | publik | comic.ts:418 | Flag akses workspace `superkomik`.                          |
| GET    | `/api/v1/super-komik/catalog`                             | publik | comic.ts:422 | Katalog seri `superkomik` (paginasi, cari).                 |
| GET    | `/api/v1/super-komik/series/:id`                          | publik | comic.ts:438 | Halaman seri `superkomik` + chapter.                        |
| GET    | `/api/v1/super-komik/chapters/:id`                        | publik | comic.ts:461 | Chapter `superkomik` + daftar halaman.                      |
| GET    | `/api/v1/super-komik/media/series/:id/cover`              | publik | comic.ts:473 | Byte/redirect cover seri `superkomik`.                      |
| GET    | `/api/v1/super-komik/media/series/:id/banner`             | publik | comic.ts:492 | Byte/redirect banner seri `superkomik`.                     |
| GET    | `/api/v1/super-komik/media/chapter-sources/:id/thumbnail` | publik | comic.ts:511 | Redirect thumbnail chapter-source.                          |
| GET    | `/api/v1/super-komik/media/pages/:id`                     | publik | comic.ts:526 | Byte/redirect satu halaman `superkomik`.                    |

## `routes/anime.ts` — baca anime (publik, 7 endpoint)

| Method | Path                                  | Auth   | File:Line    | Deskripsi                                               |
| ------ | ------------------------------------- | ------ | ------------ | ------------------------------------------------------- |
| GET    | `/api/v1/anime/sources`               | publik | anime.ts:67  | Daftar sumber anime + flag dukungan.                    |
| GET    | `/api/v1/anime/settings`              | publik | anime.ts:68  | Preferensi player/thumbnail (personalisasi bila login). |
| GET    | `/api/v1/anime/library`               | publik | anime.ts:87  | Katalog anime (paginasi, cari, genre, status, sort).    |
| GET    | `/api/v1/anime/library/:id`           | publik | anime.ts:125 | Detail satu anime.                                      |
| GET    | `/api/v1/anime/library/:id/episodes`  | publik | anime.ts:141 | Daftar episode satu anime (paginasi).                   |
| GET    | `/api/v1/anime/episodes/:id/media`    | publik | anime.ts:169 | Link stream/download episode (`?source=` opsional).     |
| GET    | `/api/v1/anime/library/:id/thumbnail` | publik | anime.ts:186 | Byte/redirect thumbnail anime.                          |

## `routes/bookmarks.ts` — bookmark (sesi, 9 endpoint)

| Method | Path                                              | Auth | File:Line        | Deskripsi                                    |
| ------ | ------------------------------------------------- | ---- | ---------------- | -------------------------------------------- |
| GET    | `/api/v1/bookmarks`                               | sesi | bookmarks.ts:94  | Daftar grup bookmark (`?type=comic\|anime`). |
| PUT    | `/api/v1/bookmarks/groups/order`                  | sesi | bookmarks.ts:103 | Simpan urutan grup.                          |
| POST   | `/api/v1/bookmarks/groups`                        | sesi | bookmarks.ts:119 | Buat grup bookmark baru.                     |
| GET    | `/api/v1/bookmarks/groups/:groupId`               | sesi | bookmarks.ts:141 | Detail satu grup + itemnya.                  |
| PATCH  | `/api/v1/bookmarks/groups/:groupId`               | sesi | bookmarks.ts:156 | Ubah nama/deskripsi/cover grup.              |
| DELETE | `/api/v1/bookmarks/groups/:groupId`               | sesi | bookmarks.ts:186 | Hapus grup (kecuali default).                |
| POST   | `/api/v1/bookmarks/groups/:groupId/items`         | sesi | bookmarks.ts:197 | Tambah seri ke grup (idempoten).             |
| PUT    | `/api/v1/bookmarks/groups/:groupId/items/order`   | sesi | bookmarks.ts:217 | Simpan urutan item dalam grup.               |
| DELETE | `/api/v1/bookmarks/groups/:groupId/items/:itemId` | sesi | bookmarks.ts:239 | Hapus satu item dari grup.                   |

## `routes/preferences.ts` — preferensi user (sesi, 2 endpoint)

| Method | Path                  | Auth | File:Line          | Deskripsi                                      |
| ------ | --------------------- | ---- | ------------------ | ---------------------------------------------- |
| GET    | `/api/v1/preferences` | sesi | preferences.ts:91  | Baca nilai preferensi (`?keys=a,b`, maks 100). |
| PUT    | `/api/v1/preferences` | sesi | preferences.ts:104 | Tulis preferensi (last-write-wins per key).    |

## `routes/scrapes.ts` — kontrol scrape (admin, 10 endpoint)

| Method | Path                                 | Auth  | File:Line      | Deskripsi                                                                          |
| ------ | ------------------------------------ | ----- | -------------- | ---------------------------------------------------------------------------------- |
| GET    | `/api/admin/scrapes`                 | admin | scrapes.ts:108 | Daftar run (`?workspace&status&kind&limit`).                                       |
| POST   | `/api/admin/scrapes`                 | admin | scrapes.ts:151 | Mulai scrape (anime vs metadata komik; default workspace `comic`).                 |
| POST   | `/api/admin/scrapes/images-download` | admin | scrapes.ts:175 | Mulai image-download run (cakupan seri/chapter/source).                            |
| GET    | `/api/admin/scrapes/:id`             | admin | scrapes.ts:201 | Detail run + 100 event terakhir.                                                   |
| POST   | `/api/admin/scrapes/:id/pause`       | admin | scrapes.ts:226 | Jeda run (queued/running → paused).                                                |
| POST   | `/api/admin/scrapes/:id/resume`      | admin | scrapes.ts:243 | Lanjutkan run (routing by kind: images → images handler).                          |
| POST   | `/api/admin/scrapes/:id/cancel`      | admin | scrapes.ts:275 | Batalkan run.                                                                      |
| POST   | `/api/admin/scrapes/:id/retry`       | admin | scrapes.ts:294 | Coba ulang run (buat run baru; routing by kind).                                   |
| GET    | `/api/admin/scrape-settings`         | admin | scrapes.ts     | Nilai efektif 5 pengaturan scraper + sumber per key (`db`/`env`) + daftar sumber. |
| PUT    | `/api/admin/scrape-settings`         | admin | scrapes.ts     | Simpan parsial 5 pengaturan (validasi ketat, 400 bila invalid/unknown key).       |

Kontrak `scrape-settings` (kunci DB `scrape.time_zone|daily_time|batch_size|batch_concurrency|incremental_max_pages`
di tabel `app_settings`; tanpa baris DB, nilai efektif = ENV `SCRAPE_*`):

- `GET` → `{ values: { timeZone, dailyTime, batchSize, batchConcurrency, incrementalMaxPages }, sources: { <key>: "db"|"env" }, validKeys, editableSources }`.
- `PUT` body parsial; validasi: `timeZone` via `Intl.DateTimeFormat`, `dailyTime` `HH:MM`,
  `batchSize` 1–100, `batchConcurrency` 1–8, `incrementalMaxPages` 2–20; unknown key → 400.
  Sukses → simpan (upsert), invalidate cache, balas nilai efektif seperti `GET`.

## `routes/library-admin.ts` — kurasi katalog (admin, 3 endpoint)

| Method | Path                           | Auth  | File:Line            | Deskripsi                                 |
| ------ | ------------------------------ | ----- | -------------------- | ----------------------------------------- |
| PATCH  | `/api/admin/library/:id`       | admin | library-admin.ts:98  | Tampilkan/sembunyikan seri (`isVisible`). |
| PATCH  | `/api/admin/sources/:id`       | admin | library-admin.ts:114 | Ubah konfigurasi sumber komik.            |
| PATCH  | `/api/admin/anime/sources/:id` | admin | library-admin.ts:131 | Ubah konfigurasi sumber anime.            |

## `routes/archive.ts` — arsip (admin, 2 endpoint)

| Method | Path                        | Auth  | File:Line      | Deskripsi                                                     |
| ------ | --------------------------- | ----- | -------------- | ------------------------------------------------------------- |
| GET    | `/api/admin/archive/export` | admin | archive.ts:295 | Unduh ZIP arsip (`?workspace=comic\|superkomik\|anime\|all`). |
| POST   | `/api/admin/archive/import` | admin | archive.ts:396 | Impor arsip ZIP (multipart `file`).                           |

## `routes/images.ts` — object storage (admin, 2 endpoint)

| Method | Path                         | Auth  | File:Line    | Deskripsi                                             |
| ------ | ---------------------------- | ----- | ------------ | ----------------------------------------------------- |
| GET    | `/api/admin/images/object/*` | admin | images.ts:18 | Serve byte object storage by key (validasi pola key). |
| POST   | `/api/admin/images/repair`   | admin | images.ts:37 | Mulai repair download satu chapter.                   |

## `routes/admin.ts` — RBAC & media (admin + izin granular, 8 endpoint)

Izin tambahan per endpoint via `requirePermission` (401 tanpa sesi, 403 tanpa izin).

| Method | Path                            | Auth                            | File:Line    | Deskripsi                                                                   |
| ------ | ------------------------------- | ------------------------------- | ------------ | --------------------------------------------------------------------------- |
| GET    | `/api/admin/users`              | admin + `users.read`            | admin.ts:35  | Daftar pengguna (cari, paginasi) + role.                                    |
| GET    | `/api/admin/users/:id`          | admin + `users.read`            | admin.ts:81  | Detail satu pengguna + role.                                                |
| PATCH  | `/api/admin/users/:id/role`     | admin + `users.manage`          | admin.ts:102 | Naik/turunkan role `admin`/`user` (lindungi admin terakhir & diri sendiri). |
| DELETE | `/api/admin/users/:id/sessions` | admin + `users.manage`          | admin.ts:149 | Cabut semua sesi pengguna (paksa logout).                                   |
| GET    | `/api/admin/roles`              | admin + `rbac.roles.read`       | admin.ts:166 | Daftar role + jumlah anggota.                                               |
| GET    | `/api/admin/permissions`        | admin + `rbac.permissions.read` | admin.ts:187 | Daftar izin built-in.                                                       |
| GET    | `/api/admin/media`              | admin + `media.read`            | admin.ts:195 | Daftar aset media (filter tipe/status/owner, paginasi).                     |
| PATCH  | `/api/admin/media/:id/requeue`  | admin + `media.manage`          | admin.ts:236 | Antre ulang aset gagal/belum unduh.                                         |

## `routes/auth.ts` — auth (campuran, 5 endpoint)

| Method | Path                  | Auth   | File:Line   | Deskripsi                                                 |
| ------ | --------------------- | ------ | ----------- | --------------------------------------------------------- |
| GET    | `/api/auth/providers` | publik | auth.ts:146 | Daftar provider OAuth aktif.                              |
| GET    | `/api/auth/profile`   | sesi   | auth.ts:149 | Profil + role pengguna saat ini.                          |
| PATCH  | `/api/auth/profile`   | sesi   | auth.ts:182 | Ubah nama/avatar/header/username/telepon.                 |
| ALL    | `/api/auth`           | publik | auth.ts:262 | Proksi Better Auth (hanya GET/POST).                      |
| ALL    | `/api/auth/*`         | publik | auth.ts:270 | Proksi Better Auth incl. OAuth callback (hanya GET/POST). |

## Root (publik, 1 endpoint)

| Method | Path | Auth   | File:Line   | Deskripsi                |
| ------ | ---- | ------ | ----------- | ------------------------ |
| GET    | `/`  | publik | index.ts:76 | Health root, balas `OK`. |
