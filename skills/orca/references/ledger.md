# Estado del run (ledger) y reanudación

Un run dura horas y sobrevive a cosas que el coordinador no controla: compactación del contexto, cierre del agente, caída de Orca, reinicio del equipo. El estado vive en un fichero, no en la conversación.

## Fichero
`.work/runs/<run>/run.md` del checkout del coordinador (con Orca, su workspace). Lo escribe **solo** el coordinador (los workers no lo ven), y con `omk run`, no a mano: `omk run new` lo crea con las unidades de `units.md` en `pending`; `omk run set <run> <U> clave=valor…` cambia una fila (`status` respeta las transiciones de abajo, pasar a `dispatching` cuenta un intento y `updated` se pone solo); `omk run meta <run> clave=valor…` cambia la cabecera y `omk run log <run> <texto>` añade al log. Sin `omk`, edítalo a mano con este formato:
```markdown
# run 20261107-recargas
- input: speckit specs/003-recargas
- engine: orca            # orca | subagents | manual | mixto
- orca_run: run_8f2c…     # solo con Orca
- autonomy: semi
- integration: feat/003-recargas
- base_ref: origin/main @ 1a2b3c4   # de dónde nació la rama de integración (SKILL.md §4)
- cleanup: —              # — | pending | done (integrate.md §6)
- status: active          # planned | active | closing | done | cancelled
- confirm1: 2026-11-07T10:12Z   # cuándo dijo «sí» el usuario al plan

| unit | round | status | role | agent · model | ref | branch | worktree | base | head | attempts | updated |
|---|---|---|---|---|---|---|---|---|---|---|---|
| U0 | 0 | merged | Hefesto | coordinador | coordinador | feat/003-recargas | (principal) | 1a2b3c4 | 5d6e7f8 | 1 | 10:31 |
| U1 | 1 | dispatched | Proteo | antigravity · <medio> | task_91 / disp_4c | (Orca) | (Orca) | 5d6e7f8 | — | 1 | 10:33 |
| U2 | 1 | reported | Ariadna | claude · <alto> | agent:u2-recarga | worktree-agent-ab12 | ../app-wt/u2 | 5d6e7f8 | 9a0b1c2 | 1 | 11:02 |

## Log
- 10:31 U0 merged 5d6e7f8 · gates PASS
- 11:02 U2 informe recibido (succeeded)
```
- `ref`: lo que identifica al worker en su motor. Orca: `<taskId> / <dispatchId>`. Subagentes: nombre o id del agente. Manual: ruta del worktree.
- `role` y `agent · model`: lo que se lanzó de verdad (`olimpo.md`); `por defecto` si no se indicó modelo.
- `branch`, `worktree` y `head`: los que se comprueban con git, no los que dice el informe. `worktree` es lo que la limpieza tendrá que borrar.
- `attempts`: intentos de lanzamiento (reintentos incluidos). Límite en `95-multi-agent.md` §Reintentos.

## Estados de una unidad
`pending` → `dispatching` → `dispatched` → `reported` → `accepted` → `merged`
Salidas laterales: `rework` (vuelve a `dispatched`), `blocked`, `discarded`, `reverted` (se deshizo tras mergear).

## Cuándo escribir (siempre antes de actuar)
1. Al confirmar el plan: todas las unidades en `pending`, `status: active`.
2. **Antes** de lanzar un worker: `dispatching`. Después, con el id que devuelva el motor: `dispatched`. Así una caída entre los dos pasos no acaba en un doble lanzamiento: `dispatching` sin `ref` se comprueba antes de relanzar.
3. Al recibir el informe: `reported`. Al revisarlo: `accepted`, `rework` o `discarded`.
4. Tras cada merge: `merged` + sha en el log. Tras cerrar la ronda: línea en el log con el resultado de `csr-gate`.
5. Al terminar: `status: done` (o `cancelled`) y la rama final. `cleanup: done` si el usuario aprobó la limpieza y se hizo; `cleanup: pending` si dijo que no o si el merge final va por PR y aún no está fusionado.

## Reanudar
Al empezar, si existe algún `.work/runs/*/run.md` con `status: active` que encaja con la petición (misma feature, mismo plan), **no** planifiques de nuevo: reanuda. Si hay dudas sobre si es el mismo trabajo, una pregunta.
1. Lee `run.md`. Comprueba la rama de integración: `git log --oneline -1 <integration>` debe coincidir con el último merge del log. Si no, el log manda menos que git: reconcilia antes de seguir.
2. Reconcilia cada unidad no cerrada con su motor:
   | Motor | Cómo saber dónde está |
   |---|---|
   | orca | `orca orchestration run-use --id <orca_run> --json`, luego `task-list --json`, `worker-list --run <orca_run> --json` y `inbox --terminal run:<orca_run> --limit 50 --json` para el correo ya consumido. Un `worker_done` en el inbox que no está en el log ⇒ procésalo ahora |
   | subagents | Si tu entorno conserva el agente (por nombre o id), pregúntale por su estado. Si no: su worktree y su rama son la verdad (`git log <base>..<branch>`, `git status` en el worktree) |
   | manual | `<worktree>/.work/REPORT.md` y el estado git del worktree |
3. Unidad `dispatching` sin `ref`, o `dispatched` cuyo intento no se puede probar terminado: **no la relances a ciegas**. Con Orca, sigue `recovery-and-cleanup` de su guía (`worker-show`). En el resto, mira si hay trabajo en su rama antes de decidir.
4. Informa en una línea y sigue desde el paso del ciclo que toque: `ORCA: reanudado run <run> · ronda <r> · <k>/<n> unidades integradas`.
5. La confirmación 1 ya dada sigue valiendo para el resto del run, salvo que el plan cambie (unidades nuevas, otro alcance): entonces vuelve a pedirla.

## Cambiar de motor a mitad de run
Si un motor deja de responder (Orca cerrado, cuota agotada), lo pendiente puede seguir con otro: marca las unidades no lanzadas con el motor nuevo y continúa. Las unidades ya lanzadas en el motor caído se cierran antes en ese motor (o con `abandon` explícito del usuario); nunca hay dos intentos vivos de la misma unidad.
