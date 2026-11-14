#!/usr/bin/env bash
# Run scripts/fetch-msr-music.mjs on the main server, whose Caddy serves the songs: in a throwaway container with Node
# and ffmpeg, so nothing is installed on the server itself, on one core at the lowest priority. Its arguments go to the
# script (--dry-run, --limit <songs>), and what it writes belongs to whoever runs this, not to root:
#
#   ~/arknights_map/scripts/fetch-music.sh --dry-run    what it would fetch
#   ~/arknights_map/scripts/fetch-music.sh              fetch it (the first time some two hours: best left running with
#                                                       nohup … >> ~/music-fetch.log 2>&1 &)
#
# and weekly from cron for new albums, after the 04:00 backup (scripts/backup.sh):
#
#   30 4 * * 1 $HOME/arknights_map/scripts/fetch-music.sh >> $HOME/music-fetch.log 2>&1
#
# The container's name keeps two runs from going at once.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$DIR/music"
echo "== $(date '+%F %T') fetch-msr-music $*"
exec docker run --rm --name zhoupmap-music --cpus 1 --memory 1g \
  -e OWNER="$(id -u):$(id -g)" \
  -v "$DIR/scripts:/work/scripts:ro" -v "$DIR/music:/work/music" -w /work \
  node:22-alpine sh -c 'apk add --no-cache ffmpeg > /dev/null && exec nice -n 19 node scripts/fetch-msr-music.mjs "$@"' sh "$@"
