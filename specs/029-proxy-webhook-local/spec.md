# Especificación: proxy local exclusivo para el webhook de WhatsApp

**Rama**: `feature/nexora-turnos`

**Creada**: 2026-10-19

**Estado**: especificada antes de escribir código.

**Carril**: ligero. Es una herramienta de desarrollo local; no cambia el
modelo de datos ni el contrato del webhook existente.

## Problema

Cloudflare Tunnel debe poder entregar el webhook de Meta a una instancia local
de Vocero sin exponer el login, la bandeja, Ajustes, APIs administrativas ni
ninguna otra ruta del servidor Next.js.

## Comportamiento observable

- El proxy escucha únicamente en `127.0.0.1:8787` por defecto y reenvía al
  Vocero local en `http://127.0.0.1:3001`.
- Un override Compose publica `app:3000` como `127.0.0.1:3001`; no pasa por
  Caddy, no acepta conexiones externas y no toca PostgreSQL ni sus volúmenes.
- Solo acepta la ruta exacta
  `/api/webhooks/wa/<META_WEBHOOK_VERIFY_TOKEN>`.
- En esa ruta solo permite GET y POST. El resto de métodos responde 405 y toda
  ruta distinta responde 404 sin llegar a Vocero.
- GET conserva la query de verificación de Meta.
- POST conserva exactamente los bytes del cuerpo y las cabeceras end-to-end de
  Meta, incluida `x-hub-signature-256`.
- No reenvía cookies, autorización, `Host` ni cabeceras hop-by-hop; el runtime
  recalcula `Content-Length` sobre los mismos bytes.
- No registra URL, token, query, cuerpo ni cabeceras sensibles. Los logs solo
  incluyen método, código, duración y estado operativo.
- Un cuerpo mayor de 2 MiB se rechaza con 413 y un upstream no disponible con
  502, sin revelar detalles internos.

## Fuera de alcance

- Instalar o autenticar `cloudflared`.
- Desactivar TLS o aceptar certificados de Caddy sin una CA confiable. Se usa
  el puerto HTTP dedicado y limitado a loopback.
- Modificar `.env`, `APP_BASE_URL`, el dominio o el número de Meta.
- Conectarse a WhatsApp de producción.
- Exponer otras rutas o actuar como proxy genérico.

## Criterios de aceptación

1. Handshake GET válido llega intacto al upstream y devuelve su challenge.
2. POST conserva cuerpo y firma byte a byte.
3. `/login`, `/inbox`, `/api/settings/*`, un token de ruta incorrecto y
   cualquier otra ruta reciben 404 sin tocar el upstream.
4. PUT/DELETE/PATCH sobre la ruta válida reciben 405.
5. Los logs de prueba no contienen el verify token ni el cuerpo.

## Constitution Check

- Seguridad: allowlist exacta, bind loopback, cabeceras mínimas y logs sin
  secretos.
- Soberanía: solo Node estándar; Cloudflare Tunnel es una herramienta opcional
  de desarrollo y el CRM sigue funcionando sin ella.
- Multi-tenancy e idempotencia: el proxy no interpreta ni persiste eventos; el
  webhook existente conserva ambas garantías.
- Verificación: pruebas de red locales con upstream falso, typecheck, lint,
  suite y build. Sin Meta real.

Sin violaciones.
