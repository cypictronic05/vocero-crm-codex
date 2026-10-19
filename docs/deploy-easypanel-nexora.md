# Nexora CRM en EasyPanel

Esta es la configuración de producción para desplegar **solo la aplicación**.
PostgreSQL ya existe y está administrado por EasyPanel; Vocero se conecta por
`DATABASE_URL`, no crea otra base ni publica puertos del VPS.

## Fuente y compilación

En EasyPanel crea un servicio **App** y configura:

- Source: **GitHub**.
- Repository: `cypictronic05/vocero-crm-codex`.
- Branch: `feature/nexora-turnos`.
- Build Path / contexto: `/` (raíz del repositorio).
- Builder: **Dockerfile**.
- Dockerfile Path: `Dockerfile`.
- Target/internal port del dominio: `3000`, protocolo HTTP.

EasyPanel resuelve el Dockerfile desde el Build Path y usa ese directorio como
contexto. La imagen escucha en `0.0.0.0:3000`; no agregues un host port ni un
servicio Caddy/Traefik dentro de esta aplicación. El dominio y HTTPS los termina
el proxy de EasyPanel.

## Almacenamiento persistente

En Storage agrega un volumen administrado por EasyPanel montado exactamente en:

```text
/data
```

La imagen define `MEDIA_DIR=/data/media`. Ahí viven adjuntos, logos e iconos.
No definas `MEDIA_DIR` en Environment y no uses un directorio dentro de `/app`.

PostgreSQL conserva conversaciones, asignaciones, horarios, credenciales
cifradas, configuración del bot y el outbox del cerebro externo. Los workers de
asignación y despacho se reanudan al arrancar; el agente incluido recupera los
entrantes pendientes de la ventana nocturna actual.

## Variables de entorno

Obligatorias:

```dotenv
APP_BASE_URL=https://crm.tudominio.com
DATABASE_URL=postgresql://USUARIO:PASSWORD@HOST_INTERNO:5432/BASE
BETTER_AUTH_SECRET=VALOR_SECRETO
ENCRYPTION_KEY=VALOR_BASE64_DE_32_BYTES
META_WEBHOOK_VERIFY_TOKEN=VALOR_SECRETO
META_APP_SECRET=VALOR_SECRETO
META_GRAPH_API_VERSION=v25.0
REGISTRATION_MODE=closed
```

`DATABASE_URL` debe ser la URL interna que muestra el servicio PostgreSQL de
EasyPanel. No uses el host público, no publiques 5432 y no escribas la URL en
el código o en un archivo versionado. Conserva la `ENCRYPTION_KEY` actual al
migrar datos: cambiarla vuelve ilegibles las credenciales cifradas existentes.
`REGISTRATION_MODE=closed` impide el signup público incluso con una base vacía;
no lo cambies durante la migración. El aprovisionamiento y la recuperación se
describen en `docs/seguridad-registro-nexora.md`.

Opcionales según la instancia:

```dotenv
AGENT_COALESCE_MS=6000
OPENROUTER_API_TOKEN=
OPENROUTER_BASE_URL=https://openrouter.ai/api
OPENROUTER_MODEL=
OPENROUTER_JUDGE_MODEL=
CHANNELS=
AGENDA=
ATRIBUCION=
BOT_API_KEY=
BRAIN_HEALTH_URL=
BRAIN_DISPATCH_URL=
```

No definas `PORT`, `HOSTNAME`, `NODE_ENV` ni `MEDIA_DIR`: la imagen ya fija los
valores correctos. Tampoco habilites `WA_MOCK_ENABLED` en producción.

## Arranque, migraciones y salud

El contenedor ejecuta `node migrate.mjs && node server.js`. Las migraciones son
aditivas y se aplican sobre la base indicada por `DATABASE_URL` antes de aceptar
tráfico. Si la base no responde o una migración falla, la app no arranca.

Configura el healthcheck de EasyPanel con:

```text
GET /api/health
Target port: 3000
```

La respuesta esperada contiene `ok: true` y `mediaWritable: true`. Este último
campo confirma que el volumen `/data` está montado con permisos correctos.

## Primera publicación y reversión

Antes del primer despliegue, crea un respaldo de la base administrada y del
volumen de adjuntos. En el primer arranque usa todavía las credenciales de
prueba; no cambies el webhook definitivo hasta validar login, conversaciones,
asignaciones, turno nocturno, adjuntos y healthcheck.

Para revertir código, selecciona en EasyPanel un deployment anterior o vuelve
la fuente a un commit conocido de esta misma rama. No reviertas migraciones ni
restaures la base automáticamente: conserva el estado actual y evalúa
compatibilidad antes de promover un respaldo.

Para trasladar la instalación local completa sin SSH, incluidos usuarios,
conversaciones y adjuntos, sigue `docs/migracion-easypanel-nexora.md`. El flujo
restaura primero en una base paralela y deja la base actual disponible para una
reversión inmediata.

El archivo `docker-compose.easypanel.yml` documenta la misma topología de una
sola app para validación local. No es necesario elegir Compose como fuente en
EasyPanel.
