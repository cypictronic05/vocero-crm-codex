# Fase 5A.6 — precarga comercial de tasas

## Fuentes revisadas

- `remesascypictroniclat-export.json`, fechado el 22-10-2026.
- Captura «Tasas del día» de Ascender Comunicaciones, 22 de octubre.

El JSON declara factores `fXXX_YYY` multiplicativos. Se reconocieron 31 claves
entre BRL, CLP, COP, MXN, PEN y USD (incluida `fUSD_USD`) y seis campos
`tasaXXX` aplicables hacia Venezuela. Al mantener Ecuador y Estados Unidos como
países distintos, esos valores producen 49 borradores para 56 corredores.

La captura no usa una única convención visible de multiplicación o división y
varios valores difieren del JSON. Por ejemplo, muestra referencias como USD→VES
885,9/895,5, mientras el JSON contiene `tasaUSD=910`. Por seguridad la captura
se conserva como contraste humano: no genera cotizaciones ni reemplaza datos.

## Comportamiento de la precarga

- Habilita visualmente los ocho países del catálogo.
- Crea las 56 direcciones posibles, excluyendo origen igual a destino.
- Conserva cualquier ruta o cotización existente mediante inserciones
  idempotentes; no actualiza ni elimina historia.
- Configura nuevas rutas inicialmente con multiplicación y dos decimales.
- Mantiene CO→VE como división comercial confirmada. El factor crudo
  `tasaCOP=0.2702702` queda en auditoría y el borrador usa su inverso decimal,
  sin pasar por IEEE-754.
- Inserta únicamente valores reconocibles como `draft`; nunca como `published`.
- Registra fuente, clave y valor originales en la auditoría append-only.
- La operación y precisión pueden cambiarse por el propietario mientras no
  exista una tasa publicada. La primera publicación bloquea la fórmula.
- Supervisora autorizada puede editar tasa y vigencia; operadoras solo consultan
  y calculan; la IA solo resuelve cotizaciones publicadas y vigentes.

La precarga se ejecuta al activar el módulo, al abrirlo como propietario o desde
«Completar precarga 5A.6». Las tres entradas llaman la misma operación
idempotente.
