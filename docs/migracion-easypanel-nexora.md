# Migración de Nexora CRM a EasyPanel sin SSH

Este procedimiento mueve el PostgreSQL 16 local y `/data/media` hacia el VPS
sin publicar PostgreSQL, sin incrustar secretos en la imagen y sin reemplazar
la base actual hasta haber validado una base paralela.

## Auditoría local de referencia — 2026-10-19

- PostgreSQL `16.15`, zona UTC, base de aproximadamente 10 MB; el servicio no
  publica 5432 y usa un volumen Docker persistente.
- 35 tablas, 20 migraciones Drizzle, 60 claves foráneas validadas y ningún
  huérfano entre conversaciones/contactos, mensajes/conversaciones o
  mensajes/adjuntos.
- 2 usuarios, 2 hashes de contraseña, 2 miembros habilitados con horario, 15
  contactos, 15 conversaciones, 86 mensajes, 3 eventos de asignación, 9 leads,
  5 etapas, 1 perfil de agente habilitado y 1 entrada de conocimiento.
- 1 credencial Meta y 1 credencial de IA con sus tres componentes cifrados
  completos. No se leyó ni imprimió ningún cifrado, hash o token.
- 1 `media_asset` disponible con ruta y 2 archivos en `/data/media`: el adjunto
  y el favicon de la organización. El volumen ocupa aproximadamente 124 KiB.
- `ENCRYPTION_KEY` decodifica a 32 bytes y `BETTER_AUTH_SECRET` satisface la
  longitud mínima. Solo se validó el formato; sus valores no se mostraron.

Estos conteos son una línea base, no el corte final. Repetir la exportación y
el informe una vez congeladas las escrituras para capturar mensajes nuevos.

## Qué contiene cada respaldo

- PostgreSQL: usuarios, hashes de contraseña, organizaciones, miembros,
  contactos, conversaciones, mensajes, asignaciones, pipeline, agente, base de
  conocimiento, credenciales cifradas, sesiones y las 20 migraciones Drizzle.
- `/data/media`: adjuntos de WhatsApp y branding (incluido el favicon). Estos
  archivos no están dentro de PostgreSQL y se exportan por separado.
- No se exportan `.env`, `ENCRYPTION_KEY`, `BETTER_AUTH_SECRET` ni secretos del
  contenedor. Esos dos valores se copian por separado en EasyPanel.

Los hashes de contraseña de `account.password` se conservan literalmente: no
hay que crear una cuenta inicial en el VPS. `ENCRYPTION_KEY` sí debe ser
exactamente la original para descifrar los tokens AES-256-GCM guardados.
`BETTER_AUTH_SECRET` debe conservarse para mantener compatibilidad de firma de
sesiones; si cambia, las contraseñas siguen funcionando pero las sesiones
anteriores quedan invalidadas.

## Canal de transferencia

Usar un bucket S3/R2 privado, con bloqueo de acceso público, cifrado en reposo,
TLS, credenciales dedicadas al prefijo `nexora-migration/` y caducidad. Registrar
ese mismo bucket en **EasyPanel → Settings → Storage Providers**. No usar Git,
GitHub Releases, enlaces públicos, correo ni el volumen de la imagen.

El dump usa `pg_dump --format=custom`, envuelto en gzip, que es el formato de
restauración PostgreSQL de EasyPanel. Los adjuntos se descargan con una URL GET
firmada de 10–15 minutos; nunca se habilita lectura pública del bucket.

## Fase A — preparación y exportación local (Codex o el operador)

1. No cambiar el webhook ni detener la instancia todavía. Abrir PowerShell en
   la raíz del repositorio.
2. Ejecutar:

   ```powershell
   .\scripts\migration\export-local.ps1
   ```

   Crea `migration-artifacts/nexora-FECHA/` (ignorado por Git) con dump, medios,
   manifiesto SHA-256 e informe sin PII. No sobrescribe una exportación previa.
3. Comparar el inventario con la auditoría esperada y conservar el directorio
   en almacenamiento local cifrado.
4. Con AWS CLI y credenciales temporales/dedicadas en la sesión:

   ```powershell
   $env:AWS_ACCESS_KEY_ID = Read-Host "Access key"
   $env:AWS_SECRET_ACCESS_KEY = Read-Host "Secret key"
   .\scripts\migration\upload-private-s3.ps1 `
     -ArtifactDirectory ".\migration-artifacts\nexora-FECHA" `
     -Bucket "BUCKET-PRIVADO" `
     -Prefix "nexora-migration/LOTE-UNICO" `
     -EndpointUrl "https://ENDPOINT-S3" `
     -Region "auto"
   Remove-Item Env:\AWS_ACCESS_KEY_ID, Env:\AWS_SECRET_ACCESS_KEY
   ```

   La salida indica la ruta exacta que se usará en Restore. Confirmar en el
   proveedor que los objetos son privados y están cifrados.

## Fase B — respaldo previo del destino (manual en EasyPanel)

No ejecutar esta fase hasta acordar la ventana de migración.

Antes de continuar, confirma en `nexora-vocero → Environment`:

```dotenv
REGISTRATION_MODE=closed
```

No crees una cuenta inicial ni uses `bootstrap`: los usuarios, organizaciones,
hashes y membresías llegarán dentro del dump de PostgreSQL.

1. En `nexora-db → Backups`, crear una configuración hacia un prefijo exclusivo
   `nexora/pre-migration/database`, ejecutar **Manual Run** y esperar éxito.
2. En `nexora-vocero → Backups/Volumes`, respaldar el volumen montado en `/data`
   hacia `nexora/pre-migration/data`. El backup de volumen es un espejo; activar
   versionado/retención en el proveedor.
3. Guardar capturas/exportación de las variables actuales de la app sin
   pegarlas en tickets ni logs. En particular: `DATABASE_URL`,
   `ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, secretos Meta y variables del bot.
