#!/usr/bin/env bash
# Pruebas de omk update (sin red: --offline) y de la puesta al día de ORCHESTRATION.md con su plantilla,
# en un $HOME y un proyecto desechables y contra un doble del CLI de Orca (tests/fixtures/fake-orca.js).
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Estas variables apuntan a la configuración real (Orca las inyecta); heredadas, el $HOME desechable no aísla nada.
unset CLAUDE_CONFIG_DIR CODEX_HOME GEMINI_DIR AGENT_KIT_HOME ORCA_CLAUDE_INJECTED_CONFIG_DIR OMK_PAUSE
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok    %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$1"; }
# Si falla, enseña lo que dijo omk: en CI es la única pista.
check(){ if eval "$2"; then ok "$1"; else bad "$1"; if [ -s "${OUT:-}" ]; then sed "s/^/        │ /" "$OUT"; fi; fi; }

command -v node >/dev/null || { echo "  SKIPPED (sin node)"; exit 0; }

# Node en Windows no entiende rutas /c/...: las variables de entorno van en formato Windows.
wpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

W="$(mktemp -d "${TMPDIR:-/tmp}/omk-update.XXXXXX")"; trap 'rm -rf "$W"' EXIT
STATE="$W/orca-state.json"
export OMK_ORCA FAKE_ORCA_STATE NO_COLOR=1
OMK_ORCA="$(wpath "$ROOT/tests/fixtures/fake-orca.js")"
FAKE_ORCA_STATE="$(wpath "$STATE")"
PLUGIN_DIR="$(wpath "$ROOT/orca-plugin")"
# shellcheck disable=SC2034  # se usa dentro de eval (check)
PV="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$ROOT/orca-plugin/orca-plugin.json")"
KEY="local.multiagent-kit"
OUT="$W/out.txt"
TPL="$ROOT/templates/ORCHESTRATION.md"
H="$W/home"; mkdir -p "$H/.claude"
P="$W/proj"; mkdir -p "$P"
F="$P/ORCHESTRATION.md"

# omk update dentro del proyecto $P. En Windows, Node toma la carpeta del usuario de USERPROFILE.
update() { (cd "$P" && HOME="$H" USERPROFILE="$(wpath "$H")" node "$ROOT/bin/omk.js" update --offline --agents claude "$@") </dev/null >"$OUT" 2>&1; }
fresh()  { rm -f "$STATE" "$STATE.calls"; touch "$STATE.calls"; if [ -n "${1:-}" ]; then printf '%s' "$1" > "$STATE"; fi; }
# Estado previo con el plugin ya instalado: $1 versión, $2 estado
installed() { fresh "{\"plugins\":[{\"pluginKey\":\"$KEY\",\"version\":\"$1\",\"status\":\"$2\",\"source\":{\"kind\":\"local-path\",\"path\":$(node -p 'JSON.stringify(process.argv[1])' "$PLUGIN_DIR")}}]$3}"; }
called() { grep -qF -- "$1" "$STATE.calls"; }
said()   { grep -qF -- "$1" "$OUT"; }
has()    { grep -qF -- "$1" "$F"; }
line()   { grep -qxF -- "$1" "$F"; }
count()  { grep -cF -- "$1" "$F" || true; }
# Un ORCHESTRATION.md de una versión anterior del kit: sin §0, sin proveedores ni tablas de roles, con valores propios.
old_project() {
  cat > "$F" <<'EOF'
# ORCHESTRATION.md — Cómo se reparte el trabajo entre agentes
> Nota propia del equipo.

## 1. Reparto
- Máximo de workers simultáneos: 5
- Commits locales de workers: no

## 2. Shared — ficheros que solo toca una unidad por ronda o el coordinador
```
## esto no es una sección
Cargo.lock
```

## 3. Entorno de worktrees
- Dependencias: cargo fetch en cada worktree
- `PORT_BASE`: 4200

## 5. No delegar nunca
- Migraciones destructivas y facturación.
EOF
}
# sync <plantilla> <fichero>: lo añadido, una línea por apartado, y el fichero ya puesto al día.
# SYNC_FIRST=stamp: la primera vez (sin sello) no añade nada y solo sella, como con STACK.md.
sync() { node -e 'const r=require(process.argv[1]).syncFile(process.argv[2],process.argv[3],{firstRun:process.env.SYNC_FIRST||"add"});console.log(r.added.join("\n"))' "$ROOT/bin/sync.js" "$1" "$2" >"$OUT" 2>&1; }

