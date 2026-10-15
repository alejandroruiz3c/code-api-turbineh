# Product description · FRONTIERS 10-26 (source of truth)

> Faithful transcription of the owner's document "DESCRIPCION PRODUCTO FRONTIERS 10-26" (original PDF kept outside
> the repo). It **prevails over every other document** in this repository (see `CLAUDE.md`). Kept in the original
> Spanish. Later explicit owner decisions are recorded as ADRs and listed at the end.

---

Este es el sistema que voy a construir finalmente.

Actualmente se generan millones de líneas de código que no tiene sentido que se generen una y otra vez. Son
defectuosas y casi todo el mundo está generando características muy parecidas una y otra vez.

Se trata de un generador de software, de prompt a producción, que se base en selección de componentes software ya
creados. El usuario introduce un prompt o conecta código que ya tiene y pide lo que quiere con ello. Nuestro sistema
toma decisiones de cómo construir o mejorar el software que será el resultado buscado entre miles de componentes
software.

Para ello debemos crear un repositorio de componentes software de todo lo disponible en la web ahora mismo (que será
muy completo). Cada componente software debe ser atómico (no sistemas completos) y bien etiquetado con casos de uso,
funcionalidad, ventajas e inconvenientes y auditoría de ciberseguridad.

El primer paso sería crearnos ese repositorio y a futuro podemos permitir que otras personas dejen sus componentes
software en nuestro repositorio también para ser usados. El repositorio debe estar bien categorizado por grupos
temáticos, siendo el más importante el de Ciberseguridad y AI Safety (si hay IA). Ese siempre lo aplicamos por
política interna.

La arquitectura interna se basará en la tecnología IA de decisión de JEV by TypeSafe. Para ello, actuarán dos
posibles sistemas de esta tipología como selectores de los componentes software que compondrán el resultado: JEV y su
mejor versión open (hay comparativo en la carpeta de proyecto y documentación de cuándo se usa cada una de las dos
opciones).

Debe tener un modelo lo más pequeño posible, open, especializado en entender el prompt de entrada, descomponer
intención y tareas de desarrollo software, estructurarlo como debe recibirlo JEV (aquí también se sigue la misma
filosofía del abierto o el cerrado según el caso) y recibir los resultados de JEV para él mismo armar todas las tareas
en base a esa selección y generar la respuesta al usuario, a la par que el sistema que pidió. Debe ser un modelo lo
suficientemente inteligente como para mantener la velocidad y calidad de desarrollo que va a aportar JEV.

Uno de los componentes software, y el primero del repositorio, debe ser nuestro propio orquestador de modelos. Será
siempre lo que se meta cuando el sistema del cliente necesite IA: JEV orquestando a cualquier modelo open source de
los documentados. Ese componente tiene un modelo lo más pequeño posible, open, especializado en entender el prompt de
entrada, descomponer intención y tareas y estructurarlo como debe recibirlo JEV (misma filosofía del abierto o el
cerrado según el caso). Y ya es el modelo al que se orquestó el que devuelve el resultado que se busque.

Ahora centrado en sistemas de:

- Apps y webs.
- Sistemas IA.
- Siempre metiendo el de ciberseguridad y safety AI con coherencia en el sistema resultado.

El uso será mediante API. La interfaz de usuario para el sistema será del tipo https://typesafe.ai/ pero con
estética https://turbineh.com (logo en la carpeta). El despliegue en api.turbineh.com; todas las KEYS necesarias en
archivo en la carpeta.

Durante el desarrollo, usar la infraestructura necesaria para dar servicio completo en una beta viral que se
presentará en 3 días. La velocidad y calidad del código generado, con una reducción enorme en consumo de tokens, debe
ser espectacular.

Como primer paso, un plan de trabajo detallado: el director de trabajo es Claude (chat) y el ejecutor, Claude Code
local. Debe ser un proyecto Git abierto llamado CODE-API-TURBINEH, de máxima calidad en buenas prácticas de
ingeniería de software y por tanto en su documentación.

