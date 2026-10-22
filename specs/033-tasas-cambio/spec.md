# Feature Specification: Tasas de cambio

**Feature Branch**: `feature/nexora-turnos`
**Created**: 2026-10-21
**Status**: Fase 5A.2 — rediseño comercial y respuestas naturales en validación

## Problema

Las tasas comerciales viven hoy como texto libre del conocimiento del agente. Eso
no permite vigencia precisa, historial, autorización separada ni cálculos exactos.
El CRM necesita una fuente de verdad en PostgreSQL que pueda operar sin alterar
la atención híbrida de la Fase 4.

## Escenarios y criterios de aceptación

### US1 — Administrar y publicar cotizaciones (P1)

El propietario crea rutas direccionales y borradores, revisa una advertencia y
publica una versión con vigencia. Una publicación anterior no se reescribe.

1. Dada una ruta configurada, al publicar una cotización válida,
   la tarjeta muestra unidades, tasa, vigencia, responsable y estado vigente o
   programado.
2. Al cambiar una cotización publicada se crea un borrador nuevo; el historial
   conserva la versión anterior.
3. La ruta inversa es independiente y nunca se calcula implícitamente.
4. Valores cero, negativos, no decimales, monedas no ISO, países ambiguos,
   intervalos invertidos o precisión fuera de 0–12 se rechazan con 422.
5. El propietario configura una sola vez por ruta la operación `MULTIPLY` o
   `DIVIDE` y la precisión final. Una supervisora no puede crear ni cambiar rutas.
6. La gestión diaria pide únicamente ruta, tasa y vigencia; las unidades se
   derivan y nunca se capturan manualmente.
7. Antes de publicar, el borrador muestra una vista previa determinista con
   importe, operación, tasa, resultado y monedas explícitas.

### US2 — Autorizar a una supervisora (P1)

El propietario concede o retira una capacidad explícita. Solo una supervisora
habilitada administra y publica; una operadora siempre consulta únicamente.

1. Owner administra tasas y autorizaciones.
2. Supervisor sin capacidad recibe 403 aunque conozca la URL.
3. Supervisor con capacidad puede crear borradores, publicar y desactivar, pero
   no configurar la fórmula ni la precisión de una ruta.
4. Member recibe solo cotizaciones vigentes y nunca el historial administrativo.

### US3 — Consultar y calcular desde la IA (P1)

Antes de invocar al LLM, el servidor detecta una pregunta de tasa, resuelve una
ruta publicada y vigente de la organización y responde de forma determinista.

1. Una ruta única responde valor, unidades y momento de referencia.
2. Con importe, el servidor calcula y redondea con aritmética decimal exacta.
3. Si faltan origen o destino, o hay varias rutas posibles, pide aclaración.
4. Si no existe cotización vigente, informa que requiere confirmación humana y
   registra una solicitud pendiente sin inventar ni usar historia.
5. La consulta nunca confirma pagos, fondos, comprobantes ni operaciones.

### US4 — Módulo opcional y aislado (P1)

Con `TASAS` apagado la navegación y APIs devuelven la misma superficie previa
(404). Encendido, cada organización debe activar además su módulo; ninguna
consulta o evento cruza `organization_id`.

### US5 — Operación comercial clara (P1)

La pantalla prioriza consulta, cálculo y actualización diaria. Muestra tarjetas
legibles, búsqueda de rutas, una calculadora y la respuesta exacta que recibirá el
cliente. La configuración inmutable y la auditoría quedan en secciones avanzadas.

1. Tasas y resultados se presentan con separadores españoles, sin ceros técnicos.
2. Toda fórmula nombra explícitamente ambas monedas y la moneda del resultado.
3. Owner ve configuración avanzada; supervisora autorizada solo tasa/vigencia;
   member consulta y calcula.
4. La respuesta de WhatsApp usa nombres, banderas y formato básico, no IDs,
   timestamps ISO, JSON ni términos de implementación.
5. La misma función de servidor alimenta IA, vista previa y cálculo administrativo.

## Casos límite

- Dos versiones publicadas solapadas para la misma ruta se rechazan.
- `valid_until` nulo significa vigencia abierta; la desactivación prevalece.
- En el instante exacto de `valid_until` la cotización ya no está vigente.
- Las reglas comerciales fijas son: VE/VES→CO/COP multiplica,
  CO/COP→VE/VES divide, PE/PEN→VE/VES multiplica y CL/CLP→VE/VES multiplica.
  Esas combinaciones rechazan una moneda distinta; otra ruta acepta la operación
  elegida por el owner.
- Una ruta migrada desde 0022 queda sin fórmula hasta que el owner la configure.
  Sus borradores/cotizaciones existentes no reciben fórmula ni cambian de valor,
  y por ello no se publican ni se entregan a la IA.
