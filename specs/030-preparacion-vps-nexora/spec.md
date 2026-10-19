# 030 — Preparación de Nexora Remesas para EasyPanel

## Problema

La personalización de Nexora funciona en desarrollo, pero necesita una ruta de
producción como servicio App de EasyPanel, conectada al PostgreSQL existente,
con adjuntos persistentes y sin perder trabajo nocturno ante un reinicio.

## Comportamiento observable y criterios de aceptación

- La configuración de producción contiene solo la aplicación, escucha en el
  puerto interno 3000 y no publica puertos del host.
- La base se recibe exclusivamente mediante `DATABASE_URL`; no se crea un
  servicio PostgreSQL ni se incluyen credenciales en código.
- Los adjuntos persisten en un volumen montado en `/data`.
- Tras reiniciar durante el turno nocturno, los entrantes recientes que habían
  quedado sin saliente vuelven a programarse. Las asignaciones y el outbox del
  cerebro externo conservan sus mecanismos de reanudación existentes.
- Un adjunto entrante de tipo imagen o documento nunca permite que el agente
  confirme un pago: responde con un acuse neutral y entrega la conversación a
  una persona para revisión.
- La guía identifica fuente GitHub, rama, contexto, Dockerfile, variables,
  healthcheck y reversión sin conectar el WhatsApp definitivo.

## Fuera de alcance

- No se despliega el VPS, no se cambia DNS y no se conectan credenciales reales.
- No se reemplaza el proxy de EasyPanel ni se reservan 80/443.
- No se crea, elimina ni modifica el servicio PostgreSQL administrado.

## Puerta constitucional

- Seguridad: los secretos llegan solo por Environment y no se imprimen.
- Soberanía: todo corre con Docker, Postgres y almacenamiento local; no se añade
  un tercero obligatorio.
- Idempotencia: la reanudación solo considera entrantes sin un saliente
  posterior y reutiliza el coalesce existente.
- Multi-tenant: las consultas de recuperación conservan `organization_id` y no
  exponen datos a una API.
- El cambio no altera el modelo de datos ni un contrato público; corresponde al
  carril ligero.
