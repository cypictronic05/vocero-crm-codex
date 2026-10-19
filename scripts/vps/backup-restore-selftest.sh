#!/bin/sh
set -eu

work="$(mktemp -d /tmp/nexora-backup-selftest.XXXXXX)"
pgdata="$work/pgdata"
socket="$work/socket"
mkdir -p "$socket" "$work/media/media"
started=0
cleanup() {
  if [ "$started" = 1 ]; then
    pg_ctl -D "$pgdata" -m fast -w stop >/dev/null 2>&1 || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

initdb -D "$pgdata" -A trust >/dev/null
pg_ctl -D "$pgdata" -o "-k $socket -c listen_addresses=''" -w start >/dev/null
started=1
createdb -h "$socket" origen
psql -h "$socket" -d origen -v ON_ERROR_STOP=1 \
  -c "create table prueba(id integer primary key, valor text not null); insert into prueba values (1, 'nexora');" \
  >/dev/null
pg_dump -h "$socket" -d origen -Fc --no-owner --no-acl \
  -f "$work/database.dump"
printf 'adjunto-prueba\n' > "$work/media/media/asset_1"
tar -C "$work/media" -czf "$work/media.tar.gz" media
printf 'format=nexora-v1\n' > "$work/metadata.txt"
(
  cd "$work"
  sha256sum database.dump media.tar.gz metadata.txt > SHA256SUMS
  tar -czf package.tar.gz database.dump media.tar.gz metadata.txt SHA256SUMS
)

age-keygen -o "$work/age.key" >/dev/null 2>&1
recipient="$(age-keygen -y "$work/age.key")"
age -r "$recipient" -o "$work/package.tar.gz.age" "$work/package.tar.gz"

PGHOST="$socket" PGUSER=postgres PGDATABASE=origen \
AGE_IDENTITY_FILE="$work/age.key" \
  /opt/vocero/restore.sh "$work/package.tar.gz.age" restaurada \
  "$work/restored-media" >/dev/null

test "$(psql -h "$socket" -d restaurada -tAc "select valor from prueba where id=1")" = "nexora"
test "$(cat "$work/restored-media/media/asset_1")" = "adjunto-prueba"
echo "[backup-selftest] dump, cifrado y restauración paralela: ok"
