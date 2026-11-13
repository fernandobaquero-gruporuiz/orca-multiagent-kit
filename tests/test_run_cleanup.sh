#!/usr/bin/env bash
# Pruebas de omk run cleanup (bin/run/cleanup.js) en repositorios git desechables: inventario desde git,
# ensayo que no cambia nada y --apply que borra solo lo integrado y limpio, con casos hostiles.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok    %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$1"; }
check(){ if eval "$2"; then ok "$1"; else bad "$1"; if [ -s "${OUT:-}" ]; then sed "s/^/        │ /" "$OUT"; fi; fi; }

command -v node >/dev/null || { echo "  SKIPPED (sin node)"; exit 0; }
command -v git >/dev/null || { echo "  SKIPPED (sin git)"; exit 0; }

W="$(mktemp -d "${TMPDIR:-/tmp}/omk-cleanup.XXXXXX")"; trap 'rm -rf "$W"' EXIT
W="$(cd "$W" && pwd -P)"   # en macOS /var es un enlace a /private/var, y git lista la ruta real
R="$W/repo"; OUT="$W/out.txt"
export NO_COLOR=1 GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
# Rutas como las escribe git (en Windows, C:/…): es lo que guarda run.md.
mpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
omk() { (cd "${CWD:-$R}" && node "$ROOT/bin/omk.js" run "$@") </dev/null >"$OUT" 2>&1; }
g() { git -C "$R" "$@"; }
# Lo que git sabe del repositorio: si no cambia, el ensayo no ha tocado nada.
snapshot() { { g worktree list --porcelain; g for-each-ref --format='%(refname) %(objectname)'; } > "$1"; }
row() { grep -F "$1" "$OUT" | grep -F "$2" >/dev/null; }
commit_in() { (cd "$1" && echo "$2" > "$2.txt" && git add "$2.txt" && git commit -qm "$2"); }

RUN=20261113-limpieza
WT="$W/repo.wt/$RUN"
git init -q -b main "$R"
(cd "$R" && printf '.env\n.work/\n' > .gitignore && echo a > a.txt && git add . && git commit -qm init)
g switch -q -c feat/int
# Remoto sin red: origin/HEAD apunta a «desarrollo» (rama por defecto) y base_ref nombra origin/padre.
g remote add origin "$W/sin-red"
g symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/desarrollo
g branch desarrollo; g branch padre
# u11: integrada pero con upstream (publicada) → se queda.
g branch "wt/$RUN/u11"; g update-ref refs/remotes/origin/u11 HEAD; g branch -q -u origin/u11 "wt/$RUN/u11"
# u13: integrado y limpio, pero su unidad sigue en reported → se queda.
g worktree add -q "$WT/u13" -b "wt/$RUN/u13"
# Worktree que una celda de run.md reclama para otra rama → no es de esa unidad, se queda.
g worktree add -q "$W/celda-ajena" -b ajena

# u1: integrado, limpio y con un .env ignorado → se borra con su rama.
g worktree add -q "$WT/u1" -b "wt/$RUN/u1"; commit_in "$WT/u1" u1; echo 'NO_LEER=1' > "$WT/u1/.env"
# u2: integrado pero con un cambio sin commit → se queda.
g worktree add -q "$WT/u2" -b "wt/$RUN/u2"; commit_in "$WT/u2" u2; echo cambio >> "$WT/u2/a.txt"
# u3: con un commit sin integrar → se queda.
g worktree add -q "$WT/u3" -b "wt/$RUN/u3"
# u4: bloqueado, integrado y en una ruta con espacios → se queda.
g worktree add -q "$W/con espacios/u4" -b "wt/$RUN/u4"; g worktree lock "$W/con espacios/u4"
# u7: integrado pero con un fichero no versionado → se queda.
g worktree add -q "$WT/u7" -b "wt/$RUN/u7"; echo nuevo > "$WT/u7/nuevo.txt"
# u9: su carpeta desapareció (prunable) → se queda y se sugiere git worktree prune.
g worktree add -q "$WT/u9" -b "wt/$RUN/u9"; mv "$WT/u9" "$W/u9-movido"
# Agente con rama sin el prefijo del run: solo lo une al run la celda de run.md.
g worktree add -q "$W/agente" -b worktree-agent-x; commit_in "$W/agente" agente
# Worktree ajeno al run: no aparece ni se toca.
g worktree add -q "$W/otro" -b otra
# Ramas sin worktree: una con nombre raro e integrada, otra sin integrar.
g branch "wt/$RUN/u5+x.y_z"
g branch "wt/$RUN/u6"; g worktree add -q "$W/tmp6" "wt/$RUN/u6"; commit_in "$W/tmp6" u6; g worktree remove "$W/tmp6"
for b in "wt/$RUN/u1" "wt/$RUN/u2" "wt/$RUN/u4" "wt/$RUN/u7" worktree-agent-x; do g merge -q --no-ff "$b" -m "merge $b"; done
commit_in "$WT/u3" u3
# Carpeta normal que run.md dice que es un worktree: nunca se borra.
mkdir -p "$W/no-es-worktree"; echo valioso > "$W/no-es-worktree/dato.txt"