echo "== ORCHESTRATION.md al día con la plantilla (bin/sync.js)"
old_project
check "añade lo que falta y lo cuenta"                 'sync "$TPL" "$F" && said "sección «0. Autonomía»" && said "§1. Reparto · «Proveedores activos»" && said "§1. Reparto · «Roles propios del proyecto»"'
check "lo escrito en el proyecto no cambia"            'line "- Máximo de workers simultáneos: 5" && line "- Commits locales de workers: no" && line "- Dependencias: cargo fetch en cada worktree" && line "- \`PORT_BASE\`: 4200" && line "> Nota propia del equipo." && line "- Migraciones destructivas y facturación."'
check "un campo que ya está no se duplica"             '[ "$(count "Máximo de workers simultáneos")" = 1 ] && [ "$(count "PORT_BASE")" = 1 ] && [ "$(count "Commits locales")" = 1 ]'
check "cada campo nuevo va junto a su vecino"          '[ "$(grep -n "Proveedores activos" "$F" | cut -d: -f1)" -lt "$(grep -n "Máximo de workers" "$F" | cut -d: -f1)" ] && [ "$(grep -n "Revisión cruzada" "$F" | cut -d: -f1)" -gt "$(grep -n "Commits locales" "$F" | cut -d: -f1)" ]'
check "las secciones nuevas van en su sitio"           '[ "$(grep -n "^## 0\. Autonomía" "$F" | cut -d: -f1)" -lt "$(grep -n "^## 1\. Reparto" "$F" | cut -d: -f1)" ] && [ "$(grep -n "^## 4\. Flujo" "$F" | cut -d: -f1)" -gt "$(grep -n "^## 3\. Entorno" "$F" | cut -d: -f1)" ] && [ "$(grep -n "^## 4\. Flujo" "$F" | cut -d: -f1)" -lt "$(grep -n "^## 5\. No delegar" "$F" | cut -d: -f1)" ]'
check "una sección renombrada casa por su número"      '[ "$(grep -c "^## 3\." "$F")" = 1 ] && has "## 3. Entorno de worktrees" && has "- Rama padre (destino del merge final)"'
check "un «## » dentro de un bloque no es una sección" '[ "$(grep -c "^## " "$F")" = 8 ] && [ "$(grep -A1 "^## esto no es" "$F" | tail -1)" = "Cargo.lock" ]'
check "omk team ya puede escribir en él"               '(cd "$P" && node "$ROOT/bin/omk.js" team set --provider claude --provider codex --role casandra=codex --autonomy auto) >"$OUT" 2>&1 && line "- Nivel: auto        <!-- manual | semi | auto -->" && has "| Rol Casandra | Casandra / codex | equipo (omk team) |"'
cp "$F" "$W/antes"
check "repetirlo no cambia nada"                       'sync "$TPL" "$F" && [ -z "$(tr -d "[:space:]" < "$OUT")" ] && cmp -s "$F" "$W/antes"'
cp "$TPL" "$F"
check "la plantilla sobre sí misma solo recibe el sello" 'sync "$TPL" "$F" && [ -z "$(tr -d "[:space:]" < "$OUT")" ] && head -n "$(wc -l < "$TPL" | tr -d " ")" "$F" | cmp -s - "$TPL" && [ "$(count "omk:plantilla")" = 1 ]'

