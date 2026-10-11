# CODE-API-TURBINEH · Plan de trabajo v1

> Versión: 10-oct-2026 · Director: Claude (chat) · Ejecutor: Claude Code local · Owner: Alex Ruiz (CEO TurbineH)
> Fuente de verdad del producto: "DESCRIPCIÓN PRODUCTO FRONTIERS 10-26". Este plan la operativiza para la beta del hackathon.

---

## 0. Objetivo de la beta (D3 · martes 13-oct)

Un usuario escribe un prompt en la UI o llama a `POST https://software.turbineh.com/v1/builds`. En minutos recibe:

1. **Un repositorio privado** en la organización GitHub de TurbineH para entregas a clientes, con una app web completamente funcional, estructurada en carpetas jerarquizadas y documentada, que compila, pasa sus tests y pasa la puerta de seguridad.
2. **Feedback textual** generado por el modelo que trabaja con JEV: qué se ha construido, qué componentes se eligieron y por qué, qué código se generó en las uniones, informe de seguridad con alcance y fecha, y métricas del build.
3. **Traza en vivo** en la UI de cada fase: intención → selección → resolución → ensamblaje → verificación → entrega.

**Métrica norte:** % de builds que pasan la puerta de verificación (build + tests + seguridad + smoke E2E) y tokens consumidos por build frente a un generador convencional con el mismo prompt.

**Dentro de la beta:** solo software nuevo, solo apps y webs full-funcionales, ciberseguridad siempre.

**Fuera de la beta (roadmap §13):** conectar repos existentes, sistemas IA en el resultado, contribuciones de terceros, rastreo masivo de toda la web con extracción de módulos.

---

## 1. Principios de arquitectura (no negociables)

1. **Seleccionar antes que generar.** Solo se genera código en las uniones (glue), configuración, migraciones y lógica de negocio sin componente disponible. Todo lo demás sale del catálogo.
2. **JEV decide, el software verifica.** JEV clasifica, puntúa y elige entre candidatos. Compatibilidad de versiones, licencia, permisos y "el test pasó" se deciden con código determinista. Un modelo nunca certifica a otro.
3. **Seguridad siempre.** El Security Pack entra en el 100 % de los builds. No existe flag para desactivarlo.
4. **Solo componentes `approved` llegan a un build.** El catálogo `discovered` sirve para búsqueda y evaluación, nunca para ensamblar.
5. **Una sola pila tecnológica en la beta.** Compatibilidad controlada > variedad.
6. **Nunca ejecutar código de terceros donde viven nuestros secretos.** Instalar, compilar y testear ocurre en sandbox efímero con credenciales sintéticas.
7. **Todo trazable.** Cada decisión registra entrada, candidatos, salida de JEV con probabilidades, regla determinista aplicada y evidencia.
8. **Abierto/cerrado intercambiable.** Cada punto de decisión de modelo es una interfaz con dos implementaciones (JEV ↔ alternativa open; modelo compilador open ↔ cerrado), seleccionables por configuración según el comparativo de la carpeta del proyecto.
9. **Números reales o nada.** Ninguna métrica pública que no salga del benchmark propio (§12).
10. **Respaldo permanente.** El sistema cuenta siempre con el mejor modelo de generación de código documentado en la carpeta del proyecto (Backup Coder, §2.4) para cubrir cualquier hueco donde los componentes del repositorio no basten. Selección primero; el respaldo solo cubre el hueco y pasa la misma verificación.

---

## 2. Arquitectura

```
                    ┌──────────────────────────── software.turbineh.com ────────────────────────────┐
 Prompt ─► Gateway ─► Abuse Guard ─► Intent Compiler ─► Selector ─► Resolver ─► Assembler ─► Verifier ─► Delivery
 (UI/API)  (auth,     (JEV: política   (modelo open     (retrieval  (determinista: (receta +   (sandbox:   (repo privado
           quotas,     de uso)          pequeño →        + JEV)      versiones,     componentes  build, test, GitHub +
           cola)                        BuildSpec)                   licencias,     + glue       seguridad,   feedback)
                                                                     peer deps)     generado)    E2E)
                                                                                        ▲            │
                                                                                        └─ corrección dirigida / swap de componente (máx. N)
```

