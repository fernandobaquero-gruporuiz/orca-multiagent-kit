// run.md (skills/orca/references/ledger.md): el estado del run en un fichero, no en la conversación.
// Lee y escribe su cabecera, la tabla de unidades y el log sin perder lo que no entiende.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { RunError, checkRunId, checkUnitId, runDir, writeAtomic, clock } = require('./util');

/** Columnas de la tabla, en orden: clave corta (la de `omk run set`) y cabecera en run.md. */
const COLUMNS = [
  ['unit', 'unit'], ['round', 'round'], ['status', 'status'], ['role', 'role'], ['agent', 'agent · model'],
  ['ref', 'ref'], ['branch', 'branch'], ['worktree', 'worktree'], ['base', 'base'], ['head', 'head'],
  ['attempts', 'attempts'], ['updated', 'updated'],
];
const META_KEYS = ['input', 'engine', 'orca_run', 'autonomy', 'integration', 'base_ref', 'cleanup', 'status', 'confirm1'];
const RUN_STATUS = ['planned', 'active', 'closing', 'done', 'cancelled'];
const CLEANUP = ['—', 'pending', 'done'];
const AUTONOMY = ['manual', 'semi', 'auto'];
const ENGINES = ['orca', 'subagents', 'manual', 'mixto'];
const EMPTY = '—';

// Estados de una unidad: el camino normal y las salidas laterales (ledger.md §Estados).
const FLOW = ['pending', 'dispatching', 'dispatched', 'reported', 'accepted', 'merged'];
const SIDE = ['rework', 'blocked', 'discarded', 'reverted'];
const UNIT_STATUS = [...FLOW, ...SIDE];

/**
 * Si se puede pasar de `from` a `to`. Hacia delante en el camino normal se puede saltar pasos (la
 * unidad del coordinador va de `pending` a `merged`); hacia atrás, solo por las salidas laterales.
 */
function canMove(from, to) {
  if (from === to) return true;
  const a = FLOW.indexOf(from);
  const b = FLOW.indexOf(to);
  if (a !== -1 && b !== -1) return b > a;
  switch (to) {
    case 'rework': return ['reported', 'accepted'].includes(from);
    case 'blocked': return from !== 'merged' && from !== 'discarded' && from !== 'reverted';
    case 'discarded': return from !== 'merged' && from !== 'reverted';
    case 'reverted': return from === 'merged';
    default: break;
  }
  if (from === 'rework') return ['dispatching', 'dispatched'].includes(to);
  if (from === 'blocked') return ['pending', 'dispatching', 'dispatched'].includes(to);
  return false;
}

const TABLE_ROW = /^\s*\|(.*)\|\s*$/;
const SEPARATOR = /^\s*\|(\s*:?-+:?\s*\|)+\s*$/;
const META_LINE = /^- ([a-z_0-9]+):\s*(.*?)\s*$/;

function cells(line) {
  return TABLE_ROW.exec(line)[1].split('|').map((cell) => cell.trim());
}

/**
 * Lee run.md. Devuelve {id, meta, metaComments, units, log, problems}. `meta` guarda las claves en el
 * orden del fichero; un comentario `# …` al final de una línea de cabecera se conserva, con su sangría, en metaComments.
 */
function parseRun(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const run = { id: null, meta: {}, metaComments: {}, units: [], log: [], problems: [] };
  let section = 'head';
  let header = null;
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const title = /^#\s+run\s+(\S+)\s*$/.exec(line);
    if (title && run.id === null) { run.id = title[1]; return; }
    if (/^##\s+Log\s*$/i.test(line)) { section = 'log'; return; }
    if (section === 'log') {
      const entry = /^- (.*)$/.exec(line);
      if (entry) run.log.push(entry[1]);
      return;
    }
    if (TABLE_ROW.test(line)) {
      section = 'table';
      if (SEPARATOR.test(line)) return;
      const row = cells(line);
      if (!header) {
        header = row;
        const expected = COLUMNS.map(([, title]) => title);
        if (row.join('|') !== expected.join('|')) run.problems.push({ line: lineNo, message: `columnas inesperadas en la tabla: ${row.join(' | ')}` });
        return;
      }
      const unit = {};
      COLUMNS.forEach(([key], i) => { unit[key] = row[i] ?? EMPTY; });
      if (row.length !== COLUMNS.length) run.problems.push({ line: lineNo, message: `fila con ${row.length} columnas: ${unit.unit}` });
      run.units.push(unit);
      return;
    }
    if (section !== 'head') return;
    const meta = META_LINE.exec(line);
    if (!meta) return;
    const [, key, raw] = meta;
    const comment = /^(.*?)(\s{2,}#\s.*)$/.exec(raw);
    run.meta[key] = comment ? comment[1] : raw;
    if (comment) run.metaComments[key] = comment[2];
  });
  if (!run.id) run.problems.push({ line: 1, message: 'falta la cabecera «# run <id>»' });
  return run;
}

function serializeRun(run) {
  const out = [`# run ${run.id}`];
  for (const [key, value] of Object.entries(run.meta)) {
    const comment = run.metaComments && run.metaComments[key];
    out.push(`- ${key}: ${value}${comment || ''}`);
  }
  out.push('');
  out.push(`| ${COLUMNS.map(([, title]) => title).join(' | ')} |`);
  out.push(`|${COLUMNS.map(() => '---').join('|')}|`);
  for (const unit of run.units) out.push(`| ${COLUMNS.map(([key]) => unit[key] ?? EMPTY).join(' | ')} |`);
  out.push('');
  out.push('## Log');
  for (const entry of run.log) out.push(`- ${entry}`);
  return `${out.join('\n')}\n`;
}

