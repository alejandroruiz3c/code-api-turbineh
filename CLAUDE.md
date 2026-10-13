# CLAUDE.md · CODE-API-TURBINEH

Eres el **ejecutor** del proyecto. El director es Claude (chat) a través de Alex Ruiz. El plan vinculante está en `docs/PLAN.md`. Si algo de este archivo o del plan entra en conflicto con la "DESCRIPCIÓN PRODUCTO FRONTIERS 10-26", prevalece la descripción y lo reportas.

## Qué construimos

Un generador de software de prompt a producción que **selecciona** componentes de un catálogo verificado en vez de generar todo el código. La decisión de selección la toma JEV (TypeSafe AI) o su alternativa open; un modelo open pequeño compila la intención y genera solo el código de unión. Entregable de cada build: repo privado en la org GitHub de TurbineH + feedback textual.

Alcance de la beta: solo software nuevo, solo apps y webs full-funcionales, Security Pack siempre.

## Antes de escribir una línea

1. Lee `docs/PLAN.md` completo.
2. Lee la carpeta del proyecto: comparativo JEV vs alternativa open (y cuándo usar cada una), logo, archivo de claves, y cualquier documentación de TurbineH relacionada.
3. Analiza las referencias de UI: https://typesafe.ai (patrón) y https://turbineh.com (estética).
4. Ejecuta WP0 (higiene de secretos) antes que nada.

## Reglas duras

- **Secretos:** las claves nunca entran en git. Van a `.env.local` (ignorado). gitleaks en pre-commit y en CI. Si una clave aparece en cualquier commit: para, avisa y pide rotación.
- **JEV:** no inventes su API. Usa la documentación y el SDK oficiales. Todo acceso pasa por la interfaz `decider` (`JevDecider` | `OpenDecider`).
- **Decisiones deterministas:** compatibilidad de versiones, licencias, permisos y resultado de tests nunca los decide un modelo.
- **Sandbox:** nunca ejecutes `install`, `build` ni `test` de código de terceros fuera del sandbox efímero sin secretos.
- **Catálogo:** solo `approved` entra en un build. Nada pasa a `approved` sin manifiesto válido, tests de contrato verdes, escaneo de seguridad y licencia de la lista permitida.
- **Security Pack:** se inyecta en el 100 % de builds. No crees flags para desactivarlo.
- **IA en builds de clientes:** prohibida en la beta. El component #001 (`@turbineh/orchestrator`) se construye y cataloga, pero no se ensambla hasta la Fase 3.
- **Backup Coder:** siempre conectado (primario + secundario, elegidos de la documentación de modelos de la carpeta; ADR-0003). Solo cubre huecos según los disparadores T1–T6 de `docs/PLAN.md §2.4`, con contexto mínimo, marca `// turbineh:generated-backup`, misma verificación y registro en `catalog/gaps/`. Nunca reescribe la app entera.
- **Métricas:** no escribas en docs, UI ni README ninguna cifra que no salga de `bench/`.
- **Versiones:** fija versiones exactas, estables y publicadas hace más de 14 días.

## Convenciones

- Monorepo pnpm + turborepo, TypeScript estricto, ESLint + Prettier.
- Conventional Commits. Una rama y un PR por WP (`wp/<n>-<slug>`).
- ADR en `docs/adr/NNNN-titulo.md` para cada decisión relevante.
- Documentación pública del repo en inglés; informes al director en español.
- Archivos generados por el sistema en apps de clientes llevan la cabecera `// turbineh:generated`.

## Comandos (mantener actualizados)

```bash
pnpm install
pnpm dev            # api + worker + web en local
pnpm test
pnpm lint && pnpm typecheck
pnpm catalog:validate
pnpm smoke:decider        # JEV + open decider (requiere .env.local y services/open-decider)
pnpm smoke:compiler       # 5 prompts → BuildSpec
pnpm smoke:backup-coder   # primario + secundario responden
pnpm bench          # ejecuta bench/prompts contra el pipeline y el baseline
pnpm --filter @turbineh/cli run build   # CLI turbineh en un solo archivo (dist/ y apps/web/public/cli/)
```

## Definition of Done de cualquier WP

Código + tests + CI verde + docs actualizadas + ADR si hubo decisión + entrada en `CHANGELOG.md`.

## Gates

Al cerrar D0, D1, D2 y D3 entrega el informe de Gate con la plantilla de `docs/PLAN.md §14` y espera validación antes de abrir el siguiente bloque.

## Decisiones que no tomas tú

Licencia del proyecto, proveedor de inferencia con coste relevante, cambios de alcance, cualquier acción sobre la org GitHub de clientes o sobre claves. Súbelas en el informe de Gate.

## Rutas del workspace (reorganizado 2026-10-10)

El repo vive en `YES-IF-API-PRODUCT/code-api-turbineh/`. Material de la carpeta del proyecto, relativo a este repo:

- **DESCRIPCIÓN PRODUCTO FRONTIERS 10-26** (prevalece): `docs/PRODUCT_DESCRIPTION.md` (original en `../inputs/2026-10-descripcion-producto-frontiers.pdf`)
- Comparativa JEV vs alternativa open: `../inputs/2026-10-comparativa-quyet-vs-jev.pdf` y `../knowledge/modelos-ia/03-guias-transversales/quyet-vs-jev-modelo-de-decision-hackathon.md`
- Documentación de modelos: `../knowledge/modelos-ia/`
- Logo: `../brand/turbineh-logo.pdf`
- Claves: `../.secrets/` → solo hacia `.env.local` (ver `docs/SECRETS.md`)
- Evaluación preliminar y estimación de coste: `../inputs/`
