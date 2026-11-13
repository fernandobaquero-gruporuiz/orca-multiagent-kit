#!/usr/bin/env bash
# Comprobaciones estáticas del kit: sintaxis, skills, versiones y rutas neutrales.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
FAIL=0
err(){ printf '  FAIL  %s\n' "$1"; FAIL=1; }
ok(){ printf '  ok    %s\n' "$1"; }

echo "== sintaxis bash"
for f in bin/*.js bin/run/*.js hooks/*.cjs scripts/*.js tests/fixtures/*.js; do
  node --check "$f" 2>/dev/null && ok "$f" || { command -v node >/dev/null && err "$f"; }
done
for f in install.sh scripts/*.sh tests/*.sh; do bash -n "$f" && ok "$f" || err "$f"; done
# bash 3.2 (macOS) lee un carácter no ASCII pegado a $VAR como parte del nombre: «$FIX»» falla con set -u. Usa ${VAR}.
for f in install.sh scripts/*.sh tests/*.sh; do
  if LC_ALL=C grep -nE '\$[A-Za-z_][A-Za-z0-9_]*[^ -~]' "$f" | LC_ALL=C grep -vqE '^[0-9]+:[[:space:]]*#' ; [ "${PIPESTATUS[1]}" -eq 0 ]; then err "$f: \$VAR pegado a un carácter no ASCII (usa \${VAR})"; fi
done

echo "== skills (frontmatter estándar SKILL.md)"
for f in skills/*/SKILL.md; do
  d="$(basename "$(dirname "$f")")"
  [ "$(sed -n '1p' "$f")" = "---" ] || { err "$f: sin frontmatter"; continue; }
  n="$(sed -n 's/^name: //p' "$f" | head -1)"
  desc="$(sed -n 's/^description: //p' "$f" | head -1)"
  [ "$n" = "$d" ] || err "$f: name '$n' no coincide con la carpeta"
  [ -n "$desc" ] || err "$f: sin description"
  [ "${#desc}" -le 1024 ] || err "$f: description > 1024 caracteres"
  case "$desc" in *'<'*|*'>'*) err "$f: description con < o >";; esac
  # La description es un escalar YAML sin comillas: «: » o « #» dentro la rompen y el agente se queda sin ella.
  case "$desc" in *': '*|*' #'*) err "$f: description con «: » o « #» (rompe el YAML del frontmatter)";; esac
done
ok "$(ls -d skills/*/ | wc -l | tr -d ' ') skills revisadas"

