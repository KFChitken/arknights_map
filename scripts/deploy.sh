#!/usr/bin/env bash
# Update the live site to the latest main branch on GitHub. Push first, then run
# from the Mac. The server is reached through the `zhoupmap` entry in ~/.ssh/config.
#
# GitHub builds the app image for every push (.github/workflows/image.yml). This
# waits for that build and has the server download the image. If GitHub's build
# failed or the server cannot download it, the server builds the image itself.
set -euo pipefail

HOST="${DEPLOY_HOST:-zhoupmap}"
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

ssh "$HOST" "MODE=$mode SHA=$sha bash -s" <<'REMOTE'
set -e
cd ~/arknights_map
git pull --ff-only
IMAGE=ghcr.io/kfchitken/arknights_map
compose() { docker compose -f docker-compose.prod.yml "$@"; }
# :latest on the server is always the image that runs, so plain compose commands keep using it
if [ "$MODE" = pull ] && docker pull -q "$IMAGE:$SHA" >/dev/null; then
  docker tag "$IMAGE:$SHA" "$IMAGE:latest"
else
  [ "$MODE" = pull ] && echo "Could not download the image from GitHub; building it here."
  compose build web
fi
compose up -d --no-build
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

# keep a copy of the newest nightly backup off the server, for as long as the server keeps its own
BACKUPS="$HOME/zhoupmap-backups"
mkdir -p -m 700 "$BACKUPS"
latest=$(ssh "$HOST" 'ls -t ~/backups/zhoupmap-*.sql.gz 2>/dev/null | head -1')
if [ -n "$latest" ]; then scp -q "$HOST:$latest" "$BACKUPS/"; fi
find "$BACKUPS" -name 'zhoupmap-*.sql.gz' -mtime +13 -delete

echo "Deployed ${sha:0:7}. https://zhoupmap.com"
