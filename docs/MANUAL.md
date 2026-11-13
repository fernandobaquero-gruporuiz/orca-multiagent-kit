# Orca Multiagent Kit — Una sola fuente de reglas y skills para todos tus agentes

Une **CSR** (claude_session_rules: calidad, seguridad, tests, hablar poco) y **MAW** (trabajo multiagente sin pisarse) en **un único sitio**, `~/.agents/`, que leen a la vez Claude Code, Antigravity, Codex, Copilot CLI, Cursor y Devin.

> **Empieza por `GUIA.html`** (ábrela en el navegador): el flujo de trabajo explicado de forma visual. Si eres una IA y te han pedido instalar o integrar esto: lee `AI_INSTALL.md`.

---

## 1. Qué problemas arregla

| Problema con CSR + MAW sueltos | Qué hace el kit |
|---|---|
| CSR copiado dos veces (`~/.claude` y `~/.gemini`) y ya distinto: la versión de Antigravity tenía reglas que la de Claude no tenía (idioma, comunicación densa, sin tablas decorativas) | Un solo núcleo, `~/.agents/AGENTS.md`, que une lo mejor de las dos versiones |
| **Claude Code carga en cada sesión todos los `.md` de `~/.claude/rules/`**. Las 12 reglas y los 17 lenguajes de CSR estaban ahí, así que la "carga progresiva" no funcionaba en Claude: pagabas todos esos tokens en cada mensaje | Las reglas viven en `~/.agents/rules/`, que ningún agente carga solo; se leen bajo demanda, como CSR pretendía |
| Rutas distintas por agente (`~/.claude/rules/…` frente a `~/.gemini/rules/…`) reescritas a mano | Rutas neutrales: `~/.agents/…` en todas partes |
| `csr-*` duplicadas: copias en `~/.claude/skills` y un plugin aparte en Antigravity | Una copia en `~/.agents/skills/` y enlaces simbólicos |
| `idioma-siempre.md` y `comunicacion-densa.md` repetidos dentro de `GEMINI.md` y como ficheros sueltos | Idioma en el núcleo (§1); comunicación fusionada en `10-communication.md` |
| Solo Claude y Antigravity | Claude Code, Antigravity, Codex, Copilot CLI, Cursor y Devin |

---

## 2. Cómo funciona

```
                         ~/.agents/                  ← LA ÚNICA FUENTE
                         ├── AGENTS.md               núcleo (~80 líneas, siempre cargado)
                         ├── rules/  00…95, lang/    bajo demanda
                         ├── skills/ csr-*, orca, kit-init (+ las tuyas: orca-cli, supabase…)
                         ├── templates/              plantillas de proyecto
                         └── output-styles/

 Claude Code   ~/.claude/CLAUDE.md          → bloque con  @~/.agents/AGENTS.md   (import oficial)
               ~/.claude/skills/<skill>     → enlace a ~/.agents/skills/<skill>
 Antigravity   ~/.gemini/GEMINI.md          → enlace a ~/.agents/AGENTS.md
               ~/.gemini/config/skills/…    → enlaces a ~/.agents/skills/…
 Codex         ~/.codex/AGENTS.md           → enlace      · skills: lee ~/.agents/skills de serie
 Copilot CLI   ~/.copilot/copilot-instructions.md → enlace · skills: lee ~/.agents/skills de serie
 Devin CLI     ~/.config/devin/AGENTS.md    → enlace (solo con --agents devin)
 Cursor        skills: lee ~/.agents/skills de serie · reglas: una línea en Settings → Rules
```

Editas `~/.agents/AGENTS.md` o una skill **una vez** y todos los agentes ven el cambio. No hay copias que se puedan desincronizar.

En **cada proyecto**, `AGENTS.md` es el fichero de reglas, porque lo leen todos los agentes. `CLAUDE.md` solo contiene `@AGENTS.md`: cuando existen los dos, Claude Code lee `CLAUDE.md` en lugar de `AGENTS.md`.

