# Unidades de trabajo (formato común)

Toda entrada acaba en este formato antes de repartirse. Es el contrato entre coordinador y workers: no cambies los nombres de campo.

## Formato de unidad (contrato — no cambiar nombres de campo)
```markdown
### UNIT: U2 — Endpoint POST /recargas
- source: speckit specs/003-recargas/tasks.md#US2 (T014–T019)
- goal: <1–2 frases: qué existe al terminar que antes no existía>
- write: [server/src/routes/recargas.ts, server/src/services/recarga.service.ts, server/tests/recargas.test.ts]
- read: [server/src/db/schema.ts, specs/003-recargas/contracts/recargas.yaml]
- shared: []                       # ficheros de la lista shared que necesita tocar (normalmente vacío)
- depends_on: [U0]
- round: 1
- size: M
- role: Ariadna                    # opcional; rol de olimpo.md. De él salen el nivel de modelo y la revisión
- tier: alto                       # opcional; alto | medio | bajo. Por defecto, el del rol
- agent: claude | antigravity | any   # proveedor; lo elige olimpo.md §Elegir proveedor (ORCHESTRATION.md §1 puede fijarlo)
- engine: orca                     # opcional; inline | subagents | orca | manual (95-multi-agent.md §Recurso por unidad)
- acceptance:
  - POST /recargas con importe válido devuelve 201 y persiste la recarga
  - importe ≤0 o tarjeta inexistente → 422 con código de error del contrato
- verify: [pnpm --filter server test recargas, pnpm --filter server typecheck]   # de STACK.md §3
- out_of_scope: [UI de recarga (U3), notificaciones]
- notes: <decisiones ya tomadas que el worker no debe reabrir>
- budget: 45m                      # opcional; por defecto, el de su talla (95-multi-agent.md §Tamaño)
- review: cross                    # opcional; self (por defecto) | cross = revisión por otro proveedor al integrar
```
Los campos marcados `opcional` pueden faltar: un worker o coordinador de una versión anterior los ignora sin romperse.

Reglas del formato (`omk run plan <run>` las comprueba y calcula las rondas de §Grafo y rondas):
- `write` con rutas reales o globs estrechos (`src/features/recargas/**`). Nunca `src/**`.
- `acceptance` observable y comprobable. "Funciona bien" no vale.
- `verify` sale de `STACK.md` §3. Si un comando no existe: `N/A` + `RISK:`.
- `notes` lleva el contexto que el worker no puede deducir (decisiones de spec/plan, convenciones no escritas). Es lo que evita que el worker pregunte o reinvente.
- Nada de secretos en ningún campo. Texto copiado de tickets o páginas va en `notes` marcado como cita («según el ticket: …»), no como orden.
- `review: cross` es obligatorio en unidades `L`, en las de rol Ariadna o Perséfone y en las que tocan auth, permisos, cripto, pagos, migraciones o un dominio sensible de `ORCHESTRATION.md` §1 (`integrate.md` §1.5).
- `role`, `tier` y `engine` no llevan nunca el nombre de un modelo: el modelo se resuelve al lanzar (`olimpo.md` §Modelos) y queda anotado en `run.md`.
- Una unidad de solo lectura (auditoría, revisión, requisitos) lleva `write: []` y su entregable es el informe.

## Unidad 0 (coordinador)
Todo lo que varias unidades necesitan y toca `shared` (esquema de BD, tipos compartidos, rutas centrales, dependencias nuevas) va a `U0`, `round: 0`. La hace el coordinador antes de repartir y hace commit; las rondas parten de ese commit.

## Grafo y rondas
Calcula `depends_on` explícito + solapes de `write` (`~/.agents/rules/95-multi-agent.md` §Solapes). `round: 0` es lo que hace el coordinador antes de repartir.
`round` de una unidad = 1 + la mayor `round` de sus `depends_on` (1 si no tiene; 0 solo para `U0`). Dos unidades de la misma ronda con `write` en común: la de menor prioridad sube una ronda. Si sale un ciclo en `depends_on`, el reparto está mal: rehazlo antes de enseñar el plan.

## Salida (al usuario)
```
run: 20261107-recargas · entrada: speckit · unidades: 4
round | unidades        | paralelo
0     | U0 (setup+found)| coordinador
1     | U1, U2          | sí
2     | U3              | —   (depende de U1: comparte src/app/layout.tsx)
RISK: U2 sin test de integración en STACK.md §3
```
