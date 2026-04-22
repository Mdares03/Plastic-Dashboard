Downtime

Material / Falta de material
Material / Material incorrecto
Material / Material contaminado
Material / Atasco de material
Material / Cambio de material
Material / Otro

Proceso / Temperatura fuera de rango
Proceso / Parámetros incorrectos
Proceso / Ajuste de proceso
Proceso / Arranque o estabilización
Proceso / Proceso inestable
Proceso / Otro

Calidad / Inspección de calidad
Calidad / Defecto detectado
Calidad / Espera de liberación
Calidad / Rechazo de producción
Calidad / Validación de primera pieza
Calidad / Otro

Seguridad / Paro de seguridad
Seguridad / Guarda o puerta abierta
Seguridad / Sensor de seguridad activado
Seguridad / Bloqueo y etiquetado
Seguridad / Reset de seguridad
Seguridad / Otro

Molde / Cambio de molde
Molde / Ajuste de molde
Molde / Limpieza de molde
Molde / Falla de molde
Molde / Problema de expulsión
Molde / Otro

Máquina / Alarma de máquina
Máquina / Falla eléctrica
Máquina / Falla mecánica
Máquina / Falla neumática o hidráulica
Máquina / Reinicio de máquina
Máquina / Otro

Automatización / Falla de robot
Automatización / Falla de sensor
Automatización / Pérdida de comunicación
Automatización / Atasco de pieza
Automatización / Reset de celda
Automatización / Otro

Operación / Falta de operador
Operación / Error de operación
Operación / Cambio de turno
Operación / Espera de apoyo
Operación / Limpieza o ajuste
Operación / Otro

Servicios / Falta de energía
Servicios / Baja presión de aire
Servicios / Falta de agua o enfriamiento
Servicios / Falla de red o comunicación
Servicios / Utilidad fuera de rango
Servicios / Otro

Scrap

Material / Material incorrecto
Material / Material contaminado
Material / Humedad de material
Material / Mezcla incorrecta
Material / Color incorrecto
Material / Otro

Proceso / Parámetros incorrectos
Proceso / Temperatura incorrecta
Proceso / Presión incorrecta
Proceso / Tiempo incorrecto
Proceso / Proceso inestable
Proceso / Otro

Calidad / Defecto visual
Calidad / Defecto dimensional
Calidad / No cumple especificación
Calidad / Defecto detectado en inspección
Calidad / Pieza no liberada
Calidad / Otro

Molde / Rebaba
Molde / Falta de llenado
Molde / Problema de expulsión
Molde / Desalineación
Molde / Daño de molde
Molde / Otro

Manipulación / Pieza golpeada
Manipulación / Pieza rayada
Manipulación / Pieza deformada
Manipulación / Daño por robot
Manipulación / Daño por operador
Manipulación / Otro


Already implemented in node-red side:

### Summary
Implementaremos captura obligatoria de razón en pantalla táctil para microstop, macrostop y scrap (no para slow-cycle en v1), usando un selector breadcrumb en español de **2 niveles**.  
La taxonomía vendrá de **Control Tower settings** con **fallback a caché local**.  
La razón seleccionada viajará a Control Tower **enriqueciendo el payload actual de event** (/api/ingest/event).  
Para macrostops con refrescos periódicos, pediremos razón **una sola vez por incidente**.

### Key Changes
- **Catálogo de razones (backend settings + cache local)**
  - Extender el flujo de Apply settings + update UI para aceptar y persistir (memory + file context) un catálogo versionado:
    - reasonCatalog.downtime (árbol 2 niveles)
    - reasonCatalog.scrap (árbol 2 niveles)
  - Enviar al UI un nuevo topic (reasonCatalogData) para hidratar selector.
  - Si CT no responde catálogo, usar última versión en caché local; no bloquear operación.

- **UI táctil (breadcrumb)**
  - Reusar UI global de anomalías + Home para abrir modal de razón con botones touch-first (mínimo 64px de alto, grid compacto).
  - Breadcrumb de 2 pasos:
    - Paso 1: categoría
    - Paso 2: subrazón
  - **Micro/Macro**: al presionar ACK, primero abrir selector de razón; al confirmar, enviar submit + ACK.
  - **Scrap**: después de capturar cantidad (numpad), abrir selector de razón scrap antes de confirmar envío final.
  - Evitar prompts repetidos en macro refresh usando incidentKey en frontend/backend (once per incident).

- **Mensajería Node-RED (interfaces nuevas)**
  - Nuevos mensajes desde UI:
    - topic: "anomaly-reason-submit" con { event_id, incidentKey, reasonPath, reasonText, reasonType: "downtime" }
    - action: "scrap-entry-with-reason" con { id, scrap, reasonPath, reasonText, reasonType: "scrap" }
  - Mantener compatibilidad con rutas actuales (acknowledge-anomaly, scrap-entry) durante transición v1.
  - Enriquecer eventos enviados por outbox con campos de razón:
    - event.reason = { type, categoryId, categoryLabel, detailId, detailLabel, catalogVersion, incidentKey }

