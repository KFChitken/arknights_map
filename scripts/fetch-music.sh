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
# With lite first, it makes each song's smaller copy instead (省流量, scripts/make-lite-music.mjs), the container
# then having fdkaac too: lite --dry-run, lite --limit 3, lite. Once those copies are wanted, the weekly line makes
# them of what it fetched, after the fetch:
#
#   30 4 * * 1 $HOME/arknights_map/scripts/fetch-music.sh >> $HOME/music-fetch.log 2>&1; $HOME/arknights_map/scripts/fetch-music.sh lite >> $HOME/music-fetch.log 2>&1
#
# With covers first, it gets each album's cover instead (scripts/fetch-msr-covers.mjs): covers --dry-run,
# covers --limit 3, covers; once they are wanted, `; …/fetch-music.sh covers >> $HOME/music-fetch.log 2>&1` at the
# end of the weekly line gets those of new albums too.
#
# The container's name keeps two runs from going at once, the fetch, lite and covers too (all write the catalogue).
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT=fetch-msr-music.mjs
PACKAGES=ffmpeg
if [ "${1:-}" = lite ]; then
  shift
  SCRIPT=make-lite-music.mjs
  PACKAGES="ffmpeg fdkaac"
elif [ "${1:-}" = covers ]; then
  shift
  SCRIPT=fetch-msr-covers.mjs
fi
mkdir -p "$DIR/music"
echo "== $(date '+%F %T') ${SCRIPT%.mjs} $*"
exec docker run --rm --name zhoupmap-music --cpus 1 --memory 1g \
  -e OWNER="$(id -u):$(id -g)" -e SCRIPT="$SCRIPT" -e PACKAGES="$PACKAGES" \
  -v "$DIR/scripts:/work/scripts:ro" -v "$DIR/music:/work/music" -w /work \
  node:22-alpine sh -c 'apk add --no-cache $PACKAGES > /dev/null && exec nice -n 19 node "scripts/$SCRIPT" "$@"' sh "$@"
