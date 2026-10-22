#!/usr/bin/env bash
# Nightly database backup on the server: a compressed dump in ~/backups, the
# last 14 days kept. cron runs it at 04:00 (see scripts/server-setup.sh).
set -euo pipefail

DIR="$HOME/backups"
KEEP_DAYS=14
umask 077
mkdir -p "$DIR"
rm -f "$DIR"/*.tmp

cd "$HOME/arknights_map"
file="$DIR/zhoupmap-$(date +%Y%m%d-%H%M).sql.gz"
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U roach -d roach --clean --if-exists | gzip > "$file.tmp"
mv "$file.tmp" "$file"
find "$DIR" -name 'zhoupmap-*.sql.gz' -mtime +$((KEEP_DAYS - 1)) -delete
echo "$(date -Is) saved $(du -h "$file" | cut -f1) in $file"
