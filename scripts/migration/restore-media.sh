#!/bin/sh
set -eu

data_root="${DATA_ROOT:-/data}"
archive="${1:-$data_root/migration/incoming-media.tar.gz}"
expected="${2:-${MIGRATION_MEDIA_SHA256:-}}"

if [ "${CONFIRM_MEDIA_RESTORE:-}" != "NEXORA_RESTORE_MEDIA" ]; then
  echo "Restauracion cancelada: define CONFIRM_MEDIA_RESTORE=NEXORA_RESTORE_MEDIA" >&2
  exit 2
fi
if [ ! -f "$archive" ]; then
  echo "No existe el archivo: $archive" >&2
  exit 2
fi
if ! printf '%s' "$expected" | grep -Eq '^[a-fA-F0-9]{64}$'; then
  echo "Falta el SHA-256 esperado" >&2
  exit 2
fi

actual="$(sha256sum "$archive" | awk '{print $1}')"
if [ "$(printf '%s' "$actual" | tr 'A-F' 'a-f')" != "$(printf '%s' "$expected" | tr 'A-F' 'a-f')" ]; then
  echo "SHA-256 incorrecto; no se modifico /data/media" >&2
  exit 3
fi

listing="$(tar -tzf "$archive")"
if [ -z "$listing" ] || printf '%s\n' "$listing" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "Archivo tar vacio o con una ruta insegura" >&2
  exit 3
fi
if printf '%s\n' "$listing" | grep -Ev '^media(/|$)' >/dev/null; then
  echo "El archivo contiene rutas fuera de media/" >&2
  exit 3
fi
if tar -tvzf "$archive" | grep -E '^l' >/dev/null; then
  echo "No se permiten enlaces simbolicos en el paquete" >&2
  exit 3
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
migration_dir="$data_root/migration"
stage="$migration_dir/stage-$stamp"
before_dir="$migration_dir/media-before-$stamp"
before_archive="$migration_dir/destination-media-before-$stamp.tar.gz"
mkdir -p "$stage"
chmod 700 "$migration_dir" "$stage"
tar -xzf "$archive" -C "$stage"
test -d "$stage/media"

if [ -d "$data_root/media" ]; then
  tar -czf "$before_archive" -C "$data_root" media
  mv "$data_root/media" "$before_dir"
fi
mv "$stage/media" "$data_root/media"

echo "Adjuntos restaurados: $(find "$data_root/media" -type f | wc -l | tr -d ' ') archivos"
if [ -f "$before_archive" ]; then
  echo "Respaldo anterior: $before_archive"
  echo "SHA-256 anterior: $(sha256sum "$before_archive" | awk '{print $1}')"
fi
echo "Directorio anterior conservado: $before_dir"
