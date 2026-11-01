# MIFE — Comic & Anime Reader Platform

![GitHub release](https://img.shields.io/github/v/release/Xyutori/MIFE?label=version)
![Bun](https://img.shields.io/badge/runtime-Bun_1.4-black?logo=bun)
![Svelte](https://img.shields.io/badge/frontend-SvelteKit_3-orange?logo=svelte)
![Elysia](https://img.shields.io/badge/backend-Elysia_1.4-purple)
![PostgreSQL](https://img.shields.io/badge/database-PostgreSQL_16-blue?logo=postgresql)
![Drizzle](https://img.shields.io/badge/orm-Drizzle-green)
![Better Auth](https://img.shields.io/badge/auth-Better_Auth-social_only-red)
![Tauri](https://img.shields.io/badge/desktop-Tauri_2-teal?logo=tauri)
![check-types](https://img.shields.io/badge/check--types-passing-brightgreen)
![platform](https://img.shields.io/badge/platform-web_%7C_desktop-lightgrey)

Platform baca komik & anime dengan scraper otomatis, katalog offline-friendly, dan aplikasi desktop — satu codebase untuk web dan desktop (Tauri).

> **v0.8.4** — migrasi penuh ke social-only auth (Google/GitHub), paritas visual XyMI, offline reader, admin console RBAC-gated.

## ✨ Fitur

- 📚 **Katalog komik & anime** — browse, search full-text PostgreSQL (`pg_trgm`/`tsvector`), filter genre multi-select, hero editorial
- 🕷️ **Scraper otomatis** — adapter multi-sumber + retry/backoff, scheduler harian, worker recovery, varian gambar WebP ke S3/MinIO
- 📖 **Reader imersif** — fullscreen tanpa chrome, chapter nav sheet, posisi baca tersimpan, auto-scroll
- 📴 **Offline** — App-shell PWA precache + cache respons 45 dtk (unduh chapter manual dihapus di versi ini)
- 🔐 **Social-only auth** — Google & GitHub OAuth (Better Auth), account linking, banned-check, bootstrap admin
- 🛡️ **Admin console** — 404 untuk non-admin; scrape runs, integritas media, users, roles/permissions, arsip export/import
- 🖥️ **Desktop (Tauri)** — satu sumber kode dengan web; dev di `http://localhost:4001`

## 🧱 Tech Stack

| Lapisan   | Teknologi |
|-----------|-----------|
| Monorepo  | Bun workspaces + Nx |
| Web       | SvelteKit 3 + Svelte 5 runes + Tailwind CSS 4 (CSS-first) |
| Backend   | Elysia 1.4 di Bun (`/api/*`) |
| Database  | PostgreSQL 16 + Drizzle ORM (`pgTable`, 35+ tabel, FTS) |
| Storage   | S3-compatible (MinIO) untuk varian gambar |
| Auth      | Better Auth 1.7 — social-only (Google, GitHub) |
| Desktop   | Tauri 2 (frontend = build web statis) |
| Env       | Varlock codegen (`PORT` web `4001`, server `4000`) |

## 🚀 Quickstart

```bash
# 1. Install
bun install

# 2. Infra lokal (Postgres :5432, MinIO :9000 — sesuaikan kredensial di .env)
docker compose up -d   # atau pakai service yang sudah jalan

# 3. Env (contoh)
cp apps/server/.env.example apps/server/.env  # bila tersedia, lalu isi:
# PORT=4000, DATABASE_URL=..., S3_ENDPOINT=http://localhost:9000,
# S3_ACCESS_KEY=..., S3_SECRET_KEY=..., S3_BUCKET=...,
# GOOGLE_CLIENT_ID/SECRET, GITHUB_CLIENT_ID/SECRET (opsional),
# AUTH_BOOTSTRAP_ADMIN_EMAIL=you@example.com

# 4. Migrasi + seed
bun run db:push
bun run env:generate

# 5. Jalan!
bun run dev:server   # → http://localhost:4000
bun run dev:web      # → http://localhost:4001
```

Login pertama dengan email bootstrap menjadi **admin** otomatis; area `/admin` melempar **404** bagi non-admin.

## 📁 Struktur

```
apps/server/src/{routes,sources,jobs,media,storage,cache,rbac,auth,anime}.ts
apps/web/src/{routes,lib/{api,components,offline}}   # SvelteKit SPA + PWA
packages/db/src/schema/{catalog,anime,bookmarks,rbac,preferences,auth}.ts
docs/references/shinigami/    # referensi HTML + backup desain lama (svelte/)
```

## 🔌 API (ringkas)

- `GET /api/v1/library?genre=a,b&...` — katalog (genre multi, koma-dipisah)
- `GET /api/v1/genres?workspace=mife|anime` — daftar genre untuk saran combobox
- `GET /api/v1/library/hero`, `/library/:id`, `/chapters/:id/pages`
- `GET /api/auth/providers` — provider OAuth aktif
- `GET/PATCH /api/auth/profile` — profil user
- `GET /api/admin/scrapes…`, `/api/admin/archive/export|import` — admin (RBAC)

## 📝 Catatan

- Tanpa kredensial OAuth, login sosial tidak aktif — daftar provider mengikuti env.
- `bun run check-types` hijau (4 proyek). Build produksi tidak dijalankan di dev loop ini.
- Migrasi data lama: `bun run migrate:xymi` di `packages/db` (`XYMI_SQLITE_PATH=...`).
