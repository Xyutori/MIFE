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

Satu-satunya konfigurasi database aplikasi adalah **`DATABASE_URL`** (root `.env`):

```env
DATABASE_URL=postgresql://app:<password>@postgres:5432/symi   # deploy (HOST=postgres)
# DATABASE_URL=postgresql://app:<password>@localhost:5432/symi # dev lokal (HOST=localhost)
```

`POSTGRES_PASSWORD` di root `.env` hanya dipakai inisialisasi volume `pgdata`
pertama kali — harus sama dengan password di `DATABASE_URL`.

| File | Isi |
|------|-----|
| `.env` (root, gitignored) | `DATABASE_URL`, `POSTGRES_PASSWORD`, `MINIO_*`, `CLOUDFLARE_TUNNEL_TOKEN` |
| `apps/server/.env` (gitignored) | `BETTER_AUTH_URL=https://mife.feryn.xyz`, `CORS_ORIGIN=https://mife.feryn.xyz`, OAuth creds, `S3_*` |
| `apps/web/.env` (gitignored) | `PUBLIC_SERVER_URL=https://mife.feryn.xyz` |

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
`CLOUDFLARE_TUNNEL_TOKEN` di `.env` sudah tidak dipakai. Tunnel dashboard lama
(`MIFE`/`MIFE-2`) boleh dihapus bila tidak dipakai.
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
| Tunnel `Restarting` | token kosong/salah | isi `CLOUDFLARE_TUNNEL_TOKEN`, `docker compose up -d tunnel` |
| DB auth failed setelah ganti password | volume lama dibuat dengan password lama | samakan `POSTGRES_PASSWORD` + password di `DATABASE_URL`, atau `down -v` (data hilang) lalu `up -d` |
| Compose error `required variable ... is missing` | `.env` root belum diisi | salin dari `.env.example` |
