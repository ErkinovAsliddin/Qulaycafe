# Docker Deployment & Rollback Instructions

## Quick Deploy (Fresh Build)

```bash
# Build the Docker image (no cache to ensure clean rebuild)
docker compose build --no-cache

# Start the container in the background
docker compose up -d

# Verify the container is running and healthy
docker compose ps

# Check logs for any errors
docker compose logs --tail=50
```

## Deploy from Latest Image (Fast)

If you've already built the image and just need to restart:

```bash
docker compose down
docker compose up -d
```

## Verify Deployment

```bash
# Check container status and health
docker compose ps

# Test the app responds
curl -s http://localhost:6000 | head -20

# Check API is responding
curl -s http://localhost:6000/api/auth/me | jq .

# View recent logs
docker compose logs --tail=100
```

## Rollback to Previous Version

### Option 1: Redeploy from Git History (Recommended)

```bash
# Stop current container
docker compose down

# Revert to previous commit (adjust hash as needed)
git checkout <previous-commit-hash> -- Dockerfile docker-compose.yml .dockerignore src/data/mockData.ts

# Rebuild and redeploy
docker compose build --no-cache
docker compose up -d

# Verify
docker compose ps
```

### Option 2: Keep Image, Restart with Rollback

If you only changed docker-compose.yml (runtime config):

```bash
# Revert docker-compose.yml
git checkout HEAD -- docker-compose.yml

# Restart with old config
docker compose down
docker compose up -d
```

### Option 3: Stop and Remove (Hard Rollback)

```bash
# Stop and remove all containers, volumes, and networks
docker compose down -v

# To restore database from backup (if using named volumes):
# The data persists in docker volumes; to clear and start fresh:
docker volume rm qulaycafe_restaurant-data
docker compose up -d
```

## Environment Variables

Runtime environment variables are now passed via `docker-compose.yml` `environment:` section, NOT from `.env` file. 

To customize for your deployment:

1. Create a `.env.production` file (git-ignored) with your production secrets:
   ```
   JWT_SECRET=your-long-secret-key-here
   ADMIN_INITIAL_PASSWORD=your-admin-password
   KITCHEN_INITIAL_PIN=your-kitchen-pin
   APP_URL=https://your-domain.com
   ```

2. Reference it in docker-compose.yml by uncommenting `env_file:` or export vars before compose up:
   ```bash
   export JWT_SECRET="your-long-secret"
   docker compose up -d
   ```

## Monitoring

```bash
# Watch logs in real-time
docker compose logs -f

# Get health status
docker inspect restaurant-app --format='{{.State.Health.Status}}'

# Check for errors
docker compose logs --tail=500 | grep -i error
```

## Persistent Data

The app database lives in a Docker volume at `/app/data` inside the container, mounted as `restaurant-data` volume on the host. 

To prevent data loss on redeploy:
- ALWAYS use `docker compose down` (not `docker container rm`)
- The volume persists across restarts
- To wipe the database: `docker volume rm qulaycafe_restaurant-data`

## Scaling (Future)

If you need multiple instances behind a load balancer:

```bash
docker compose up -d --scale app=3
```

Note: Multiple instances share the same database volume; ensure your SQLite WAL mode can handle concurrent access, or switch to a proper database (PostgreSQL).
