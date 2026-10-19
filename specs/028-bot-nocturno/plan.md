# Plan de implementación: bot nocturno de Nexora

## Resumen

Crear una política horaria pura y compartida para `22:00–06:00` en
`America/Bogota`, aplicarla a los puntos de entrada y de entrega del agente
incluido y del despacho externo, y proteger `POST /api/bot/messages` frente a
respuestas tardías. No hay migración ni dependencia nueva.

## Diseño

1. `src/lib/night-bot.ts` será la autoridad única del horario, con bordes
   inclusivo/exclusivo y `Intl.DateTimeFormat` sobre `America/Bogota`.
2. `maybeRunAgentTurn` filtrará mensajes diurnos antes de consultar proveedor o
   crear despachos.
3. `runAgentTurn` revalidará al comenzar y después de recibir al LLM; las
   conversaciones `is_test` quedan exentas para preservar el Laboratorio.
4. El worker del despacho revalidará antes del POST y marcará la fila
   `descartado` si la noche terminó.
5. `POST /api/bot/messages` devolverá `409 outside_bot_shift` antes de llamar a
   `sendText`.
6. Pruebas unitarias cubrirán los cuatro bordes, una fecha UTC que cae en el día
   anterior de Bogotá y guardarraíles de integración en todos los caminos.

## Verificación

- Unitarias de la política y de cobertura de integraciones.
- Prueba de la API con transporte mock, si el arnés local disponible permite
  autenticar sin credenciales externas.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` y `pnpm build` usando el ejecutable
  local disponible.
- Ningún contenedor, volumen, dato o conexión real de Meta se modifica.

## Constitution Check posterior al diseño

El diseño mantiene una sola autoridad horaria, no persiste estado derivado, no
añade dependencias, no modifica datos y conserva el sandbox del Laboratorio.
El nuevo 409 es aditivo y queda documentado y probado. Sin violaciones.