echo "== el sello: lo borrado no vuelve y solo entra lo que la plantilla estrena"
old_project; sync "$TPL" "$F"
check "deja un sello al final, una sola vez"           '[ "$(count "<!-- omk:plantilla ")" = 1 ] && tail -n 1 "$F" | grep -q "^<!-- omk:plantilla [0-9a-f ]* · .*-->$"'
grep -v "Reintentos automáticos" "$F" > "$W/sin" && cp "$W/sin" "$F"
awk '/^## 4\. /{skip=1} /^## 5\. /{skip=0} !skip' "$F" > "$W/sin" && cp "$W/sin" "$F"
cp "$F" "$W/antes"
check "un campo y una sección borrados a propósito no vuelven" 'sync "$TPL" "$F" && [ -z "$(tr -d "[:space:]" < "$OUT")" ] && cmp -s "$F" "$W/antes"'
# Una plantilla posterior, con un campo y una sección que la anterior no tenía.
awk '{print} /^- Reintentos automáticos por unidad:/{print "- Campo que estrena la plantilla: valor"}' "$TPL" > "$W/tpl-nueva.md"
printf '\n## 7. Sección que estrena la plantilla\n- Otro campo: x\n' >> "$W/tpl-nueva.md"
check "lo que la plantilla estrena sí entra"           'sync "$W/tpl-nueva.md" "$F" && said "«Campo que estrena la plantilla»" && said "sección «7. Sección que estrena la plantilla»" && [ "$(wc -l < "$OUT" | tr -d " ")" = 2 ]'
check "y lo borrado sigue sin volver"                  '! has "Reintentos automáticos" && ! has "## 4. Flujo" && [ "$(count "omk:plantilla")" = 1 ]'
cp "$F" "$W/antes"
check "repetirlo con la plantilla nueva no cambia nada" 'sync "$W/tpl-nueva.md" "$F" && cmp -s "$F" "$W/antes"'
old_project; cp "$F" "$W/antes"
check "primera vez en modo sello: no añade nada, solo sella" 'SYNC_FIRST=stamp sync "$TPL" "$F" && [ -z "$(tr -d "[:space:]" < "$OUT")" ] && [ "$(count "omk:plantilla")" = 1 ] && head -n "$(wc -l < "$W/antes" | tr -d " ")" "$F" | cmp -s - "$W/antes"'
check "y después solo recibe lo que se estrene"        'SYNC_FIRST=stamp sync "$W/tpl-nueva.md" "$F" && said "«Campo que estrena la plantilla»" && ! has "## 0. Autonomía"'
old_project
node -e 'const fs=require("fs");const f=process.argv[1];fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(/\n/g,"\r\n"))' "$F"
check "respeta CRLF"                                   'sync "$TPL" "$F" && [ "$(grep -c $'"'"'\r$'"'"' "$F")" = "$(wc -l < "$F" | tr -d " ")" ]'
printf '## 1. Reparto\n- Dominios sensibles: pagos' > "$F"
check "una etiqueta acortada cuenta como la misma, y el final sin salto se conserva" 'sync "$TPL" "$F" && [ "$(count "Dominios sensibles")" = 1 ] && [ "$(tail -c 1 "$F" | wc -l | tr -d " ")" = 0 ]'
old_project; rm -f "$W/enlace.md"
if ln -s "$F" "$W/enlace.md" 2>/dev/null && [ -L "$W/enlace.md" ]; then
  cp "$F" "$W/antes"
  check "un enlace simbólico no se toca"               '! sync "$TPL" "$W/enlace.md" && said "no es un fichero normal" && cmp -s "$F" "$W/antes"'
fi