| Módulo | Responsabilidad | Decide |
|---|---|---|
| Gateway | Auth por API key, rate limit, idempotencia, encolado, SSE de eventos | Código |
| Abuse Guard | Rechazar prompts de malware, phishing, clones de marcas, scraping abusivo | JEV (Noul/Choice) + umbrales en código |
| Intent Compiler | Prompt → `BuildSpec` (receta, entidades, páginas, capacidades, criterios de aceptación) | Modelo open pequeño |
| Selector | Por capacidad: retrieval a ≤ 20 candidatos → JEV elige y puntúa | JEV |
| Resolver | Conjunto compatible: versiones, peer deps, licencias, política de seguridad | Código |
| Assembler | Receta base + instalación de componentes + glue mínimo generado | Código + modelo open |
| Verifier | install → typecheck → lint → build → unit → escaneos → E2E smoke | Código (sandbox) |
| Corrector | Ante fallo: parche dirigido al fallo concreto; tras N, swap de componente vía Selector | Modelo open + JEV |
| Backup Coder | Cubre huecos: capacidad sin componente, glue complejo, corrección agotada | Mejor modelo de código documentado (§2.4) |
| Delivery | Crear repo privado, push, invitar colaborador, generar feedback | Código + modelo open |

### 2.1 JEV: uso correcto

Hechos públicos relevantes (verificar contra la documentación oficial antes de codificar):

- No genera texto ni código. Recibe un estado + preguntas tipadas (Choice, Score, Noul) y responde todas en paralelo en una llamada, con probabilidad calibrada.
- Latencia publicada 70–500 ms.
- Choice admite como máximo 255 opciones. **Por eso la selección es en dos etapas:** filtro determinista + búsqueda vectorial → top-20 → JEV.
- Acceso en early access con lista de espera: **validar acceso real en el Gate G0** (§11).

Patrón por capacidad (pseudo-código; adaptar al SDK real, no inventar la API):

```ts
const state = { buildSpec, capability: "auth.session", candidates: top20.map(toCard) };
const questions = {
  best_fit:        choice(top20.map(c => c.id)),          // ¿cuál encaja mejor?
  integration_cost: score(1, 5),                           // coste de integración del elegido
  meets_acceptance: noul("cumple los criterios de aceptación de esta capacidad"),
  security_concern: noul("introduce un riesgo de seguridad no mitigado por el Security Pack"),
};
const d = await decider.ask(state, questions);           // decider = JevDecider | OpenDecider
// La política vive en código:
if (d.meets_acceptance.p < 0.6 || d.security_concern.p > 0.3) escalate(); else select(d.best_fit);
```

`decider` es una interfaz con `JevDecider` y `OpenDecider` (alternativa open según comparativo). El router entre ambas se configura por política, no por prompt.

### 2.2 Modelo compilador (open, lo más pequeño posible)

- Funciones: (a) prompt → `BuildSpec` JSON validado con Zod; (b) formular las preguntas tipadas para JEV; (c) generar glue code acotado; (d) redactar el feedback final.
- Elección: según el comparativo de la carpeta del proyecto. Si no lo especifica, empezar por un modelo open de código en el rango 7–14B servido por proveedor de inferencia, medir y bajar de tamaño mientras se mantenga la tasa de builds verdes.
- Respaldo: cuando el modelo pequeño no basta, escala al Backup Coder (§2.4). No es un flag opcional: está siempre disponible.
- Salidas siempre estructuradas y validadas. Si el JSON no valida → reintento con el error, máx. 2; después, Backup Coder.

### 2.4 Backup Coder · respaldo permanente

**Qué es:** el mejor modelo de generación de código de los documentados en la carpeta del proyecto, siempre conectado al pipeline para apoyar cualquier fase cuando los componentes del repositorio no son suficientes.

**Elección del modelo:**
- Claude Code lee la documentación de modelos de la carpeta, preselecciona el mejor modelo de código y uno de reserva, y lo registra en `docs/adr/0003-backup-coder.md`.
- La elección se valida con el benchmark (§12) en D1: gana el que más builds verdes logre por coste.
- Configuración: `BACKUP_CODER_PRIMARY` y `BACKUP_CODER_SECONDARY`. Si el primario falla o está limitado, entra el secundario sin intervención.

**Disparadores (la política vive en código):**

