# syntax=docker/dockerfile:1
FROM node:22-alpine AS base

WORKDIR /app

# Local development uses PostgreSQL on the host. Inside Docker, loopback
# addresses must point to the host gateway; remote database URLs stay intact.
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

# Run explicitly through the Compose tools profile when migrations are needed.
FROM build AS migrations

COPY drizzle.config.js ./
COPY drizzle ./drizzle

USER node

CMD ["npm", "run", "db:migrate"]

FROM base AS production

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
