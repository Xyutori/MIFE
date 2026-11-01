FROM oven/bun:1 AS builder
WORKDIR /app

COPY . .
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local --mount=type=cache,target=/root/.bun/install/cache bun install

ENV NODE_ENV=production
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local --mount=type=cache,target=/root/.bun/install/cache cd apps/server && bun run env:generate
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local cd apps/server && bun run build

FROM oven/bun:1 AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app /app

EXPOSE 4000

WORKDIR /app/apps/server
# Migrasi skema dulu (idempoten via journal drizzle), lalu jalankan server.
# Memakai API drizzle-orm langsung (bukan drizzle-kit CLI) agar versi selalu cocok.
CMD ["sh", "-c", "bun /app/packages/db/src/migrate-deploy.ts && bun dist/index.mjs"]