echo "== skills listadas en install.sh y en el núcleo"
for d in skills/*/; do s="$(basename "$d")"
  grep -Eq "^KIT_SKILLS=\"([^\"]* )?$s( |\")" install.sh || err "$s no está en KIT_SKILLS de install.sh"
  grep -q "\`$s\`" core/AGENTS.md || err "$s no está en el router de core/AGENTS.md"
done
ok "todas las skills están en install.sh y en el router"

echo "== versión coherente"
V="$(tr -d '[:space:]' < VERSION)"
echo "$V" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || err "VERSION no es SemVer: $V"
grep -q "v$V" core/AGENTS.md || err "core/AGENTS.md no menciona v$V"
grep -q "## \[$V\]" CHANGELOG.md || err "CHANGELOG.md no tiene la sección [$V]"
grep -q "V$V" assets/banner.svg 2>/dev/null || python3 - "$V" <<'EOF' || err "assets/banner.svg no corresponde a v$V (ejecuta scripts/banner.py assets)"
import sys,subprocess,tempfile,pathlib
d=tempfile.mkdtemp(); subprocess.run([sys.executable,'scripts/banner.py',d],check=True)
sys.exit(0 if pathlib.Path(d,'banner.svg').read_text()==pathlib.Path('assets/banner.svg').read_text() else 1)
EOF
PV="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json)"
[ "$PV" = "$V" ] || err "package.json ($PV) no coincide con VERSION ($V)"
grep -q "<span id=\"ver\">v$V</span>" site/index.html || err "site/index.html: el pie no dice v$V"
ok "versión $V"

echo "== Olimpo (roles con nivel válido, modelos solo en models.md)"
OL=skills/orca/references/olimpo.md
NROL=0
while IFS= read -r line; do
  NROL=$((NROL+1))
  lvl="$(printf '%s' "$line" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/,"",$4); print $4}')"
  case "$lvl" in alto|medio|bajo) ;; *) err "$OL: rol sin nivel válido (alto|medio|bajo): $(printf '%s' "$line" | cut -c1-60)" ;; esac
done <<EOF
$(grep -E '^\| \*\*' "$OL")
EOF
[ "$NROL" -ge 10 ] || err "$OL: solo $NROL roles (se esperan al menos 10)"
for lvl in alto medio bajo; do
  grep -Eq "^\| $lvl \|" templates/models.md || err "templates/models.md: falta la fila del nivel $lvl"
  grep -Eq "^\| \`$lvl\` \|" "$OL" || err "$OL: falta la definición del nivel $lvl"
done
# El kit no nombra versiones de modelo: caducan. Los nombres viven en ~/.agents/models.md, que es del usuario.
MODEL_ID='(claude-(opus|sonnet|haiku)-[0-9]|gpt-[0-9]|gemini-[0-9]|o[0-9]-(mini|pro))'
if grep -rnEi "$MODEL_ID" core rules skills templates >/dev/null; then
  grep -rnEi "$MODEL_ID" core rules skills templates | sed 's/^/  /'; err "versión concreta de un modelo en reglas, skills o plantillas"
fi
grep -q 'Agentes por capa' templates/ORCHESTRATION.md && err "templates/ORCHESTRATION.md conserva la tabla «Agentes por capa» (el reparto sale de olimpo.md)"
for f in SKILL.md references/units.md references/ledger.md references/integrate.md; do
  grep -q 'olimpo\|role\|cleanup' "skills/orca/$f" || err "skills/orca/$f no enlaza con Olimpo ni con la limpieza"
done
ok "$NROL roles · 3 niveles · sin versiones de modelo en el kit"
# omk team y el panel Equipo del plugin llevan su propia lista de roles: debe ser la de Olimpo sin Hefesto.
OLROLES="$(grep -E '^\| \*\*' "$OL" | sed -E 's/^\| \*\*([^*]+)\*\*.*/\1/' | grep -vx 'Hefesto' | sort | tr '\n' ' ')"
TEAMROLES="$(grep -oE "\['[a-z]+', '[^']+'\]" bin/team.js | sed -E "s/.*, '([^']+)'\]/\1/" | sort | tr '\n' ' ')"
PLUGROLES="$(grep -oE "name: '[^']+', work:" orca-plugin/src/kit.ts | sed -E "s/name: '([^']+)'.*/\1/" | sort | tr '\n' ' ')"
[ "$TEAMROLES" = "$OLROLES" ] || err "bin/team.js (ROLES) no lista los roles de $OL: ${TEAMROLES}≠ ${OLROLES}"
[ "$PLUGROLES" = "$OLROLES" ] || err "orca-plugin/src/kit.ts (TEAM_ROLES) no lista los roles de $OL: ${PLUGROLES}≠ ${OLROLES}"
ok "omk team y el plugin conocen los mismos roles que Olimpo"

echo "== rutas neutrales (sin ~/.claude/rules ni ~/.gemini/rules en reglas y skills)"
# shellcheck disable=SC2088  # se busca el texto literal "~/", no una ruta
if grep -rnE '~/\.(claude|gemini)/rules' core rules skills templates output-styles >/dev/null; then
  # shellcheck disable=SC2088
  grep -rnE '~/\.(claude|gemini)/rules' core rules skills templates output-styles | sed 's/^/  /'; err "rutas específicas de un agente"
else ok "sin rutas específicas"; fi

echo "== plugin de Orca (manifiesto, sin Orca; la validación completa es \`orca plugin validate orca-plugin\`)"
if command -v node >/dev/null; then
  node - orca-plugin <<'EOF' && ok "orca-plugin/orca-plugin.json" || err "orca-plugin/orca-plugin.json"
const fs = require('fs'), path = require('path')
const dir = process.argv[2], problems = []
let m
try { m = JSON.parse(fs.readFileSync(path.join(dir, 'orca-plugin.json'), 'utf8')) } catch (e) { console.error(`  ${e.message}`); process.exit(1) }
const c = m.contributes || {}
if (m.manifestVersion !== 2) problems.push('manifestVersion debe ser 2')
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(m.id || '') || m.id.startsWith('orca-')) problems.push(`id no válido o reservado: ${m.id}`)
if (!/^\d+\.\d+\.\d+$/.test(m.version || '')) problems.push(`version no es SemVer: ${m.version}`)
if (!/^>=\d+\.\d+\.\d+$/.test((m.engines || {}).orca || '')) problems.push('engines.orca debe ser >=x.y.z')
if (m.main && !fs.existsSync(path.join(dir, m.main))) problems.push(`main no existe: ${m.main}`)
for (const p of c.panels || []) if (!fs.existsSync(path.join(dir, p.entry))) problems.push(`panels.${p.id}: entry no existe: ${p.entry}`)
const ids = new Set((c.commands || []).map((x) => x.id))
for (const item of c.statusBarItems || []) if (item.command && !ids.has(item.command)) problems.push(`statusBarItems.${item.id}: comando ${item.command} no declarado`)
const kinds = new Set((m.capabilities || []).map((x) => x.kind))
if ((c.settings || []).length && !kinds.has('settings:own')) problems.push('settings sin la capacidad settings:own')
problems.forEach((p) => console.error(`  ${p}`))
process.exit(problems.length ? 1 : 0)
EOF
else ok "plugin de Orca sin comprobar (no hay node)"; fi

echo "== tamaño del núcleo (≤ 200 líneas)"
n="$(wc -l < core/AGENTS.md | tr -d ' ')"; [ "$n" -le 200 ] && ok "$n líneas" || err "core/AGENTS.md tiene $n líneas"

[ "$FAIL" -eq 0 ] && echo "TODO OK" || { echo "HAY FALLOS"; exit 1; }
