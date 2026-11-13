# Changelog

Todos los cambios relevantes de este proyecto se documentan aquí.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [Versionado Semántico](https://semver.org/lang/es/).

## [Unreleased]

### Añadido
- **`omk run`, el motor determinista de los runs.** Lo mecánico de un run orquestado ya no depende de que el coordinador siga las referencias de memoria: `new`, `set`, `meta`, `log`, `status` y `list` llevan `run.md` respetando sus transiciones de estado; `plan` valida `units.md` y calcula rondas, solapes y si compensa; `start` hace la base fresca y crea la rama de integración con `--no-track`; `worktree` crea el de cada unidad desde la integración con sus `.env` de desarrollo; `check` comprueba el alcance contra `write`; `merge` ensaya con `merge-tree` y hace `--no-ff` sin push; `cleanup` hace el inventario y, con `--apply`, borra solo lo integrado y limpio. La skill `orca` dice qué orden toca en cada paso, y los pasos a mano siguen para quien no tenga `omk`. Detalle en `docs/ORQUESTADOR.md` §10; pruebas en `tests/test_run*.sh`.
- **Puerta de reparto obligatoria en Claude Code** (`hooks/orca-gate.cjs`, `omk gate on|off|status`). Recordar la regla no bastaba: el veredicto secuencial solo llegaba al chat en 4 de 16 ensayos y un reparto podía empezar sin esperar el «sí». Ahora, tras cargar la skill `orca`, Claude Code no edita el proyecto, no escribe desde la shell y no lanza workers hasta que el veredicto esté registrado (`echo "ORCA: …"`, porque el transcript le llega tarde al hook) y, si reparte, hasta que la persona responda al plan. Medido: 6 de 6 encargos con el veredicto antes de editar, sin denegaciones de más, y 2 de 2 repartos que esperan al «sí». Nunca bloquea por un fallo suyo. `omk setup`, `install` y `update` lo instalan en `~/.agents/hooks` y lo registran en `~/.claude/settings.json`; con el ejecutable y sin Node, lo ejecuta el propio `omk`. Pruebas en `tests/test_gate.sh`.
- **La orquestación se dispara también fuera de spec-kit.** Hasta ahora solo `/speckit.implement` tenía un disparador que no dependiera del criterio del agente (su hook `before_implement`); con un prompt normal, un plan nativo o un artefacto, casi siempre lo hacía todo un único agente. Ahora:
  - **Puerta de reparto** en el núcleo (`core/AGENTS.md` §6, «YOU MUST»): antes de la primera edición de un trabajo con 2 o más entregables separables se carga la skill `orca` y su veredicto queda en el chat en una línea `ORCA: …` (con el plan de rondas y antes de editar, si reparte). En los ensayos la skill se cargó siempre y los encargos grandes se repartieron; lo que no es fiable es que la línea `ORCA: secuencial` de los encargos pequeños llegue al chat (cifras en `docs/ORQUESTADOR.md` §9). El agente ya no tiene que estimar de memoria si «compensa» antes de cargarla: lo decide la skill, que ahora esboza las unidades aunque no haya `tasks.md`.
  - **Hooks de Claude Code** (`templates/claude-settings.json`): `UserPromptSubmit` recuerda la puerta en cada mensaje y `PostToolUse` sobre `ExitPlanMode`, al aprobar un plan. `omk setup`, `omk install` y `omk update` los fusionan en `~/.claude/settings.json` (y `omk init` / `omk update` / `kit-init`, en el `.claude/settings.json` del proyecto) sin tocar lo demás y con copia. `--no-hooks` u `OMK_NO_HOOKS=1` para que no los pongan.
  - Todo plan que escribe el agente (modo plan, `implementation_plan.md`, `planes/*.md`, artefacto) termina con una sección `Reparto`, que es lo que se ejecuta con «implementa el plan».
  - La cuenta de «¿compensa?» era demasiado cara para trabajos pequeños: con 10 min por unidad y 10 por ronda, dos unidades medianas nunca compensaban. Ahora son 5 y 5, y ante un empate se reparte (`rules/95-multi-agent.md`).
  - En Antigravity y Codex no hay hook: les aplica la regla del núcleo. Detalle y tabla de disparadores en `docs/ORQUESTADOR.md` §9.
- **Plugin v0.7.0 — acción en curso**: lo que lanzas desde el panel o la paleta (verificar, actualizar, inicializar, *Repartir* y los `omk team` de *Equipo*) se ve en el panel, encima de las pestañas: en curso, esperando tu respuesta, terminado o fallido, con las últimas líneas de su terminal. Antes solo decía que había abierto un terminal, y la API de plugins no deja traerlo al frente. Si `omk update` pide aprobar el plugin nuevo, se contesta con «Aprobar» o «Rechazar» desde la tarjeta. El seguimiento sobrevive al reinicio del plugin que provoca la propia actualización. Detalle en [`docs/PLUGIN-ORCA.md`](docs/PLUGIN-ORCA.md#acción-en-curso).
- **Un comando lo instala todo y otro lo actualiza todo, se instale como se instale**:
  - `npx orca-multiagent-kit setup` deja `omk` instalado (`npm install -g`) antes de seguir: el plugin de Orca lo usa desde el PATH y la copia de npx es temporal.
  - `curl … get.sh | bash` baja el ejecutable de tu sistema, comprueba su SHA-256 y hace `omk setup`; donde no hay ejecutable, sigue con el zip e `install.sh` y dice qué falta.
  - `omk update` sabe cómo llegó el kit: con npm instala la versión posterior; **el ejecutable se actualiza a sí mismo** (descarga el de la última release, comprueba su SHA-256 con el `.sha256` publicado y solo entonces se sustituye; solo HTTPS); una copia suelta (clon, zip) no se toca.
  - Después pone al día `~/.agents`, el proyecto de la carpeta actual y el plugin de Orca si está instalado. Ya no hace falta `omk setup` después de actualizar. Opciones: `--offline` (sin descargar nada), `--yes`, `--no-project`, `--no-plugin`, `--dry-run`, `--force`. Pruebas en `tests/test_update.sh`.
- **Plantillas de proyecto al día**: `omk update` añade a `ORCHESTRATION.md` las secciones y los campos que la plantilla tiene y el fichero no, sin tocar lo escrito y con copia en `~/.agents/backups/`. Al final deja un sello (`<!-- omk:plantilla … -->`) con los apartados ya ofrecidos: lo que borres a propósito no vuelve, y en adelante solo entra lo que la plantilla estrene. `STACK.md` recibe el mismo trato, salvo que la primera vez solo se sella.
- `omk install` también deja el plugin de Orca en la versión del kit si ya estaba instalado (`--no-plugin` para que no lo mire). Quien actualiza desde un `omk` anterior, que al acabar solo llama a `omk install`, se lleva así el plugin nuevo.
- `omk <comando> --exit-marker` escribe al salir `[omk:fin] <comando> salida=<código>`: es como el plugin sabe que un comando ha terminado y cómo.
- Escenarios del panel para `orca plugin check` y `orca plugin shot --scenario` (`orca-plugin/src/panel.check.ts`).

### Corregido
- `omk update` reinstalaba la versión de npm aunque fuera **anterior** a la que tenías (una copia de desarrollo o una versión aún sin publicar): ahora solo actualiza a una posterior, y una copia que no viene de npm no se sustituye por la de npm.
- `omk update` ya no enseña el aviso `DEP0190` de Node al llamar a npm en Windows, y sigue con el `omk` recién instalado por su ruta en vez de buscarlo en el PATH.
- `omk` ya no depende de lo que imprimen `npm root -g` y `npm prefix -g` para encontrar la carpeta global: npm tapa con «***» los tramos de una ruta que le parecen un secreto (un UUID, por ejemplo), y con una ruta así fallaban el arranque desde npx y la comprobación de permisos. Ahora usa primero el prefijo que npm pasa por el entorno.
- Plugin: un fallo al lanzar una acción desde el panel (sin workspace activo, agente de inicializar no válido, error de Orca) salía como «Hecho». Ahora sale como error.
- La pregunta de aprobación del plugin (`omk setup`, `omk plugin install`, `omk update`) ya no espera para siempre en un terminal que nadie mira: sin respuesta en 10 minutos cuenta como «no».
- Los mensajes del instalador nombran el comando que tienes: `omk …` con npm, npx o el ejecutable (con npx, `npx orca-multiagent-kit …`) y la ruta de `install.sh` con el zip, un clon o curl. Antes mezclaban `omk install` y `./install.sh --verify` sin mirar cómo se había lanzado.
- Documentación al día con lo que hace el código: la instalación por IA (`AI_INSTALL.md`) copiaba una instalación incompleta y esperaba un texto que `verify` no imprime; la guía visual solo conocía `./install.sh`; la web enseñaba una salida y unos comandos que ya no existen; al manual le faltaba una regla, y el README prometía en `install.sh` equivalentes de comandos que solo tiene `omk`.
- Web: cabeceras de tabla y etiquetas por debajo de 11 px, `kbd` sin aire y un salto de nivel de encabezado en la portada.

### Cambiado
- El plugin lanza `omk` con `--exit-marker`: necesita un `omk` de esta versión o posterior. Con uno anterior, la tarjeta lo explica y dice cómo actualizarlo.
- Viniendo de la 1.6.0: el botón *Actualizar kit* del plugin antiguo instala el `omk` nuevo, que ya actualiza también el plugin. Si Orca pide aprobar la versión nueva, la pregunta sale en el terminal de esa actualización (el plugin antiguo no la enseña): contéstala ahí, o ejecuta `omk update` en un terminal. A partir de ahí, el botón lo hace todo y la aprobación se contesta desde el panel.
- Los marcadores de los bloques de proyecto (`AGENTS:BEGIN project`, `AGENTS:BEGIN project-claude`) ya no llevan una versión escrita a mano, que se había quedado en v1.0.0.
- El gate de dependencias se llama `deps-audit` en todas partes (antes, `deps` en el núcleo y en el ejemplo del reporte).
- `omk init` dice «se conserva» en vez de «no se toca» de los ficheros que ya existían.

## [1.6.0] - 2026-11-12

### Añadido
- **`omk team`**: enseña y cambia el equipo de roles del proyecto en `ORCHESTRATION.md` §1 (proveedores activos, revisión cruzada, un proveedor fijo por rol de Olimpo y roles propios del proyecto) sin tocar lo escrito a mano. `--data` recibe el equipo entero en base64url (lo usa el panel). Pruebas en `tests/test_team.sh`.
- **Plugin v0.5.0**: orquestación sin spec-kit. Todo agente que Orca arranca con una tarea (crear un worktree con tarea, pestaña nueva, issue) pasa primero por la skill `orca`, que decide si compensa repartir (ajuste *Repartir al lanzar un agente con tarea*, activado por defecto).
- Panel del plugin en pestañas *Agentes*, *Repartir*, *Equipo* y *Kit*.
  - *Agentes*: cada agente con nombre (`U2 · Ariadna — Pagos` en los despachos del kit, el título de Orca o el agente que es), agrupados por run o workspace, los bloqueados primero; cada uno con su ficha (agente, unidad, rol y nivel, run, workspace, rama, carpeta, terminal o chat, último turno, desde cuándo) y un botón para ir a su workspace.
  - *Repartir*: lanza el coordinador con la skill `orca` desde lo que escribes, un plan del repo o spec-kit; las dos primeras no necesitan spec-kit.
  - *Equipo*: equipos predefinidos (Solo Claude, Claude + Codex revisor, Codex + Claude revisor) o personalizado; proveedores con casillas, un proveedor por rol de Olimpo y roles propios (nombre, qué hace, nivel, revisión, guardarraíl, proveedor). «Aplicar al proyecto» ejecuta `omk team set --data`.
  - Los agentes (inicializar, coordinador, proveedores) se eligen de una lista con el catálogo de Orca, no se escriben.
  - Avisos (ajuste *Avisos de agentes*) cuando un agente se bloquea y cuando terminan todas las unidades lanzadas de un run. El tooltip de la barra nombra a los agentes.
- **Plugin v0.6.0**: pestañas *Avisos*, *Worktrees* e *Historial*, iconos de agente y autonomía.
  - *Avisos*: la tarjeta del plan de rondas del coordinador, en colores, con «Sí, lánzalo» y «Pedir cambio», que se escriben en su terminal; y los agentes bloqueados o esperando, con las últimas líneas de su terminal y una caja para responderles. La skill `orca` escribe el plan en `.work/runs/<run>/plan.json` (`references/plan-card.md`) y el plugin lo lee del hook `agent.tool.after`.
  - Con el coordinador como chat de Orca (sin terminal), la tarjeta también sale y se contesta: el plugin lee `plan.json` del disco cuando el coordinador espera, y manda la respuesta por el buzón del Run de Orca (`orcaRun` en la tarjeta, `orca orchestration send` sin shell). La skill solo acepta esas respuestas para la confirmación 1.
  - *Worktrees*: los worktrees de la orquestación por run, con sus agentes, estado y modelo (de `--model`), y «Cambiar modelo» (`/model`) para un Claude Code que espera.
  - *Historial*: despachos, bloqueos, finales de unidad, runs terminados y lo que haces desde el panel; las 200 últimas entradas, guardadas en el plugin.
  - El logo de cada agente, los mismos que usa Orca y a su tamaño (16 px), delante de cada agente y cada worktree; uno genérico para los que no tienen.
  - Autonomía: en *Equipo*, la del proyecto (`ORCHESTRATION.md` §0); en *Repartir*, otra solo para ese run.
- **`omk team set --autonomy manual|semi|auto`**: cambia la línea `- Nivel:` de `ORCHESTRATION.md` §0; `omk team` la enseña.

### Corregido
- Plugin: el resultado de cada acción salía como «Consejo» (Orca pinta así un aviso sin título). Ahora dice «Hecho» o «No se pudo» y se puede cerrar.
- Plugin: los agentes salían «sin título» en el panel y en la barra. Cada cambio de estado sin título borraba el que ya se conocía; no se usaban ni el agente (`agents.list`, hook `agent.launch.before`, panel de los chats de Orca) ni el despacho del kit; y el workspace de los eventos (`<repo>::<ruta>`) no casaba con el de `workspace.list` (`identity:…`).

### Cambiado
- El plugin pide `workspace:write` (abrir el workspace de un agente) y observa el hook `agent.launch.before`; hay que volver a aprobarlo (`omk plugin install`).
- La v0.6.0 del plugin pide además `storage:own` (historial) y observa `agent.tool.after` (tarjeta del plan): otra aprobación.

## [1.5.0] - 2026-11-11

Orca listo de una vez: `omk setup`, un ejecutable sin Node y el plugin configurable desde un panel. Detalle en [`docs/EJECUTABLE.md`](docs/EJECUTABLE.md).

### Añadido
- **`omk setup`**: instala el kit, abre Orca si hace falta, enciende los plugins, instala (o actualiza, o aprueba) el plugin del kit y abre su panel. Enseña lo que pide el plugin y pregunta antes de aprobarlo; `--yes` lo aprueba de antemano, `--dry-run` simula, `--no-plugin` solo instala el kit.
- **`omk plugin install|status|uninstall`**: el plugin de Orca sin copiar comandos de `orca plugin`. No toca una versión instalada desde otra carpeta ni reactiva un plugin que desactivaste.
- **Ejecutable autónomo** (`omk-windows-x64.exe`, `omk-macos-arm64`, `omk-linux-x64`, Node SEA): con doble clic hace `omk setup`, se copia al `PATH` del usuario (en Windows, en el registro, conservando las variables sin expandir) y extrae el kit a una carpeta estable. `scripts/build-exe.js` lo construye; la release lo adjunta con su `.sha256`.
- **Panel *Multiagent Kit*** en el plugin (v0.2.0): verificar, inicializar y actualizar con un botón, los tres ajustes del plugin (los mismos de *Settings → Plugins*) y los agentes activos.
- Pruebas: `tests/test_orca.sh` (contra un doble del CLI de Orca), `tests/test_exe.sh` y las del panel; la CI construye y prueba el ejecutable en Linux, macOS y Windows.

### Cambiado
- La notificación «omk no está instalado» del plugin menciona el ejecutable y que hay que reiniciar Orca.

## [1.4.1] - 2026-11-11

### Corregido
- Proyectos inicializados con una versión anterior: ya no hace falta reinicializarlos para que la 1.4.0 funcione. La skill `orca` deduce en cada run lo que falte en la ficha (proveedores activos, dominios sensibles, setup de worktree, `.env` de desarrollo que no estén en `.worktreeinclude`, rama padre), lo usa, lo anota en el plan de rondas y ofrece guardarlo al cerrar. Con Orca, el despacho lleva el bloque `SETUP` si `orca.yaml` o `.worktreeinclude` no están al día.

## [1.4.0] - 2026-11-11

Olimpo: reparto por roles y niveles de modelo, y worktrees que nacen de una base fresca, listos para probar y sin residuos. Detalle en [`docs/OLIMPO.md`](docs/OLIMPO.md).

### Añadido
- **Olimpo** (`skills/orca/references/olimpo.md`): doce roles de agente (Hefesto, Dédalo, Casandra, Temis, Ariadna, Perséfone, Proteo, Narciso, Ícaro, Argos, Atlas, Clío), cada uno con su tipo de trabajo, nivel de modelo, revisión obligatoria y guardarraíl. Las 24 fichas del equipo de origen están en `docs/OLIMPO.md`.
- **Modelos por nivel** (`alto`, `medio`, `bajo`), sin nombres de modelo en el kit. La correspondencia por proveedor vive en `~/.agents/models.md`, fichero del usuario que el instalador crea una vez y no sobrescribe. En cada run la skill consulta los modelos del proveedor (por ejemplo `agy models`): una versión nueva de una familia conocida entra sola, y una familia nueva la clasifica el coordinador con evidencia (alias y changelog del proveedor, documentación pública), comprueba que la cuenta puede usarla y lo anota en el plan de rondas, sin preguntar al usuario.
- **Recurso por unidad** (`rules/95-multi-agent.md`): coordinador, subagente de solo lectura, subagente con worktree, worker de Orca o manual, decidido unidad a unidad. Un run puede mezclar motores.
- **Base fresca**: `git fetch` y comparación con `origin/<rama padre>` antes de crear la rama de integración; si la rama local va por detrás se parte de `origin`, y si tiene commits sin subir se pregunta. Se repite antes del merge final.
- **Entorno de worktree verificado**: setup real en `ORCHESTRATION.md` §3, `scripts.setup` en `orca.yaml`, bloque `SETUP` en los despachos sin Orca y comprobación en el arranque del worker (`BLOCKED: entorno`).
- **Confirmación 3, limpieza**: tras el merge final el coordinador enseña el inventario (worktrees, ramas, copias de `.env`) y lo borra con permiso. Si se rechaza, queda `cleanup: pending` en `run.md` y se recuerda en el siguiente run.
- Modo «limpia el run» en la skill `orca`, también para worktrees de runs antiguos.
- Instalador: al preparar un proyecto, un `.env` con señales de producción (`NODE_ENV=production`, claves `sk_live_`…) se desactiva en el `.worktreeinclude` nuevo y queda como pendiente; si el fichero ya era tuyo, solo avisa. No se muestra su contenido.
- `omk verify` comprueba que existen los roles de Olimpo y `~/.agents/models.md`.
- Guía visual y web: sección de Olimpo, recurso por unidad, base fresca y limpieza.
- Campos opcionales nuevos: `role`, `tier` y `engine` en las unidades; `base_ref`, `cleanup`, rol, modelo y worktree en `run.md`; línea `ROL:` en el despacho.

### Cambiado
- El plan de rondas enseña la base, el rol, el nivel, el modelo y el recurso de cada unidad.
- Plantilla `ORCHESTRATION.md`: la tabla «Agentes por capa» se sustituye por proveedores activos, dominios sensibles y excepciones. Las fichas existentes siguen valiendo: su tabla se lee como excepciones de proveedor.
- Motor Orca: `--setup run` y `--base-branch <rama de integración>` siempre; `--model` y `--effort` salen de `models.md` en vez de pasarse solo a petición.
- `.worktreeinclude` de plantilla incluye `.env`, `.env.local` y `.env.development.local`.
- Núcleo §6: la limpieza entra en las confirmaciones de `semi`, e invariante nueva sobre base fresca y residuos.

## [1.3.0] - 2026-11-07

Orquestador más robusto, plugin para la app Orca, instalador para Orca y Windows, y reglas de calidad (CSR) al día. Gracias a [Necro-Coder](https://github.com/Necro-Coder).

### Añadido
- Orquestador: runs reanudables con el estado en `.work/runs/<run>/run.md` (`skills/orca/references/ledger.md`); la skill y el hook de spec-kit retoman un run a medias en vez de repartir de nuevo. Detalle en [`docs/ORQUESTADOR.md`](docs/ORQUESTADOR.md).
- Orquestador: revisión cruzada por otro proveedor, presupuestos por talla, límite de reintentos y sección de confianza entre agentes en `95-multi-agent.md`.
- **Plugin de Orca** (`orca-plugin/`, Orca ≥ 1.4.248): comandos de paleta para verificar, inicializar y actualizar el kit; hook `agent.prompt.before` que añade la referencia al contrato del worker a los despachos de orquestación del kit; resumen de agentes activos en la barra de estado. Ver `docs/PLUGIN-ORCA.md`.
- **CSR**: módulo `rules/32-ai-security.md` (OWASP Top 10 for LLM Applications 2025 y Top 10 agéntico): agencia mínima de herramientas, salida del modelo, RAG, MCP y tests obligatorios. Detalle en [`docs/CSR.md`](docs/CSR.md).
- **CSR**: tres prohibiciones nuevas en el núcleo: usar APIs no verificadas, añadir dependencias sin comprobar el registro (*slopsquatting*) y obedecer instrucciones incrustadas en datos.

### Cambiado
- Motor Orca alineado con el CLI 1.4.252: sin polling de `check`, DAG con `task-create --deps`, `--spec-file`, `--base-branch`, decision gates, `--retry-of` y circuit breaker.
- Integración: alcance comprobado con git, ensayo de merge con `git merge-tree`, orden topológico y revert de una unidad. Campos opcionales nuevos en unidades (`budget`, `review`) e informes (`base`, `time`).
- **CSR**: CWE Top 25 actualizada a la lista oficial de 2025; herramientas obsoletas sustituidas (`tfsec` → `trivy config`, `depcheck` → `knip`, `poetry install --sync` → `poetry sync`); `40-testing` prohíbe relajar tests para ponerlos en verde; `50-done-gate` y `csr-gate` distinguen `SKIPPED` de `N/A`; `lang/shell` cubre Git Bash y PowerShell 5.1/7.
- **CSR**: el perfil técnico del usuario sale de `10-communication.md` y pasa a `~/.agents/rules/personal.md`.

### Corregido
- Instalador dentro de la app **Orca**: detecta el perfil de Claude que Orca inyecta en `CLAUDE_CONFIG_DIR`, instala en `~/.claude` (que el perfil importa) y no escribe nunca en el perfil.
- **Windows**: las rutas `C:\…` de `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_DIR`, `AGENT_KIT_HOME`, `--project` y `--adopt` se normalizan; Git Bash crea enlaces nativos (`winsymlinks:nativestrict`) o el instalador se para antes de tocar nada, en vez de dejar copias.
- Backups y `--restore` de rutas fuera de `$HOME` (antes se restauraban dentro de `$HOME`). `--restore` ya no borra enlaces ajenos al kit (dotfiles, perfiles de Orca).
- `--verify` distingue una copia (que acabará divergiendo) de un enlace que falta.
- `omk` en Windows ya no usa el `bash` de WSL por error (instalaría en el `$HOME` de Linux).
- Las pruebas aíslan `CLAUDE_CONFIG_DIR` y compañía: con solo un `HOME` desechable, escribían en la configuración real.
Detalle: [`docs/INSTALADOR-ORCA-WINDOWS.md`](docs/INSTALADOR-ORCA-WINDOWS.md).

## [1.2.0] - 2026-11-07

### Añadido
- **Salida nueva de `omk`**: spinner por fase, color lima, símbolos de estado (`+` creado, `=` sin cambios, `!` aviso) y tiempo total. Sin dependencias.
- El resumen final separa **Pendiente** (lo que tienes que hacer tú) de **Para tu información**, y acaba con los siguientes pasos (`omk verify`, `omk init`, `omk restore`).
- `omk verify` agrupa las comprobaciones por agente y da un total.
- Cursor: el instalador detecta si ya tienes la regla de usuario y deja de pedirla.
- `./install.sh` sin `omk` muestra la misma estructura en texto, con color en terminal.
- `omk update` compara con la última versión de npm y, si no tienes permisos (instalación con `sudo`), explica cómo arreglarlo en vez de mostrar el error de npm.
- La release se publica sola al fusionar en `main` un cambio de `VERSION` (GitHub y npm).
- `check.sh` detecta `$VAR` pegado a un carácter no ASCII, que rompe bash 3.2 en macOS.

### Corregido
- `omk init` en un proyecto con spec-kit fallaba con «Directory not found: ~/.agents/speckit-ext/orca» si aún no se había ejecutado `omk install` con esta versión. Ahora usa la extensión del propio kit y avisa de que falta `omk install`.
- macOS: un mensaje con `«$FIX»` cortaba el instalador (bash 3.2 tomaba `«` como parte del nombre de la variable).
- «deshacer» solo aparece cuando hay copia de seguridad que restaurar.
- Banner: la barra de carga del pie, que no representaba nada, se sustituye por las skills que instala el kit.

### Cambiado
- Publicado en npm: `npx orca-multiagent-kit install` y `npm i -g orca-multiagent-kit`, sin el prefijo `github:`.
- Las releases publican en npm con Trusted Publishing (OIDC), sin tokens guardados en el repo.

## [1.1.0] - 2026-11-07

Orquestación automática: ya no hace falta conocer ni invocar fases. Escribes `/speckit.implement` (o pides la tarea con normalidad) y el kit decide si compensa repartirla.

### Añadido
- Skill **`orca`**: punto de entrada único al desarrollo orquestado. El agente la usa por iniciativa propia cuando una tarea tiene partes independientes. Decide si compensa, divide, reparte, vigila e integra.
- **Niveles de autonomía** en `ORCHESTRATION.md` (`manual`, `semi`, `auto`). Por defecto, `semi`: solo se confirman el plan de rondas y el merge final.
- **Extensión de spec-kit `orca`** (`speckit-extension/orca`) con hook `before_implement` obligatorio: `/speckit.implement` reparte las user stories si compensa y, si no, sigue como siempre. La skill `speckit-orca-implement` resuelve el comando en cualquier agente.
- `kit-init`, `omk init` e `install.sh --project` activan el hook en proyectos con `.specify/`.
- Rama de integración por run (`feat/<feature>`): los merges intermedios nunca tocan la rama por defecto.

### Cambiado
- Las 8 skills `maw-*` pasan a ser referencias internas de `orca` (`skills/orca/references/`). El instalador retira las antiguas.
- Con Orca, el contrato del worker ya no duplica lo que Orca inyecta (`worker_done`, preguntas, heartbeats); solo se añaden las reglas de alcance.
- Núcleo §6: orquestación proactiva, autonomía y nueva invariante (nunca merge a la rama por defecto ni push sin confirmación).

### Eliminado
- Skills `maw-route`, `maw-brief`, `maw-plan`, `maw-dispatch`, `maw-worker`, `maw-integrate`, `maw-race` y `maw-setup` (consolidadas en `orca`).

## [1.0.0] - 2026-11-07

Primera versión de **Orca Multiagent Kit**. Une CSR (Claude Session Rules, de [Necro-Coder](https://github.com/Necro-Coder)) y MAW (Multi-Agent Work) en una fuente única para varios proveedores.

### Añadido
- Fuente única en `~/.agents/` (`AGENTS.md`, `rules/`, `skills/`, `templates/`, `output-styles/`), leída por Claude Code, Antigravity, Codex, Copilot CLI, Cursor y Devin mediante import, enlace simbólico o lectura nativa.
- **MAW — Multi-Agent Work**: regla `95-multi-agent` y skills `maw-route`, `maw-brief` (adaptadores spec-kit, plan en fichero, plan nativo, chat y artefacto), `maw-plan`, `maw-dispatch` (motores Orca, subagentes y manual), `maw-worker`, `maw-integrate`, `maw-race` y `maw-setup`.
- Skill `kit-init`: inicializa o migra un proyecto con un solo prompt (reglas, detección del stack y orquestación).
- Plantillas de proyecto: `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md`), `ORCHESTRATION.md`, `orca.yaml`, `.worktreeinclude`.
- `install.sh`: detección de agentes, migración desde instalaciones previas de CSR/MAW con backup, `--verify`, `--restore`, `--adopt`, `--dry-run`, `--project`. Compatible con bash 3.2 (macOS).
- `GUIA.html`: guía visual del flujo de trabajo.
- Convivencia con skills externas (impeccable, supabase, spec-kit, Orca): precedencia por terreno en el núcleo.
- Batería de pruebas del instalador (`tests/`), comprobaciones estáticas (`scripts/check.sh`) y CI en Linux y macOS.
- Releases con zip descargable y `SHA256SUMS`.

### Cambiado (respecto a CSR original)
- El núcleo de CSR se unifica a partir de sus dos copias (Claude y Antigravity). Se conservan las mejoras de la versión de Antigravity: prefijos `BLOCKED`/`CONFLICT`/`DEFERRED`, sin tablas decorativas y excepciones de brevedad.
- Las reglas usan rutas neutrales (`~/.agents/rules/…`) en vez de las de cada agente.
- `idioma-siempre` pasa al núcleo (§1) y `comunicacion-densa` se fusiona en `10-communication`.
- Nivel técnico del usuario en `10-communication`: perfil fullstack.

### Corregido
- Claude Code cargaba en cada sesión todas las reglas copiadas en `~/.claude/rules/` (unas 29), lo que anulaba la carga progresiva de CSR. Ahora las reglas viven fuera de las carpetas que los agentes cargan automáticamente.

### Eliminado
- Copias duplicadas de reglas y skills `csr-*` dentro de cada agente, y el plugin `claude-session-rules` de Antigravity.

[Unreleased]: https://github.com/FernandoBaqueroo/orca-multiagent-kit/compare/v1.6.0...HEAD
[1.6.0]: https://github.com/FernandoBaqueroo/orca-multiagent-kit/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/FernandoBaqueroo/orca-multiagent-kit/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/FernandoBaqueroo/orca-multiagent-kit/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/FernandoBaqueroo/orca-multiagent-kit/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/FernandoBaqueroo/orca-multiagent-kit/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/FernandoBaqueroo/orca-multiagent-kit/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/FernandoBaqueroo/orca-multiagent-kit/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/FernandoBaqueroo/orca-multiagent-kit/releases/tag/v1.0.0