---

## 3. Qué hay dentro

```
orca-multiagent-kit/
├── GUIA.html                 guía visual del flujo (ábrela en el navegador)
├── README.md · AI_INSTALL.md · VERSION · install.sh
├── core/AGENTS.md            núcleo: precedencia, idioma, respuesta, stack, puerta de validez,
│                             prohibiciones, multiagente, router
├── rules/                    00-router · 10-communication · 20-clean-code · 30-security ·
│   └── lang/ (17)            31-security-audit · 32-ai-security · 40-testing · 50-done-gate ·
│                             60-git-workflow · 70-performance · 75-reliability · 80-supply-chain ·
│                             90-docs-comments · 95-multi-agent
├── skills/                   kit-init · csr-stack · csr-gate · csr-audit
│                             orca (entrada única) · speckit-orca-implement (hook)
├── speckit-extension/orca/   hook before_implement de spec-kit
├── output-styles/csr-minimal.md   (estilo de salida de Claude Code)
└── templates/                AGENTS.md · CLAUDE.md · STACK.md · ORCHESTRATION.md · orca.yaml ·
                              .worktreeinclude · claude-settings.json · models.md
```

---

## 4. Instalación (y migración desde CSR / MAW sueltos)

Lo normal es un solo comando, y los tres caminos acaban en `omk setup`: `npx orca-multiagent-kit setup` (Node ≥ 18; deja `omk` instalado con `npm install -g`), el ejecutable de la release (sin Node; se abre y ya) o `curl -fsSL https://raw.githubusercontent.com/FernandoBaqueroo/orca-multiagent-kit/main/scripts/get.sh | bash` (sin Node; baja ese ejecutable y comprueba su SHA-256). `omk setup` instala las reglas y las skills, deja `omk` en el PATH y, si usas Orca, instala su plugin y abre su panel. Después tienes `omk update` (lo actualiza todo), `omk init`, `omk verify`, `omk adopt`, `omk restore` y `omk team`. `omk install` hace solo la parte de `~/.agents`.

Sin Node y sin ejecutable para tu sistema, con el zip o un clon se instalan las reglas y las skills (no hay `omk` ni plugin de Orca):

```bash
cd ~/Documents/orca-multiagent-kit
chmod +x install.sh
./install.sh --dry-run          # qué haría, sin tocar nada
./install.sh                    # instala para los agentes detectados y migra lo antiguo
./install.sh --verify           # comprueba enlaces y que no queden copias divergentes
```

Más opciones:
```bash
./install.sh --project ~/Dev/mi-app        # además, migra o prepara un proyecto
./install.sh --project-only ~/Dev/otra-app
./install.sh --agents claude,antigravity,codex
./install.sh --agents devin                # Devin es opcional: también lee ~/.claude/CLAUDE.md
./install.sh --restore 20261107-091500     # deshace una instalación desde su backup
./install.sh --adopt ~/.gemini/config/plugins/user-workflows/skills/impeccable   # skill externa → multiproveedor
```

