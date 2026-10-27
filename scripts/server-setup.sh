#!/usr/bin/env bash
# First-time setup of the Ubuntu server: Docker, a swap file for builds, the
# code, a .env with fresh secrets and the nightly backup. Safe to run again.
# From the Mac: ssh zhoupmap 'bash -s' < scripts/server-setup.sh
set -euo pipefail

REPO=https://github.com/KFChitken/arknights_map.git
DIR="$HOME/arknights_map"

if ! command -v docker >/dev/null; then
  sudo apt-get update
  sudo apt-get install -y docker.io docker-compose-v2 git
  sudo usermod -aG docker "$USER"
fi

# `next build` alone can use most of a 2 GB machine
if [ -z "$(swapon --show)" ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

[ -d "$DIR/.git" ] || git clone "$REPO" "$DIR"

if [ ! -f "$DIR/.env" ]; then
  umask 077
  cat > "$DIR/.env" <<ENV
AUTH_SECRET=$(openssl rand -base64 32)
DB_PASSWORD=$(openssl rand -hex 24)
NEXT_PUBLIC_AMAP_KEY=
NEXT_PUBLIC_AMAP_SECURITY_CODE=
SMTP_URL=
MAIL_FROM=舟P地图 <no-reply@zhoupmap.com>
ENV
fi

# nightly database backup at 04:00 server time, logged next to the dumps
mkdir -p -m 700 "$HOME/backups"
( crontab -l 2>/dev/null | grep -v 'scripts/backup.sh' || true
  echo "0 4 * * * $DIR/scripts/backup.sh >> \$HOME/backups/backup.log 2>&1" ) | crontab -

echo "Ready. Fill in the empty values in $DIR/.env, then run scripts/deploy.sh from the Mac."
