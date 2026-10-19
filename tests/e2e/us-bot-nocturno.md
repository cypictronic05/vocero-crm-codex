# E2E — Bot nocturno de Nexora

## Preparación

- Aplicación local con mocks (`WA_MOCK_ENABLED=true`), nunca Meta real.
- Organización con agente configurado y una trabajadora habilitada con el
  turno por defecto `06:00–22:00` en `America/Bogota`.
- Reloj del arnés fijable en los bordes de la ventana.

## Camino feliz

1. A las 21:59:59 de Bogotá ingresar un mensaje: se persiste, se asigna a la
   trabajadora y no aparece salida de IA.
2. A las 22:00:00 ingresar otro mensaje: la conversación queda en cola y el
   agente incluido produce una sola respuesta por el transporte mock.
3. Repetir con despacho externo: se crea y entrega un único evento firmado.
4. A las 06:00:00 ingresar otro mensaje: no se crea turno de IA y el barrido
   asigna el caso a una trabajadora disponible.

## Camino infeliz

1. Encolar un despacho a las 05:59:59 y procesarlo a las 06:00:00: queda
   descartado, no caducado a humano, y no se llama al cerebro.
2. Autenticar `POST /api/bot/messages` a las 06:00:00: responde 409 con
   `outside_bot_shift` y el mock no registra envío.
3. Ejecutar una conversación del Laboratorio durante el día: el turno termina
   normalmente y solo persiste su salida sandbox.

## Resultado esperado

Los mensajes entrantes siempre permanecen en PostgreSQL. El bot solo produce
efectos entre 22:00 y 06:00 de Bogotá; durante el día atiende el equipo humano.
