#!/bin/sh
# Real visitor addresses behind a reverse proxy (nginx, Caddy, Cloudflare).
#
# ARGUS_TRUSTED_PROXIES: comma-separated IPs or CIDR ranges of the proxies
#   in front of Argus. Only connections from these may say who the visitor
#   is; everyone else is taken at their own address.
# ARGUS_REAL_IP_HEADER: the header those proxies put the visitor's address
#   in (default X-Forwarded-For; CF-Connecting-IP when Cloudflare connects
#   to Argus directly, for example through a tunnel).
#
# Writes /etc/nginx/argus-real-ip.conf, included by the server block.
set -eu
out=/etc/nginx/argus-real-ip.conf
: > "$out"
proxies=$(printf '%s' "${ARGUS_TRUSTED_PROXIES:-}" | tr ',' ' ')
header=${ARGUS_REAL_IP_HEADER:-X-Forwarded-For}
case "$header" in
  *[!A-Za-z0-9-]*|'') echo "argus: ARGUS_REAL_IP_HEADER must be a header name" >&2; exit 1 ;;
esac
count=0
for p in $proxies; do
  # IPv4 or IPv6 address, optionally with a /prefix. Nothing else gets in.
  case "$p" in
    *[!0-9a-fA-F.:/]*) echo "argus: ignoring trusted proxy '$p' (not an IP or range)" >&2; continue ;;
  esac
  echo "set_real_ip_from $p;" >> "$out"
  count=$((count + 1))
done
if [ "$count" -gt 0 ]; then
  echo "real_ip_header $header;" >> "$out"
  echo "real_ip_recursive on;" >> "$out"
  echo "argus: trusting $count proxy range(s) for $header" >&2
fi
