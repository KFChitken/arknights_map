#!/usr/bin/env bash
# Set up (or set up again) the second door, server B, from nothing: run on B as the ubuntu user with
#   bash relay-setup.sh <A's private address>
# after copying deploy/relay/nginx.conf next to it. B keeps nothing: when it breaks, a new one is this.
# SSH and the cloud firewall are set by hand (see the README), not here.
set -euo pipefail
A_PRIVATE="${1:?usage: relay-setup.sh <private address of A, e.g. 10.5.0.6>}"
HERE="$(cd "$(dirname "$0")" && pwd)"

sudo DEBIAN_FRONTEND=noninteractive apt-get update -q
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q nginx libnginx-mod-stream unattended-upgrades
sudo systemctl enable --now unattended-upgrades
# the clock: Tencent's image keeps it with chrony; anything else, systemd-timesyncd
if ! systemctl is-active --quiet chrony; then sudo systemctl enable --now systemd-timesyncd; fi

# BBR as on A; and a local port for each connection B opens to A, so the whole range, reused soon
sudo tee /etc/sysctl.d/90-relay.conf >/dev/null <<'SYSCTL'
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
fs.file-max = 2097152
SYSCTL
echo tcp_bbr | sudo tee /etc/modules-load.d/bbr.conf >/dev/null
sudo modprobe tcp_bbr
# only this file (sysctl --system would also apply other files)
sudo sysctl -p /etc/sysctl.d/90-relay.conf

# nginx may hold a million open files
sudo mkdir -p /etc/systemd/system/nginx.service.d
printf '[Service]\nLimitNOFILE=1048576\n' | sudo tee /etc/systemd/system/nginx.service.d/limits.conf >/dev/null
sudo systemctl daemon-reload

# the forwarding, and no web site of nginx's own
sed "s/A_PRIVATE/${A_PRIVATE}/g" "$HERE/nginx.conf" | sudo tee /etc/nginx/nginx.conf >/dev/null
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
echo "relay up: 443 -> ${A_PRIVATE}:8443 (PROXY protocol), 80 -> ${A_PRIVATE}:80"
