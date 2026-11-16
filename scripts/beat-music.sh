#!/usr/bin/env bash
# Run scripts/beat-music.mjs on the main server, whose Caddy serves the songs and the clips: in a throwaway container
# with Node and ffmpeg, as scripts/fetch-music.sh runs the fetch, so nothing is installed on the server itself, on one
# core at the lowest priority. Its arguments go to the script (--top <clips>, --pick <cid>,<cid>, --limit <songs>), and
# what it writes belongs to whoever runs this, not to root:
#
#   ~/arknights_map/scripts/beat-music.sh --limit 5     try it on five songs (it cuts no clips)
#   ~/arknights_map/scripts/beat-music.sh               all of them (the first time some tens of minutes: best left
#                                                       running with nohup … >> ~/beat-music.log 2>&1 &)
#
# Not while scripts/fetch-music.sh runs (Mondays from 04:30), nor its lite: the container's name keeps two of these
# from going at once, not one of each.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ ! -f "$DIR/music/catalog.json" ]; then
  echo "No music/catalog.json yet: fetch the songs first (scripts/fetch-music.sh)" >&2
  exit 1
fi
echo "== $(date '+%F %T') beat-music $*"
exec docker run --rm --name zhoupmap-beat --cpus 1 --memory 1g \
  -e OWNER="$(id -u):$(id -g)" \
  -v "$DIR/scripts:/work/scripts:ro" -v "$DIR/music:/work/music" -w /work \
  node:22-alpine sh -c 'apk add --no-cache ffmpeg > /dev/null && exec nice -n 19 node scripts/beat-music.mjs "$@"' sh "$@"
