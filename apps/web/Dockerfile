# Tahap 1: build SvelteKit static (adapter-static -> /app/apps/web/build).
FROM oven/bun:1 AS web-builder
WORKDIR /app

COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install

# PUBLIC_SERVER_URL dibake saat build (SvelteKit static). Diambil dari build-arg,
# fallback ke apps/web/.env bila arg kosong.
ARG PUBLIC_SERVER_URL=""
ENV PUBLIC_SERVER_URL=${PUBLIC_SERVER_URL}
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=cache,target=/root/.bun/install/cache \
	cd apps/web && bun run env:generate
RUN if [ -n "$PUBLIC_SERVER_URL" ]; then \
		printf 'PUBLIC_SERVER_URL=%s\nNODE_ENV=production\nPORT=4001\n' "$PUBLIC_SERVER_URL" > /app/apps/web/.env.local; \
	fi
RUN --mount=type=cache,target=/root/.bun/install/cache \
	cd apps/web && bun run build

# Tahap 2: nginx — sajikan build + proxy /api/* ke server.
FROM nginx:1.27-alpine AS runner
COPY --from=web-builder /app/apps/web/build /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
