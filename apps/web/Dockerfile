# Tahap 1: build SvelteKit static (adapter-static -> /app/apps/web/build).
FROM oven/bun:1 AS web-builder
WORKDIR /app

COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install

# Nilai publik di-bake via ARG (bukan secret, aman masuk image).
# Secret .env.production hanya dipakai saat codegen tipe.
ARG PUBLIC_SERVER_URL=https://mife.feryn.xyz
ARG PORT=4001
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=cache,target=/root/.bun/install/cache \
	cd apps/web && bun run env:generate
RUN printf 'PUBLIC_SERVER_URL=%s\nNODE_ENV=production\nPORT=%s\n' "$PUBLIC_SERVER_URL" "$PORT" > /app/apps/web/.env.local
RUN --mount=type=cache,target=/root/.bun/install/cache \
	cd apps/web && bun run build

# Tahap 2: nginx — sajikan build + proxy /api/* ke server.
FROM nginx:1.27-alpine AS runner
COPY --from=web-builder /app/apps/web/build /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
