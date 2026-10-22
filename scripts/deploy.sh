#!/usr/bin/env bash
# Update the live site to the latest main branch on GitHub. Push first, then run
# from the Mac. The server is reached through the `zhoupmap` entry in ~/.ssh/config.
set -euo pipefail

HOST="${DEPLOY_HOST:-zhoupmap}"
ssh "$HOST" 'set -e
cd ~/arknights_map
git pull --ff-only
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
docker image prune -f >/dev/null'
echo "Deployed. https://zhoupmap.com"
