# US — Modalidad manual de asignación

## Preparación

- Base local aislada y migrada; nunca producción.
- Una organización con owner, supervisor y dos members.
- WhatsApp mock habilitado.

## Camino feliz

1. Entrar como owner, abrir Ajustes → Equipo y seleccionar Manual.
2. Inyectar un entrante mediante el mock.
3. Verificar que owner y supervisor lo ven bajo **Sin asignar** y los members no.
4. Asignar el hilo a member A y verificar que aparece en su Bandeja sin recargar.
5. Responder como member A y comprobar que sale por el único canal configurado.
6. Reasignar a member B y comprobar que A pierde acceso y B lo recibe por SSE.
7. Devolverlo a cola y comprobar que ningún member puede leerlo ni responderlo.

## Caminos infelices

- PUT de modalidad sin sesión responde 401.
- PUT como supervisor o member responde 403.
- Un body con otro organizationId no cruza el tenant de la sesión.
- Suspender una operadora o finalizar su turno devuelve sus hilos a cola.
- Dos asignaciones concurrentes dejan una sola versión final y auditoría ordenada.
- La IA puede contestar sin asignar el hilo a una persona.

## Regresión automática

Cambiar a Automática y comprobar que una conversación en cola se entrega a la
operadora disponible de menor carga, conservando relevos y asignaciones explícitas.
