# E2E — Tasas de cambio

Arnés: `scripts/e2e-tasas-cambio.mjs`.

## Preparación aislada

1. Crear PostgreSQL 16 desechable; nunca usar `nexora_import_20261019`.
2. Aplicar migraciones hasta 0021, arrancar la app con `REGISTRATION_MODE=bootstrap`,
   `TASAS=on`, `WA_MOCK_ENABLED=true` y URLs de WhatsApp/IA apuntando a mocks.
3. Aplicar 0024 con `pnpm db:migrate`, ejecutar `pnpm test:integration:tasas` y después `pnpm test:e2e:tasas`.

## Evidencias esperadas

- El owner activa el módulo por API autenticada.
- Se guarda un borrador y no aparece como vigente.
- Tras publicar, GET y la pantalla real muestran una tarjeta comercial, ruta,
  tasa legible, moneda destino y vigencia humana.
- Los selectores independientes permiten buscar origen y destino por bandera,
  país, código o moneda; el destino procede de las rutas activas y nunca repite
  el origen.
- El owner ve ocho países, una matriz direccional, una vista previa antes de la
  activación masiva y el aviso de que las rutas nuevas quedan sin tasa/fórmula.
- La calculadora y la vista previa de WhatsApp consumen el generador del servidor;
  no infieren la operación ni reutilizan una tasa vencida.
- Un mensaje como «¿Cuánto son 50 mil pesos?» reutiliza una ruta inequívoca del
  contexto reciente, consulta PostgreSQL y responde el importe exacto sin LLM.
- «100 mil COP» y nombres como «pesos colombianos» se interpretan como importes;
  una moneda o ruta ambigua produce una pregunta concreta, no una tasa inventada.
- Confirmaciones de transferencias, pagos o comprobantes continúan en revisión
  humana aunque incluyan una cantidad.
- Una ruta explícita del mensaje actual invalida el contexto anterior. Si no
  tiene tasa publicada y vigente, se registra una única solicitud pendiente y
  solo entonces la respuesta informa que se consultará con una asesora.
- Una nota de voz se conserva como adjunto y recibe un único aviso para escribir
  la consulta; no se transcribe, no llega al LLM y no reutiliza texto anterior.
- Reintentar el mismo webhook de ruta o audio no duplica solicitudes ni respuestas.
- Antes de guardar/publicar, la supervisora ve el cálculo exacto con la nueva tasa.
- Un decimal negativo recibe 422.
- Publicación solapada recibe 409 y conserva la versión anterior.
- Con `TASAS` apagado, API y página responden 404.
- No hay llamadas a Meta ni al proveedor LLM.

Permisos owner/supervisor/member, aislamiento entre organizaciones, cálculo, rutas
inversas, ambigüedad, concurrencia, intervención humana y protecciones financieras
se cubren además en Vitest. La
actualización 0023→0024 se verifica sobre una copia desechable y confirma que
las rutas, cotizaciones y operaciones preexistentes conservan identidad y valor.
La validación visual conserva capturas de escritorio y móvil, y comprueba tema
oscuro sin alterar la navegación general del CRM.
