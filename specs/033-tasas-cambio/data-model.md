# Modelo de datos — tasas de cambio

- `organization.exchange_rates_enabled`: booleano, default false.
- `member.can_manage_exchange_rates`: booleano, default false.
- `exchange_rate_route`: dirección país/moneda origen → país/moneda destino y
  unidad base decimal positiva; organización e identidad direccional únicas.
- `exchange_rate_quote`: versión, tasa `numeric(30,12)`, precisión, vigencia,
  estado, creador/publicador y fechas. Publicada es inmutable salvo desactivar.
- `exchange_rate_audit_event`: bitácora append-only con actor, acción y snapshots.
- `exchange_rate_request`: pregunta pendiente ligada a conversación y razón.

Todas las tablas de dominio tienen `organization_id NOT NULL`, FK en cascada e
índice org-first.
