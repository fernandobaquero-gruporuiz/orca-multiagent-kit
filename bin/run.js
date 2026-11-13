// omk run: el motor determinista de la skill orca. Lo que no debe depender de que el modelo se
// acuerde (estado del run, rondas, worktrees, alcance, merge y limpieza) lo hace este código; el
// modelo decide el reparto y revisa. Estado en .work/runs/<run>/ del checkout del coordinador.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { RunError, checkRunId, checkoutRoot, runDir, parseArgs, writeAtomic } = require('./run/util');
const { parseUnits } = require('./run/units');
const ledger = require('./run/ledger');

const HELP = `Uso: omk run <subcomando> [opciones]

  new <run> [--input X] [--autonomy semi] [--engine E] [--integration RAMA] [--base "REF @ SHA"]
                               Crea .work/runs/<run>/run.md con las unidades de su units.md, en pending
  list [--json]                Los runs de este repositorio y su estado
  status [<run>] [--json]      Cabecera, unidades y log de un run (sin <run>, el único activo)
  set <run> <unidad> clave=valor… [--force]
                               Cambia una unidad: status, ref, branch, worktree, base, head, role,
                               agent, round, attempts. status respeta las transiciones de ledger.md
  meta <run> clave=valor…      Cambia la cabecera: status, cleanup, integration, base_ref, confirm1…
  log <run> <texto>            Añade una línea al log con la hora
  plan <run> [--json] [--orchestration RUTA]
                               Valida units.md y calcula rondas, conflictos y si compensa
  start <run> --parent RAMA [--remote origin] [--from local|remote] [--integration RAMA]
                               Base fresca y rama de integración (sale con 3 si la decisión es tuya)
  worktree <run> <unidad> [--path RUTA] [--no-copy]
                               Worktree y rama wt/<run>/<u> desde la integración, con los .env de desarrollo
  check <run> <unidad> [--json]
                               Comprueba que lo cambiado está dentro de su write y commiteado
  merge <run> <unidad> [--dry-run]
                               Integra la rama de una unidad accepted (ensayo y merge --no-ff; nunca push)
  cleanup <run> [--apply] [--json] [--integration RAMA]
                               Inventario de worktrees y ramas del run; --apply borra lo integrado y limpio

Estados de unidad: ${ledger.UNIT_STATUS.join(', ')}.`;

// Subcomandos de otros módulos de bin/run/: se cargan al usarlos.
const EXTERNAL = {
  plan: './run/plan',
  start: './run/git',
  worktree: './run/git',
  check: './run/git',
  merge: './run/git',
  cleanup: './run/cleanup',
};

/** El run indicado o, sin id, el único con status active o closing. */
function resolveRun(root, id) {
  if (id) return checkRunId(id);
  const open = ledger.listRuns(root).filter((name) => {
    try {
      return ['active', 'closing'].includes(ledger.readRun(root, name).meta.status);
    } catch (error) {
      if (error instanceof RunError) return false;
      throw error;
    }
  });
  if (open.length === 1) return open[0];
  if (open.length === 0) throw new RunError('no hay ningún run activo: indica cuál (omk run list)');
  throw new RunError(`hay varios runs activos (${open.join(', ')}): indica cuál`);
}

function pairs(items) {
  const fields = {};
  for (const item of items) {
    const eq = item.indexOf('=');
    if (eq <= 0) throw new RunError(`se esperaba clave=valor: «${item}»`, 2);
    fields[item.slice(0, eq)] = item.slice(eq + 1);
  }
  if (!Object.keys(fields).length) throw new RunError('falta al menos un clave=valor', 2);
  return fields;
}

function printProblems(problems, where) {
  for (const p of problems) console.error(`  ${where}:${p.line}: ${p.message}`);
}

function cmdNew(args, { root }) {
  const { positional, options } = parseArgs(args, { values: ['input', 'autonomy', 'engine', 'integration', 'base'] });
  const id = checkRunId(positional[0]);
  if (positional.length > 1) throw new RunError(`sobra: ${positional.slice(1).join(' ')}`, 2);
  const file = ledger.runFile(root, id);
  if (fs.existsSync(file)) throw new RunError(`el run ${id} ya existe (${file}); para seguirlo: omk run status ${id}`);
  const unitsFile = path.join(runDir(root, id), 'units.md');
  let units = [];
  if (fs.existsSync(unitsFile)) {
    const parsed = parseUnits(fs.readFileSync(unitsFile, 'utf8'));
    if (parsed.problems.length) {
      printProblems(parsed.problems, unitsFile);
      throw new RunError(`units.md tiene ${parsed.problems.length} problema(s) de formato`);
    }
    units = parsed.units.map((u) => ({ id: u.id, round: u.fields.round, role: u.fields.role, agent: u.fields.agent }));
  }
  const meta = {};
  for (const [option, key] of [['input', 'input'], ['autonomy', 'autonomy'], ['engine', 'engine'], ['integration', 'integration'], ['base', 'base_ref']]) {
    if (options[option] !== undefined) meta[key] = options[option];
  }
  const run = ledger.newRun({ id, meta, units });
  ledger.addLog(run, units.length ? `run creado con ${units.length} unidades de units.md` : 'run creado sin units.md');
  ledger.writeRun(root, run);
  console.log(`run ${id} creado: ${path.relative(root, file)} (${units.length} unidades)`);
  return 0;
}

