# E2E — Atención híbrida nocturna

Arnés: `scripts/e2e-atencion-hibrida.ts`.

Se ejecuta contra PostgreSQL 16 aislado y una aplicación local con
`wa-mock`/`ai-mock`. Debe comprobar:

- migración limpia hasta 0021 y actualización 0020 → 0021 con historial;
- fronteras 21:59, 22:00, 03:00, 05:59 y 06:00 en America/Bogota;
- solicitud humana pendiente, continuidad informativa nocturna e intervención;
- supervisora 24/7 y operadoras sujetas a turno;
- asignación manual, permisos, aislamiento organizacional y SSE;
- carrera humano/IA sin duplicados;
- pagos, transferencias, comprobantes y tasas con guarda de servidor;
- tasa autorizada solo cuando el KB fue actualizado el mismo día local;
- interruptor y etiquetas en navegador local.

El arnés no contiene credenciales reales y no debe apuntarse a una base
persistente. Sus recursos se eliminan completos al terminar la validación.
