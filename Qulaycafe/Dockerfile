# Build Stage
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# better-sqlite3 has a native addon; these let it build from source if no
# prebuilt binary matches this platform (avoids alpine/musl prebuild issues).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package manifests
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy application source
COPY . .

# Build Vite frontend and bundled Node server
RUN npm run build

# Production Stage
FROM node:20-bookworm-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
# Persistent SQLite database lives here. Mount a real volume at this path
# in production (see DEPLOYMENT_AND_HARDENING.md) or every redeploy wipes
# your orders/menu/tables again, same as the original in-memory bug.
ENV DATABASE_DIR=/app/data

# Copy package manifests and production bundle
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# The apex hostname serves the static marketing site out of ./landing (server.ts
# only mounts it when the directory exists, so leaving it out of the image
# silently downgrades qulaycafe.uz to the guest app).
COPY --from=builder /app/landing ./landing

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["npm", "start"]
