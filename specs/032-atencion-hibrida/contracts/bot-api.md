# Adición compatible a `/api/bot/*`

- `POST /api/bot/messages` conserva `409 ai_paused` y
  `409 outside_bot_shift`; ahora evalúa el horario de la organización y permite
  continuar un handoff pendiente cuyo motivo sea `cliente` hasta que exista
  intervención humana.
- `GET /api/bot/context` mantiene todas sus llaves y añade
  `conversation.humanAttention`, con `none`, `pending` o `active`.
- Ninguna llave existente se elimina o renombra.
