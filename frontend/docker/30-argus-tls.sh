#!/bin/sh
# HTTPS with a self-signed certificate, for a LAN server before a proper
# reverse proxy (with its own certificate) is in front.
#
# ARGUS_TLS=self-signed   serve HTTPS on the container's port 443 too
# ARGUS_TLS_NAMES         comma list of the names and IPs people use to
#                         reach this server (default: localhost)
#
# The certificate is made once and kept in /etc/nginx/tls (a volume), so
# the exception you accept in the browser stays valid across rebuilds;
# it's made again only if ARGUS_TLS_NAMES changes. Writes
# /etc/nginx/argus-tls.conf, included in the server block.
set -eu
conf=/etc/nginx/argus-tls.conf
: > "$conf"
[ "${ARGUS_TLS:-}" = "self-signed" ] || exit 0

dir=/etc/nginx/tls
mkdir -p "$dir"
names=${ARGUS_TLS_NAMES:-localhost}
case "$names" in
  *[!A-Za-z0-9.,:_-]*) echo "argus: ARGUS_TLS_NAMES may only hold names, IPs and commas" >&2; exit 1 ;;
esac
san=""
for n in $(printf '%s' "$names" | tr ',' ' '); do
  if printf '%s' "$n" | grep -Eq '^[0-9.]+$|:'; then
    san="$san,IP:$n"
  else
    san="$san,DNS:$n"
  fi
done
san=${san#,}
first=$(printf '%s' "$names" | cut -d, -f1)

if [ ! -s "$dir/cert.pem" ] || [ "$(cat "$dir/names" 2>/dev/null)" != "$names" ]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
    -days 825 -subj "/CN=$first/O=Argus (self-signed)" \
    -addext "subjectAltName=$san" \
    -keyout "$dir/key.pem" -out "$dir/cert.pem" 2>/dev/null
  chmod 600 "$dir/key.pem"
  printf '%s' "$names" > "$dir/names"
  echo "argus: made a self-signed certificate for $names" >&2
fi
cat > "$conf" <<CONF
listen 443 ssl;
http2 on;
ssl_certificate $dir/cert.pem;
ssl_certificate_key $dir/key.pem;
ssl_protocols TLSv1.2 TLSv1.3;
CONF
echo "argus: HTTPS on (self-signed, $names)" >&2
