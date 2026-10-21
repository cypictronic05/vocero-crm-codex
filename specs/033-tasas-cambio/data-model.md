# Modelo de datos — tasas de cambio

- `organization.exchange_rates_enabled`: booleano, default false.
- `member.can_manage_exchange_rates`: booleano, default false.
- `exchange_rate_route`: dirección país/moneda origen → país/moneda destino,
  `calculation_operation` (`multiply`/`divide`) y `rounding_precision`. Las dos
  columnas nuevas son nullable solo para migrar rutas 0022 sin reinterpretarlas;
  toda ruta nueva o confirmada guarda ambas una única vez por el owner.
- `exchange_rate_quote`: versión, tasa `numeric(30,12)`, copia nullable de
  `calculation_operation`, precisión, unidades derivadas, vigencia, estado,
  creador/publicador y fechas. Las cotizaciones 0022 permanecen null y no se
  modifican; una nueva siempre copia fórmula y precisión de su ruta.
- `exchange_rate_audit_event`: bitácora append-only con actor, acción y snapshots.
- `exchange_rate_request`: pregunta pendiente ligada a conversación y razón.

Todas las tablas de dominio tienen `organization_id NOT NULL`, FK en cascada e
índice org-first.
