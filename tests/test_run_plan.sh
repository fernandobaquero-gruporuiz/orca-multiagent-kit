#!/usr/bin/env bash
# Pruebas de omk run plan (bin/run/plan.js): la validación y el cálculo (tests/fixtures/run-plan-cases.js)
# y el CLI sobre un repositorio desechable.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok    %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$1"; }
check(){ if eval "$2"; then ok "$1"; else bad "$1"; if [ -s "${OUT:-}" ]; then sed "s/^/        │ /" "$OUT"; fi; fi; }

command -v node >/dev/null || { echo "  SKIPPED (sin node)"; exit 0; }

echo "== cálculo (tests/fixtures/run-plan-cases.js)"
if node "$ROOT/tests/fixtures/run-plan-cases.js"; then CASES=0; else CASES=1; fi

W="$(mktemp -d "${TMPDIR:-/tmp}/omk-plan.XXXXXX")"; trap 'rm -rf "$W"' EXIT
R="$W/repo"; OUT="$W/out.txt"
export NO_COLOR=1
mkdir -p "$R"
omk() { (cd "$R" && node "$ROOT/bin/omk.js" run "$@") </dev/null >"$OUT" 2>"$W/err.txt"; }
RUN=20261113-plan
D="$R/.work/runs/$RUN"
mkdir -p "$D"
cat > "$D/units.md" <<'EOF'
### UNIT: U0 — Base
- write: [package.json]
- acceptance:
  - la base existe
- verify: [npm test]
- round: 0

### UNIT: U1 — Uno
- write: [src/uno/a.js]
- acceptance:
  - hace uno
- verify: [npm test]
- depends_on: [U0]
- size: M

### UNIT: U2 — Dos
- write: [src/dos/a.js]
- acceptance:
  - hace dos
- verify: [npm test]
- depends_on: [U0]
- size: M

### UNIT: U3 — Tres, solapa con U2
- write: [src/dos/a.js]
- acceptance:
  - hace tres
- verify: [npm test]
- depends_on: [U0]
- size: M
EOF

echo "== CLI"
check "plan enseña la tabla, el empuje por solape y el veredicto" 'omk plan $RUN && grep -q "^run: $RUN · unidades: 4" "$OUT" && grep -q "^round | unidades" "$OUT" && grep -q "coordinador" "$OUT" && grep -q "U1, U2 " "$OUT" && grep -q "U3: solape: src/dos/a.js" "$OUT" && grep -q "^compensa: sí — ahorro 40 min, coste 25 min" "$OUT"'
check "no escribe nada en el run"                                '[ "$(ls "$D")" = "units.md" ]'
check "sin id usa el único run activo (si no hay, lo dice)"       '! omk plan && grep -q "no hay ningún run activo" "$W/err.txt"'
check "--json es JSON con rondas, unidades y worth"               'omk plan $RUN --json && node -e "const j=JSON.parse(require(\"fs\").readFileSync(process.argv[1],\"utf8\"));const u=j.units.find(x=>x.id===\"U3\");if(j.run!==process.argv[2]||j.rounds.length!==3||u.round!==2||u.files!==\"1\"||u.depends!==\"U0\"||j.worth.verdict!==\"sí\"||j.errors.length)process.exit(1)" "$OUT" $RUN'
check "ORCHESTRATION.md: un write sobre un shared sin declarar es error (salida 1)" 'printf "## 2. Shared\n\`\`\`\npackage.json\nsrc/uno/**\n\`\`\`\n" > "$R/ORCHESTRATION.md"; ! omk plan $RUN && grep -q "RISK: error.*U1: write solapa el fichero shared «src/uno/\*\*»" "$OUT"'
check "--orchestration apunta a otro fichero"                     'printf "## 2. Shared\n\`\`\`\n# nada\n\`\`\`\n" > "$W/otro.md"; omk plan $RUN --orchestration "$W/otro.md" && ! grep -q "RISK: error" "$OUT"'
check "--orchestration inexistente sale con 2"                    'omk plan $RUN --orchestration "$W/no-existe.md"; [ $? -eq 2 ]'
rm -f "$R/ORCHESTRATION.md"
check "un run sin units.md lo dice"                               'mkdir -p "$R/.work/runs/20261113-vacio" && ! omk plan 20261113-vacio && grep -q "no existe" "$W/err.txt"'
check "un id que sale de .work/runs se rechaza con 2"             'omk plan ../fuera; [ $? -eq 2 ]'
cat > "$D/units.md" <<'EOF'
### UNIT: U1 — Uno
- write: [src/**]
- depends_on: [U2]

### UNIT: U2 — Dos
- write: [a.js]
- acceptance:
  - algo
- verify: [npm test]
- depends_on: [U1]
EOF
check "errores de validación salen con 1 y se enseñan con RISK:"  '! omk plan $RUN && grep -q "RISK: error.*glob demasiado ancho" "$OUT" && grep -q "falta acceptance" "$OUT" && grep -q "ciclo en depends_on: U1 → U2 → U1" "$OUT"'

printf '\n  %s ok, %s fallos\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] && [ "$CASES" -eq 0 ]