### Qué hace exactamente
1. **Backup** de todo lo que toca en `~/.agents/backups/<fecha>/`, con las mismas rutas relativas a tu carpeta personal. `--restore` lo devuelve a su sitio.
2. Copia núcleo, reglas, skills, plantillas y estilo a `~/.agents/`. Solo reemplaza **sus** skills: `orca-cli`, `orchestration`, `supabase` y el resto se quedan como están. Si creas `~/.agents/rules/personal.md`, no lo toca nunca. Crea `~/.agents/models.md` (qué modelo usa cada nivel en cada proveedor) solo si no existe; si ya lo tienes, tampoco lo toca.
3. **Claude Code**: quita de `CLAUDE.md` los bloques CSR y MAW, pone el bloque con el import y **conserva el resto** de lo que tuvieras escrito. Saca de `~/.claude/rules/` los ficheros de CSR y MAW (los tuyos se quedan), enlaza las skills y el output style.
4. **Antigravity**: `GEMINI.md` pasa a ser un enlace al núcleo. Retira las reglas copiadas de `~/.gemini/rules/`, las plantillas y el plugin `claude-session-rules` (todo va al backup) y enlaza las skills en `~/.gemini/config/skills/`.
5. **Codex / Copilot / Devin**: enlazan su fichero global de instrucciones al núcleo. Sus skills ya las leen desde `~/.agents/skills/`.
6. **Cursor**: no guarda las reglas de usuario en ficheros. El instalador te da la línea para pegar en **Settings → Rules → User Rules**.
7. **Proyecto** (`--project`): reescribe `AGENTS.md` y `CLAUDE.md` con el formato del kit y **migra tus "Overrides de este proyecto"** del bloque CSR antiguo. Crea `STACK.md`, `ORCHESTRATION.md`, `orca.yaml`, `.worktreeinclude` y `.claude/settings.json` si faltan, y añade `.work/` al `.gitignore`. Si un `.env` del proyecto parece de producción, lo desactiva en el `.worktreeinclude` nuevo y te lo deja como pendiente.

Reinstalar es idempotente: sirve también para actualizar después de editar el kit.

### Actualizar (`omk update`)
Un solo comando pone al día todo lo que el kit instala, en este orden:

1. **El kit**, según cómo lo instalaste. Con npm, si hay una versión posterior publicada, la instala y sigue con ella. Con el ejecutable, descarga el de la última release junto a sí mismo, comprueba que su SHA-256 es el del `.sha256` publicado y solo entonces se sustituye. Una copia suelta (un clon, el zip) no se toca: se actualiza como la obtuviste. `--offline` se salta este paso y reaplica la versión que ya tienes.
2. **`~/.agents`**: lo mismo que `omk install`.
3. **El proyecto de la carpeta actual**, si está preparado con el kit (tiene `ORCHESTRATION.md` o el bloque del kit en `AGENTS.md`): lo mismo que `omk init` y, además, añade a `ORCHESTRATION.md` las secciones y los campos que la plantilla tiene y tu fichero no. Solo añade: lo que escribiste no se cambia, no se mueve y no se borra, y cada campo nuevo entra junto a su vecino con el valor de la plantilla, para que lo revises (o se lo pidas al agente con «inicializa el proyecto»). La versión anterior queda en `~/.agents/backups/` (`omk restore <fecha>`). Al final del fichero queda un sello (`<!-- omk:plantilla … -->`) con los apartados de la plantilla que ya se le han ofrecido: lo que borres a propósito no vuelve, y en adelante solo entra lo que la plantilla estrene. `STACK.md` recibe el mismo trato, salvo que la primera vez solo se sella, porque su plantilla pide borrar lo que no aplique. `orca.yaml` y `.worktreeinclude` no se tocan si existen. `--no-project` se salta este paso.
4. **Los hooks de reparto de Claude Code**, si usas Claude Code: en `~/.claude/settings.json` y en el `.claude/settings.json` del proyecto quedan dos hooks del kit (`UserPromptSubmit` y `PostToolUse` sobre `ExitPlanMode`) que recuerdan al agente que un trabajo con 2 o más entregables pasa por la skill `orca` antes de editar. Es lo que hace que la orquestación se dispare con un prompt o un plan, y no solo con spec-kit. Se fusionan sin tocar tus otros hooks ni ajustes, con copia; un `settings.json` que no sea JSON válido no se toca. `--no-hooks` u `OMK_NO_HOOKS=1` los omiten. En la configuración global va además la **puerta obligatoria** (`~/.agents/hooks/orca-gate.cjs`): tras cargar la skill `orca`, Claude Code no edita el proyecto hasta que el veredicto `ORCA: …` esté registrado y, si reparte, hasta que respondas al plan de rondas. `omk gate off` la apaga sin tocar los recordatorios, `omk gate on` la vuelve a encender y `omk gate status` dice cómo está. Detalle en [`ORQUESTADOR.md`](ORQUESTADOR.md) §9. Una vez repartido, lo mecánico del run (estado, rondas, worktrees, alcance, merge y limpieza) lo hace `omk run` en vez del agente de memoria ([`ORQUESTADOR.md`](ORQUESTADOR.md) §10; `omk run help`).
5. **El plugin de Orca**, si está instalado y Orca está abierto: lo deja en la versión del kit. Si la versión nueva necesita tu aprobación, la pide como `omk plugin install` (`--yes` la da de antemano; sin respuesta en 10 minutos cuenta como «no»). No abre Orca ni instala un plugin que no tenías: eso es `omk setup`. `--no-plugin` se salta este paso.

