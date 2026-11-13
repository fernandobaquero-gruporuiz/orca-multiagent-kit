#!/usr/bin/env node
// Casos de bin/run/plan.js: validación de units.md, rondas, solapes y la cuenta «¿compensa?».
// Sale con 1 si alguno falla.
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const { analyze, overlaps, isBroadGlob, parseShared, parseBudget } = require(path.join(ROOT, 'bin', 'run', 'plan.js'));

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

/** Una unidad completa; `extra` sustituye o añade campos (null quita el campo). */
function unit(id, extra = {}) {
  const fields = { write: `[src/${id}/a.js]`, acceptance: '\n  - hace algo comprobable', verify: '[npm test]', depends_on: '[]', ...extra };
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => (String(value).startsWith('\n') ? `- ${key}:${value}` : `- ${key}: ${value}`));
  return `### UNIT: ${id} — título ${id}\n${lines.join('\n')}\n`;
}
const plan = (units, shared = []) => analyze(units.join('\n'), shared, '20261113-t');
const messages = (result) => result.errors.map((e) => e.message).join('\n');
const roundOf = (result, id) => result.units.find((u) => u.id === id).round;

check('overlaps: literales solo si son iguales', () => {
  assert.equal(overlaps('a/b.js', 'a/b.js'), true);
  assert.equal(overlaps('a/b', 'a/b/c'), false);
});
check('overlaps: bin/run/** y bin/run.js no solapan; src/a/*.ts y src/a/b.js sí', () => {
  assert.equal(overlaps('bin/run/**', 'bin/run.js'), false);
  assert.equal(overlaps('src/a/*.ts', 'src/a/b.js'), true);
  assert.equal(overlaps('src/**', 'src/x/y.js'), true);
});
check('isBroadGlob: los cuatro anchos y los tres estrechos', () => {
  for (const p of ['**', '*.js', 'src/**', 'src/*.ts']) assert.equal(isBroadGlob(p), true, p);
  for (const p of ['bin/run/**', 'src/features/recargas/**', 'bin/run.js']) assert.equal(isBroadGlob(p), false, p);
});
check('parseBudget: 45m, 1h, 1h30m y basura', () => {
  assert.equal(parseBudget('45m'), 45);
  assert.equal(parseBudget('1h'), 60);
  assert.equal(parseBudget('1h30m'), 90);
  assert.equal(parseBudget('mucho'), null);
  assert.equal(parseBudget(''), null);
});
check('parseShared: bloque bajo «## 2. Shared», sin comentarios ni vacías, y se para en el siguiente ##', () => {
  const text = '## 1. X\n```\nno\n```\n## 2. Shared — algo\n```\n# nota\npackage.json\n\nsrc/db/**\n```\n## 3. Y\n```\nno\n```\n';
  assert.deepEqual(parseShared(text), ['package.json', 'src/db/**']);
  assert.deepEqual(parseShared('# sin sección\n'), []);
});

check('un plan correcto: sin errores y rondas por depends_on', () => {
  const r = plan([unit('U0', { round: 0 }), unit('U1', { depends_on: '[U0]' }), unit('U2', { depends_on: '[U0]' }), unit('U3', { depends_on: '[U1, U2]' })]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rounds.map((x) => [x.round, x.units.join('+'), x.parallel]), [[0, 'U0', 'coordinador'], [1, 'U1+U2', 'sí'], [2, 'U3', '—']]);
});
check('problemas de formato de parseUnits son errores', () => {
  const r = plan([unit('U1', { colores: 'azul' })]);
  assert.match(messages(r), /campo desconocido/);
});
check('sin write, sin acceptance y write sin verify', () => {
  const r = plan([unit('U1', { write: null }), unit('U2', { acceptance: null }), unit('U3', { verify: null })]);
  assert.match(messages(r), /U1: falta el campo write/);
  assert.match(messages(r), /U2: falta acceptance/);
  assert.match(messages(r), /U3: write no vacío sin verify/);
});
check('unidad de solo lectura: write [] sin verify vale', () => {
  assert.deepEqual(plan([unit('U1', { write: '[]', verify: null })]).errors, []);
});
check('depends_on a una unidad que no existe', () => {
  assert.match(messages(plan([unit('U1', { depends_on: '[U9]' })])), /U1: depends_on a una unidad que no existe: U9/);
});
check('ciclo en depends_on, nombrado', () => {
  const r = plan([unit('U1', { depends_on: '[U2]' }), unit('U2', { depends_on: '[U1]' })]);
  assert.match(messages(r), /ciclo en depends_on: U1 → U2 → U1/);
});
check('ruta absoluta, con .. y glob ancho en write', () => {
  const r = plan([unit('U1', { write: '[/etc/x, C:/x/y.js, ../fuera.js, src/**]' })]);
  assert.match(messages(r), /ruta absoluta en write: \/etc\/x/);
  assert.match(messages(r), /ruta absoluta en write: C:\/x\/y.js/);
  assert.match(messages(r), /«\.\.» en write/);
  assert.match(messages(r), /glob demasiado ancho en write: src\/\*\*/);
});
check('write que solapa un shared sin declararlo es error; declarado, no', () => {
  const sin = plan([unit('U1', { write: '[package.json]' })], ['package.json']);
  assert.match(messages(sin), /solapa el fichero shared «package.json»/);
  const con = plan([unit('U1', { write: '[package.json]', shared: '[package.json]' })], ['package.json']);
  assert.deepEqual(con.errors, []);
  const base = plan([unit('U0', { write: '[package.json]', round: 0 })], ['package.json']);
  assert.deepEqual(base.errors, []);
});
check('ronda 0 que depende de una que no lo es', () => {
  const r = plan([unit('U1'), unit('U0', { round: 0, depends_on: '[U1]' })]);
  assert.match(messages(r), /U0: es de ronda 0/);
});