echo "== omk update en un proyecto del kit"
old_project
installed 0.0.1 running ""
check "termina bien"                                   'update'
check "reinstala la fuente única"                      '[ -f "$H/.agents/AGENTS.md" ] && [ "$(cat "$H/.agents/AGENT_KIT_VERSION")" = "$(cat "$ROOT/VERSION")" ]'
check "pone al día el proyecto"                        'grep -q "AGENTS:BEGIN project" "$P/AGENTS.md" && grep -qx "@AGENTS.md" "$P/CLAUDE.md" && [ -f "$P/STACK.md" ] && [ -f "$P/orca.yaml" ]'
check "añade a ORCHESTRATION.md lo nuevo de la plantilla" 'has "## 0. Autonomía" && has "- Proveedores activos:" && line "- Máximo de workers simultáneos: 5" && said "apartados nuevos" && said "sección «0. Autonomía»"'
check "sella STACK.md sin añadirle nada"               'grep -q "omk:plantilla" "$P/STACK.md" && [ "$(grep -c "^## " "$P/STACK.md")" = "$(grep -c "^## " "$ROOT/templates/STACK.md")" ]'
check "deja copia de lo que había"                     'said "omk restore" && [ -n "$(find "$H/.agents/backups" -name ORCHESTRATION.md -type f | head -1)" ] && grep -q "simultáneos: 5" "$(find "$H/.agents/backups" -name ORCHESTRATION.md -type f | head -1)" && ! grep -q "Autonomía" "$(find "$H/.agents/backups" -name ORCHESTRATION.md -type f | head -1)"'
check "actualiza el plugin de Orca instalado"          'called "plugin update $KEY" && grep -q "\"version\": \"$PV\"" "$STATE" && said "Kit al día"'
check "no abre Orca ni reinstala el plugin"            '! called "open" && ! called "plugin install"'
cp "$F" "$W/antes"
check "repetirlo no cambia el proyecto ni el plugin"   'update && cmp -s "$F" "$W/antes" && said "ya tiene todos los apartados" && [ "$(grep -cF "plugin update" "$STATE.calls")" = 1 ] && said "ya estaba instalado"'

echo "== omk install tras el update de una versión anterior (lo que lanza el omk update de la v1.6.0)"
# El omk update de la v1.6.0 instala el paquete nuevo y termina con «omk install»: con ~/.agents aún en la
# versión anterior y dentro de un proyecto del kit, install lo hace todo, como un update.
install_in() { (cd "$1" && HOME="$H" USERPROFILE="$(wpath "$H")" node "$ROOT/bin/omk.js" install --agents claude "${@:2}") </dev/null >"$OUT" 2>&1; }
old_project; printf '1.6.0\n' > "$H/.agents/AGENT_KIT_VERSION"; installed 0.0.1 running ""
check "sube de versión: pone al día también el proyecto" 'install_in "$P" && said "actualizo también este proyecto" && has "## 0. Autonomía" && line "- Máximo de workers simultáneos: 5" && called "plugin update $KEY" && [ "$(cat "$H/.agents/AGENT_KIT_VERSION")" = "$(cat "$ROOT/VERSION")" ]'
old_project; cp "$F" "$W/antes"
check "misma versión: install no toca el proyecto"     'install_in "$P" --no-plugin && ! said "actualizo también" && cmp -s "$F" "$W/antes"'
printf '1.6.0\n' > "$H/.agents/AGENT_KIT_VERSION"
check "--no-project lo deja como un install normal"    'install_in "$P" --no-plugin --no-project && ! said "actualizo también" && cmp -s "$F" "$W/antes"'
mkdir -p "$W/otra"; printf '1.6.0\n' > "$H/.agents/AGENT_KIT_VERSION"
check "fuera de un proyecto del kit, install normal"   'install_in "$W/otra" --no-plugin && ! said "actualizo también" && [ -z "$(ls -A "$W/otra")" ]'

echo "== omk update: plugin"
installed 0.0.1 running ',"updateNeedsApproval":true'
check "sin --yes ni terminal no aprueba y sale con error" '! update --no-project && said "Orca pide tu aprobación" && ! called "--approve" && said "terminado con fallos"'
check "--yes aprueba el plugin nuevo"                  'update --no-project --yes && called "plugin update $KEY --approve ap1-0123456789abcdef" && said "Kit al día"'
fresh
check "sin plugin instalado no lo instala y dice cómo" 'update --no-project && ! called "plugin install" && said "omk setup" && said "Kit al día"'
installed 0.0.1 running ',"reachable":false'
check "con Orca cerrado no lo abre"                    'update --no-project && ! called "open" && ! called "plugin update" && said "Orca está cerrado"'
installed 0.0.1 running ""
check "--no-plugin no habla con Orca"                  'update --no-project --no-plugin && [ ! -s "$STATE.calls" ]'