| # | Situación | Detectado por |
|---|---|---|
| T1 | Capacidad del `BuildSpec` sin ningún componente `approved` | Selector (determinista) |
| T2 | JEV indica que los candidatos no cubren la capacidad: `meets_acceptance.p < umbral` en todos | Selector + JEV |
| T3 | Glue de complejidad alta (varios componentes, migraciones, lógica de negocio) | JEV (`Score` de complejidad) + umbral |
| T4 | Bucle de corrección agotado (3 intentos) y swap de componente sin éxito | Corrector |
| T5 | El modelo compilador no produce `BuildSpec` válido tras 2 reintentos | Compiler |
| T6 | Cualquier fase pide ayuda explícita tras fallo no clasificado | Orquestación del worker |

**Reglas de uso:**
1. Solo genera el hueco concreto, con el contexto mínimo necesario: contratos de los componentes vecinos, `BuildSpec` y error. Nunca reescribe la app entera.
2. Su código pasa exactamente la misma verificación y el mismo Security Pack que el resto.
3. Todo archivo o bloque suyo lleva la cabecera `// turbineh:generated-backup`.
4. Cada activación queda en la traza: disparador, modelo, tokens, coste y resultado.
5. **Flywheel del catálogo:** cada hueco cubierto genera una entrada en `catalog/gaps/` con la capacidad que faltaba y el código producido. Los huecos recurrentes se convierten en candidatos a componente; así el respaldo se usa cada vez menos.

**Métricas específicas:** % de builds con respaldo, tokens del respaldo sobre el total del build y huecos más frecuentes. Se reportan en `TURBINEH_REPORT.md` y en el benchmark (coherente con el Frontier Dependency Ratio del Lab).

### 2.3 Componente 001 · `@turbineh/orchestrator`

Es la misma pieza que usa internamente el pipeline (modelo pequeño que descompone y estructura → decider → modelo orquestado), empaquetada como componente del catálogo.

- En la beta: se construye, se usa internamente y se publica en el catálogo como **component #001** con manifiesto completo.
- **No se ensambla en builds de clientes** hasta la Fase 3 (sistemas IA), respetando el orden decidido.

---

## 3. Catálogo de componentes

### 3.1 Definición de "atómico"

Una unidad versionada con **una responsabilidad verificable**, que declara lo que necesita y puede probarse mediante un contrato. No es "pocas líneas": es "una capacidad comprobable".

Dos niveles:
- **Componente:** unidad reutilizable (ej. verificador de sesión, tabla con paginación y filtros, verificador de firma de webhook).
- **Receta:** combinación verificada de componentes + esqueleto de app (ej. "SaaS CRUD con auth y roles").

### 3.2 Estados

| Estado | Qué sabemos | Uso |
|---|---|---|
| `discovered` | Existe, metadatos preliminares | Búsqueda y evaluación |
| `evaluated` | Versión revisada y escaneada | Selección condicionada, no ensamblaje en beta |
| `approved` | Cumple contrato y pasó tests en la pila de la beta | Ensamblaje automático |

La aprobación pertenece a **versión + entorno**, no al nombre del proyecto.

### 3.3 Manifiesto `component.yaml` (v0.1)

```yaml
schema: turbineh.component/v0.1
id: auth.session.better-auth          # categoría.capacidad.implementación
version: 1.0.0                        # versión del manifiesto
status: approved                      # discovered | evaluated | approved | deprecated
category: auth                        # ver taxonomía §3.4
source:
  purl: pkg:npm/<name>@<version>
  repo: https://github.com/<org>/<repo>
  commit: <sha>
  integrity: <sha512>
capability:
  does: "Gestiona sesiones con cookie segura y rotación"
  does_not: "No implementa SSO empresarial"
  use_cases: [saas-crud, internal-tool]
  pros: [...]
  cons: [...]
  alternatives: [auth.session.<otra>]
contract:
  inputs: [...]
  outputs: [...]
  errors: [...]
  limits: [...]
compat:
  runtime: node@<rango>
  framework: next@<rango>
  peer: { react: "<rango>" }
effects: { network: false, fs: false, db: true, external_services: [] }
integration:
  strategy: dependency                # dependency | vendored-with-provenance | adapter | fork
  install: "pnpm add <pkg>@<version>"
  config: [ENV_VAR_1, ENV_VAR_2]
  migrations: true
quality:
  tests: { command: "pnpm test", passed: true, date: 2026-10-11 }
security:
  scanned_at: 2026-10-11
  tools: [osv-scanner, gitleaks, semgrep-oss]
  findings: []
  scope: "dependencias directas y transitivas + análisis estático"
license:
  declared: MIT
  detected: MIT
  obligations: [preserve-notice]
evidence:                             # cada afirmación con origen
  - claim: "compatible con next@<versión>"
    origin: tested                    # maintainer | model-inferred | tested | unknown
    ref: ci-run/<id>
relations:
  requires: []
  provides: [auth.session]
  conflicts: []
  tested_with: [db.orm.drizzle]
```