check('solape de write en la misma ronda sube la de después, con motivo', () => {
  const r = plan([unit('U1', { write: '[src/x/a.js]' }), unit('U2', { write: '[src/x/a.js, src/y/b.js]' })]);
  assert.equal(roundOf(r, 'U1'), 1);
  assert.equal(roundOf(r, 'U2'), 2);
  assert.deepEqual(r.units[1].reasons, ['solape: src/x/a.js']);
});
check('el empuje arrastra a los que dependen de la empujada', () => {
  const r = plan([unit('U1', { write: '[src/x/a.js]' }), unit('U2', { write: '[src/x/a.js]' }), unit('U3', { depends_on: '[U2]' })]);
  assert.equal(roundOf(r, 'U3'), 3);
});
check('el solape por shared declarado también empuja', () => {
  const r = plan([unit('U1', { shared: '[package.json]' }), unit('U2', { shared: '[package.json]' })], ['package.json']);
  assert.equal(roundOf(r, 'U2'), 2);
});
check('round declarado distinto del calculado: aviso, manda el calculado', () => {
  const r = plan([unit('U1', { round: 3 })]);
  assert.equal(roundOf(r, 'U1'), 1);
  assert.match(r.warnings.map((w) => w.message).join('\n'), /round declarado 3 ≠ calculado 1/);
  assert.deepEqual(r.errors, []);
});
check('avisos: talla L sin review cross, rol Ariadna, talla S con otras', () => {
  const r = plan([unit('U1', { size: 'L' }), unit('U2', { role: 'Ariadna' }), unit('U3', { size: 'S' })]);
  const text = r.warnings.map((w) => w.message).join('\n');
  assert.match(text, /U1: talla L: divídela/);
  assert.match(text, /U1: falta review: cross/);
  assert.match(text, /U2: falta review: cross/);
  assert.match(text, /U3: talla S en una ronda con otras/);
});

check('compensa: dos M disjuntas (ahorro 40, coste 15), no con poco ahorro, sí en empate', () => {
  const r = plan([unit('U1', { size: 'M' }), unit('U2', { size: 'M' })]);
  assert.deepEqual([r.worth.saving, r.worth.cost, r.worth.verdict], [40, 15, 'sí']);
  const low = plan([unit('U1', { budget: '10m' }), unit('U2', { budget: '10m' })]);
  assert.deepEqual([low.worth.saving, low.worth.cost, low.worth.verdict], [10, 15, 'no']);
  const tie = plan([unit('U1', { budget: '15m' }), unit('U2', { budget: '15m' })]);
  assert.deepEqual([tie.worth.saving, tie.worth.cost, tie.worth.verdict], [15, 15, 'sí']);
});
check('compensa: sin ronda de 2 unidades no hay paralelo', () => {
  const r = plan([unit('U1'), unit('U2', { depends_on: '[U1]' })]);
  assert.equal(r.worth.verdict, 'no');
  assert.match(r.worth.reason, /nada que paralelizar/);
});
check('compensa: una L en ronda con otras pide dividir la unidad L', () => {
  const r = plan([unit('U1', { size: 'L' }), unit('U2', { size: 'M' })]);
  assert.equal(r.worth.verdict, 'no');
  assert.match(r.worth.reason, /divide la unidad L \(U1\)/);
});
check('compensa: cada fichero shared declarado suma 10 min de coste', () => {
  const r = plan([unit('U1', { shared: '[package.json]' }), unit('U2', { write: '[src/b.js]' })], ['package.json']);
  assert.equal(r.worth.cost, 5 * 2 + 5 * 1 + 10);
});
check('las unidades de ronda 0 no entran en la cuenta', () => {
  const r = plan([unit('U0', { round: 0 }), unit('U1'), unit('U2')]);
  assert.equal(r.worth.cost, 5 * 2 + 5 * 1);
});
check('campos para plan.json: files y depends como en plan-card', () => {
  const r = plan([unit('U0', { round: 0 }), unit('U1', { write: '[]', verify: null, depends_on: '[U0]' })]);
  assert.equal(r.units[0].files, '1');
  assert.equal(r.units[0].depends, '—');
  assert.equal(r.units[1].files, 'lectura');
  assert.equal(r.units[1].depends, 'U0');
});

process.exit(failed ? 1 : 0);
