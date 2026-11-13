#!/usr/bin/env node
// Casos de bin/run/units.js y bin/run/ledger.js: lectura de units.md y run.md, transiciones y
// escritura. Sale con 1 si alguno falla.
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const { parseUnits, splitList } = require(path.join(ROOT, 'bin', 'run', 'units.js'));
const ledger = require(path.join(ROOT, 'bin', 'run', 'ledger.js'));
const { checkRunId, parseArgs, RunError } = require(path.join(ROOT, 'bin', 'run', 'util.js'));

let failed = 0;
function check(name, fn) {
  try {
    fn();
    process.stdout.write(`  ok    ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stdout.write(`  FAIL  ${name}\n        │ ${String(error.stack || error).split('\n').slice(0, 4).join('\n        │ ')}\n`);
  }
}

const UNITS = `# Unidades

\`\`\`markdown
### UNIT: U9 — ejemplo dentro de un bloque de código: no cuenta
\`\`\`

### UNIT: U0 — Base común
- write: [bin/run.js, bin/run/util.js]
- depends_on: []
- round: 0

### UNIT: U2 — Endpoint POST /recargas
- source: speckit specs/003-recargas/tasks.md#US2 (T014–T019)
- goal: existe POST /recargas
- write: [server/src/routes/recargas.ts, src/**/*.{ts,tsx}]
- read: [server/src/db/schema.ts]
- shared: []                       # normalmente vacío
- depends_on: [U0]
- round: 1
- role: Ariadna                    # opcional
- acceptance:
  - POST /recargas con importe válido devuelve 201
  - importe ≤0 → 422  # con código
- verify: [pnpm test recargas, pnpm typecheck]
- review: cross

## Otra sección
- write: [esto no es de ninguna unidad]
`;

process.stdout.write('== units.md\n');
check('lee las unidades y se salta los bloques de código', () => {
  const { units, problems } = parseUnits(UNITS);
  assert.deepEqual(problems, []);
  assert.deepEqual(units.map((u) => u.id), ['U0', 'U2']);
  assert.equal(units[1].title, 'Endpoint POST /recargas');
});
check('listas entre corchetes, con globs de llaves y comentarios', () => {
  const u2 = parseUnits(UNITS).units[1].fields;
  assert.deepEqual(u2.write, ['server/src/routes/recargas.ts', 'src/**/*.{ts,tsx}']);
  assert.deepEqual(u2.shared, []);
  assert.deepEqual(u2.depends_on, ['U0']);
  assert.equal(u2.role, 'Ariadna');
  assert.equal(u2.source, 'speckit specs/003-recargas/tasks.md#US2 (T014–T019)');
});
check('listas en líneas debajo del campo', () => {
  const u2 = parseUnits(UNITS).units[1].fields;
  assert.deepEqual(u2.acceptance, ['POST /recargas con importe válido devuelve 201', 'importe ≤0 → 422']);
  assert.deepEqual(u2.verify, ['pnpm test recargas', 'pnpm typecheck']);
  assert.equal(u2.review, 'cross');
});
check('round es un número; lo que va tras otra cabecera no es de la unidad', () => {
  const [u0, u2] = parseUnits(UNITS).units;
  assert.equal(u0.fields.round, 0);
  assert.equal(u2.fields.round, 1);
  assert.equal(u2.fields.write.includes('esto no es de ninguna unidad'), false);
});
check('avisa de ids no válidos, repetidos, campos desconocidos y rounds raros', () => {
  const { problems } = parseUnits('### UNIT: X1 — a\n### UNIT: U1 — b\n- colour: red\n- round: dos\n### UNIT: U1 — c\n- write: [a]\n- write: [b]\n');
  const text = problems.map((p) => p.message).join('\n');
  assert.match(text, /id de unidad no válido: X1/);
  assert.match(text, /campo desconocido «colour»/);
  assert.match(text, /round no es un entero/);
  assert.match(text, /unidad repetida: U1/);
  assert.match(text, /campo repetido «write»/);
});
check('splitList respeta llaves y paréntesis', () => {
  assert.deepEqual(splitList('a, b/{c,d}, f(g, h)'), ['a', 'b/{c,d}', 'f(g, h)']);
});

const RUN = `# run 20261107-recargas
- input: speckit specs/003-recargas
- engine: orca            # orca | subagents | manual | mixto
- autonomy: semi
- integration: feat/003-recargas
- base_ref: origin/main @ 1a2b3c4
- cleanup: —
- status: active

| unit | round | status | role | agent · model | ref | branch | worktree | base | head | attempts | updated |
|---|---|---|---|---|---|---|---|---|---|---|---|
| U0 | 0 | merged | Hefesto | coordinador | coordinador | feat/003-recargas | (principal) | 1a2b3c4 | 5d6e7f8 | 1 | 10:31 |
| U1 | 1 | pending | Proteo | claude · sonnet | — | — | — | — | — | 0 | — |

## Log
- 10:31 U0 merged 5d6e7f8 · gates PASS
`;

process.stdout.write('== run.md\n');
check('lee cabecera, tabla y log', () => {
  const run = ledger.parseRun(RUN);
  assert.deepEqual(run.problems, []);
  assert.equal(run.id, '20261107-recargas');
  assert.equal(run.meta.engine, 'orca');
  assert.equal(run.metaComments.engine.trim(), '# orca | subagents | manual | mixto');
  assert.equal(run.units[1].agent, 'claude · sonnet');
  assert.deepEqual(run.log, ['10:31 U0 merged 5d6e7f8 · gates PASS']);
});
check('leer y escribir no cambia un run.md bien formado', () => {
  assert.equal(ledger.serializeRun(ledger.parseRun(RUN)), RUN);
});
check('avisa de columnas inesperadas y filas incompletas', () => {
  const run = ledger.parseRun(RUN.replace('| unit | round |', '| unidad | round |').replace('| 0 | — |\n', '|\n'));
  assert.equal(run.problems.length, 2);
});
check('transiciones: hacia delante sí (también saltando), hacia atrás no', () => {
  assert.equal(ledger.canMove('pending', 'merged'), true);
  assert.equal(ledger.canMove('reported', 'accepted'), true);
  assert.equal(ledger.canMove('merged', 'pending'), false);
  assert.equal(ledger.canMove('accepted', 'dispatched'), false);
});
check('transiciones laterales de ledger.md', () => {
  assert.equal(ledger.canMove('reported', 'rework'), true);
  assert.equal(ledger.canMove('rework', 'dispatched'), true);
  assert.equal(ledger.canMove('pending', 'rework'), false);
  assert.equal(ledger.canMove('merged', 'reverted'), true);
  assert.equal(ledger.canMove('dispatched', 'reverted'), false);
  assert.equal(ledger.canMove('blocked', 'dispatching'), true);
  assert.equal(ledger.canMove('merged', 'blocked'), false);
});
check('setUnit cuenta el intento al pasar a dispatching y pone la hora', () => {
  const run = ledger.parseRun(RUN);
  const unit = ledger.setUnit(run, 'U1', { status: 'dispatching' }, { now: new Date(2026, 10, 13, 9, 5) });
  assert.equal(unit.attempts, '1');
  assert.equal(unit.updated, '09:05');
  ledger.setUnit(run, 'U1', { status: 'dispatched', ref: 'agent:u1' });
  assert.equal(unit.attempts, '1');
});
check('setUnit rechaza transiciones inválidas, campos desconocidos y «|»', () => {
  const run = ledger.parseRun(RUN);
  assert.throws(() => ledger.setUnit(run, 'U0', { status: 'pending' }), RunError);
  assert.doesNotThrow(() => ledger.setUnit(run, 'U0', { status: 'pending' }, { force: true }));
  assert.throws(() => ledger.setUnit(run, 'U1', { colour: 'x' }), /campo desconocido/);
  assert.throws(() => ledger.setUnit(run, 'U1', { updated: '10:00' }), /solo lectura/);
  assert.throws(() => ledger.setUnit(run, 'U1', { ref: 'a | b' }), /«\|»/);
  assert.throws(() => ledger.setUnit(run, 'U7', { ref: 'x' }), /no tiene la unidad U7/);
  assert.throws(() => ledger.setUnit(run, 'U1', { status: 'volando' }), /estado desconocido/);
});
check('setMeta valida claves y valores', () => {
  const run = ledger.parseRun(RUN);
  ledger.setMeta(run, 'cleanup', 'pending');
  assert.equal(run.meta.cleanup, 'pending');
  assert.throws(() => ledger.setMeta(run, 'status', 'quizá'), /no admite/);
  assert.throws(() => ledger.setMeta(run, 'colour', 'x'), /desconocida/);
  assert.throws(() => ledger.setMeta(run, 'input', 'a\nb'), /saltos de línea/);
});
check('newRun pone las unidades en pending con su ronda', () => {
  const run = ledger.newRun({ id: '20261113-prueba', meta: { input: 'chat' }, units: [{ id: 'U0', round: 0 }, { id: 'U1', round: 1, role: 'Proteo' }] });
  assert.deepEqual(run.units.map((u) => [u.unit, u.round, u.status, u.role, u.attempts]), [['U0', '0', 'pending', '—', '0'], ['U1', '1', 'pending', 'Proteo', '0']]);
  assert.deepEqual(ledger.parseRun(ledger.serializeRun(run)).problems, []);
});

process.stdout.write('== entrada hostil\n');
check('ids de run que escaparían de .work/runs se rechazan', () => {
  for (const bad of ['../x', '20261113-../../etc', '20261113-A', 'run', '20261113-a/b', '', undefined]) {
    assert.throws(() => checkRunId(bad), RunError, String(bad));
  }
  assert.equal(checkRunId('20261113-omk-run'), '20261113-omk-run');
});
check('ramas que git expandiría a otra (@{-1}, @) se rechazan sin llamar a git', () => {
  const { checkBranch } = require(path.join(ROOT, 'bin', 'run', 'util.js'));
  for (const bad of ['@{-1}', '@', 'feat@{u}', '-x']) assert.throws(() => checkBranch(bad, ROOT), RunError, bad);
});
check('plan: una carpeta con «/» final es un glob (ancho si es de primer nivel)', () => {
  const plan = require(path.join(ROOT, 'bin', 'run', 'plan.js'));
  assert.equal(plan.isBroadGlob('src/'), true);
  assert.equal(plan.isBroadGlob('bin/run/'), false);
  assert.equal(plan.overlaps('bin/run/', 'bin/run/x.js'), true);
});
check('parseArgs: opción desconocida, valor ausente y bandera con valor', () => {
  assert.throws(() => parseArgs(['--x']), /desconocida/);
  assert.throws(() => parseArgs(['--input'], { values: ['input'] }), /falta el valor/);
  assert.throws(() => parseArgs(['--json=1'], { flags: ['json'] }), /no lleva valor/);
  assert.deepEqual(parseArgs(['a', '--input=b', '--json', '--', '--c'], { flags: ['json'], values: ['input'] }), { positional: ['a', '--c'], options: { input: 'b', json: true } });
});

process.stdout.write(`\n${failed ? `${failed} casos fallan` : 'todos los casos pasan'}\n`);
process.exitCode = failed ? 1 : 0;