Validador obligatorio en CI: ningún manifiesto entra sin pasar el schema.

### 3.4 Taxonomía inicial

`security` (siempre; incluye `ai-safety` a partir de Fase 3) · `auth` · `authz` · `data` (ORM, validación, paginación) · `ui` (tablas, formularios, layout, estados) · `files` · `email` · `payments` · `jobs` · `observability` · `ops` (rate limit, idempotencia, reintentos) · `deploy` · `ai` (bloqueada hasta Fase 3).

### 3.5 Pila de la beta (una sola)

Next.js (App Router) + TypeScript estricto + Tailwind + shadcn/ui + ORM tipado (Drizzle) + Postgres + librería de auth open + Zod. Versiones exactas fijadas en `docs/adr/0002-stack.md`, siempre estables y publicadas hace más de 14 días.

### 3.6 Licencias permitidas en `approved` (beta)

MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC. Cualquier otra, sin licencia o con discrepancia entre metadatos y archivos → no pasa a `approved`. Código sin licencia no se reutiliza.

### 3.7 Siembra del catálogo

| Capa | Objetivo beta | Fuente |
|---|---|---|
| `discovered` | ≥ 5.000 paquetes con metadatos | Registros npm vía deps.dev / ecosyste.ms + avisos OSV, con caché y respetando límites |
| `evaluated` | ≥ 150 | Escaneo automático + revisión de manifiesto |
| `approved` | 60–80 componentes cubriendo 30–40 capacidades | Curación + tests de contrato en la pila beta |
| Recetas | 5 | Ver §3.8 |

### 3.8 Recetas de la beta

1. **SaaS CRUD** con auth, organizaciones y roles.
2. **Landing + waitlist** con formulario, email y panel admin.
3. **Herramienta interna** con tablas, filtros, importación CSV y exportación.
4. **Reservas/citas** con calendario, disponibilidad y notificaciones.
5. **Portal de clientes** con subida de archivos y estados de solicitud.
6. **Web corporativa** con servicios, blog, contacto y panel de textos (añadida en D3, ADR-0018).
7. **Tienda online** con catálogo, carrito, pago con Stripe Checkout, pedidos y stock (añadida en D3, ADR-0018).

Prompts fuera de estas familias → respuesta honesta "fuera del alcance de la beta" con la receta más cercana sugerida.

---

## 4. Ciclo de vida de un build

`queued → guarding → compiling → selecting → resolving → assembling → verifying → (correcting ↺ máx. 3) → delivering → done | failed`

Cada transición emite un evento SSE con: fase, duración, tokens, decisiones (con probabilidades de JEV), componentes y hallazgos.

Presupuestos por build (configurables): tokens máx., tiempo máx., coste máx. Si se exceden → `failed` con informe, nunca un repo a medias sin avisar.

---

## 5. Security Pack (siempre presente)

### 5.1 Lo que se inyecta en cada app generada

Cabeceras de seguridad y CSP · cookies seguras · protección CSRF · validación de entrada con Zod en todos los límites · middleware de autorización por rol/organización · rate limiting · esquema validado de variables de entorno · gestión de errores sin filtrar internos · logging sin datos sensibles · `SECURITY.md` · configuración de actualizaciones automáticas de dependencias · workflow CI con escaneos.

### 5.2 Lo que se verifica antes de entregar