4. En la consola de la app ejecutar y guardar de forma privada la salida:

   ```sh
   node /app/scripts/migration/check-secret-compatibility.mjs
   ```

   En el origen se puede ejecutar
   `node --env-file=.env scripts/migration/check-secret-compatibility.mjs`.
   Las dos huellas deben coincidir después de copiar los valores originales.

## Fase C — restauración paralela de PostgreSQL (manual en EasyPanel)

1. Poner la aplicación en mantenimiento o detenerla para congelar escrituras.
   Hacer una exportación local final después de detener la entrada de mensajes.
2. En `nexora-db → Shell → psql`, ejecutar `SHOW server_version;`: el destino
   debe ser PostgreSQL 16 o una versión posterior compatible. Crear una base
   nueva, con un nombre simple y
   fechado; no borrar ni limpiar la base actual:

   ```sql
   CREATE DATABASE nexora_import_YYYYMMDD TEMPLATE template0;
   ```

   Si el rol configurado no tiene permiso `CREATEDB`, detenerse: no restaurar
   sobre la base actual. Crear la base paralela desde las opciones del servicio
   o conceder el permiso desde la consola administrativa de EasyPanel.

3. En `nexora-db → Backups → Restore`, elegir el proveedor privado, pegar la
   ruta exacta del `.sql.gz` y seleccionar `nexora_import_YYYYMMDD`. EasyPanel
   restaura en sitio y de forma destructiva **solo esa base nueva**.
4. Abrir psql sobre la base importada y ejecutar el contenido de
   `scripts/migration/integrity.sql`. Comparar tabla por tabla con
   `source-integrity.txt`: conteos, 20 migraciones, 60 FK válidas y cero
   huérfanos deben coincidir.
5. No apuntar todavía la app a la base importada si falla cualquier conteo.

## Fase D — adjuntos y cambio controlado (manual en EasyPanel)

1. Crear en el proveedor una URL GET firmada de 10–15 minutos para el
   `nexora-media-*.tar.gz`. Leer el SHA-256 en `manifest.json`.
2. En la consola de `nexora-vocero`, sin imprimir la URL:

   ```sh
   export MIGRATION_MEDIA_URL='URL-FIRMADA-CORTA'
   export MIGRATION_MEDIA_SHA256='SHA256-DEL-MANIFIESTO'
   node /app/scripts/migration/download-media.mjs
   unset MIGRATION_MEDIA_URL
   CONFIRM_MEDIA_RESTORE=NEXORA_RESTORE_MEDIA \
     /app/scripts/migration/restore-media.sh \
     /data/migration/incoming-media.tar.gz "$MIGRATION_MEDIA_SHA256"
   unset MIGRATION_MEDIA_SHA256
   ```

   El script comprueba SHA-256 y rutas del tar, conserva el directorio anterior
   y crea un tar de recuperación; no borra el contenido previo.
3. En Environment de `nexora-vocero`, copiar exactamente desde el origen
   `ENCRYPTION_KEY` y `BETTER_AUTH_SECRET`. No cambiar variables Meta ni webhook.
4. Cambiar únicamente `DATABASE_URL` para que el último segmento apunte a
   `nexora_import_YYYYMMDD`, conservando host, puerto, usuario y contraseña de
   la URL interna de EasyPanel. No exponer el 5432.
5. Desplegar/reiniciar la app. El arranque aplica solo migraciones pendientes y
   luego inicia el servidor.

## Validación funcional antes de abrir tráfico

1. `/api/health`: `ok: true`, `database: true`, `mediaWritable: true`.
2. Iniciar sesión con un usuario importado; no crear un usuario inicial nuevo.
3. Abrir contactos, 15 conversaciones y mensajes históricos; comprobar el
   adjunto y el favicon.
4. Verificar trabajadoras, asignaciones y eventos de asignación.
5. Revisar configuración del agente y base de conocimiento. Ejecutar Doctor:
   las credenciales Meta y de IA deben descifrar, sin enviar mensajes.
6. Verificar que los procesos de despacho/turnos arrancan sin errores. No hacer
   una prueba contra el WhatsApp definitivo ni cambiar su webhook.
7. Repetir `integrity.sql` y conservar el informe privado del destino.

## Reversión

La base original nunca se modifica. Si algo falla:

1. Poner la app en mantenimiento.
2. Restaurar las variables de entorno guardadas, especialmente la
   `DATABASE_URL` original y los secretos previos, y desplegar de nuevo.
3. Para medios, invocar `restore-media.sh` sobre el tar
   `destination-media-before-*.tar.gz` y su SHA-256 mostrado por el primer
   cambio. El script vuelve a conservar el estado que reemplaza.
4. Si la base original necesitara recuperación, usar el backup manual de
   EasyPanel solo después de verificar servicio, nombre de base y objeto; esa
   acción sí reemplaza objetos y es destructiva.

No eliminar la base importada fallida, la base anterior, los tar ni los objetos
del bucket hasta cerrar la validación. Después, aplicar la retención acordada.

## Responsabilidades

Codex puede auditar, generar el lote local, verificar hashes, revisar los dos
informes y ejecutar pruebas del código. El operador debe configurar el bucket,
copiar secretos mediante la UI, ejecutar el backup/restore en EasyPanel, crear
la base paralela, detener/reiniciar servicios y decidir el cambio o reversión.