Por ahora, con objetivo de la hackathon, el resultado de cada interacción de un usuario con el producto debe ser la
estructura de carpetas jerarquizada y documentada correctamente como proyecto privado en GitHub. Ese es el
entregable. Como entrada, si es software nuevo, solo prompt; si es existente, debe permitir conectar un proyecto de
GitHub y de ahí bebe el sistema; en ese caso el entregable es sobre ese proyecto que nos da, no solo como proyecto
privado en la cuenta que tenemos para dar resultados a clientes. Siempre feedback textual también, generado por el
modelo que trabaja con JEV y arma los resultados.

Decisiones de ejecución:

- Primero solo software nuevo.
- Primero solo apps y webs full funcionales.
- Ciberseguridad y AI safety siempre (cuando haya IA).
- Siempre que nos conecten software debe pasar controles de ciberseguridad con un modelo especializado open de los
  que tengamos, probablemente con participación de JEV. Se deja para justo el paso antes de permitir que nos conecten
  sistemas ya existentes, y ahí se profundiza antes de implementarlo. Según esa auditoría se decidirán qué componentes
  de la categoría ciberseguridad y AI Safety (si conlleva IA) meter.
- Que nos conecten software existente antes de permitir sistemas IA. Ese es el orden.

---

## Later owner decisions (2026-10-10, recorded as ADRs)

| Topic            | Description says                                                           | Owner decision                                                                                                                               | ADR        |
| ---------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Deployment host  | api.turbineh.com                                                           | **software.turbineh.com** (api.turbineh.com keeps the YES IF landing)                                                                        | 0005       |
| Interaction      | "Uso mediante API" + typesafe.ai-style UI                                  | Web app first (best UX), API second on the same backend                                                                                      | 0005       |
| Open Git project | Open project                                                               | Private until the D3 release review, then public                                                                                             | 0007       |
| Delivery         | "proyecto privado en la cuenta que tenemos para dar resultados a clientes" | Only the complete verified package (download) and "Push to my GitHub" into the user's own account; no delivery into TurbineH GitHub accounts | 0013       |
| Models           | JEV + best open version                                                    | Open-weights only, except JEV; closed frontier only as benchmark baseline                                                                    | 0001, 0009 |

---

## Actualización del propietario · 2026-10-12 · producto comercial "YES IF for Builders" (prevalece sobre lo anterior)

- **No somos un generador prompt → app** (espacio competido por empresas consolidadas y modelos frontera). Somos la
  **capa de capacidades verificadas** sobre la que construyen equipos humanos y agentes IA (Claude Code, Codex…): en
  vez de desarrollarlo todo, pasan por nosotros con sus requisitos y se llevan un flujo completo, parcial o un
  componente integrable.
- **Valor:** repositorio lo más grande posible de recursos por caso de uso y por componente; auditado y verificado en
  ciberseguridad, AI safety, eficiencia y calidad; evita rehacer las mismas capacidades (tiempo, tokens, dinero,
  energía); gran trabajo de integrabilidad y trazabilidad en cada entrega.
- **Si el usuario trae su repositorio**, se lo entregamos integrado y funcional sobre su sistema (lo que era F2).
- **Arquitectura híbrida de orquestación** (nuestra tecnología y MOAT): entender intención → orquestar decisiones →
  ejecutar tareas; predice los trabajos a realizar y decide antes de ejecutar, maximizando safety, security y calidad.
  **No se nombra a terceros (proveedor del decisor) en ninguna superficie de producto.**
- **Promesa:** "Obtén capacidades funcionales listas para integrar, como paquete descargable o directamente en tu
  proyecto." Clave: flujos funcionales de software con calidad y seguridad verificadas, en segundos y casi gratis.
- **Acceso:** software.turbineh.com es exclusivamente el área de uso del producto, protegida por un token de acceso de
  invitación (sin login); el mismo token sirve como clave de API durante esta fase. La landing comercial es
  api.turbineh.com.
- Necesidades sin caso de uso completo pero con componentes útiles: se integran esos componentes (el orquestador de IA
  para cualquier trabajo con inferencia es clave).
- Sin "previsualizar UIs" tipo Lovable: el foco es transparencia, utilidad y diferencial en tiempo, consumo, safety y
  calidad.