| Capa | Herramienta | Criterio de bloqueo |
|---|---|---|
| Secretos | gitleaks | Cualquier hallazgo |
| Dependencias | osv-scanner + audit del gestor | Crítica/alta sin mitigación |
| Estático | semgrep (motor OSS) con **reglas propias** | Regla bloqueante propia |
| Licencias | escáner de licencias | Fuera de lista §3.6 |
| Contrato | tests de los componentes | Fallo |
| E2E | Playwright smoke (login, CRUD principal) | Fallo |

Nota: las reglas mantenidas del registro de Semgrep tienen restricciones de uso como servicio. Usar el motor OSS con reglas propias hasta revisar licencia.

### 5.3 Informe

Nunca "seguro" binario. El informe declara alcance, herramientas, fecha, hallazgos y lo que **no** se ha comprobado.

### 5.4 Seguridad de la propia plataforma

Abuse Guard con JEV · sandbox efímero sin red salvo registro de paquetes y sin secretos reales · tokens de GitHub de mínimo privilegio · cuotas por API key · circuit breaker de coste global.

---

## 6. Entregable: estructura del repo generado

```
<app-slug>/
├── README.md                 # qué es, cómo arrancar, variables de entorno
├── ARCHITECTURE.md           # diagrama, decisiones, receta usada
├── COMPONENTS.md             # cada componente: id, versión, origen, licencia, por qué se eligió
├── SECURITY.md               # informe de seguridad con alcance y fecha
├── TURBINEH_REPORT.md        # feedback del build: métricas, tokens, % reutilizado vs generado
├── sbom.cdx.json             # SBOM CycloneDX
├── .env.example
├── .github/workflows/ci.yml
├── src/
│   ├── app/                  # rutas y páginas
│   ├── components/           # UI (de catálogo + glue marcado)
│   ├── server/               # acciones, servicios, authz
│   ├── db/                   # esquema y migraciones
│   ├── lib/                  # utilidades y adaptadores
│   └── security/             # Security Pack
├── tests/{unit,e2e}/
└── docs/adr/
```

Todo archivo generado (no proveniente de catálogo) lleva cabecera `// turbineh:generated` para medir el ratio reutilizado/generado de forma honesta.

---

## 7. API pública

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/v1/builds` | `{ prompt, github_username?, options? }` → `202 { build_id }`. Header `Idempotency-Key` |
| `GET` | `/v1/builds/{id}` | Estado, métricas, URL del repo, feedback |
| `GET` | `/v1/builds/{id}/events` | SSE con la traza en vivo |
| `GET` | `/v1/components` | Búsqueda en catálogo (`q`, `category`, `status`) |
| `GET` | `/v1/components/{id}` | Manifiesto completo |
| `GET` | `/health` | Salud |

Auth: `Authorization: Bearer <api_key>`. Especificación OpenAPI 3.1 generada desde el código y publicada en `/docs`. Errores con formato RFC 9457.

### 7.1 Estrategia de entrega (por límites de GitHub)

GitHub limita la creación de contenido a unas 80 peticiones/min y 500/hora por identidad. Por eso la entrega se desacopla en tres canales:

| Canal | Cuándo | Cómo | Consume cuota de |
|---|---|---|---|
| **A · Artefacto propio (siempre)** | 100 % de builds, al terminar la verificación | Repo git completo (bundle + ZIP) en object storage, visor de árbol y docs en la UI, enlace firmado | Nadie (sin límite GitHub) |
| **B · "Llevar a mi GitHub" (CTA por defecto)** | Usuario de la beta | Login con GitHub (GitHub App, token de usuario) → repo privado creado **en su cuenta** con un único `git push` | El propio usuario |
| **C · Org TurbineH de entregas** | Clientes y leads cualificados | GitHub App en la org; cola con token bucket a ≤ 150 entregas/hora; una creación de repo + un push, sin invitaciones salvo cliente | TurbineH |

Reglas:
- La fuente de verdad es el artefacto del canal A. GitHub es un canal de exportación asíncrono: si falla o se limita, el usuario ya tiene su resultado.
- Nunca crear archivos uno a uno con la Contents API: siempre repo vacío + un único `git push` del árbol completo.
- Respetar `retry-after` y `x-ratelimit-*`; backoff exponencial; reintentos idempotentes por `build_id`.
- Prohibido repartir carga entre varias cuentas u organizaciones para esquivar límites.

Acceso al repo en canal C: invitación como colaborador a `github_username`.

---

## 8. UI

- Patrón de la home de **typesafe.ai** (Claude Code: analizar la referencia antes de diseñar): hero mínimo, input protagonista, demostración inmediata.
- Estética **turbineh.com** y logo de la carpeta: navy `#001A5A` de fondo de marca, teal `#34D8C4` = inteligencia/IA, amber `#F2B24B` = dinero/ahorro (convención de marca). Verificar tipografías contra turbineh.com.
- Pantallas: (1) Home con prompt y ejemplos de las 5 recetas · (2) Build en vivo: traza por fases, componentes elegidos con probabilidad de JEV, contador de tokens frente a baseline · (3) Resultado: enlace al repo, feedback, informe de seguridad · (4) Catálogo navegable · (5) Docs API.
- Un único CTA por pantalla.