- **Persistencia local y trazabilidad**
  - Guardar razón en anomaly_events sin migración (v1) dentro de data_json y/o notes al momento de submit.
  - Para scrap, persistir razón junto con evento outbox y opcionalmente en work_orders flujo de actualización si ya existe payload contextual.
  - No usar stop_events en v1 (tabla existe pero hoy no está integrada al pipeline activo).

### API / Interface Additions
- **Settings contract (Control Tower -> Edge)**: agregar bloque reasonCatalog con árboles downtime y scrap, y version.
- **Edge event payload (Edge -> Control Tower)**: agregar objeto reason dentro de event cuando aplique.
- **Node-RED UI topics/actions nuevos**:
  - reasonCatalogData
  - anomaly-reason-submit
  - scrap-entry-with-reason

### Test Plan
- **Catalog + fallback**
  - Con catálogo remoto disponible: UI muestra opciones correctas en español.
  - Sin catálogo remoto: UI usa caché local previa y sigue operando.
- **Downtime reason flow**
  - Microstop: ACK obliga razón, envía 1 evento con razón, actualiza estado local.
  - Macrostop refrescado: solo primer ACK del incidente solicita razón; refrescos posteriores no repiten prompt.
- **Scrap reason flow**
  - Scrap manual: cantidad + razón obligatoria, persistencia local correcta y outbox event enriquecido.
- **Outbox / CT integration**
  - outbox_messages para msg_type=event incluye event.reason con shape esperado.
  - Retries no pierden razón (payload intacto tras reintentos).
- **UX touch**
  - Botones utilizables en raspi touch (tap error bajo, sin overflow en 1280x800).
  - Breadcrumb claro y navegable (atrás/adelante) sin bloquear otras pantallas fuera del modal.

### Assumptions
- Control Tower aceptará el enriquecimiento de event.reason en el endpoint actual /api/ingest/event.
- El catálogo remoto será entregado desde settings de máquina/org y versionado.
- En v1 no se requiere migración SQL; razón local se serializa en campos existentes.
- slow-cycle permanece informativo sin razón obligatoria (según decisión actual)



Click-Through Runbook (what to test on screen)
Trigger a macrostop or microstop alert.
Tap Acknowledge on anomaly panel/popup.
Confirm downtime reason modal appears (Paso 1 category).
Pick category -> confirm step 2 (subreason) appears.
Pick subreason.
Confirm:
alert is removed
no re-prompt on same macro incident refresh (incidentKey once-per-incident)
event is queued as type=event to /api/ingest/event
event payload includes both event.reason and event.downtime.
Open scrap modal from Home.
Enter scrap qty and submit.
Confirm scrap reason modal appears (Paso 1 -> Paso 2).
Pick subreason and submit.
Confirm:
work_orders.scrap_parts updates
event is queued as type=event
payload includes event.reason and event.downtime: null.
Exact JSON sent to CT (POST /api/ingest/event)
This is the HTTP body from outbox publisher (payload_json envelope).

A) Downtime reason acknowledgment event
{
  "schemaVersion": "1.0",
  "machineId": "M-EDGE-01",
  "tsMs": 1710001234567,
  "seq": "901",
  "type": "event",
  "payload": {
    "event": {
      "tsMs": 1710001234567,
      "eventType": "downtime-acknowledged",
      "anomalyType": "macrostop",
      "eventId": 1710001112222,
      "incidentKey": "macrostop:WO-100:1710000000000",
      "reason": {
        "type": "downtime",
        "categoryId": "mecanico",
        "categoryLabel": "Mecanico",
        "detailId": "hidraulico",
        "detailLabel": "Hidraulico",
        "reasonText": "Mecanico > Hidraulico",
        "catalogVersion": 3,
        "incidentKey": "macrostop:WO-100:1710000000000"
      },
      "downtime": {
        "incidentKey": "macrostop:WO-100:1710000000000",
        "eventId": 1710001112222,
        "anomalyType": "macrostop",
        "acknowledgedAtMs": 1710001234567,
        "reason": {
          "type": "downtime",
          "categoryId": "mecanico",
          "categoryLabel": "Mecanico",
          "detailId": "hidraulico",
          "detailLabel": "Hidraulico",
          "reasonText": "Mecanico > Hidraulico",
          "catalogVersion": 3,
          "incidentKey": "macrostop:WO-100:1710000000000"
        }
      }
    }
  }
}
B) Scrap manual entry with reason
{
  "schemaVersion": "1.0",
  "machineId": "M-EDGE-01",
  "tsMs": 1776472069609,
  "seq": "902",
  "type": "event",
  "payload": {
    "event": {
      "tsMs": 1776472069609,
      "eventType": "scrap-manual-entry",
      "workOrderId": "WO-100",
      "scrapDelta": 4,
      "source": "home-ui",
      "reason": {
        "type": "scrap",
        "categoryId": "calidad",
        "categoryLabel": "Calidad",
        "detailId": "rebaba",
        "detailLabel": "Rebaba",
        "reasonText": "Calidad > Rebaba",
        "catalogVersion": 3
      }
    }
  }
}