- La caída del LLM no afecta una respuesta determinista de tasa.
- Una solicitud humana pendiente de tasa no modifica horarios, asignación ni la
  regla de intervención humana efectiva de Fase 4.

## Requisitos funcionales

- **FR-001**: Toda tabla nueva lleva `organization_id` NOT NULL e índice org-first.
- **FR-002**: Valores financieros usan `numeric` en PostgreSQL y strings/BigInt en
  TypeScript; queda prohibido `number` para tasa o cálculo.
- **FR-002A**: `MULTIPLY` calcula `importe × tasa`; `DIVIDE` calcula
  `importe ÷ tasa`. Se redondea una sola vez al final con half-up y la precisión
  inmutable copiada desde la ruta a la cotización.
- **FR-003**: Crear, publicar, desactivar y autorizar deja auditoría append-only.
- **FR-004**: Una versión publicada es inmutable; actualizar crea otra versión.
- **FR-004A**: La fórmula de ruta se configura una sola vez por el owner. La
  migración es aditiva y no rellena fórmula en rutas ni cotizaciones existentes.
- **FR-005**: Solo tasas `published`, no desactivadas y con `valid_from <= now <
  valid_until` (o fin nulo) son consultables.
- **FR-006**: Owner administra; supervisor requiere capacidad explícita; member
  solo lee vigentes.
- **FR-007**: La IA recibe como máximo la cotización resuelta, nunca la tabla ni
  versiones históricas; preferentemente la respuesta se produce sin LLM.
- **FR-008**: Las protecciones de transacciones y los horarios de Fase 4 no cambian.
- **FR-009**: Las APIs validan body y query con Zod y devuelven 404 con módulo
  apagado, 401 sin sesión, 403 sin capacidad y 422 en input inválido.
- **FR-010**: La UI es responsive, usa tokens de tema y separa edición/publicación.

## Entidades

- **Ruta de cambio**: dirección país/moneda origen → país/moneda destino,
  operación y precisión comercial configuradas una vez por el owner.
- **Versión de tasa**: cotización exacta, copia de operación y precisión,
  vigencia, estado y versión.
- **Capacidad de tasas**: autorización explícita de un miembro supervisor.
- **Evento de auditoría**: actor, acción, antes/después y fecha.
- **Solicitud pendiente**: pregunta que no pudo resolverse con una tasa vigente.

## Fuera de alcance

- Inferir tasas inversas, conversión entre rutas, FX de mercado o proveedor externo.
- Confirmar transferencias, pagos, fondos o comprobantes.
- SaaS, facturación, migraciones sobre EasyPanel o despliegue.

## Puerta constitucional

- Seguridad/multiempresa: pasa mediante `scoped()` y tablas org-first.
- Soberanía: pasa; solo PostgreSQL, sin dependencia externa.
- Specs antes de código: ciclo completo por migración y extensión del agente.
- Calidad/en vivo: exige unitarias, migración aislada y E2E local con mocks.
- Foco: pasa; la función responde conversaciones y apoya operaciones del negocio.

## Resultados medibles

- 100% de lecturas/escrituras bloquean cruces de organización en pruebas.
- 100% de cálculos de fixtures financieros coinciden con resultados decimales.
- Módulo apagado no cambia navegación ni APIs observables.
- TypeScript, ESLint, Vitest y build terminan en verde.

## Supuestos y decisiones pendientes

- Se usan códigos asignados de ISO 3166-1 alpha-2 e ISO 4217. La validación no
  acepta códigos reservados o ficticios aunque tengan dos o tres letras. Las
  combinaciones comerciales permitidas son únicamente las rutas direccionales
  que el owner configura y publica; el sistema nunca deriva una ruta inversa.
- Redondeo comercial inicial: mitad alejándose de cero, aplicado una sola vez
  al importe final con la precisión declarada en la cotización. En importes
  positivos equivale a redondeo half-up: un empate de media unidad sube. Esto
  puede diferir del redondeo bancario half-even y acumular centavos a favor del
  destinatario en lotes con muchos empates; Nexora debe ratificar la política
  contable y la precisión por ruta antes de producción.
- La referencia pública verificada el 2026-10-21 confirma CO→VE como división
  (`100000 / 3.68 = 27173.91`) y VE→CO como multiplicación
  (`100000 VES × 2.90 = 290000 COP`). En esa versión PE→VE y CL→VE aparecen por
  confirmar; la regla MULTIPLY para ambas proviene de la instrucción expresa
  del propietario para 5A.1.
- Retención de auditoría y solicitudes pendientes: indefinida en esta fase.
