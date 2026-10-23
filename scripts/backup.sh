#!/usr/bin/env bash
# Nightly database backup on the server: a compressed dump in ~/backups. cron
# runs it at 04:00 (see scripts/server-setup.sh).
#
# When ~/.zhoupmap-cos exists, each dump is also uploaded to Tencent Cloud object
# storage (COS), and only the last 3 days stay on the server; otherwise 14 days
# stay here. The file is mode 600 and sets COS_BUCKET, COS_REGION, COS_SECRET_ID
# and COS_SECRET_KEY, for a key that may only upload. The bucket deletes copies
# after 14 days by its own lifecycle rule.
set -euo pipefail

DIR="$HOME/backups"
COS="$HOME/.zhoupmap-cos"
umask 077
mkdir -p "$DIR"
rm -f "$DIR"/*.tmp

cd "$HOME/arknights_map"
name="zhoupmap-$(date +%Y%m%d-%H%M).sql.gz"
file="$DIR/$name"
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U roach -d roach --clean --if-exists | gzip > "$file.tmp"
mv "$file.tmp" "$file"
echo "$(date -Is) saved $(du -h "$file" | cut -f1) in $file"

KEEP_DAYS=14
if [ -f "$COS" ]; then
  # shellcheck disable=SC1090
  . "$COS"
  # COS takes S3-style signed uploads; the key goes in through stdin, so it never shows in the process list
  printf 'user = "%s:%s"\n' "$COS_SECRET_ID" "$COS_SECRET_KEY" |
    curl -fsS --retry 3 -K - --aws-sigv4 "aws:amz:$COS_REGION:s3" \
      -T "$file" "https://$COS_BUCKET.cos.$COS_REGION.myqcloud.com/$name"
  echo "$(date -Is) uploaded $name to $COS_BUCKET"
  KEEP_DAYS=3
fi
# a failed upload stops the script above, so local copies are only thinned once the upload worked
find "$DIR" -name 'zhoupmap-*.sql.gz' -mtime +$((KEEP_DAYS - 1)) -delete
