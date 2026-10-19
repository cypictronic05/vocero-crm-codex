#!/bin/sh
set -eu

: "${PGHOST:?falta PGHOST}"
: "${PGUSER:?falta PGUSER}"
: "${PGDATABASE:?falta PGDATABASE}"
: "${BACKUP_AGE_RECIPIENT:?falta BACKUP_AGE_RECIPIENT}"

retention_days="${BACKUP_RETENTION_DAYS:-30}"
case "$retention_days" in
  ''|*[!0-9]*) echo "[backup] BACKUP_RETENTION_DAYS debe ser entero" >&2; exit 2 ;;
esac

umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
stage="$(mktemp -d /tmp/nexora-backup.XXXXXX)"
package="$stage/nexora-$stamp.tar.gz"
partial="/backups/.nexora-$stamp.tar.gz.age.partial"
output="/backups/nexora-$stamp.tar.gz.age"
cleanup() {
  rm -rf "$stage"
  rm -f "$partial"
}
trap cleanup EXIT INT TERM

echo "[backup] creando pg_dump $stamp"
pg_dump --format=custom --compress=6 --no-owner --no-acl \
  --file="$stage/database.dump" "$PGDATABASE"

if [ ! -d /data/media ]; then
  echo "[backup] falta /data/media; se cancela para no producir un respaldo incompleto" >&2
  exit 1
fi
tar -C /data -czf "$stage/media.tar.gz" media

cat > "$stage/metadata.txt" <<EOF
created_at_utc=$stamp
database=$PGDATABASE
format=nexora-v1
EOF
(
  cd "$stage"
  sha256sum database.dump media.tar.gz metadata.txt > SHA256SUMS
  tar -czf "$package" database.dump media.tar.gz metadata.txt SHA256SUMS
)

age -r "$BACKUP_AGE_RECIPIENT" -o "$partial" "$package"
mv "$partial" "$output"
find /backups -maxdepth 1 -type f -name 'nexora-*.tar.gz.age' \
  -mtime "+$retention_days" -delete
echo "[backup] listo: $(basename "$output")"
