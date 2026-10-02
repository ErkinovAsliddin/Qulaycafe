# ============================================================
# Stage 1 — builder
# Compiles the React/Vite frontend and bundles server.ts with
# esbuild. VITE_* vars must be present HERE because Vite inlines
# them into the JS bundle at build time; they are not read at
# runtime.
# ============================================================
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# better-sqlite3 builds a native addon. These tools let it
# compile from source when no matching prebuilt binary exists.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# NODE_ENV=production tells Vite to optimise the bundle.
# It is set here, not read from .env (which is excluded via
# .dockerignore) to avoid the "NODE_ENV is not supported in
# .env files" Vite warning.
ENV NODE_ENV=production

# --- VITE build-time variables ---
# Declare as ARG so `docker compose build --build-arg` (or
# compose `build: args:`) can inject values from .env.
# The ENV line immediately after makes the value available to
# the `npm run build` process that follows.
ARG VITE_CLIENTS_URL
ENV VITE_CLIENTS_URL=${VITE_CLIENTS_URL}

ARG VITE_KITCHEN_URL
ENV VITE_KITCHEN_URL=${VITE_KITCHEN_URL}

ARG VITE_ADMIN_URL
ENV VITE_ADMIN_URL=${VITE_ADMIN_URL}

ARG VITE_CONTACT_TELEGRAM
ENV VITE_CONTACT_TELEGRAM=${VITE_CONTACT_TELEGRAM}

ARG VITE_CONTACT_PHONE
ENV VITE_CONTACT_PHONE=${VITE_CONTACT_PHONE}

# Optional: exact-hostname overrides for non-standard deployments.
ARG VITE_ADMIN_HOSTS
ENV VITE_ADMIN_HOSTS=${VITE_ADMIN_HOSTS}

ARG VITE_KITCHEN_HOSTS
ENV VITE_KITCHEN_HOSTS=${VITE_KITCHEN_HOSTS}

ARG VITE_CLIENTS_HOSTS
ENV VITE_CLIENTS_HOSTS=${VITE_CLIENTS_HOSTS}

ARG VITE_LANDING_HOSTS
ENV VITE_LANDING_HOSTS=${VITE_LANDING_HOSTS}

ARG VITE_ALLOW_SURFACE_OVERRIDE
ENV VITE_ALLOW_SURFACE_OVERRIDE=${VITE_ALLOW_SURFACE_OVERRIDE}

COPY package*.json ./
RUN npm ci

COPY . .

# Builds:
#   dist/          <- Vite frontend (index.html + hashed assets)
#   landing/       <- Vite landing site (outDir in vite.landing.config.ts)
#   dist/server.cjs <- esbuild bundle of server.ts
RUN npm run build

# ============================================================
# Stage 2 — runner
# Minimal production image. Only the compiled artefacts and
# production npm dependencies are included; source, devDeps,
# and secrets never enter this layer.
# ============================================================
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# better-sqlite3 is a native module; it must be rebuilt against
# the same Node ABI used in the runner image. Installing the
# build tools here (and running `npm ci --omit=dev`) does that
# automatically — the postinstall script compiles the addon.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=6000

COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled artefacts from builder
COPY --from=builder /app/dist    ./dist
COPY --from=builder /app/landing ./landing

# Create the data directory. The container runs as root (the
# default for node images) so it can always write the SQLite
# -wal / -shm sidecar files regardless of host directory
# ownership. This is a single-tenant private server; the
# no-root hardening is not required here.
RUN mkdir -p /app/data

EXPOSE 6000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:6000/ || exit 1

CMD ["npm", "start"]
