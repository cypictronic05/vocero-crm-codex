#!/bin/sh
set -eu

interval="${BACKUP_INTERVAL_SECONDS:-86400}"
case "$interval" in
  ''|*[!0-9]*) echo "[backup] BACKUP_INTERVAL_SECONDS debe ser entero" >&2; exit 2 ;;
esac
if [ "$interval" -lt 3600 ]; then
  echo "[backup] BACKUP_INTERVAL_SECONDS debe ser al menos 3600" >&2
  exit 2
fi

while true; do
  /opt/vocero/backup.sh || echo "[backup] la ejecución falló; se reintentará" >&2
  sleep "$interval"
done
