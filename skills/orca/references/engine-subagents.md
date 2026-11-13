# Motor: subagentes nativos

Un solo proveedor, sin Orca. Más barato de montar; menos visibilidad.

## Antes de lanzar
- **El worktree lo creas tú**, no el entorno: `omk run worktree <run> <U>` (sin `omk`, `engine-manual.md` §1). Sale de la cabeza de la rama de integración, en la rama `wt/<run>/<u>`, con su `.env` de desarrollo, y queda anotado en `run.md`. Su ruta va en la línea `WORKTREE:` del despacho.
- Unidad en `dispatching` en `run.md` antes de lanzar; `dispatched` con el nombre o id del subagente después (`ledger.md`).
- **Modelo**: pasa al subagente el modelo que le tocó a la unidad (`olimpo.md` §Modelos) con el parámetro de modelo del entorno. Si el entorno no deja elegirlo, dilo en el plan (`por defecto`).
- **Entorno**: aquí no hay `orca.yaml` que lo prepare. El despacho lleva el bloque `SETUP` (ruta absoluta del checkout principal y setup de `ORCHESTRATION.md` §3) y el worker lo ejecuta en su arranque (`worker-contract.md` §1.4).
- **Solo lectura** (investigar, auditar, revisar un diff): subagente sin worktree y sin permiso de edición si el entorno lo permite. No lleva `SETUP`; su informe es el entregable.

## Claude Code
- Un subagente por unidad con la herramienta de agentes del entorno, en segundo plano si está disponible (el entorno te avisa al terminar, no hace falta sondear) y **sin** su opción de aislamiento en worktree: ese worktree nace de la rama por defecto, no de la de integración, y se borra si el subagente termina sin cambios (medido en el run 20261113-omk-run: los tres workers arrancaron en `main`). El subagente trabaja en la carpeta de `WORKTREE:` (`worker-contract.md` §1.1).
- Dos subagentes nunca comparten carpeta: cada uno en su worktree. Si no puedes crearlos, la ronda va en secuencial.
- Prompt del subagente = mensaje de despacho completo (`SKILL.md` §5) con el contrato entero (`worker-contract.md`).
- El informe es el mensaje final del subagente. Su rama y su worktree son los de `run.md`: compruébalos con `omk run check <run> <U>` antes de integrar.
- `rework`: si el entorno permite seguir hablando con un subagente terminado (por nombre o id), mándale la lista de cambios; si no, lanza uno nuevo sobre el mismo worktree con el brief original + la lista.
- Agent Teams / modos de varios agentes del producto sirven igual; las reglas de `write` y `shared` no cambian.

## Antigravity
- Usa el Agent Manager: una conversación/agente por unidad, cada uno en su propio worktree o workspace. Si el entorno no crea worktrees, créalos tú con `engine-manual.md` §1 y abre cada agente sobre su carpeta.
- Pega el mensaje de despacho como primer mensaje del agente.
- Recoge el informe del final de cada conversación.

## Codex, Cursor, Copilot
Usa su mecanismo de agentes en paralelo si crea un worktree por agente. Si no lo crea, trátalo como `engine-manual.md` (tú creas los worktrees, el agente trabaja en cada uno).

## Común
- Límite práctico: 3 subagentes simultáneos.
- Los subagentes no ven tu conversación: todo el contexto va en el despacho.
- Al terminar, la integración es igual: `integrate.md`.
