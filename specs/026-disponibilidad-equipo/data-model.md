# Data model — Disponibilidad del equipo

## `member` (extensión)

| Campo | Tipo | Regla |
|---|---|---|
| `status` | text | `enabled` o `suspended`; default `enabled`, NOT NULL |
| `weekly_schedule` | jsonb | arreglo validado de intervalos; default 06:00–22:00 los siete días, NOT NULL |

Un intervalo es `{ day: 0..6, startMinute: 0..1439, endMinute: 0..1439 }`,
donde `0` es domingo y `endMinute` es exclusivo. `startMinute > endMinute`
cruza medianoche. `startMinute === endMinute` se rechaza para evitar una
ambigüedad entre turno vacío y 24 horas.

## `team_audit_event`

| Campo | Tipo | Regla |
|---|---|---|
| `id` | text | PK con prefijo interno |
| `organization_id` | text | NOT NULL, FK organization, índice org-first |
| `actor_user_id` | text | NOT NULL, usuario que ejecutó el cambio |
| `target_member_id` | text | NOT NULL, miembro afectado |
| `action` | text | `member_created` o `member_settings_updated` |
| `before` | jsonb | instantánea anterior, nullable para alta |
| `after` | jsonb | instantánea posterior, NOT NULL |
| `created_at` | timestamp | NOT NULL, default now |

La tabla es append-only por diseño: no hay endpoint de actualización o borrado.
