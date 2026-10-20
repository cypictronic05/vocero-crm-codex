# Modelo de datos

## `organization.assignment_mode`

- Tipo físico: `text NOT NULL DEFAULT ''automatic''`.
- Tipo de aplicación: unión `"manual" | "automatic"` validada con Zod.
- Alcance: una política por organización; todas las lecturas y escrituras usan el
  identificador de la sesión.
- Compatibilidad: el default conserva el reparto actual en organizaciones existentes.

No se alteran filas de `conversation`, `message` ni
`conversation_assignment_event` durante la migración.

