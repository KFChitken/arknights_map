#!/usr/bin/env bash
# Update the live site to the latest main branch on GitHub. Push first, then run
# from the Mac. The server is reached through the `zhoupmap` entry in ~/.ssh/config.
set -euo pipefail

HOST="${DEPLOY_HOST:-zhoupmap}"
ssh "$HOST" 'set -e
cd ~/arknights_map
git pull --ff-only
docker compose -f docker-compose.prod.yml up -d --build
# a freshly started Caddy takes a moment to accept reloads
for i in 1 2 3 4 5 6; do
  docker compose -f docker-compose.prod.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile && break
  [ "$i" = 6 ] && exit 1
  sleep 2
done
docker image prune -f >/dev/null'
# keep a copy of the newest nightly backup off the server, for as long as the server keeps its own
BACKUPS="$HOME/zhoupmap-backups"
mkdir -p -m 700 "$BACKUPS"
latest=$(ssh "$HOST" 'ls -t ~/backups/zhoupmap-*.sql.gz 2>/dev/null | head -1')
if [ -n "$latest" ]; then scp -q "$HOST:$latest" "$BACKUPS/"; fi
find "$BACKUPS" -name 'zhoupmap-*.sql.gz' -mtime +13 -delete

echo "Deployed. https://zhoupmap.com"