---

## 9. Infraestructura para la beta viral

Proveedor-agnóstico. Claude Code lee el archivo de claves de la carpeta, detecta qué proveedores hay disponibles y elige; propone alternativa solo si falta algo crítico.

| Pieza | Requisito | Notas |
|---|---|---|
| API + workers | Contenedores escalables horizontalmente | API y workers separados |
| Cola | Persistente con reintentos | Concurrencia limitada por coste |
| Base de datos | Postgres + pgvector | Catálogo, builds, eventos |
| Sandbox | MicroVM o contenedor efímero, pre-calentado | Sin secretos, red solo al registro |
| Inferencia open | Proveedor con baja latencia | Modelo compilador |
| JEV | API TypeSafe | + `OpenDecider` como fallback |
| GitHub | GitHub App en la org de entregas | Mínimo privilegio |
| UI | Hosting edge | `turbineh` estética |
| Observabilidad | Logs estructurados, trazas, métricas | Panel de builds/min, tasa verde, coste |

**Capacidad viral:**
- Cuotas por API key y por IP; lista de espera automática cuando la cola supera umbral.
- Circuit breaker de coste diario global.
- Caché de resoluciones: mismo `BuildSpec` normalizado → misma selección sin volver a llamar a modelos.
- Sandboxes pre-calentados con la receta base ya instalada (clave para la velocidad).
- Prueba de carga en D3 antes del freeze.
- Entrega según §7.1: el artefacto propio no depende de GitHub; la cuota de la org TurbineH se reserva para clientes.

---

## 10. Repositorio CODE-API-TURBINEH

```
CODE-API-TURBINEH/
├── apps/
│   ├── api/                 # gateway HTTP + SSE
│   ├── worker/              # ejecución del pipeline
│   └── web/                 # UI
├── packages/
│   ├── orchestrator/        # component #001
│   ├── decider/             # interfaz + JevDecider + OpenDecider
│   ├── compiler/            # prompt → BuildSpec, glue, feedback
│   ├── backup-coder/        # respaldo permanente: primario + secundario, disparadores
│   ├── catalog/             # schema, validador, repositorio de datos
│   ├── selector/            # retrieval + decider
│   ├── resolver/            # compatibilidad determinista
│   ├── assembler/           # recetas + instalación + glue
│   ├── verifier/            # sandbox runner + escaneos
│   ├── security-pack/       # lo que se inyecta + reglas propias
│   ├── delivery-github/     # repo privado + invitación
│   └── shared/              # tipos, eventos, config, logger
├── catalog/
│   ├── components/<id>/component.yaml
│   ├── recipes/<id>/
│   └── gaps/                # huecos cubiertos por el respaldo → candidatos a componente
├── ingest/                  # siembra discovered/evaluated
├── bench/                   # prompts, baseline, resultados
├── docs/
│   ├── PLAN.md
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── COMPONENT_MANIFEST.md
│   ├── SECURITY.md
│   ├── ROADMAP.md
│   └── adr/
├── .github/                 # CI, plantillas de issue/PR, CODEOWNERS
├── CLAUDE.md
├── README.md  CONTRIBUTING.md  CODE_OF_CONDUCT.md  SECURITY.md  CHANGELOG.md  LICENSE
```

**Estándares:** monorepo pnpm + turborepo · TypeScript estricto · ESLint + Prettier · Conventional Commits · ramas por WP con PR · CI obligatoria (lint, typecheck, test, manifiestos, escaneo de secretos) · cobertura ≥ 80 % en `resolver`, `catalog` y `security-pack` · ADR por cada decisión relevante · documentación pública en inglés · licencia del proyecto: Apache-2.0 (confirmar con Alex en G0).

