#!/usr/bin/env bash
# Pruebas de omk run start | worktree | check | merge (bin/run/git.js) y de los globs (bin/run/glob.js),
# en repositorios git desechables: un bare como «origin», el checkout del coordinador y un segundo clon
# para hacer avanzar la rama padre.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0; FAIL=0; SKIP=0
ok()   { PASS=$((PASS+1)); printf '  ok    %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$1"; }
skip() { SKIP=$((SKIP+1)); printf '  skip  %s\n' "$1"; }
check(){ if eval "$2"; then ok "$1"; else bad "$1"; if [ -s "${OUT:-}" ]; then sed "s/^/        │ /" "$OUT"; fi; fi; }

command -v node >/dev/null || { echo "  SKIPPED (sin node)"; exit 0; }
command -v git >/dev/null || { echo "  SKIPPED (sin git)"; exit 0; }

echo "== glob (tests/fixtures/run-glob-cases.js)"
if node "$ROOT/tests/fixtures/run-glob-cases.js"; then CASES=0; else CASES=1; fi

W="$(mktemp -d "${TMPDIR:-/tmp}/omk-run-git.XXXXXX")"; trap 'rm -rf "$W"' EXIT
R="$W/repo"; C2="$W/c2"; OUT="$W/out.txt"
export NO_COLOR=1 GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
omk() { (cd "${CWD:-$R}" && node "$ROOT/bin/omk.js" run "$@") </dev/null >"$OUT" 2>&1; }
s7() { git -C "${2:-$R}" rev-parse "$1" | cut -c1-7; }
branch_now() { git -C "${1:-$R}" branch --show-current; }
has_branch() { git -C "$R" rev-parse --verify -q "refs/heads/$1" >/dev/null; }
no_upstream() { ! git -C "$R" rev-parse --abbrev-ref "$1@{upstream}" >/dev/null 2>&1; }

# origin (bare) con main; el coordinador y un segundo clon salen de él.
git init -q -b main "$W/seed"
(cd "$W/seed" && printf '.work/\n.env*\n*.env\n*.secret\n' > .gitignore && echo a > a.txt && echo f > f.txt \
  && echo t > tracked.txt && git add -A && git commit -qm init)
git init -q --bare -b main "$W/origin.git"
git -C "$W/seed" push -q "$W/origin.git" main
git clone -q "$W/origin.git" "$R"
git clone -q "$W/origin.git" "$C2"

RUN=20261113-git
D="$R/.work/runs/$RUN"
mkdir -p "$D"
cat > "$D/units.md" <<'EOF'
### UNIT: U1 — Uno
- write: [src/**/*.js, STACK.md, docs/**]
- shared: [common.txt]

### UNIT: U2 — Dos
- write: [b.txt]

### UNIT: U3 — Tres
- write: [new/**, **/*.md]

### UNIT: U4 — Cuatro
- write: [f.txt]

### UNIT: U5 — Cinco
- write: [x.txt]

### UNIT: U6 — Seis
- write: [g.txt]

### UNIT: U7 — Siete
- write: [cfg.secret]

### UNIT: U8 — Ocho
- write: [y.txt]

### UNIT: U10 — Diez
- write: [z.txt]
EOF
omk new "$RUN"

echo "== start: validación"
check "sin --parent sale con 2"                            'omk start $RUN; [ $? -eq 2 ] && grep -q "falta --parent" "$OUT"'
check "sin rama de integración sale con 2"                 'omk start $RUN --parent main; [ $? -eq 2 ] && grep -q "falta la rama de integración" "$OUT"'
check "padre que empieza por «-» se rechaza"               'omk start $RUN --parent -x --integration feat/a; [ $? -eq 2 ] && grep -q "nombre de rama no válido" "$OUT"'
check "integración que empieza por «-» se rechaza"         'omk start $RUN --parent main --integration=--orphan; [ $? -eq 2 ] && grep -q "nombre de rama no válido" "$OUT"'
check "remoto con nombre hostil se rechaza"                'omk start $RUN --parent main --integration feat/a --remote=--upload-pack=x; [ $? -eq 2 ]'
check "integración igual a la padre se rechaza"            '! omk start $RUN --parent feat/x --integration feat/x && grep -q "no puede ser la padre" "$OUT"'
check "integración igual a la rama por defecto se rechaza" '! omk start $RUN --parent develop --integration main && grep -q "rama por defecto" "$OUT"'
echo cambio >> "$R/a.txt"
check "con cambios versionados sin commitear no cambia de rama" '! omk start $RUN --parent main --integration feat/a && grep -q "sin commitear" "$OUT" && [ "$(branch_now)" = main ] && ! has_branch feat/a'
git -C "$R" checkout -q -- a.txt
git -C "$R" remote add roto "$W/no-existe.git"
check "fetch que falla: RISK y salida 1, sin tocar nada"  'omk start $RUN --parent main --integration feat/a --remote roto; [ $? -eq 1 ] && grep -q "RISK: no pude actualizar roto" "$OUT" && grep -q -- "--no-fetch" "$OUT" && ! has_branch feat/a && grep -q "^- integration: —$" "$D/run.md"'
RUN7=20261113-sin-fetch; omk new "$RUN7"
check "--no-fetch sigue con las refs que hay y lo dice"   'omk start $RUN7 --parent main --integration feat/nf --remote roto --no-fetch && grep -q "parto de la rama local main (--no-fetch" "$OUT" && [ "$(branch_now)" = feat/nf ]'
git -C "$R" switch -q main

echo "== start: tabla de SKILL.md §4"
# shellcheck disable=SC2034  # se usa dentro de eval (check)
MAIN0="$(git -C "$R" rev-parse main)"
check "0 0: parte de la padre local, sin upstream"         'omk start $RUN --parent main --integration feat/a && grep -q "coinciden" "$OUT" && [ "$(branch_now)" = feat/a ] && [ "$(git -C "$R" rev-parse feat/a)" = "$MAIN0" ] && no_upstream feat/a'
check "0 0: anota base_ref, integration y status active"   'grep -q "^- base_ref: main @ $(s7 main)$" "$D/run.md" && grep -q "^- integration: feat/a$" "$D/run.md" && grep -q "^- status: active$" "$D/run.md" && grep -q "start: crea feat/a" "$D/run.md"'
check "--integration distinta de la de run.md se rechaza"  '! omk start $RUN --parent main --integration otra && grep -q "ya dice integration: feat/a" "$OUT"'

git -C "$R" switch -q main
(cd "$C2" && echo 2 > c2.txt && git add c2.txt && git commit -qm c2 && git push -q origin main)
RUN2=20261113-detras; omk new "$RUN2"
check "detrás: parte de origin/main y la local no se toca" 'omk start $RUN2 --parent main --integration feat/b && [ "$(git -C "$R" rev-parse feat/b)" = "$(git -C "$R" rev-parse origin/main)" ] && [ "$(git -C "$R" rev-parse main)" = "$MAIN0" ] && no_upstream feat/b && grep -q "^- base_ref: origin/main @ $(s7 origin/main)$" "$R/.work/runs/$RUN2/run.md"'
git -C "$R" switch -q main
RUN8=20261113-detras-local; omk new "$RUN8"
check "detrás con --from local: manda el usuario y lo dice" 'omk start $RUN8 --parent main --integration feat/g --from local && [ "$(git -C "$R" rev-parse feat/g)" = "$MAIN0" ] && grep -q -- "--from local: parto de main" "$OUT"'
git -C "$R" switch -q main
git -C "$C2" push -q origin main:refs/heads/feat/b
(cd "$C2" && git switch -q -c fb && echo 3 > c3.txt && git add c3.txt && git commit -qm c3 && git push -q origin fb:refs/heads/feat/b)
check "integración existente con remota: avisa de sus cuentas sin tocar nada" 'omk start $RUN2 --parent main && grep -q "aviso: feat/b va 1 commit(s) por detrás y 0 por delante de origin/feat/b" "$OUT" && [ "$(git -C "$R" rev-parse feat/b)" = "$(git -C "$R" rev-parse origin/main)" ]'

git -C "$R" switch -q main
git -C "$R" merge -q --ff-only origin/main
(cd "$R" && echo l > local.txt && git add local.txt && git commit -qm local)
RUN3=20261113-delante; omk new "$RUN3"
check "delante: salida 3 con las dos opciones, sin crear nada" 'omk start $RUN3 --parent main --integration feat/c; [ $? -eq 3 ] && grep -q -- "--from remote" "$OUT" && grep -q -- "--from local" "$OUT" && ! has_branch feat/c && [ "$(branch_now)" = main ]'
check "delante con --from local: parte de la local"        'omk start $RUN3 --parent main --integration feat/c --from local && [ "$(git -C "$R" rev-parse feat/c)" = "$(git -C "$R" rev-parse main)" ]'
git -C "$R" switch -q main
RUN4=20261113-remota; omk new "$RUN4"
check "delante con --from remote: parte de origin/main"    'omk start $RUN4 --parent main --integration feat/d --from remote && [ "$(git -C "$R" rev-parse feat/d)" = "$(git -C "$R" rev-parse origin/main)" ] && no_upstream feat/d'
check "--from con un valor raro sale con 2"                'omk start $RUN4 --parent main --from otro; [ $? -eq 2 ]'

git -C "$R" switch -q main
# shellcheck disable=SC2034  # se usa dentro de eval (check)
FA="$(git -C "$R" rev-parse feat/a)"
check "integración existente: no se recrea, se cambia a ella y avisa" 'omk start $RUN --parent main --from local && grep -q "ya existe" "$OUT" && grep -q "la rama padre ha avanzado" "$OUT" && [ "$(git -C "$R" rev-parse feat/a)" = "$FA" ] && [ "$(branch_now)" = feat/a ] && grep -q "^- base_ref: main @ ${FA:0:7}$" "$D/run.md"'

git -C "$C2" push -q origin main:refs/heads/feat/r
git -C "$R" switch -q main
RUN6=20261113-solo-remota; omk new "$RUN6"
check "integración solo en el remoto: salida 3, no la crea de cero" 'omk start $RUN6 --parent main --integration feat/r --from local; [ $? -eq 3 ] && grep -q "existe origin/feat/r" "$OUT" && ! has_branch feat/r'

NR="$W/sin-remoto"
git init -q -b main "$NR"; (cd "$NR" && printf '.work/\n*.secret\n' > .gitignore && echo a > a.txt && git add -A && git commit -qm init)
# shellcheck disable=SC2034  # se usa dentro de eval (check)
RUN5=20261113-local
check "sin remoto: parte de la rama local y lo dice"        'CWD="$NR" omk new $RUN5 && CWD="$NR" omk start $RUN5 --parent main --integration feat/e && grep -q "sin remoto origin" "$OUT" && [ "$(branch_now "$NR")" = feat/e ] && grep -q "^- base_ref: main @" "$NR/.work/runs/$RUN5/run.md"'

echo "== worktree: destino que ya existe como enlace (roto)"
NRUN=20261113-enlace
mkdir -p "$NR/.work/runs/$NRUN"; printf '### UNIT: U1 — Uno\n- write: [z.txt]\n' > "$NR/.work/runs/$NRUN/units.md"
git -C "$NR" switch -q main
CWD="$NR" omk new "$NRUN"; CWD="$NR" omk start "$NRUN" --parent main --integration feat/h
# En feat/h, roto.secret es un enlace versionado a un destino que no existe; en main es un fichero ignorado.
BLOB="$(printf 'no-existe' | git -C "$NR" hash-object -w --stdin)"
git -C "$NR" update-index --add --cacheinfo "120000,$BLOB,roto.secret"
git -C "$NR" commit -qm "enlace roto"
git -C "$NR" checkout -q -- roto.secret
git -C "$NR" switch -q main
echo real > "$NR/roto.secret"; echo roto.secret > "$NR/.worktreeinclude"
check "un destino que ya existe (enlace roto incluido) no se pisa" 'CWD="$NR" omk worktree $NRUN U1 && grep -q "omitido: roto.secret — ya existe en el worktree" "$OUT"'

echo "== worktree"
git -C "$R" switch -q feat/a
INTEG="$(git -C "$R" rev-parse feat/a)"
echo "SECRETO=valor-ultrasecreto-123" > "$R/.env"
echo "SECRETO=prod-ultrasecreto-456" > "$R/.env.production"
mkdir -p "$R/config"; echo s > "$R/config/app.secret"
echo fuera > "$W/fuera.txt"; echo abs > "$W/abs.txt"
SYMLINK=0
# En Git Bash, ln -s copia el fichero salvo con enlaces nativos (modo desarrollador o administrador).
if MSYS=winsymlinks:nativestrict ln -s .env "$R/link.env" 2>/dev/null && [ -L "$R/link.env" ]; then SYMLINK=1; else rm -f "$R/link.env"; fi
printf '# comentario\n.env\n.env.production\n../fuera.txt\n%s\nC:/abs.txt\nlink.env\ntracked.txt\nno-existe.txt\n*.secret\nconfig/app.secret\nprod/app.secret\nconfig.live.secret\ncfg-prd.secret\ndelivery.secret\n' "$W/abs.txt" > "$R/.worktreeinclude"
WT1="$W/repo.wt/$RUN/u1"
check "crea rama y worktree desde la cabeza de la integración" 'omk worktree $RUN U1 && [ -d "$WT1" ] && [ "$(branch_now "$WT1")" = "wt/$RUN/u1" ] && [ "$(git -C "$WT1" rev-parse HEAD)" = "$INTEG" ]'
check "copia los de desarrollo ignorados (también en subcarpetas)" '[ -f "$WT1/.env" ] && [ -f "$WT1/config/app.secret" ] && grep -q "copiado: .env$" "$OUT" && grep -q "copiado: config/app.secret$" "$OUT"'
check "nunca enseña el contenido de lo que copia"          '! grep -q "ultrasecreto" "$OUT" && ! grep -q "ultrasecreto" "$D/run.md"'
check ".env.production: omitido con RISK"                  'grep -q "^RISK: omitido .env.production" "$OUT" && [ ! -e "$WT1/.env.production" ]'
check "producción en cualquier segmento, prd y live como palabra" 'grep -q "^RISK: omitido prod/app.secret" "$OUT" && grep -q "^RISK: omitido config.live.secret" "$OUT" && grep -q "^RISK: omitido cfg-prd.secret" "$OUT" && grep -q "omitido: delivery.secret — no existe" "$OUT"'
check "../ se omite"                                       'grep -q "omitido: ../fuera.txt — sale de la raíz" "$OUT" && [ ! -e "$W/repo.wt/$RUN/fuera.txt" ]'
check "rutas absolutas se omiten"                          'grep -q "abs.txt — ruta absoluta" "$OUT" && grep -q "omitido: C:/abs.txt — ruta absoluta" "$OUT"'
check "lo versionado, lo que no existe y los globs se omiten" 'grep -q "omitido: tracked.txt — no está ignorado" "$OUT" && grep -q "omitido: no-existe.txt — no existe" "$OUT" && grep -q "omitido: \*.secret — parece un glob" "$OUT"'
if [ "$SYMLINK" -eq 1 ]; then
  check "un enlace simbólico se omite"                     'grep -q "omitido: link.env — es o cruza un enlace simbólico" "$OUT" && [ ! -e "$WT1/link.env" ]'
else
  skip "un enlace simbólico se omite (este sistema no crea enlaces con ln -s)"
fi
check "anota branch, worktree y base en la fila y en el log" 'grep -q "| wt/$RUN/u1 | [^|]*u1 | ${INTEG:0:7} | — |" "$D/run.md" && grep -q "U1 worktree .* base ${INTEG:0:7}" "$D/run.md"'
check "repetirlo no toca nada y sale con 0"                'omk worktree $RUN U1 && grep -q "ya existe" "$OUT"'
WT2="$W/con espacios/u2"
check "--path con espacios y --no-copy"                     'omk worktree $RUN U2 --path "$WT2" --no-copy && [ "$(branch_now "$WT2")" = "wt/$RUN/u2" ] && [ ! -e "$WT2/.env" ] && grep -q "con espacios" "$D/run.md"'
mkdir -p "$W/lleno"; echo x > "$W/lleno/x"
check "ruta que existe y no está vacía: se niega"          '! omk worktree $RUN U3 --path "$W/lleno" && grep -q "no es una carpeta vacía" "$OUT" && ! has_branch "wt/$RUN/u3"'
check "ruta que contiene el checkout: se niega"            'omk worktree $RUN U3 --path "$W"; [ $? -eq 2 ] && ! has_branch "wt/$RUN/u3"'
check "ruta dentro del checkout: se niega"                 'omk worktree $RUN U3 --path "$R/dentro"; [ $? -eq 2 ] && grep -q "queda dentro del checkout" "$OUT" && ! has_branch "wt/$RUN/u3" && [ ! -e "$R/dentro" ]'
WT3="$W/repo.wt/$RUN/u3"; WT4="$W/repo.wt/$RUN/u4"; WT6="$W/repo.wt/$RUN/u6"; WT7="$W/repo.wt/$RUN/u7"
check "U3, U4, U6, U7 y U8 en su ruta por defecto"         'omk worktree $RUN U3 && omk worktree $RUN U4 && omk worktree $RUN U6 --no-copy && omk worktree $RUN U7 --no-copy && omk worktree $RUN U8 --no-copy && [ -d "$WT3" ] && [ -d "$WT4" ] && [ -d "$WT6" ]'
omk set "$RUN" U10 branch=otra/rama
check "fila con otra rama ya anotada: no la pisa"          '! omk worktree $RUN U10 && grep -q "ya tiene branch otra/rama" "$OUT" && ! has_branch "wt/$RUN/u10"'
git -C "$R" branch "wt/$RUN/u5" feat/a
check "rama de la unidad que ya existe sin worktree: no la pisa" '! omk worktree $RUN U5 && grep -q "ya existe sin worktree" "$OUT"'
check "unidad que no está en el run"                       '! omk worktree $RUN U9 && grep -q "no tiene la unidad U9" "$OUT"'
check "id de unidad hostil sale con 2"                     'omk worktree $RUN "U1;rm"; [ $? -eq 2 ]'

echo "== check"
(cd "$WT1" && mkdir -p src/a docs && echo 1 > src/a/b.js && echo s > STACK.md && echo d > docs/x.md && echo c > common.txt \
  && git add -A && git commit -qm u1)
check "pasa con write (glob), STACK.md literal y shared"    'omk check $RUN U1 && grep -q "check U1: OK" "$OUT" && grep -q "4 fichero" "$OUT"'
check "--json con ok: true"                                'omk check $RUN U1 --json && node -e "const j=JSON.parse(require(\"fs\").readFileSync(process.argv[1],\"utf8\"));if(!j.ok||j.changed.length!==4)process.exit(1)" "$OUT"'
(cd "$WT2" && echo b > b.txt && echo c > c.txt && git add -A && git commit -qm u2 && echo b2 > b.txt && echo d > d.txt)
check "falla fuera de write y con cambios sin commitear"   'omk check $RUN U2; [ $? -eq 1 ] && grep -q "fuera de alcance: c.txt" "$OUT" && grep -q "sin commitear: d.txt" "$OUT" && grep -q "sin commitear: b.txt" "$OUT" && ! grep -q "fuera de alcance: b.txt" "$OUT"'
check "--json del fallo"                                   'omk check $RUN U2 --json; [ $? -eq 1 ] && node -e "const j=JSON.parse(require(\"fs\").readFileSync(process.argv[1],\"utf8\"));if(j.ok||!j.out_of_scope.includes(\"c.txt\")||!j.uncommitted.includes(\"d.txt\"))process.exit(1)" "$OUT"'
omk set "$RUN" U2 "worktree=(Orca)"
check "celda worktree entre paréntesis: lo busca por la rama" 'omk check $RUN U2; [ $? -eq 1 ] && grep -q "sin commitear: d.txt" "$OUT"'
omk set "$RUN" U2 "worktree=../con espacios/u2"
check "celda worktree relativa: contra root, no contra cwd" 'CWD="$R/config" omk check $RUN U2; [ $? -eq 1 ] && grep -q "sin commitear: d.txt" "$OUT" && ! grep -q "problema:" "$OUT"'
omk set "$RUN" U2 "worktree=no-hay/u2"
check "celda worktree que no existe: es un problema"       'omk check $RUN U2; [ $? -eq 1 ] && grep -q "problema: el worktree no-hay/u2 de run.md no existe" "$OUT"'
(cd "$WT3" && mkdir -p new planes otra .Plans/sub new/.work && git mv a.txt new/a.txt && echo t > new/tasks.md && echo '{}' > new/package-lock.json \
  && echo p > planes/p.md && echo n > notas.md && echo T > otra/TASKS.md && echo q > .Plans/sub/q.md && echo w > new/.work/x.txt \
  && git add -A && git add -f new/.work/x.txt && git commit -qm u3)
check "prohibidos aunque encajen en un glob de write"      '! omk check $RUN U3 && grep -q "prohibido a un worker: new/tasks.md" "$OUT" && grep -q "prohibido a un worker: new/package-lock.json" "$OUT" && grep -q "prohibido a un worker: planes/p.md" "$OUT" && ! grep -q "notas.md" "$OUT"'
check "prohibidos sin distinguir mayúsculas, en subcarpetas de planes y .work a cualquier nivel" 'grep -q "prohibido a un worker: otra/TASKS.md" "$OUT" && grep -q "prohibido a un worker: .Plans/sub/q.md" "$OUT" && grep -q "prohibido a un worker: new/.work/x.txt" "$OUT"'
check "un renombrado cuenta el origen (a.txt) fuera de write" 'grep -q "fuera de alcance: a.txt" "$OUT" && ! grep -q ": new/a.txt" "$OUT"'
check "sin base en run.md: se niega"                       '! omk check $RUN U5 && grep -q "no tiene base" "$OUT"'
omk set "$RUN" U5 branch=--output=x base="${INTEG:0:7}"
check "rama hostil en run.md: se rechaza"                  'omk check $RUN U5; [ $? -eq 2 ] && grep -q "nombre de rama no válido" "$OUT"'

echo "== merge"
(cd "$WT4" && echo f4 > f.txt && git commit -qam u4)
(cd "$R" && echo f-coord > f.txt && git commit -qam "coordinador toca f.txt")
check "unidad que no está accepted: se niega"              '! omk merge $RUN U1 && grep -q "solo se integra una unidad accepted" "$OUT"'
omk set "$RUN" U1 status=accepted; omk set "$RUN" U2 status=accepted; omk set "$RUN" U4 status=accepted
git -C "$R" switch -q main
check "fuera de la rama de integración: se niega"          '! omk merge $RUN U1 && grep -q "no en la rama de integración feat/a" "$OUT"'
omk meta "$RUN" integration=main
check "integración = rama por defecto: se niega"           '! omk merge $RUN U1 && grep -q "es la rama por defecto" "$OUT"'
omk meta "$RUN" integration=feat/a
git -C "$R" switch -q feat/a
echo sucio >> "$R/tracked.txt"
check "con el árbol sucio: se niega"                       '! omk merge $RUN U1 && grep -q "sin commitear" "$OUT"'
git -C "$R" checkout -q -- tracked.txt
# shellcheck disable=SC2034  # se usa dentro de eval (check)
HEAD0="$(git -C "$R" rev-parse HEAD)"
check "si check falla: se niega"                           '! omk merge $RUN U2 && grep -q "no pasa check" "$OUT" && [ "$(git -C "$R" rev-parse HEAD)" = "$HEAD0" ]'
check "conflicto en el ensayo: salida 1 con los ficheros, sin tocar nada" 'omk merge $RUN U4; [ $? -eq 1 ] && grep -q "conflictos" "$OUT" && grep -q "^  f.txt$" "$OUT" && [ "$(git -C "$R" rev-parse HEAD)" = "$HEAD0" ] && [ ! -e "$R/.git/MERGE_HEAD" ] && [ -z "$(git -C "$R" status --porcelain --untracked-files=no)" ]'
git -C "$R" rev-parse HEAD > "$R/.git/MERGE_HEAD"
check "con un merge a medias (MERGE_HEAD), merge y start se niegan" '! omk merge $RUN U1 && grep -q "hay un merge a medias" "$OUT" && ! omk start $RUN --parent main --from local && grep -q "hay un merge a medias" "$OUT" && [ "$(git -C "$R" rev-parse HEAD)" = "$HEAD0" ]'
rm -f "$R/.git/MERGE_HEAD"
check "--dry-run solo ensaya"                            'omk merge $RUN U1 --dry-run && grep -q "sale limpio" "$OUT" && [ "$(git -C "$R" rev-parse HEAD)" = "$HEAD0" ] && grep -q "| U1 | — | accepted |" "$D/run.md"'
check "merge --no-ff con su mensaje"                       'omk merge $RUN U1 && [ "$(git -C "$R" rev-list --parents -n 1 HEAD | wc -w | tr -d " ")" = 3 ] && [ "$(git -C "$R" log -1 --format=%s)" = "merge($RUN): U1 — Uno" ] && [ -f "$R/src/a/b.js" ]'
check "anota merged, head y log"                           'grep -q "| U1 | — | merged | .* | $(s7 HEAD) | 0 |" "$D/run.md" && grep -q "U1 integrada en feat/a · merge $(s7 HEAD)" "$D/run.md"'
check "nunca hace push"                                    '[ -z "$(git -C "$R" ls-remote --heads origin feat/a)" ]'
check "no integra dos veces (ya está merged)"              '! omk merge $RUN U1 && grep -q "está en merged" "$OUT"'

echo "== check y merge contra la rama de integración"
(cd "$WT6" && echo g > g.txt && git add g.txt && git commit -qm u6 && git merge -q --no-edit feat/a)
check "el worker trajo la integración: lo ajeno no cuenta" 'omk check $RUN U6 && grep -q "1 fichero(s) cambiado(s)" "$OUT"'
(cd "$WT6" && git rm -q src/a/b.js && git commit -qm "revierte lo de U1")
check "revertir en su rama algo ya integrado: fuera de alcance" '! omk check $RUN U6 && grep -q "fuera de alcance: src/a/b.js" "$OUT"'
omk set "$RUN" U6 base="$(git -C "$R" rev-parse --short main)"
check "base de run.md que no es antecesora de la rama: problema" '! omk check $RUN U6 && grep -q "problema: la base .* no es antecesora de wt/$RUN/u6" "$OUT"'
omk set "$RUN" U8 status=accepted
# shellcheck disable=SC2034  # se usa dentro de eval (check)
HEAD1="$(git -C "$R" rev-parse HEAD)"
check "rama sin commits nuevos: se niega y no marca merged" 'omk check $RUN U8 && ! omk merge $RUN U8 && grep -q "no aporta commits" "$OUT" && grep -q "| U8 | — | accepted |" "$D/run.md" && [ "$(git -C "$R" rev-parse HEAD)" = "$HEAD1" ]'
(cd "$WT7" && echo rama > cfg.secret && git add -f cfg.secret && git commit -qm u7)
echo local > "$R/cfg.secret"
omk set "$RUN" U7 status=accepted
check "merge no pisa un fichero ignorado del checkout (--no-overwrite-ignore)" 'omk check $RUN U7 && ! omk merge $RUN U7 && grep -q "pisaría ficheros sin versionar o ignorados" "$OUT" && grep -q "^  cfg.secret$" "$OUT" && [ "$(cat "$R/cfg.secret")" = local ] && [ "$(git -C "$R" rev-parse HEAD)" = "$HEAD1" ] && [ ! -e "$R/.git/MERGE_HEAD" ] && grep -q "| U7 | — | accepted |" "$D/run.md"'

printf '\n%s ok · %s fallos · %s omitidos (más los de glob, arriba)\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ] && [ "$CASES" -eq 0 ]