D="$R/.work/runs/$RUN"; mkdir -p "$D"
cat > "$D/run.md" <<EOF
# run $RUN
- input: chat
- engine: subagents
- autonomy: semi
- integration: feat/int
- base_ref: origin/padre @ abc1234
- cleanup: —
- status: closing
- confirm1: —

| unit | round | status | role | agent · model | ref | branch | worktree | base | head | attempts | updated |
|---|---|---|---|---|---|---|---|---|---|---|---|
| U0 | 0 | merged | Hefesto | coordinador | coordinador | feat/int | (principal) | — | — | 1 | 10:00 |
| U1 | 1 | merged | Ariadna | claude | agent:u1 | wt/$RUN/u1 | $(mpath "$WT/u1") | — | — | 1 | 10:00 |
| U8 | 1 | merged | Proteo | claude | agent:u8 | worktree-agent-x | $(mpath "$W/agente") | — | — | 1 | 10:00 |
| U9 | 1 | discarded | Proteo | claude | agent:u9 | -D | $(mpath "$W/no-es-worktree") | — | — | 1 | 10:00 |
| U10 | 1 | discarded | Proteo | claude | agent:u10 | main | (Orca) | — | — | 1 | 10:00 |
| U12 | 1 | merged | Proteo | claude | agent:u12 | worktree-agent-y | $(mpath "$W/celda-ajena") | — | — | 1 | 10:00 |
| U13 | 1 | reported | Proteo | claude | agent:u13 | wt/$RUN/u13 | $(mpath "$WT/u13") | — | — | 1 | 10:00 |
| U14 | 1 | merged | Proteo | claude | agent:u14 | desarrollo | (Orca) | — | — | 1 | 10:00 |
| U15 | 1 | merged | Proteo | claude | agent:u15 | padre | (Orca) | — | — | 1 | 10:00 |

## Log
- 10:00 run creado
EOF
cp "$D/run.md" "$W/run.antes"

echo "== uso"
check "sin run.md ni --integration sale con 2"                 'omk cleanup 20261113-viejo; [ $? -eq 2 ] && grep -q -- "--integration" "$OUT"'
check "una rama de integración que no existe sale con 1"       'omk cleanup $RUN --integration no-existe; [ $? -eq 1 ] && grep -q "no existe" "$OUT"'
check "un nombre de integración hostil sale con 2"             'omk cleanup $RUN --integration=-x; [ $? -eq 2 ]'
check "un id de run que escapa de .work/runs sale con 2"       'omk cleanup ../fuera; [ $? -eq 2 ]'