echo "== omk update: proyecto"
old_project; cp "$F" "$W/antes"
check "--no-project no toca el proyecto"               'update --no-project --no-plugin && cmp -s "$F" "$W/antes" && ! said "Plantillas del proyecto"'
check "--dry-run no escribe nada"                      'update --dry-run --no-plugin && cmp -s "$F" "$W/antes" && said "se añadirían" && said "Simulación"'
P="$W/otra"; mkdir -p "$P"
check "una carpeta que no es del kit no se prepara"    'update --no-plugin && [ -z "$(ls -A "$P")" ] && said "no es un proyecto preparado con el kit"'
P="$W/proj"

echo "== hooks de reparto de Claude Code (bin/hooks.js)"
SET="$H/.claude/settings.json"
# kit_hooks <settings.json>: cuántos hooks del kit hay en cada evento, «UserPromptSubmit=1 PostToolUse=1».
# shellcheck disable=SC2016  # el $ es de JavaScript
kit_hooks() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const n=(e)=>(j.hooks[e]||[]).flatMap((x)=>x.hooks||[]).filter((h)=>String(h.command).includes("[Orca Multiagent Kit]")).length;console.log("UserPromptSubmit="+n("UserPromptSubmit")+" PostToolUse="+n("PostToolUse"))' "$(wpath "$1")"; }
# shellcheck disable=SC2016  # el $ es de JavaScript
check "la plantilla es JSON con los dos hooks, en ASCII y sin nada que un shell expanda" 'node -e '"'"'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const cmds=[...j.hooks.UserPromptSubmit,...j.hooks.PostToolUse].flatMap((e)=>e.hooks.map((h)=>h.command));const ok=cmds.length===2&&j.hooks.PostToolUse[0].matcher==="ExitPlanMode"&&cmds.every((c)=>/^echo \x27[\x20-\x7e]*\x27$/.test(c)&&!/[$`]/.test(c)&&c.split("\x27").length===3&&c.includes("[Orca Multiagent Kit]"));process.exit(ok?0:1)'"'"' "$(wpath "$ROOT/templates/claude-settings.json")"'
# En la global va también la puerta obligatoria (tests/test_gate.sh): un hook más en UserPromptSubmit y en PostToolUse (sobre Skill).
check "omk update los deja en la configuración global" '[ "$(kit_hooks "$SET")" = "UserPromptSubmit=2 PostToolUse=2" ]'
check "y en el .claude/settings.json del proyecto"     '[ "$(kit_hooks "$W/proj/.claude/settings.json")" = "UserPromptSubmit=1 PostToolUse=1" ]'
printf '%s' '{"model":"x","hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"echo mio"}]}],"Stop":[{"hooks":[{"type":"command","command":"echo fin"}]}]}}' > "$SET"
check "conserva los hooks y ajustes que ya tenías"     'update --no-project --no-plugin && [ "$(kit_hooks "$SET")" = "UserPromptSubmit=2 PostToolUse=2" ] && grep -q "echo mio" "$SET" && grep -q "echo fin" "$SET" && grep -q "\"model\": \"x\"" "$SET" && said "hooks de reparto en"'
cp "$SET" "$W/antes"
check "repetirlo no los duplica ni cambia el fichero"  'update --no-project --no-plugin && cmp -s "$SET" "$W/antes" && said "hooks de reparto al día"'
check "deja copia del settings.json anterior"          '[ -n "$(find "$H/.agents/backups" -name settings.json -path "*.claude*" -type f | head -1)" ]'
# Un hook del kit con un texto antiguo se pone al día, sin tocar el del usuario que comparte entrada.
node -e 'const fs=require("fs");const f=process.argv[1];const j=JSON.parse(fs.readFileSync(f,"utf8"));const e=j.hooks.UserPromptSubmit.find((x)=>x.hooks.some((h)=>h.command.includes("[Orca Multiagent Kit]")));e.hooks=[{type:"command",command:"echo otro"},{type:"command",command:"echo [Orca Multiagent Kit] viejo"}];fs.writeFileSync(f,JSON.stringify(j))' "$(wpath "$SET")"
check "un hook del kit antiguo se sustituye"           'update --no-project --no-plugin && [ "$(kit_hooks "$SET")" = "UserPromptSubmit=2 PostToolUse=2" ] && ! grep -q "viejo" "$SET" && grep -q "echo otro" "$SET"'
printf '%s' '{ esto no es json' > "$SET"; cp "$SET" "$W/antes"
check "un settings.json que no es JSON no se toca"     'update --no-project --no-plugin && cmp -s "$SET" "$W/antes" && said "no lo toco"'
rm -f "$SET"
check "--no-hooks no los pone"                         'update --no-project --no-plugin --no-hooks && [ ! -e "$SET" ] && ! said "Puerta de reparto"'
check "OMK_NO_HOOKS=1 tampoco"                         'OMK_NO_HOOKS=1 update --no-project --no-plugin && [ ! -e "$SET" ]'
check "--dry-run dice lo que haría y no escribe"       'update --no-project --no-plugin --dry-run && [ ! -e "$SET" ] && said "se añadirían a"'

