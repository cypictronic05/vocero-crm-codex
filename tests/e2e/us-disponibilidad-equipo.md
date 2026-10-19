# E2E — Disponibilidad y turnos del equipo

## Preparación

- Stack reconstruido desde este fork con `docker compose up -d --build`.
- Una cuenta propietaria y una cuenta miembro.
- No conectar Meta: los rechazos de disponibilidad ocurren antes del transporte.

## Propietario

1. Entrar como propietario y abrir Ajustes → Equipo.
2. Confirmar que se muestran estado, disponibilidad y siete días en
   `America/Bogota` para cada cuenta.
3. En un miembro, guardar un turno que cruce medianoche (`22:00–06:00`).
4. Recargar y confirmar que el turno y la etiqueta «cruza medianoche» persisten.
5. Suspender el miembro y confirmar el estado «Suspendido».
6. Confirmar que la tarjeta propietaria no ofrece controles de suspensión y
   explica el acceso de recuperación.

## Miembro suspendido

1. Entrar como el miembro suspendido.
2. Abrir Bandeja y seleccionar una conversación demo.
3. Confirmar que no aparecen controles de texto, adjunto, ubicación, contacto o
   plantilla; aparece el aviso de cuenta suspendida.
4. Llamar directamente a los cuatro POST de envío y confirmar 403
   `member_suspended`, sin mensaje nuevo ni llamada a Meta.

## Fuera y dentro de turno

1. Habilitar el miembro con un intervalo que no incluya la hora actual de
   `America/Bogota`.
2. Confirmar aviso «fuera de tu turno» y 403 `outside_shift` en los cuatro POST.
3. Cambiar el intervalo para incluir la hora actual.
4. Confirmar que los controles vuelven a mostrarse. No enviar a Meta real.

## Auditoría

Comprobar en PostgreSQL que cada alta y cada guardado exitoso agregó una fila a
`team_audit_event` con la organización, actor, objetivo, acción, antes, después
y fecha. Los intentos 403 no agregan filas.

## Resultado de esta implementación (2026-10-18)

- Build Docker local, migración `0018`, salud y conservación de las ocho
  conversaciones demo: verificados.
- Pruebas automatizadas de horario, owner-only y cobertura de las cuatro rutas:
  verdes.
- Recorrido autenticado: pendiente de verificación humana porque el repositorio
  no contiene credenciales de las cuentas locales y no se alteraron contraseñas
  ni sesiones existentes.
