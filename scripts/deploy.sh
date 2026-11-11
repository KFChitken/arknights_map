#!/usr/bin/env bash
# Update the live site to the latest main branch on GitHub. Push first, then run
# from the Mac. The servers are reached through the `zhoupmap` (main) and `zhoupmap2`
# (second) entries in ~/.ssh/config.
#
# GitHub builds the app image for every push (.github/workflows/image.yml). This
# waits for that build and has the server download the image. If GitHub's build
# failed or the server cannot download it, the server builds the image itself.
# The second server runs web2 and web3 (docker-compose.second.yml) from the same
# image, which it always downloads; they restart after the main server's web, one
# at a time, so open pages never all lose their process at once.
set -euo pipefail

HOST="${DEPLOY_HOST:-zhoupmap}"
HOST2="${DEPLOY_HOST2:-zhoupmap2}"
REPO="KFChitken/arknights_map"
sha=$(git ls-remote origin refs/heads/main | cut -f1)

# success, failure, pending, or none while GitHub has not picked the push up yet
build_state() {
  curl -fsS "https://api.github.com/repos/$REPO/actions/workflows/image.yml/runs?head_sha=$sha&per_page=1" 2>/dev/null |
    python3 -c 'import json, sys
runs = json.load(sys.stdin)["workflow_runs"]
if not runs: print("none")
elif runs[0]["status"] != "completed": print("pending")
else: print("success" if runs[0]["conclusion"] == "success" else "failure")' ||
    echo "unknown"
}

mode=build
for i in $(seq 1 45); do
  state=$(build_state)
  case "$state" in
    success) mode=pull; break ;;
    failure) echo "GitHub's image build failed; the server will build the image itself."; break ;;
  esac
  # a push shows up within a minute or two; after that, no run means there is none to wait for
  if [ "$state" != pending ] && [ "$i" -ge 6 ]; then echo "No image build on GitHub ($state); the server will build the image itself."; break; fi
  [ "$i" = 1 ] && echo "Waiting for GitHub to build the image for ${sha:0:7} ..."
  sleep 20
done

# the character pictures stay out of git, so they travel from this Mac (scripts/fetch-operator-art.mjs),
# to both servers: the app's processes on the second server read them too
if [ -f operator-art/index.json ]; then
  ssh "$HOST" 'mkdir -p ~/arknights_map/operator-art'
  rsync -a --delete operator-art/ "$HOST:arknights_map/operator-art/"
  ssh "$HOST2" 'mkdir -p ~/zhoupmap-b/operator-art'
  rsync -a --delete operator-art/ "$HOST2:zhoupmap-b/operator-art/"
fi
# and so do the guides' pictures
if [ -f guide-art/amiya.png ]; then
  ssh "$HOST" 'mkdir -p ~/arknights_map/guide-art'
  rsync -a --delete guide-art/ "$HOST:arknights_map/guide-art/"
  ssh "$HOST2" 'mkdir -p ~/zhoupmap-b/guide-art'
  rsync -a --delete guide-art/ "$HOST2:zhoupmap-b/guide-art/"
fi
# the overseas map's fonts and icons; never the map file itself, which the server fetches on its own
for d in fonts sprites; do
  if [ -d "tiles/$d" ]; then
    ssh "$HOST" "mkdir -p ~/arknights_map/tiles/$d"
    rsync -a --delete "tiles/$d/" "$HOST:arknights_map/tiles/$d/"
  fi
done

ssh "$HOST" "MODE=$mode SHA=$sha bash -s" <<'REMOTE'
set -e
cd ~/arknights_map
git pull --ff-only
# made by us, not by Docker as root, should the pictures or the map not be there yet
mkdir -p operator-art guide-art tiles
IMAGE=ghcr.io/kfchitken/arknights_map
compose() { docker compose -f docker-compose.prod.yml "$@"; }
# :latest on the server is always the image that runs, so plain compose commands keep using it
if [ "$MODE" = pull ] && docker pull -q "$IMAGE:$SHA" >/dev/null; then
  docker tag "$IMAGE:$SHA" "$IMAGE:latest"
else
  [ "$MODE" = pull ] && echo "Could not download the image from GitHub; building it here."
  compose build web
fi
compose up -d --no-build --remove-orphans
# a freshly started Caddy takes a moment to accept reloads
for i in 1 2 3 4 5 6; do
  compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile && break
  [ "$i" = 6 ] && exit 1
  sleep 2
done
# older app images, including ones built before secrets were kept out of images
docker images "$IMAGE" --format '{{.Tag}}' | grep -vxE "latest|$SHA" | xargs -r -I{} docker rmi -f "$IMAGE:{}" >/dev/null
docker rmi zhoupmap-web >/dev/null 2>&1 || true
docker image prune -f >/dev/null
REMOTE

# The second server: its compose file and the main server's settings (.env is edited on the main server
# only; it goes from one server straight to the other and is never written down here), then web2 and
# web3 on the new image, one at a time, each answering again before the next restarts.
ssh "$HOST2" 'mkdir -p -m 700 ~/zhoupmap-b'
scp -q docker-compose.second.yml "$HOST2:zhoupmap-b/docker-compose.yml"
ssh "$HOST" 'cat ~/arknights_map/.env' | ssh "$HOST2" 'umask 077 && cat > ~/zhoupmap-b/.env.new && mv ~/zhoupmap-b/.env.new ~/zhoupmap-b/.env'
ssh "$HOST2" "SHA=$sha bash -s" <<'REMOTE2'
set -e
cd ~/zhoupmap-b
mkdir -p operator-art guide-art
IMAGE=ghcr.io/kfchitken/arknights_map
if ! docker pull -q "$IMAGE:$SHA" >/dev/null; then
  echo "The second server could not download ${SHA:0:7}: web2 and web3 keep running the version before."
  exit 0
fi
docker tag "$IMAGE:$SHA" "$IMAGE:latest"
for s in web2 web3; do
  docker compose up -d --no-build "$s"
  n=0
  until docker compose exec -T "$s" node -e "fetch('http://127.0.0.1:3000/icon.svg').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; do
    n=$((n+1)); [ "$n" -ge 90 ] && { echo "$s on the second server is not answering"; exit 1; }
    sleep 2
  done
  [ "$s" = web3 ] || sleep 20
done
docker images "$IMAGE" --format '{{.Tag}}' | grep -vxE "latest|$SHA" | xargs -r -I{} docker rmi -f "$IMAGE:{}" >/dev/null
docker image prune -f >/dev/null
REMOTE2

# keep a copy of the newest nightly backup off the server, for as long as the server keeps its own
BACKUPS="$HOME/zhoupmap-backups"
mkdir -p -m 700 "$BACKUPS"
latest=$(ssh "$HOST" 'ls -t ~/backups/zhoupmap-*.sql.gz 2>/dev/null | head -1')
if [ -n "$latest" ]; then scp -q "$HOST:$latest" "$BACKUPS/"; fi
find "$BACKUPS" -name 'zhoupmap-*.sql.gz' -mtime +13 -delete

echo "Deployed ${sha:0:7}. https://zhoupmap.com"
