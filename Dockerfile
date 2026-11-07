# One image runs both the API (default) and the worker (override the command).
# The API also serves the built web app, so production is a single origin.

FROM node:22-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-trixie-slim AS runtime
# ffmpeg for media, fonts for burned-in text, pg_dump (v17, dumps v16) for backups.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core postgresql-client ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    WEB_DIST_DIR=/app/apps/web/dist \
    LOCAL_STORAGE_DIR=/app/data/storage \
    FONT_PATH=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @mitome/server && npm cache clean --force
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/drizzle apps/server/drizzle
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir -p /app/data/storage && chown -R node:node /app/data
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "apps/server/dist/api.js"]
