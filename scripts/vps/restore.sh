#!/bin/sh
set -eu

usage() {
  echo "Uso: restore.sh ARCHIVO.age --verify-only" >&2
  echo "  o: restore.sh ARCHIVO.age BASE_NUEVA DIRECTORIO_MEDIA_NUEVO" >&2
  exit 2
}

[ "$#" -ge 2 ] || usage
archive="$1"
mode="$2"
: "${AGE_IDENTITY_FILE:?falta AGE_IDENTITY_FILE}"
[ -f "$archive" ] || { echo "[restore] no existe $archive" >&2; exit 2; }
[ -f "$AGE_IDENTITY_FILE" ] || { echo "[restore] no existe AGE_IDENTITY_FILE" >&2; exit 2; }

umask 077
stage="$(mktemp -d /tmp/nexora-restore.XXXXXX)"
cleanup() { rm -rf "$stage"; }
trap cleanup EXIT INT TERM

age -d -i "$AGE_IDENTITY_FILE" -o "$stage/package.tar.gz" "$archive"
tar -xzf "$stage/package.tar.gz" -C "$stage"
(
  cd "$stage"
  sha256sum -c SHA256SUMS
)
pg_restore --list "$stage/database.dump" >/dev/null
tar -tzf "$stage/media.tar.gz" | awk '
  /^\// || /(^|\/)\.\.($|\/)/ { bad=1 }
  $0 !~ /^media(\/|$)/ { bad=1 }
  END { exit bad }
' || { echo "[restore] rutas inválidas en media.tar.gz" >&2; exit 1; }

if [ "$mode" = "--verify-only" ]; then
  echo "[restore] archivo íntegro y legible"
  exit 0
fi
[ "$#" -eq 3 ] || usage
target_db="$2"
target_media="$3"
case "$target_db" in
  ''|*[!A-Za-z0-9_]*) echo "[restore] nombre de base inválido" >&2; exit 2 ;;
esac
if psql -d postgres -tAc "select 1 from pg_database where datname = '$target_db'" | grep -q 1; then
  echo "[restore] la base $target_db ya existe; no se sobrescribe" >&2
  exit 1
fi
if [ -e "$target_media" ]; then
  echo "[restore] $target_media ya existe; no se sobrescribe" >&2
  exit 1
fi

createdb "$target_db"
pg_restore --exit-on-error --no-owner --no-acl -d "$target_db" \
  "$stage/database.dump"
mkdir -p "$target_media"
tar -xzf "$stage/media.tar.gz" -C "$target_media"
echo "[restore] restauración paralela lista: base=$target_db media=$target_media/media"
