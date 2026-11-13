# Motor: manual (worktrees + humano)

Para cuando no hay Orca ni subagentes, o se mezclan proveedores sin Orca.

## 1. Crear worktrees
Desde tu checkout, por cada unidad de la ronda, a partir del commit base de la ronda (la rama de integración tras el último merge):
```bash
omk run worktree <run> U2          # ../<repo>.wt/<run>/u2 en la rama wt/<run>/u2, con los .env de .worktreeinclude, anotado en run.md
# sin omk: git worktree add ../<repo>.wt/<run>/u2 -b wt/<run>/u2 <sha-base>
```
`omk run worktree` solo copia de `.worktreeinclude` ficheros ignorados por git, dentro del checkout, sin enlaces ni `..`, y nunca uno cuyo nombre parezca de producción (lo dice con `RISK:`).
`<sha-base>` es el commit de la rama de integración, que nació de una base fresca (`SKILL.md` §4); nunca el de una rama local sin contrastar con `origin`.
Después, **en cada worktree, ejecuta tú el setup** de `ORCHESTRATION.md` §3: sin `omk`, copia los ficheros de `.worktreeinclude` desde el checkout principal (solo `.env` de desarrollo); en los dos casos, instala dependencias o enlaza los directorios compartidos. Comprueba que el comando `install`/`typecheck` de `STACK.md` §3 pasa antes de dejar el brief. Anota la ruta del worktree como `ref` en `run.md` (`ledger.md`).

## 2. Dejar el brief
Escribe el mensaje de despacho completo (con `worker-contract.md` entero) en `<worktree>/.work/BRIEF.md` (dentro del worktree, ignorado por git) y en `.work/runs/<run>/briefs/<unit>.md` del principal.

## 3. Instrucciones al usuario (una sola vez, en bloque)
```
Abre un agente en cada carpeta y pégale: «Lee .work/BRIEF.md y ejecútalo: es una unidad de un run orquestado con su contrato. Entrega el informe en .work/REPORT.md»
U1 → ../<repo>.wt/<run>/u1  (Claude Code, modelo <medio de models.md>)
U2 → ../<repo>.wt/<run>/u2  (Antigravity, modelo <alto de models.md>)
Cuando terminen, dime «ronda lista».
```

## 4. Recoger
Cada worker escribe su informe en `<worktree>/.work/REPORT.md`. Léelos, cópialos a `.work/runs/<run>/reports/` y pasa a la integración (`integrate.md`). Una unidad sin `REPORT.md` no está terminada, aunque haya cambios en su rama: pregunta al usuario por ella en vez de integrarla.

## 5. Limpieza
Tras el merge final y con la confirmación 3: `integrate.md` §6.
