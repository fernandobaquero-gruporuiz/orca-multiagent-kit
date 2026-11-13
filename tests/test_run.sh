#!/usr/bin/env bash
# Pruebas de omk run (bin/run.js): el modelo del run (units.md, run.md) y su CLI, en un repositorio
# git desechable. Los subcomandos de git (start, worktree, check, merge, cleanup) y plan tienen las suyas
# en tests/test_run_*.sh.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok    %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$1"; }
check(){ if eval "$2"; then ok "$1"; else bad "$1"; if [ -s "${OUT:-}" ]; then sed "s/^/        │ /" "$OUT"; fi; fi; }

command -v node >/dev/null || { echo "  SKIPPED (sin node)"; exit 0; }
command -v git >/dev/null || { echo "  SKIPPED (sin git)"; exit 0; }

echo "== modelo (tests/fixtures/run-cases.js)"
if node "$ROOT/tests/fixtures/run-cases.js"; then CASES=0; else CASES=1; fi

W="$(mktemp -d "${TMPDIR:-/tmp}/omk-run.XXXXXX")"; trap 'rm -rf "$W"' EXIT
R="$W/repo"; OUT="$W/out.txt"
export NO_COLOR=1 GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
git init -q -b main "$R"; (cd "$R" && echo a > a.txt && git add a.txt && git commit -qm init)
omk() { (cd "${CWD:-$R}" && node "$ROOT/bin/omk.js" run "$@") </dev/null >"$OUT" 2>&1; }
RUN=20261113-prueba
D="$R/.work/runs/$RUN"
mkdir -p "$D"
cat > "$D/units.md" <<'EOF'
### UNIT: U0 — Base
- write: [a.txt]
- round: 0

### UNIT: U1 — Uno
- write: [b.txt]
- depends_on: [U0]
- round: 1
- role: Proteo
EOF

echo "== CLI"
check "sin subcomando enseña la ayuda y sale con 2"          '! omk && grep -q "Uso: omk run" "$OUT"'
check "omk help lista omk run"                                '(cd "$R" && node "$ROOT/bin/omk.js" help) | grep -q "run "'
check "list sin runs"                                         'omk list && grep -q "no hay runs" "$OUT"'
check "new crea run.md con las unidades de units.md"          'omk new $RUN --input chat --integration feat/prueba --base "main @ abc1234" && [ -f "$D/run.md" ] && grep -q "^| U1 | 1 | pending | Proteo |" "$D/run.md" && grep -q "^- integration: feat/prueba$" "$D/run.md"'
check "new no pisa un run existente"                          '! omk new $RUN && grep -q "ya existe" "$OUT"'
check "status sin id: el único activo (y si no hay, lo dice)" '! omk status && grep -q "no hay ningún run activo" "$OUT"'
check "meta cambia la cabecera"                               'omk meta $RUN status=active && grep -q "^- status: active$" "$D/run.md"'
check "status sin id encuentra el activo"                     'omk status && grep -q "^# run $RUN" "$OUT"'
check "status --json es JSON"                                 'omk status $RUN --json && node -e "const j=JSON.parse(require(\"fs\").readFileSync(process.argv[1],\"utf8\"));if(j.units.length!==2)process.exit(1)" "$OUT"'
check "set mueve una unidad y cuenta el intento"              'omk set $RUN U1 status=dispatching && grep -q "^| U1 | 1 | dispatching | Proteo | — | — | — | — | — | — | 1 |" "$D/run.md"'
check "set con ref y estado siguiente"                        'omk set $RUN U1 status=dispatched ref=agent:u1 && grep -q "| dispatched | Proteo | — | agent:u1 |" "$D/run.md"'
check "set rechaza volver atrás sin --force"                  '! omk set $RUN U1 status=pending && grep -q "no se pasa de dispatched a pending" "$OUT"'
check "set --force lo permite y lo anota"                     'omk set $RUN U1 status=pending --force && grep -q "(forzado)" "$D/run.md"'
check "set rechaza un «|» que rompería la tabla"              '! omk set $RUN U1 "ref=a|b" && grep -q "«|»" "$OUT"'
check "log añade una línea con la hora"                       'omk log $RUN gates PASS && grep -Eq "^- [0-9]{2}:[0-9]{2} gates PASS$" "$D/run.md"'
check "list enseña el run"                                    'omk list && grep -q "^$RUN  active" "$OUT"'
check "un id que sale de .work/runs se rechaza"               '! omk new ../fuera && grep -q "id de run no válido" "$OUT" && [ ! -e "$R/.work/fuera" ]'
check "subcomando desconocido sale con 2"                     'omk volar; [ $? -eq 2 ]'
git -C "$R" worktree add -q "$W/wt" -b wt >/dev/null 2>&1
check "el .work es el del checkout donde corre (en Orca, el workspace)" 'CWD="$W/wt" omk new 20261113-otro && [ -f "$W/wt/.work/runs/20261113-otro/run.md" ] && CWD="$W/wt" omk list && ! grep -q "$RUN" "$OUT"'
cp "$D/run.md" "$W/bueno"; sed -i.x 's/| unit | round |/| unidad | round |/' "$D/run.md"
check "no escribe en un run.md con problemas de formato"      '! omk log $RUN x && grep -q "problemas de formato" "$OUT" && ! grep -q " x$" "$D/run.md"'
cp "$W/bueno" "$D/run.md"
mkdir -p "$R/.work/runs/20261113-roto"; printf '### UNIT: X — mal\n' > "$R/.work/runs/20261113-roto/units.md"
check "new no crea el run si units.md está mal"               '! omk new 20261113-roto && grep -q "id de unidad no válido" "$OUT" && [ ! -e "$R/.work/runs/20261113-roto/run.md" ]'

printf '\n%s ok · %s fallos (más los del modelo, arriba)\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] && [ "$CASES" -eq 0 ]
