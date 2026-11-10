#!/bin/sh
set -eu
exec 9>/run/lock/tonight-soup-cert.lock
flock -n 9 || exit 0
base=/opt/tonight-turtle-soup
docker run --rm --name tonight-soup-cert-renew --network host \
  --memory 256m --memory-swap 256m --cpus .5 --pids-limit 128 \
  -v "$base/letsencrypt:/etc/letsencrypt" \
  -v "$base/acme:/var/www/certbot" \
  -v "$base/certbot-work:/var/lib/letsencrypt" \
  -v "$base/certbot-logs:/var/log/letsencrypt" \
  certbot/certbot:v5.4.0 renew --quiet
docker exec tonight-soup-web nginx -t
docker kill --signal=HUP tonight-soup-web >/dev/null