---

## 11. Plan por días

Cada día cierra con un **Gate**. Claude Code no avanza al siguiente bloque sin reportar el Gate (plantilla §14).

### D0 · sábado 10-oct (tarde/noche) · Cimientos

| WP | Tarea | Definition of Done |
|---|---|---|
| WP0 | Higiene de secretos: claves de la carpeta → `.env.local` no versionado; `.gitignore`, gitleaks pre-commit | Escaneo limpio; ninguna clave en el historial |
| WP1 | Monorepo, CI, plantillas, README/CONTRIBUTING/SECURITY, ADR-0001 (arquitectura) y ADR-0002 (pila) | CI verde en repo público vacío funcional |
| WP2 | Smoke test de JEV y de la alternativa open (según comparativo); interfaz `decider` | Ambas responden a 1 pregunta Choice + 1 Noul; latencias medidas |
| WP3 | Schema `component.yaml` v0.1 + validador + 3 manifiestos de ejemplo | Validador en CI, 3 manifiestos verdes |
| WP4 | Smoke test del modelo compilador → `BuildSpec` validado + Backup Coder primario y secundario conectados (ADR-0003) | 5 prompts producen `BuildSpec` válido; ambos modelos de respaldo responden |

**Gate G0:** acceso real a JEV confirmado (o decisión de ir con `OpenDecider` en la beta), claves operativas, CI verde, licencia confirmada.

### D1 · domingo 11-oct · Catálogo y selección

| WP | Tarea | DoD |
|---|---|---|
| WP5 | Postgres + pgvector, tablas catálogo/builds/eventos, ingesta `discovered` | ≥ 5.000 paquetes indexados |
| WP6 | Curación `approved`: 60–80 componentes, 30–40 capacidades, tests de contrato | Todos con manifiesto completo y tests en verde |
| WP7 | Recetas 1–3 (SaaS CRUD, landing+waitlist, herramienta interna) | Cada receta base compila y pasa E2E smoke |
| WP8 | Selector (retrieval → top-20 → decider) + Resolver determinista | Tests unitarios de conflictos de versión y licencia |
| WP9 | Verifier en sandbox (install → build → test → escaneos → E2E) con imagen pre-calentada | Receta 1 verificada en sandbox |

**Gate G1:** un prompt de la receta 1 recorre compile → select → resolve → assemble → verify **en local** y deja un repo verde en disco.

### D2 · lunes 12-oct · Producto end-to-end

| WP | Tarea | DoD |
|---|---|---|
| WP10 | Assembler con glue generado + Corrector (parche dirigido, swap tras N) + disparadores T1–T6 del Backup Coder + `catalog/gaps/` | Fallo inducido se corrige sin reiniciar; capacidad sin componente se cubre con respaldo y queda registrada como hueco |
| WP11 | Security Pack completo inyectado + informe | 100 % de builds con pack; informe con alcance y fecha |
| WP12 | Delivery por canales (§7.1): A artefacto + visor; B login GitHub y push a la cuenta del usuario; C cola a la org TurbineH; `TURBINEH_REPORT.md`, SBOM | Los tres canales funcionan; prueba de saturación del canal C no bloquea A ni B |
| WP13 | API pública (OpenAPI, auth, cuotas, idempotencia, SSE) + cola + workers | Despliegue en staging |
| WP14 | UI (home, build en vivo, resultado, catálogo, docs) | Flujo completo desde navegador en staging |
| WP15 | Recetas 4–5 + Abuse Guard | Prompts maliciosos de prueba bloqueados |
| WP16 | Benchmark (§12) primera pasada | Tabla de resultados reales |

**Gate G2:** en staging, ≥ 8 de 10 prompts de benchmark terminan en repo verde; tabla de métricas real disponible.

### D3 · martes 13-oct · Endurecer y lanzar

| Bloque | Tarea |
|---|---|
| Mañana | Prueba de carga, ajuste de cuotas y concurrencia, corrección de los fallos de G2 |
| Mediodía | **Code freeze.** Despliegue a producción en `software.turbineh.com` (`api.turbineh.com` sigue siendo la landing de YES IF; ADR-0005) |
| Tarde | Pulido de docs públicas, demo grabada de respaldo, 3 prompts de demo ensayados |
| Presentación | Demo en vivo + repo público + benchmark |