echo "== ensayo (sin --apply)"
snapshot "$W/antes"
check "el ensayo sale con 0 y enseña la tabla"                 'omk cleanup $RUN && grep -q "^tipo .*| nombre .*| estado .*| acción" "$OUT"'
check "u1: limpio e integrado, se borra; el .env cuenta sin nombrarse" 'row "$(mpath "$WT/u1")" "| borrar" && grep -q "1 ignorado" "$OUT" && ! grep -q "NO_LEER" "$OUT"'
check "u2: con cambios sin commit se queda"                     'row "$(mpath "$WT/u2")" "se queda — se perderían los cambios sin commit"'
check "u3: con commits sin integrar se queda"                   'row "$(mpath "$WT/u3")" "1 commit sin integrar"'
check "u4: bloqueado y con espacios se queda"                   'row "con espacios/u4" "se queda — está bloqueado"'
check "u7: un no versionado cuenta como cambio y se queda"      'row "$(mpath "$WT/u7")" "1 cambio sin commit"'
check "u9: ruta desaparecida se queda y sugiere prune"          'row "$(mpath "$WT/u9")" "git worktree prune" && grep -q "^aviso: hay worktrees cuya carpeta ya no existe" "$OUT"'
check "worktree de agente (por su celda de run.md) se borra"    'row "$(mpath "$W/agente")" "| borrar" && row "rama     | worktree-agent-x" "| borrar"'
check "rama con nombre raro e integrada se borra"               'row "wt/$RUN/u5+x.y_z" "| borrar"'
check "rama sin integrar se queda"                              'row "wt/$RUN/u6 " "no está integrada en feat/int"'
check "rama de un worktree que se queda, se queda"              'row "wt/$RUN/u2 " "que se queda"'
check "celda de run.md que no es worktree: se informa y no se toca" 'row "$(mpath "$W/no-es-worktree")" "no es un worktree de git: no se toca"'
check "celda de rama hostil (-D) no se toma por rama"           'row "| -D " "no existe como rama local"'
check "rama por defecto de una celda: no se toca nunca"         'row "rama     | main " "no se toca nunca"'
check "ni la integración ni el worktree ajeno salen"            '! grep -q "| feat/int " "$OUT" && ! grep -q "$(mpath "$W/otro")" "$OUT" && ! grep -q "| otra " "$OUT"'
check "rama por defecto de origin/HEAD (sin --short) protegida"  'row "rama     | desarrollo " "rama por defecto"'
check "rama padre del run (base_ref sin el remoto) protegida"   'row "rama     | padre " "rama padre del run"'
check "rama con upstream protegida aunque esté integrada"       'row "wt/$RUN/u11 " "tiene upstream (refs/remotes/origin/u11)"'
check "celda worktree con otra rama: no es de esa unidad"       'row "$(mpath "$W/celda-ajena")" "se queda — la ruta de run.md no es de esta unidad"'
check "unidad en reported: su worktree y su rama se quedan"     'row "$(mpath "$WT/u13")" "se queda — unidad en reported" && row "wt/$RUN/u13 " "se queda — unidad en reported"'
check "resumen con lo que se borraría"                          'grep -q "^resumen: para borrar: 2 worktrees y 3 ramas" "$OUT"'
snapshot "$W/despues"
check "el ensayo no cambia git ni run.md"                       'cmp -s "$W/antes" "$W/despues" && cmp -s "$W/run.antes" "$D/run.md"'
check "--json es JSON con las mismas acciones"                  'omk cleanup $RUN --json && node -e "const j=JSON.parse(require(\"fs\").readFileSync(process.argv[1],\"utf8\"));const d=j.items.filter(i=>i.action===\"delete\").length;if(d!==5||j.apply!==false||j.integration!==\"feat/int\")process.exit(1)" "$OUT"'

echo "== --apply"
check "--apply sale con 0 si borró todo lo que tocaba"          'omk cleanup $RUN --apply'
check "borró los worktrees integrados y limpios (y su .env)"    '[ ! -e "$WT/u1" ] && [ ! -e "$W/agente" ]'
check "borró sus ramas y la integrada sin worktree"             '! g rev-parse -q --verify "refs/heads/wt/$RUN/u1" >/dev/null && ! g rev-parse -q --verify refs/heads/worktree-agent-x >/dev/null && ! g rev-parse -q --verify "refs/heads/wt/$RUN/u5+x.y_z" >/dev/null'
check "el worktree con cambios sigue con sus cambios"           '[ -d "$WT/u2" ] && grep -q cambio "$WT/u2/a.txt" && [ -f "$WT/u7/nuevo.txt" ]'
check "el bloqueado, el de commits sin integrar y el ajeno siguen" '[ -d "$W/con espacios/u4" ] && [ -d "$WT/u3" ] && [ -d "$W/otro" ]'
check "la carpeta que no era worktree sigue intacta"            '[ -f "$W/no-es-worktree/dato.txt" ] && grep -q valioso "$W/no-es-worktree/dato.txt"'
check "siguen main, feat/int, otra, u6 sin integrar y u9"       'for b in main feat/int otra "wt/$RUN/u6" "wt/$RUN/u9" "wt/$RUN/u3"; do g rev-parse -q --verify "refs/heads/$b" >/dev/null || exit 1; done'
check "siguen las protegidas, la de upstream y la unidad abierta" 'for b in desarrollo padre ajena "wt/$RUN/u11" "wt/$RUN/u13"; do g rev-parse -q --verify "refs/heads/$b" >/dev/null || exit 1; done && [ -d "$W/celda-ajena" ] && [ -d "$WT/u13" ]'
check "el registro del worktree desaparecido no se purga solo"  'g worktree list --porcelain | grep -q prunable'
check "run.md queda en cleanup: pending con una línea de log"   'grep -q "^- cleanup: pending$" "$D/run.md" && grep -Eq "^- [0-9]{2}:[0-9]{2} cleanup --apply: 5 borrados" "$D/run.md"'
check "repetir --apply no borra nada más"                       'omk cleanup $RUN --apply && grep -q "^resumen: 0 borrados" "$OUT"'
check "al repetir, lo de run.md ya borrado sale como «ya borrado»" 'omk cleanup $RUN && row "$(mpath "$WT/u1")" "| ya borrado" && row "$(mpath "$W/agente")" "| ya borrado" && row "rama     | worktree-agent-x" "| ya borrado"'
check "y no entra en el aviso de rutas que git no lista"        'grep -q "^aviso: 1 ruta de run.md que git no lista" "$OUT"'