echo "== de dónde sale la versión nueva (bin/fetch.js)"
check "una copia suelta del kit no consulta npm: lo dice y reaplica" '(cd "$P" && HOME="$H" USERPROFILE="$(wpath "$H")" node "$ROOT/bin/omk.js" update --agents claude --no-project --no-plugin) </dev/null >"$OUT" 2>&1 && said "no viene de npm ni es el ejecutable" && said "Kit al día"'
# shellcheck disable=SC2016  # el $ es de JavaScript
check "reconoce npm, npx, el ejecutable y una copia"   'node -e '"'"'const f=require(process.argv[1]);const ok=f.kitSource("/usr/lib/node_modules/orca-multiagent-kit",false)==="npm"&&f.kitSource("C:/Users/u/AppData/Roaming/npm/node_modules/orca-multiagent-kit",false)==="npm"&&f.kitSource("/home/u/dev/orca-multiagent-kit",false)==="copy"&&f.kitSource("/home/u/.local/share/orca-multiagent-kit",true)==="exe"&&f.isTransientCopy("/home/u/.npm/_npx/ab12/node_modules/orca-multiagent-kit")&&!f.isTransientCopy("/usr/lib/node_modules/orca-multiagent-kit");process.exit(ok?0:1)'"'"' "$ROOT/bin/fetch.js"'
# shellcheck disable=SC2016  # el $ es de JavaScript
check "busca el omk global donde dice el entorno de npm, antes que en lo que imprime" 'node -e '"'"'const f=require(process.argv[1]);const p=require("path");const w=f.globalRoots({npm_config_global_prefix:"C:\\npm"},"win32");const u=f.globalRoots({npm_config_prefix:"/opt/npm"},"linux");process.exit(w[0]===p.join("C:\\npm","node_modules")&&u[0]===p.join("/opt/npm","lib","node_modules")?0:1)'"'"' "$ROOT/bin/fetch.js"'
# Una «release» servida en esta máquina: /releases/latest redirige al tag, y bajo él están el ejecutable y su .sha256.
# $1 versión que tiene · $2 versión publicada · $3 «bad» para publicar un SHA-256 que no es el suyo
# shellcheck disable=SC2016  # el $ es de JavaScript
exe_update() { node -e '
const [lib, target, have, latest, mode] = process.argv.slice(1);
const { fetchExecutable } = require(lib);
const body = Buffer.from("ejecutable nuevo v" + latest);
const sum = require("node:crypto").createHash("sha256").update(mode === "bad" ? "otro" : body).digest("hex");
const server = require("node:http").createServer((req, res) => {
  const dl = "/releases/download/v" + latest + "/omk-linux-x64";
  if (req.url === "/releases/latest") { res.writeHead(302, { location: "/releases/tag/v" + latest }); res.end(); }
  else if (req.url === dl) res.end(body);
  else if (req.url === dl + ".sha256") res.end(sum + "  omk-linux-x64\n");
  else { res.writeHead(404); res.end(); }
});
server.listen(0, "127.0.0.1", async () => {
  let code = 0;
  try {
    const got = await fetchExecutable({ version: have, target, base: "http://127.0.0.1:" + server.address().port, platform: "linux", arch: "x64" });
    console.log("instalada:", got);
  } catch (e) { console.log("error:", e.message); code = 1; }
  server.close(() => process.exit(code));
});' "$ROOT/bin/fetch.js" "$(wpath "$W/omk-exe")" "$1" "$2" "${3:-}" >"$OUT" 2>&1; }
printf 'ejecutable viejo' > "$W/omk-exe"
check "el ejecutable se sustituye por el de la última release" 'exe_update 1.6.0 1.7.0 && said "instalada: 1.7.0" && [ "$(cat "$W/omk-exe")" = "ejecutable nuevo v1.7.0" ] && [ ! -e "$W/omk-exe.new" ]'
check "si ya es la última no descarga nada"            'exe_update 1.7.0 1.7.0 && said "instalada: null" && [ "$(cat "$W/omk-exe")" = "ejecutable nuevo v1.7.0" ]'
check "un SHA-256 que no coincide no se instala"       '! exe_update 1.7.0 1.8.0 bad && said "no coincide con su SHA-256" && [ "$(cat "$W/omk-exe")" = "ejecutable nuevo v1.7.0" ] && [ ! -e "$W/omk-exe.new" ]'
# shellcheck disable=SC2016  # el $ es de JavaScript
check "solo descarga por HTTPS, o de esta máquina"     'node -e '"'"'require(process.argv[1]).fetchExecutable({version:"1.0.0",target:process.argv[2],base:"http://example.com",platform:"linux",arch:"x64"}).then(()=>process.exit(1),(e)=>process.exit(/solo HTTPS/.test(e.message)?0:1))'"'"' "$ROOT/bin/fetch.js" "$(wpath "$W/omk-exe")"'
# shellcheck disable=SC2016  # el $ es de JavaScript
check "sin ejecutable para la plataforma lo dice"      'node -e '"'"'require(process.argv[1]).fetchExecutable({version:"1.0.0",target:"x",platform:"linux",arch:"arm64"}).then(()=>process.exit(1),(e)=>process.exit(/no hay ejecutable publicado/.test(e.message)?0:1))'"'"' "$ROOT/bin/fetch.js"'

echo "== línea de cierre (--exit-marker, la que lee el plugin)"
check "termina con el comando y el código 0"           'update --no-project --no-plugin --exit-marker && [ "$(grep -c "^\[omk:fin\] update salida=0$" "$OUT")" = 1 ]'
check "un fallo lleva su código"                       '! OMK_ORCA="$(wpath "$W/no-existe.js")" update --no-project --exit-marker && grep -q "^\[omk:fin\] update salida=1$" "$OUT"'
check "vale para cualquier comando"                    'node "$ROOT/bin/omk.js" version --exit-marker >"$OUT" 2>&1 && grep -q "^\[omk:fin\] version salida=0$" "$OUT" && ! node "$ROOT/bin/omk.js" nada --exit-marker >"$OUT" 2>&1 && grep -q "^\[omk:fin\] nada salida=2$" "$OUT"'
check "sin la opción no sale"                          'node "$ROOT/bin/omk.js" version >"$OUT" 2>&1 && ! grep -q "omk:fin" "$OUT"'

echo "== versiones y copias de seguridad"
# shellcheck disable=SC2016  # el $ es de JavaScript
check "solo se actualiza a una versión posterior"      'node -e '"'"'const {newer}=require(process.argv[1]);process.exit(newer("1.7.0","1.6.9")&&newer("1.10.0","1.9.9")&&!newer("1.6.0","1.6.0")&&!newer("1.6.0","1.7.0")&&!newer("","1.0.0")?0:1)'"'"' "$ROOT/bin/update.js"'
check "la copia sigue el formato de omk restore"       'node -e '"'"'const {backupRel}=require(process.argv[1]);const p=require("path");const ok=backupRel(p.join("/home/u","dev","app","ORCHESTRATION.md"),"/home/u","linux")==="dev/app/ORCHESTRATION.md"&&backupRel("/srv/app/ORCHESTRATION.md".split("/").join(p.sep),"/home/u".split("/").join(p.sep),"linux")==="_abs/srv/app/ORCHESTRATION.md";process.exit(ok?0:1)'"'"' "$ROOT/bin/update.js"'

printf '\n%s ok · %s fallos\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