**Gate G3 (go/no-go):** producción estable, cuotas activas, circuit breaker probado, demo de respaldo grabada.

---

## 12. Benchmark

- 10–20 prompts repartidos entre las 5 recetas, publicados en `bench/prompts/`.
- **Baseline:** el mismo prompt a un agente de generación completa convencional con un modelo frontier.
- **Medidas por build:** tokens (separando respaldo), activaciones del Backup Coder por disparador, tiempo hasta repo, build verde (sí/no), criterios de aceptación cumplidos, hallazgos de seguridad, líneas reutilizadas vs generadas, correcciones necesarias, coste ajustado por calidad.
- **Métrica principal:** apps que pasan los criterios de aceptación y cuánto trabajo necesitaron. Mucha reutilización con muchas correcciones es mala señal.
- Solo se comunican números obtenidos aquí.

---

## 13. Roadmap posterior a la beta

| Fase | Contenido | Condición de entrada |
|---|---|---|
| F2 | Conectar repos GitHub existentes | Diseño en profundidad de la auditoría de ciberseguridad de entrada (modelo open especializado + JEV) **antes** de implementar |
| F3 | Sistemas IA en el resultado: component #001 + AI Safety Pack | F2 estable |
| F4 | Contribuciones de terceros con manifiesto público, identidad del publicador y versiones inmutables | Proceso de evaluación automatizado |
| F5 | Ingesta masiva multi-registro y nuevas pilas | Métricas de F2–F3 |

---

## 14. Protocolo director ↔ ejecutor

1. Claude Code trabaja WP a WP, en rama propia, con PR y descripción.
2. Al cerrar cada Gate entrega este informe, que Alex trae al chat del director:

```
GATE: G?
ESTADO: verde | ámbar | rojo
WPs CERRADOS: ...
WPs ABIERTOS / BLOQUEOS: ...
MÉTRICAS: builds verdes x/y · tokens medios · tiempo medio · coste medio
DECISIONES TOMADAS (con ADR): ...
DECISIONES QUE NECESITAN A ALEX: ...
RIESGOS NUEVOS: ...
SIGUIENTE BLOQUE: ...
```

3. Decisiones que siempre suben a Alex: licencia del proyecto, proveedor de inferencia si hay coste relevante, cambios de alcance de la beta, cualquier cosa que toque claves o la org de GitHub de clientes.
4. Todo lo demás lo decide Claude Code dentro de este plan y lo registra en ADR.

---

## 15. Riesgos

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| R1 | JEV en early access: acceso, cuotas o SDK no disponibles a tiempo | Bloquea el selector | Interfaz `decider` + `OpenDecider` desde D0; decisión en G0 |
| R2 | Modelo compilador pequeño insuficiente para glue de calidad | Builds rojos | Backup Coder permanente con disparadores T1–T6 |
| R10 | El respaldo se usa en exceso y diluye la tesis de selección | Mensaje y coste | Métrica pública de % de respaldo, contexto mínimo, flywheel `catalog/gaps/`, cuotas de tokens del respaldo por build |
| R3 | "Full-funcional desde cualquier prompt" en 3 días | Demo frágil | 5 recetas, respuesta honesta fuera de alcance, demo grabada de respaldo |
| R4 | Claves en un repo público | Compromiso total | WP0 primero, gitleaks pre-commit, rotación inmediata si aparece cualquier fuga |
| R5 | Ejecución de código de terceros | Fuga de secretos | Sandbox efímero sin secretos, red limitada |
| R6 | Carga viral sobre coste y límites de GitHub | Caída o factura | Cuotas, cola, circuit breaker, caché de resoluciones, entrega encolada |
| R7 | Promesas de reducción de tokens sin medir | Credibilidad | Solo números del benchmark §12 |
| R8 | Licencias de reglas de seguridad y de componentes | Legal | Lista cerrada §3.6, reglas propias |
| R9 | Precedente cercano (Bit + Hope AI) | Diferenciación | Mensaje: selección con decisión calibrada + verificación + seguridad siempre, con evidencia pública |
