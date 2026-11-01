# Deployment — Docker + Cloudflare Tunnel

Publik: **https://mife.feryn.xyz** → Cloudflare Tunnel → service `web` (nginx: halaman statis + proxy `/api/*` ke `server`).

## Peta port & service

| Service   | Image / build          | Port container | Port host | Akses dari luar? |
|-----------|------------------------|----------------|-----------|------------------|
| `web`     | build `apps/web/Dockerfile` (nginx) | 80 | **8080** (cek lokal) | via Tunnel |
| `server`  | build `apps/server/Dockerfile` (Bun+Elysia) | 4000 | — (internal) | via `web:80/api/*` |
| `postgres`| `postgres:16-alpine`  | 5432 | — (internal) | tidak |
| `minio`   | `chainguard/minio`     | 9000/9001 | — (internal) | tidak |
| `tunnel`  | `cloudflare/cloudflared` | — | — | outbound ke Cloudflare |

Alur request: `mife.feryn.xyz` → `tunnel` → `web:80` → (`/` file statis, `/api/*` proxy ke `server:4000`).

> Dev lokal tetap `web http://localhost:4001` + `server http://localhost:4000`
> (`bun run dev:web` / `bun run dev:server`). Jangan campur env prod & dev —
> untuk dev lokal, timpa via file `.env.local` (diprioritaskan varlock).

## Environment

Satu-satunya konfigurasi database aplikasi adalah **`DATABASE_URL`**
di `apps/server/.env.production`:

```env
DATABASE_URL=postgresql://app:<password>@postgres:5432/symi   # deploy (HOST=postgres)
# DATABASE_URL=postgresql://app:<password>@localhost:5432/symi # dev: apps/server/.env (HOST=localhost)
```

`POSTGRES_PASSWORD` di file yang sama hanya dipakai inisialisasi volume `pgdata`
pertama kali — harus sama dengan password di `DATABASE_URL`.

| File | Isi |
|------|-----|
| `apps/server/.env` (gitignored, dev) | URL/`DATABASE_URL`/`S3_*` → `localhost`, kredensial OAuth |
| `apps/server/.env.production` (gitignored, prod) | SEMUA config deploy: URL domain, `DATABASE_URL` → `@postgres`, `S3` → `@minio`, OAuth, plus `POSTGRES_*` (init volume, password = password di DATABASE_URL) dan `MINIO_ROOT_*` (= `S3_*`) |
| `apps/web/.env` (gitignored, dev) | `PUBLIC_SERVER_URL=http://localhost:4000` |
| `apps/web/.env.production` (gitignored, prod) | `PUBLIC_SERVER_URL=https://mife.feryn.xyz` |
| Tidak ada `.env` root | compose tidak butuh interpolasi apa pun; contoh: `apps/*/.env.production.example` |

Google Console wajib: origin `https://mife.feryn.xyz` + redirect
`https://mife.feryn.xyz/api/auth/callback/google` (sesuaikan per provider).

## Menjalankan

```bash
# Pertama kali / setelah ubah kode
docker compose build [server|web]
docker compose up -d

# Hanya tunnel (butuh login cloudflared + route DNS sekali saja, lihat Tunnel di bawah)
docker compose up -d tunnel

## Tunnel (dikelola via CLI, tanpa dashboard)

```bash
cloudflared tunnel login                             # sekali per mesin (browser)
cloudflared tunnel create mife-app                   # sekali saja → ~/.cloudflared/<id>.json
chmod 644 ~/.cloudflared/<id>.json                   # agar terbaca container
cloudflared tunnel route dns mife-app mife.feryn.xyz # CNAME → tunnel (sekali saja)
```

`deploy/cloudflared-config.yml` memetakan `mife.feryn.xyz → http://web:80`.
Tidak ada token di repo — konektor memakai kredensial lokal `~/.cloudflared`.
Tunnel dashboard lama (`MIFE`/`MIFE-2`) boleh dihapus bila tidak dipakai.
```

Migrasi DB jalan otomatis tiap boot `server` (idempoten via journal drizzle).

## Mengelola container

```bash
docker compose ps                                   # status + health
docker compose logs -f [server|web|tunnel|postgres|minio]   # log live
docker compose restart [service]                    # restart
docker compose up -d --force-recreate [service]     # recreate (baca ulang env/config)
docker compose stop [service] / docker compose start [service]
docker compose down                                 # stop semua (data volume aman)
docker compose down -v                             # ⚠️ hapus juga pgdata + minio-data

# Update image pihak ketiga
docker compose pull [postgres|minio|tunnel] && docker compose up -d

# Masuk shell / cek langsung
docker compose exec server sh
docker compose exec postgres psql -U app -d symi
curl -s http://localhost:8080/api/auth/providers   # via gateway
```

## Troubleshooting

| Gejala | Penyebab umum | Perintah cek |
|---|---|---|
| `web` unhealthy | nginx belum siap / build gagal | `docker compose logs web` |
| `server` restarting | migrasi gagal / env salah | `docker compose logs server --tail 30` |
| Login sosial error `invalid_client` | redirect URI belum ditambah di Google Console | cek callback URL di atas |
| `🚨 DETECTED LEAKED SENSITIVE CONFIG - *_CLIENT_ID` | `client_id` sah muncul di URL authorize — sudah dikecualikan via `@sensitive={preventLeaks=false}` di `apps/server/.env.schema`; pastikan file itu versi terbaru dan server di-restart |
| Tunnel `Restarting` | kredensial lokal hilang/permission | `ls -l ~/.cloudflared/`, `chmod 644` bila perlu |
| DB auth failed setelah ganti password | volume lama dibuat dengan password lama | samakan `POSTGRES_PASSWORD` + password di `DATABASE_URL` di `apps/server/.env.production`, atau `down -v` (data hilang) lalu `up -d` |
| Mesin fresh: contoh env belum diisi | salin `apps/*/.env.production.example` → `.env.production` lalu isi |
