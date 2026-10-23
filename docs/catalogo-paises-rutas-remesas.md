# Catálogo y activación de rutas de remesas

## Catálogo inicial

| País | Código | Moneda |
|---|---:|---:|
| Venezuela | VE | VES |
| Colombia | CO | COP |
| Chile | CL | CLP |
| Perú | PE | PEN |
| Ecuador | EC | USD |
| Estados Unidos | US | USD |
| Brasil | BR | BRL |
| México | MX | MXN |

Ecuador y Estados Unidos son países diferentes aunque ambos operen en USD. Cada
organización habilita sus países; el catálogo común no activa ninguno por sí solo.

## Evidencia comercial de rutas

Confirmadas por instrucciones expresas del propietario:

| Origen | Destino | Operación |
|---|---|---|
| Colombia (COP) | Venezuela (VES) | DIVIDE |
| Venezuela (VES) | Colombia (COP) | MULTIPLY |
| Perú (PEN) | Venezuela (VES) | MULTIPLY |
| Chile (CLP) | Venezuela (VES) | MULTIPLY |

Las demás direcciones posibles entre países habilitados se muestran como
**Requiere confirmación**. No se deduce la ruta inversa, la operación, la
precisión ni una tasa a partir de una captura, una moneda compartida o una ruta
parecida.

## Procedimiento seguro para una futura activación

1. El owner habilita únicamente los países aprobados para la organización.
2. En la matriz selecciona las direcciones aprobadas; origen y destino iguales
   no están disponibles.
3. Ejecuta **Revisar activación**. El sistema informa cuántas rutas creará,
   reactivará o dejará sin cambios y todavía no escribe nada.
4. Contrasta el resumen con la autorización comercial y pulsa **Confirmar
   activación** una sola vez. Repetir esta operación es seguro: una ruta existente
   queda en «sin cambios» y no se duplica.
5. Cada ruta nueva queda pendiente, sin operación, precisión ni tasa. El owner
   configura una vez `MULTIPLY` o `DIVIDE` y la precisión final.
6. Owner o supervisora autorizada carga tasa y vigencia, revisa la vista previa y
   publica. Hasta entonces la calculadora y la IA informan que la ruta no tiene
   una tasa disponible.

La activación no modifica cotizaciones históricas, no publica tasas y no ejecuta
migraciones de producción. La migración 0024 únicamente agrega el estado del
catálogo por organización.