function cmdList(args, { root }) {
  const { positional, options } = parseArgs(args, { flags: ['json'] });
  if (positional.length) throw new RunError(`sobra: ${positional.join(' ')}`, 2);
  const runs = ledger.listRuns(root).map((id) => {
    const run = ledger.readRun(root, id);
    return { id, status: run.meta.status || ledger.EMPTY, cleanup: run.meta.cleanup || ledger.EMPTY, integration: run.meta.integration || ledger.EMPTY, units: run.units.length };
  });
  if (options.json) {
    console.log(JSON.stringify(runs, null, 2));
    return 0;
  }
  if (!runs.length) {
    console.log('no hay runs en .work/runs');
    return 0;
  }
  for (const r of runs) console.log(`${r.id}  ${r.status}  cleanup ${r.cleanup}  ${r.integration}  ${r.units} unidades`);
  return 0;
}

function cmdStatus(args, { root }) {
  const { positional, options } = parseArgs(args, { flags: ['json'] });
  if (positional.length > 1) throw new RunError(`sobra: ${positional.slice(1).join(' ')}`, 2);
  const id = resolveRun(root, positional[0]);
  const run = ledger.readRun(root, id);
  if (options.json) {
    const { metaComments, ...data } = run;
    console.log(JSON.stringify(data, null, 2));
    return run.problems.length ? 1 : 0;
  }
  process.stdout.write(ledger.serializeRun(run));
  if (run.problems.length) printProblems(run.problems, ledger.runFile(root, id));
  return run.problems.length ? 1 : 0;
}

function edit(root, id, change) {
  const run = ledger.readRun(root, id);
  if (run.problems.length) {
    printProblems(run.problems, ledger.runFile(root, id));
    throw new RunError('run.md tiene problemas de formato: arréglalo antes de escribir en él');
  }
  const message = change(run);
  ledger.writeRun(root, run);
  if (message) console.log(message);
  return 0;
}

function cmdSet(args, { root }) {
  const { positional, options } = parseArgs(args, { flags: ['force'] });
  const [id, unitId, ...rest] = positional;
  checkRunId(id);
  const fields = pairs(rest);
  return edit(root, id, (run) => {
    const before = run.units.find((u) => u.unit === unitId);
    const from = before ? before.status : null;
    const unit = ledger.setUnit(run, unitId, fields, { force: Boolean(options.force) });
    const summary = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    ledger.addLog(run, `${unitId} ${fields.status && fields.status !== from ? `${from} → ${unit.status}` : 'actualizada'}${summary ? ` · ${summary}` : ''}${options.force ? ' (forzado)' : ''}`);
    return `${unitId}: ${unit.status}`;
  });
}

function cmdMeta(args, { root }) {
  const { positional } = parseArgs(args);
  const [id, ...rest] = positional;
  checkRunId(id);
  const fields = pairs(rest);
  return edit(root, id, (run) => {
    for (const [key, value] of Object.entries(fields)) ledger.setMeta(run, key, value);
    ledger.addLog(run, `cabecera: ${Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    return `run ${id}: ${Object.keys(fields).join(', ')} actualizado`;
  });
}

function cmdLog(args, { root }) {
  const { positional } = parseArgs(args);
  const [id, ...words] = positional;
  checkRunId(id);
  if (!words.length) throw new RunError('falta el texto: omk run log <run> <texto>', 2);
  return edit(root, id, (run) => {
    ledger.addLog(run, words.join(' '));
    return null;
  });
}

const LOCAL = { new: cmdNew, list: cmdList, status: cmdStatus, set: cmdSet, meta: cmdMeta, log: cmdLog };

/** Punto de entrada: devuelve el código de salida (o una promesa de él). */
function main(args, { cwd = process.cwd() } = {}) {
  const [sub, ...rest] = args;
  if (!sub || sub === 'help' || sub === '-h' || sub === '--help') {
    console.log(HELP);
    return sub ? 0 : 2;
  }
  const ctx = { cwd, root: checkoutRoot(cwd), resolveRun, writeAtomic };
  const handle = (error) => {
    if (!(error instanceof RunError)) throw error;
    console.error(`omk run ${sub}: ${error.message}`);
    return error.code;
  };
  try {
    if (LOCAL[sub]) return LOCAL[sub](rest, ctx);
    if (!EXTERNAL[sub]) throw new RunError(`subcomando desconocido: ${sub}\n${HELP}`, 2);
    let mod;
    try {
      mod = require(EXTERNAL[sub]);
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND' && String(error.message).includes(EXTERNAL[sub].slice(2))) {
        throw new RunError(`omk run ${sub} no está disponible en esta versión del kit`, 2);
      }
      throw error;
    }
    const result = mod.run(sub, rest, ctx);
    return result && typeof result.then === 'function' ? result.catch(handle) : result;
  } catch (error) {
    return handle(error);
  }
}

module.exports = { main, resolveRun, HELP };
