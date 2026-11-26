# syntax=docker/dockerfile:1
FROM node:22-alpine AS base

WORKDIR /app

# Local development uses PostgreSQL on the host. Inside Docker, loopback
# addresses must point to the host gateway; remote database URLs stay intact.
# Compose sets DATABASE_URL to the `postgres` service, so this only affects
# ad-hoc `docker run` usage against a host database.
COPY --chmod=755 <<'EOF' /usr/local/bin/mobile-api-entrypoint
#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL wajib diisi}"
if [ -n "${DATABASE_URL:-}" ]; then
  DATABASE_URL="$(node -e '
    try {
      const original = process.env.DATABASE_URL;
      const url = new URL(original);
      if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        url.hostname = "host.docker.internal";
        process.stdout.write(url.toString());
      } else {
        process.stdout.write(original);
      }
    } catch {
      console.error("DATABASE_URL tidak valid");
      process.exit(1);
    }
  ')"
  export DATABASE_URL
fi
exec "$@"
EOF

ENTRYPOINT ["/usr/local/bin/mobile-api-entrypoint"]

FROM base AS build

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Migrations run as their own Compose service before the API starts.
# drizzle-kit lives in devDependencies, so this stage reuses the build image.
FROM build AS migrations

COPY drizzle.config.js ./
COPY drizzle ./drizzle

USER node

CMD ["npm", "run", "db:migrate"]

FROM base AS production

ENV NODE_ENV=production
ENV PORT=3000
ENV UPLOAD_DIR=/app/uploads

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Includes dist/db/seed.js, used by the Compose `seed` service and `npm run db:seed:prod`.
COPY --from=build /app/dist ./dist

# Local file storage adapter writes here; the node user must own it so the
# named volume keeps the same ownership on first mount.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
