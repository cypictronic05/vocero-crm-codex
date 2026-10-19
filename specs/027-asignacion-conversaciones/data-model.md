# Modelo de datos

## conversation

- `assigned_member_id`: miembro responsable; nulo significa cola sin asignar.
- `assigned_at`: momento del último cambio de responsable.
- `assignment_version`: contador monotónico para invalidar estados de interfaz obsoletos.

## conversation_assignment_event

Registro aditivo e inmutable con organización, conversación, responsable anterior y nuevo, motivo, usuario actor y fecha de creación. Los identificadores de responsables se conservan como texto histórico.

Los índices permiten reconstruir el historial por conversación y auditar cambios por organización.
