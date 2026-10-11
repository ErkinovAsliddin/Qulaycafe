# Docker Build & Deployment Fixes — Summary

## Issues Fixed

### 1. ✅ Missing mockData File
**Problem:** `esbuild` failed with `Could not resolve "../data/mockData"` during the build.

**Root Cause:** `src/data/mockData.ts` did not exist, but was imported by `src/server/db.ts` for demo data seeding.

**Fix:** Created `src/data/mockData.ts` with empty arrays for `INITIAL_MENU_ITEMS`, `INITIAL_ORDERS`, `INITIAL_TABLES`, and `INITIAL_LOYALTY_MEMBERS`. This allows the build to succeed and the seeding function to run without error (no demo data is pre-populated, as intended).

### 2. ✅ NODE_ENV=production Warning During Build
**Problem:** Vite warning: `"NODE_ENV=production is not supported in the .env file"` appeared during the Docker build.

**Root Cause:** `.env` file (containing `NODE_ENV=production`) was being copied into the Docker image during the build phase, and Vite was reading it.

**Fix:** 
- Updated `.dockerignore` to exclude `.env` files during Docker build
- Added explicit `ENV NODE_ENV=production` statements in Dockerfile builder and runner stages
- Set other required `VITE_*` env vars in the builder stage so they're compiled into the bundle
- Moved runtime config (JWT_SECRET, passwords, URLs) to `docker-compose.yml` `environment:` section instead of `.env` file

### 3. ✅ Port Mismatch & Configuration
**Problem:** Dockerfile used `PORT=3000` but docker-compose.yml mapped `6000:6000`, causing confusion.

**Fix:** Updated Dockerfile to use `PORT=6000` to match docker-compose.yml and the production `.env`.

### 4. ✅ Missing HEALTHCHECK
**Problem:** No health check defined, so Docker can't detect if the app crashes.

**Fix:** Added `HEALTHCHECK` directive that curls `http://localhost:6000` every 30 seconds. Added `curl` to the runner stage dependencies.

### 5. ✅ Runtime Environment Secrets
**Problem:** After excluding `.env`, the container couldn't start because it needs `JWT_SECRET` and other runtime config.

**Fix:** Updated `docker-compose.yml` to pass all required runtime env vars via `environment:` section with sensible defaults pulled from the original `.env` using `${VAR:-default}` syntax.

### 6. ✅ Restart Policy
**Problem:** Container could crash without auto-restart.

**Fix:** Verified `restart: unless-stopped` is set in docker-compose.yml.

---

## Files Changed

| File | Changes | Why |
|------|---------|-----|
| **src/data/mockData.ts** | Created | Provides missing seed data exports (empty arrays) |
| **.dockerignore** | Updated | Exclude `.env` files from Docker build context to prevent NODE_ENV warning |
| **Dockerfile** | Updated | Set `VITE_*` vars at build time, match PORT to docker-compose, add curl for healthcheck |
| **docker-compose.yml** | Updated | Pass runtime config via `environment:` instead of `env_file:`, removed `.env` reference |

---

## Build & Deployment Verification

✅ **Docker build succeeds** (no esbuild errors, no NODE_ENV warnings)
✅ **Container starts and stays healthy** (health check passes)
✅ **API responds** (curl http://localhost:6000 returns app shell)
✅ **Database persists** (SQLite at /app/data with Docker volume mount)
✅ **Multi-stage build optimized** (runtime image is smaller, contains only production code)

---

## Deployment Commands

### Deploy (Fresh)
```bash
docker compose build --no-cache && docker compose up -d
```

### Deploy (From Existing Image)
```bash
docker compose down && docker compose up -d
```

### Verify
```bash
docker compose ps                              # Check health status
docker compose logs --tail=50                  # View recent logs
curl http://localhost:6000/api/auth/me | jq . # Test API
```

### Rollback
```bash
git checkout <previous-commit-hash> -- Dockerfile docker-compose.yml .dockerignore src/data/mockData.ts
docker compose build --no-cache && docker compose up -d
```

See `DEPLOYMENT_INSTRUCTIONS.md` for full deployment and rollback guide.

---

## What Was NOT Changed

- ✅ No app features, routes, or logic modified
- ✅ No database schema changes
- ✅ No UI changes
- ✅ No destructive git operations
- ✅ Chunk-size warnings left untouched (harmless)

---

## For Docker Buildx Warning

The user mentioned: `"Docker Compose is configured to build using Bake, but buildx isn't installed"`

**Fix:** Either:
1. Install buildx: `docker buildx install` or `apt-get install docker-buildx-plugin`
2. Or disable Bake: Set `COMPOSE_BAKE=false` environment variable before running compose

This is orthogonal to the build failures and not required to deploy the app.

---

## Notes

- Secrets (JWT_SECRET, passwords) are now passed at runtime via docker-compose.yml, not baked into the image. This is more secure and follows best practices.
- The `.env` file remains in the repo for local development (tsx server.ts) but is excluded from Docker builds.
- Database files are persistent via Docker named volumes; data is not lost on redeploy.
- The app is production-ready and can be deployed to any Docker-capable server/cloud platform.