/** Un valor de celda o de cabecera: una línea, sin «|» (rompería la tabla). */
function cleanValue(key, value) {
  const text = String(value).trim();
  if (/[|\r\n]/.test(text)) throw new RunError(`${key}: el valor no puede llevar «|» ni saltos de línea`, 2);
  return text === '' ? EMPTY : text;
}

function runFile(root, id) {
  return path.join(runDir(root, id), 'run.md');
}

function readRun(root, id) {
  const file = runFile(root, id);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new RunError(`no existe el run ${id} (${file})`);
    throw error;
  }
  const run = parseRun(text);
  if (run.id !== id) run.problems.push({ line: 1, message: `la cabecera dice «${run.id}» y la carpeta es ${id}` });
  return run;
}

function writeRun(root, run) {
  writeAtomic(runFile(root, checkRunId(run.id)), serializeRun(run));
}

/** Ids de los runs de .work/runs con run.md, ordenados. */
function listRuns(root) {
  const dir = path.join(root, '.work', 'runs');
  let names;
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return names
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'run.md')))
    .map((entry) => entry.name)
    .sort();
}

function newRun({ id, meta = {}, units = [] }) {
  checkRunId(id);
  const run = {
    id,
    meta: {
      input: EMPTY, engine: EMPTY, autonomy: 'semi', integration: EMPTY, base_ref: EMPTY,
      cleanup: EMPTY, status: 'planned', confirm1: EMPTY,
    },
    metaComments: {},
    units: [],
    log: [],
    problems: [],
  };
  for (const [key, value] of Object.entries(meta)) setMeta(run, key, value);
  for (const unit of units) {
    checkUnitId(unit.id);
    if (run.units.some((u) => u.unit === unit.id)) throw new RunError(`unidad repetida: ${unit.id}`, 2);
    const row = Object.fromEntries(COLUMNS.map(([key]) => [key, EMPTY]));
    Object.assign(row, {
      unit: unit.id,
      round: unit.round === null || unit.round === undefined ? EMPTY : String(unit.round),
      status: 'pending',
      role: unit.role ? cleanValue('role', unit.role) : EMPTY,
      agent: unit.agent ? cleanValue('agent', unit.agent) : EMPTY,
      attempts: '0',
    });
    run.units.push(row);
  }
  return run;
}

function setMeta(run, key, value) {
  if (!META_KEYS.includes(key)) throw new RunError(`clave de cabecera desconocida: ${key} (${META_KEYS.join(', ')})`, 2);
  const text = cleanValue(key, value);
  const allowed = { status: RUN_STATUS, cleanup: CLEANUP, autonomy: AUTONOMY, engine: [EMPTY, ...ENGINES] }[key];
  if (allowed && !allowed.includes(text)) throw new RunError(`${key} no admite «${text}» (${allowed.join(', ')})`, 2);
  run.meta[key] = text;
  return run;
}

/**
 * Cambia campos de una unidad. `status` respeta las transiciones (salvo `force`); pasar a
 * `dispatching` cuenta un intento; `updated` se pone solo.
 */
function setUnit(run, unitId, fields, { force = false, now = new Date() } = {}) {
  checkUnitId(unitId);
  const unit = run.units.find((u) => u.unit === unitId);
  if (!unit) throw new RunError(`el run ${run.id} no tiene la unidad ${unitId}`);
  const keys = COLUMNS.map(([key]) => key);
  const changes = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!keys.includes(key) || key === 'unit' || key === 'updated') {
      throw new RunError(`campo desconocido o de solo lectura: ${key} (${keys.filter((k) => k !== 'unit' && k !== 'updated').join(', ')})`, 2);
    }
    changes[key] = cleanValue(key, value);
  }
  if (changes.status !== undefined) {
    if (!UNIT_STATUS.includes(changes.status)) throw new RunError(`estado desconocido: ${changes.status} (${UNIT_STATUS.join(', ')})`, 2);
    if (!force && !canMove(unit.status, changes.status)) {
      throw new RunError(`${unitId}: no se pasa de ${unit.status} a ${changes.status} (usa --force si de verdad toca)`);
    }
    if (changes.status === 'dispatching' && unit.status !== 'dispatching' && changes.attempts === undefined) {
      changes.attempts = String((Number.parseInt(unit.attempts, 10) || 0) + 1);
    }
  }
  if (changes.round !== undefined && changes.round !== EMPTY && !/^[0-9]+$/.test(changes.round)) throw new RunError('round tiene que ser un entero ≥0', 2);
  if (changes.attempts !== undefined && !/^[0-9]+$/.test(changes.attempts)) throw new RunError('attempts tiene que ser un entero ≥0', 2);
  Object.assign(unit, changes, { updated: clock(now) });
  return unit;
}

function addLog(run, message, now = new Date()) {
  run.log.push(`${clock(now)} ${cleanValue('log', message)}`);
  return run;
}

module.exports = {
  COLUMNS, META_KEYS, RUN_STATUS, UNIT_STATUS, FLOW, EMPTY,
  canMove, parseRun, serializeRun, runFile, readRun, writeRun, listRuns, newRun, setMeta, setUnit, addLog,
};