`--dry-run` enseña lo que haría sin escribir nada. Desde Orca es el botón *Actualizar kit* del panel, que enseña la salida y te deja aprobar el plugin sin ir al terminal ([`PLUGIN-ORCA.md`](PLUGIN-ORCA.md#acción-en-curso)).

### Después de instalar
- **Reinicia** Claude Code y Antigravity (y Codex o Copilot si los usas).

### Proyectos nuevos o antiguos: un solo prompt
Abre el agente en el repo y escribe **«inicializa el proyecto»** (skill `kit-init`). No hace falta terminal ni el instalador:
1. Crea o migra `AGENTS.md` (con tus overrides del CSR antiguo) y deja `CLAUDE.md` como `@AGENTS.md`.
2. Si `STACK.md` falta o está vacío, ejecuta `csr-stack`: **detecta el stack** leyendo manifiestos, configuración, versiones y comandos reales del repo. No necesitas describirle nada.
3. Prepara la orquestación: `ORCHESTRATION.md` (nivel de autonomía, proveedores activos, dominios sensibles y el setup real de cada worktree), `orca.yaml`, `.worktreeinclude`, `.work/` en `.gitignore` y, si hay spec-kit, el hook `before_implement`. Si a `~/.agents/models.md` le falta un proveedor activo, clasifica sus modelos en niveles y lo rellena.
4. Te hace como máximo 4 preguntas en una tanda (lo que no se puede deducir: nivel ASVS, proveedores activos…) y propone el commit.

Si el agente detecta un repo sin `AGENTS.md` o sin `STACK.md`, te ofrecerá `kit-init` él solo. Desde la terminal, `./install.sh --project <ruta>` hace la parte de ficheros, pero la detección del stack la sigue haciendo el agente.

---

## 5. Uso diario

Igual que antes; lo único que cambia es dónde vive cada cosa.

| Situación | Qué escribes |
|---|---|
| Repo nuevo o con CSR antiguo | «inicializa el proyecto» → `kit-init` |
| Feature con spec-kit | `/speckit.specify` → `plan` → `tasks` y luego **`/speckit.implement` como siempre**. El hook decide si se reparte |
| Feature grande sin spec | Pídela con normalidad. Si tiene partes independientes, `orca` propone el reparto sola |
| Quieres un plan antes | «planifica X en sprints» (`orca`, modo plan) |
| Bug raro | «carrera entre Claude y Gemini» (`orca`, modo carrera) |
| No quieres que se reparta | «hazlo tú solo» |
| Cerrar una tarea | «pasa los gates» (`csr-gate`) |
| Antes de publicar o tocar algo sensible | «audita la seguridad» (`csr-audit`) |

**Autonomía** (`ORCHESTRATION.md` §0): `semi` por defecto. Confirmas el plan de rondas (autoriza los commits del run en ramas de trabajo), el merge final y la limpieza de worktrees y ramas; en medio solo te interrumpe por decisiones de producto. `manual` confirma cada ronda; `auto`, solo el merge final y la limpieza. Nunca hay merge a la rama por defecto, push ni borrado de worktrees o ramas sin confirmación.

**Roles y modelos** ([`OLIMPO.md`](OLIMPO.md)): cada unidad lleva un rol y un nivel de modelo (`alto`, `medio`, `bajo`). El modelo concreto de cada nivel y proveedor está en `~/.agents/models.md`, que es tuyo: el instalador lo crea si falta y no lo sobrescribe. Para cambiar qué modelo usa un nivel, edita ese fichero; no hay que reinstalar.

El detalle está en `skills/orca/SKILL.md` y sus `references/`, y en `rules/95-multi-agent.md`.

---

## 6. Cómo cambiar reglas a partir de ahora

| Quieres cambiar… | Edita | Y luego |
|---|---|---|
| Una regla global (todos los agentes) | `~/Documents/orca-multiagent-kit/core/AGENTS.md` o `rules/…` | `./install.sh` |
| Una regla solo tuya que el kit no debe pisar | `~/.agents/rules/personal.md` | nada: el núcleo lo lee |
| Qué modelo usa cada nivel en cada proveedor | `~/.agents/models.md` | nada: `orca` lo lee en cada run |
| Una skill | `~/Documents/orca-multiagent-kit/skills/<skill>/` | `./install.sh` |
| Reglas de un proyecto | `AGENTS.md` del proyecto, sección *Overrides* | nada |

Puedes editar directamente en `~/.agents/`, pero la próxima reinstalación lo sobrescribirá. La fuente de verdad es el kit; si lo versionas en git, tienes historial y lo sincronizas entre ordenadores (`git pull && ./install.sh`).

**Una regla, un sitio**: no copies reglas en `CLAUDE.md`, `GEMINI.md` ni en las reglas de Cursor. Esas copias son justo las que acaban divergiendo.

---

## 7. Convivencia con skills externas

| Skill | Dónde vive | Cómo convive |
|---|---|---|
| `impeccable` (diseño UI) | Hoy, dentro del plugin `user-workflows` de Antigravity: **solo la ve Antigravity** | Prefijos distintos, sin choques de nombre. Su `audit` es de diseño, a11y y rendimiento; `csr-audit` es de seguridad, así que se complementan. `orca` la usa en las unidades de UI y pasa su `audit` antes de cerrar una ronda con UI, y sus `PRODUCT.md`/`DESIGN.md` van a la lista `shared`. Para que la vean todos los agentes: `./install.sh --adopt <su carpeta>` |
| `supabase`, `supabase-postgres-best-practices` | `~/.agents/skills` | Sin cambios. Complementan `31-security-audit` (RLS) y `75-reliability` (migraciones) |
| `orca-cli`, `orchestration` | `~/.agents/skills` | Sin cambios. `orca` las carga para los comandos exactos de tu Orca |
| spec-kit (`speckit-*`) | Proyecto / plugin | No se modifica. La extensión `orca` añade un hook `before_implement`, y `orca` lee su `tasks.md` |
| Plugins de Antigravity (`android-cli`, `chrome-devtools`, `user-workflows`) | `~/.gemini/config/plugins` | No se tocan. Solo se retira el plugin `claude-session-rules`, que duplicaba CSR |

**Regla de precedencia** (núcleo §0): una skill externa manda en su terreno cuando la invocas o encaja con la tarea. Por ejemplo, impeccable puede "ir a por todas" en diseño aunque el núcleo pida brevedad en el chat. La puerta de validez (§4) y las prohibiciones (§5) se aplican siempre.

**`--adopt`** mueve la skill a `~/.agents/skills/` y deja un enlace en su sitio original, así el plugin la sigue encontrando. Después la enlaza en Claude y Antigravity. Si la skill se actualiza con su propio instalador, vuelve a adoptarla.

## 8. Avisos

- **Claude Code en Cowork** (app de escritorio): por seguridad, no carga imports de fuera de la carpeta de trabajo. En la CLI y en el IDE el import funciona. Si usas Cowork para programar, abre allí la carpeta del proyecto: su `AGENTS.md` (vía `CLAUDE.md`) indica que hay que leer `~/.agents/AGENTS.md`.
- **Cursor** lee también `~/.claude/skills` por compatibilidad, así que puede mostrar las skills dos veces. Son enlaces al mismo contenido, así que no hay riesgo de divergencia.
- **Devin** lee también `~/.claude/CLAUDE.md`. Por eso es opcional.
- **Antigravity**: si al arrancar se queja del plugin `claude-session-rules` ausente, desactívalo en sus ajustes. Su contenido ya está en el núcleo.
- **Nivel técnico** (`rules/10-communication.md`): la versión anterior te describía como "backend avanzado (Python, Kubernetes…)". Ahora pone fullstack con tu stack real. Ajústalo si no te encaja.
- **Windows (Git Bash)**: el kit necesita enlaces simbólicos nativos. Activa el *Modo de desarrollador* (Configuración → Sistema → Para programadores) o abre Git Bash como administrador. Si no se pueden crear, el instalador se para antes de tocar nada; nunca deja copias. Detalle en [`INSTALADOR-ORCA-WINDOWS.md`](INSTALADOR-ORCA-WINDOWS.md).
- **Claude dentro de la app Orca**: Orca lanza Claude con un perfil propio (`CLAUDE_CONFIG_DIR=…/orca/claude-profiles/<id>/home`) que importa `~/.claude/CLAUDE.md`. El instalador lo detecta, instala en `~/.claude` y no toca el perfil, así que puedes ejecutarlo desde una terminal de Orca.
- **Permisos**: Orca y Antigravity ejecutan sin confirmación. Copia solo `.env` de desarrollo a los worktrees (`.worktreeinclude`) y revisa los permisos que tiene guardados Antigravity. Las copias se borran con el worktree, en la limpieza que el coordinador te pide confirmar al cerrar cada run.
- **Worktrees de runs antiguos**: si quedan worktrees o ramas de un run que no se limpió, di «limpia el run». El agente enseña el inventario y borra solo lo integrado y sin cambios pendientes, tras tu «sí».

---

## 9. Verificación funcional (en cada agente)

| Pregunta | Respuesta correcta |
|---|---|
| «¿Qué dice la sección 4 de tus reglas globales?» | La puerta de validez en 8 fases |
| «¿Dónde están tus reglas de seguridad?» | `~/.agents/rules/30-security.md` |
| «Hola, ¿qué tal?» (en inglés) | Responde en español de España, breve |
| «Inicializa el proyecto» en un repo sin AGENTS.md | `kit-init`: detecta el stack, crea los ficheros, pregunta ≤4 cosas |
| «Añade un botón de logout» | Lo hace directamente (sin MAW) y pasa los gates |
| `/speckit.implement` en una spec con varias stories independientes | El hook `orca` muestra el plan de rondas y espera tu «sí» |

---

## 10. Desinstalar

```bash
./install.sh --restore <fecha-del-primer-backup>   # vuelve al estado anterior
rm -rf ~/.agents/AGENTS.md ~/.agents/rules ~/.agents/templates ~/.agents/output-styles ~/.agents/models.md
rm -rf ~/.agents/skills/csr-* ~/.agents/skills/orca ~/.agents/skills/kit-init ~/.agents/skills/speckit-orca-implement ~/.agents/speckit-ext
```

---

## 11. Base documental
- Claude Code, memoria, imports y `~/.claude/rules`: https://code.claude.com/docs/en/memory
- Cursor, skills: https://cursor.com/docs/skills
- Codex, AGENTS.md y skills: https://learn.chatgpt.com/docs/customization/overview
- Copilot CLI, configuración y skills: https://docs.github.com/en/copilot/concepts/customizations/agent-skills
- Devin CLI, reglas: https://docs.devin.ai/cli/extensibility/rules
- Orca: https://www.onorca.dev/docs
- Normas de seguridad: ver la base documental del README de CSR v1 (OWASP Top 10 2025, ASVS 5.0, CWE Top 25).