echo "== cleanup: done"
RUN2=20261113-limpio
g worktree add -q "$W/repo.wt/$RUN2/u1" -b "wt/$RUN2/u1"; commit_in "$W/repo.wt/$RUN2/u1" r2; g merge -q --no-ff "wt/$RUN2/u1" -m r2
mkdir -p "$R/.work/runs/$RUN2"
cat > "$R/.work/runs/$RUN2/run.md" <<EOF
# run $RUN2
- integration: feat/int
- base_ref: main @ abc1234
- cleanup: —
- status: closing

| unit | round | status | role | agent · model | ref | branch | worktree | base | head | attempts | updated |
|---|---|---|---|---|---|---|---|---|---|---|---|
| U1 | 1 | merged | Proteo | claude | agent:u1 | wt/$RUN2/u1 | $(mpath "$W/repo.wt/$RUN2/u1") | — | — | 1 | 10:00 |

## Log
EOF
check "sin restos del run, run.md pasa a cleanup: done"         'omk cleanup $RUN2 --apply && grep -q "^- cleanup: done$" "$R/.work/runs/$RUN2/run.md" && [ ! -e "$W/repo.wt/$RUN2/u1" ]'
check "repetir tras done: ya borrado, sin avisos y sigue en done" 'omk cleanup $RUN2 --apply && row "$(mpath "$W/repo.wt/$RUN2/u1")" "| ya borrado" && ! grep -q "^aviso:" "$OUT" && grep -q "^run.md: cleanup done$" "$OUT"'

echo "== git sin -z (< 2.36)"
check "los campos con \\r final se leen bien"                   'node -e "const {parsePorcelain}=require(process.argv[1]);const [w]=parsePorcelain(\"worktree C:/a b\\r\\nHEAD 0123456789012345678901234567890123456789\\r\\nbranch refs/heads/wt/x/u1\\r\\nlocked\\r\\n\\r\\n\",\"\\n\");if(w.path!==\"C:/a b\"||w.branch!==\"wt/x/u1\"||!w.locked||w.head.length!==40)process.exit(1)" "$(mpath "$ROOT/bin/run/cleanup.js")"'

echo "== runs antiguos (sin run.md) y fallos parciales"
RUN3=20261113-viejo
g switch -q main
g branch "wt/$RUN3/a" feat/int
g branch "wt/$RUN3/b" main
check "sin run.md, con --integration, usa el prefijo del run"   'omk cleanup $RUN3 --integration feat/int && row "wt/$RUN3/a" "| borrar" && row "wt/$RUN3/b" "| borrar"'
# git branch -d compara con el HEAD de donde corre (main): «a» solo está en feat/int y git se niega.
check "un fallo no para el resto y sale con 1"                  'omk cleanup $RUN3 --integration feat/int --apply; [ $? -eq 1 ] && row "wt/$RUN3/a" "falló" && ! g rev-parse -q --verify "refs/heads/wt/$RUN3/b" >/dev/null && g rev-parse -q --verify "refs/heads/wt/$RUN3/a" >/dev/null'
check "la rama actual del coordinador no se toca"               'g switch -q -c "wt/$RUN3/c" && omk cleanup $RUN3 --integration feat/int && row "wt/$RUN3/c" "rama actual del coordinador"'

printf '\n%s ok · %s fallos\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
