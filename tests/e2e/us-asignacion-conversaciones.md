# US — Asignación de conversaciones

## Automatizado

El arnés `scripts/e2e-assignments.ts` se ejecuta contra PostgreSQL real y limpia su organización temporal al terminar. Comprueba:

1. selección por menor carga;
2. dos intentos concurrentes producen una sola asignación/historial;
3. una trabajadora no consulta conversaciones ni adjuntos ajenos;
4. la suspensión releva conversaciones pendientes;
5. no se puede asignar manualmente a una trabajadora no disponible;
6. una devolución manual permanece en cola;
7. un caso que quedó pendiente por falta de personal sale de cola al volver la disponibilidad.

En la red de Docker se compila y ejecuta así:

```powershell
.\node_modules\.bin\esbuild.cmd scripts\e2e-assignments.ts --bundle --platform=node --format=esm --outfile=.tmp-e2e-assignments.mjs --alias:@=./src
docker cp .tmp-e2e-assignments.mjs vocero-crm-codex-app-1:/tmp/e2e-assignments.mjs
docker compose exec -T app node /tmp/e2e-assignments.mjs
```

## Comprobación manual de interfaz

1. Entrar como propietario y abrir Bandeja.
2. Seleccionar una conversación y cambiar `Responsable` en Detalles.
3. Entrar como la trabajadora asignada: solo debe ver esa conversación.
4. Probar una URL conocida de otra conversación: lista, hilo, PATCH, envío y adjunto deben responder como no encontrados.
5. Suspender a la trabajadora desde Ajustes → Equipo y confirmar que la conversación pasa a otra disponible o a `Sin asignar`.
