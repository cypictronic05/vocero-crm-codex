# Webhook local de WhatsApp mediante Cloudflare Tunnel

Esta receta expone **solo** el webhook de WhatsApp. Cloudflare nunca apunta al
puerto 3000 de Next.js: apunta al proxy local en `127.0.0.1:8787`, que responde
404 para login, bandeja, Ajustes, APIs administrativas y cualquier ruta que no
sea el webhook exacto configurado.

## Contrato que recibe Meta

Ruta exacta:

```text
/api/webhooks/wa/<META_WEBHOOK_VERIFY_TOKEN>
```

- GET: `hub.mode=subscribe`, `hub.verify_token` y `hub.challenge`. El segmento
  y el query token deben coincidir con `META_WEBHOOK_VERIFY_TOKEN`.
- POST: conserva el cuerpo crudo y `x-hub-signature-256`. Si
  `META_APP_SECRET` está configurado, Vocero exige
  `sha256=HMAC-SHA256(META_APP_SECRET, cuerpo crudo)`; si no, esa segunda capa
  se omite.

Variables existentes involucradas: `META_WEBHOOK_VERIFY_TOKEN` (obligatoria),
`META_APP_SECRET` (opcional y recomendada) y `APP_BASE_URL` (solo genera la URL
mostrada por el CRM; no hace falta cambiarla para esta prueba). El proxy admite
`WEBHOOK_PROXY_PORT` y `VOCERO_LOCAL_URL` como overrides de proceso; no es
necesario agregarlos a `.env`.

## Conexión local a Vocero

Caddy escucha en 80/443 y redirige HTTP a HTTPS. El proxy no pasa por Caddy:
el override `docker-compose.webhook-local.yml` publica directamente el puerto
3000 del contenedor `app` como `127.0.0.1:3001`. Al estar ligado a loopback no
queda disponible en la LAN ni en internet.

Desde la raíz del repositorio, aplica el override sin recrear PostgreSQL:

```powershell
docker compose -f docker-compose.yml -f docker-compose.webhook-local.yml up -d --no-deps app
```

Esto puede recrear únicamente el contenedor `app`; conserva su volumen y no
toca el contenedor ni el volumen de PostgreSQL.

No se desactiva TLS de Node. `https://localhost` sigue rechazado por el proxy
si no existe una CA explícitamente confiable; el camino soportado evita TLS
mediante el puerto HTTP dedicado, accesible solo por loopback.

## Arranque del proxy y el túnel

1. Con el upstream local disponible en `127.0.0.1:3001`, inicia el proxy:

```powershell
node --env-file=.env scripts/webhook-proxy.mjs
```

2. Con `cloudflared` instalado, abre otra terminal:

```powershell
cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate
```

Cloudflare imprimirá una URL similar a
`https://nombre-aleatorio.trycloudflare.com`. En Meta registra:

```text
https://nombre-aleatorio.trycloudflare.com/api/webhooks/wa/<META_WEBHOOK_VERIFY_TOKEN>
```

En el campo **Verify token** de Meta pega el mismo valor de
`META_WEBHOOK_VERIFY_TOKEN`. Los Quick Tunnels cambian de URL al reiniciarse;
actualiza Meta si reinicias `cloudflared`.

## Controles de seguridad

- Nunca ejecutes el túnel contra `localhost:3000`.
- Nunca apuntes el proxy a `http://127.0.0.1` sin puerto: es Caddy y responde
  con una redirección 308. El upstream por defecto es `127.0.0.1:3001`.
- El proxy enlaza solo loopback y solo permite GET/POST sobre la ruta exacta.
- Conserva las cabeceras end-to-end de Meta, pero no reenvía `Cookie`,
  `Authorization`, `Host` ni cabeceras hop-by-hop.
- No registra token, query, firmas ni cuerpos.
- Para comprobarlo sin Meta: `pnpm test:webhook-proxy`.
