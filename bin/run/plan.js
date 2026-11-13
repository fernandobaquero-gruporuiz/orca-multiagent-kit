// omk run plan: valida units.md y calcula rondas, conflictos y si compensa repartir. No escribe nada.
// Reglas: skills/orca/references/units.md (§Grafo y rondas, §Salida) y rules/95-multi-agent.md (§Cuenta rápida).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { RunError, parseArgs, runDir } = require('./util');
const { parseUnits } = require('./units');

const WILDCARD = /[*?[{]/;
const SIZE_MINUTES = { S: 15, M: 40, L: 90 };
const DEFAULT_MINUTES = SIZE_MINUTES.M;
const COST_PER_UNIT = 5;
const COST_PER_ROUND = 5;
const COST_PER_SHARED = 10;
const CROSS_ROLES = new Set(['ariadna', 'perséfone', 'persefone']);

const segmentsOf = (pattern) => pattern.replace(/^(\.\/)+/, '').split('/').filter(Boolean);
// «src/» cubre toda la carpeta (glob.js lo lee como «src/**»): cuenta como comodín.
const hasWildcard = (pattern) => WILDCARD.test(pattern) || pattern.endsWith('/');

/** Segmentos literales antes del primero con comodín (todos, si el patrón no tiene comodín). */
function literalPrefix(pattern) {
  const out = [];
  for (const segment of segmentsOf(pattern)) {
    if (hasWildcard(segment)) break;
    out.push(segment);
  }
  return out;
}

/** Glob ancho: con comodín y con menos de 2 segmentos literales delante (`**`, `*.js`, `src/**`). */
function isBroadGlob(pattern) {
  return hasWildcard(pattern) && literalPrefix(pattern).length < 2;
}

const startsWithSegments = (long, short) => short.every((segment, i) => long[i] === segment);

/** Solape conservador, sin matcher: dos literales, iguales; con algún glob, un prefijo literal contiene al otro. */
function overlaps(a, b) {
  if (!hasWildcard(a) && !hasWildcard(b)) return segmentsOf(a).join('/') === segmentsOf(b).join('/');
  const pa = literalPrefix(a);
  const pb = literalPrefix(b);
  return startsWithSegments(pa, pb) || startsWithSegments(pb, pa);
}

/** Rutas o globs del bloque de código bajo «## 2. Shared» de ORCHESTRATION.md. */
function parseShared(text) {
  const shared = [];
  let inSection = false;
  let inFence = false;
  for (const line of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!inFence && /^##\s+2\.\s*Shared/i.test(line)) { inSection = true; continue; }
    if (!inSection) continue;
    if (/^\s*```/.test(line)) {
      if (inFence) break;
      inFence = true;
      continue;
    }
    if (!inFence) {
      if (/^##\s/.test(line)) break;
      continue;
    }
    const entry = line.trim();
    if (entry && !entry.startsWith('#')) shared.push(entry);
  }
  return shared;
}

/** Minutos de un `budget` (`45m`, `1h`, `1h30m`) o null si no es válido. */
function parseBudget(value) {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(String(value).trim());
  if (!match || (!match[1] && !match[2])) return null;
  return Number(match[1] || 0) * 60 + Number(match[2] || 0);
}

function findCycles(units, graph) {
  const cycles = [];
  const seen = new Set();
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const next of graph.get(id) || []) {
      if (state.get(next) === 1) {
        const cycle = stack.slice(stack.indexOf(next));
        const key = [...cycle].sort().join(',');
        if (!seen.has(key)) { seen.add(key); cycles.push([...cycle, next]); }
      } else if (!state.get(next)) {
        visit(next);
      }
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const unit of units) if (!state.get(unit.id)) visit(unit.id);
  return cycles;
}

/** Validación por unidad: devuelve los errores {unit, line, message}. */
function validate(units, shared) {
  const errors = [];
  const fail = (unit, message) => errors.push({ unit: unit.id, line: unit.line, message: `${unit.id}: ${message}` });
  const ids = new Set(units.map((u) => u.id));
  const graph = new Map();
  for (const unit of units) {
    const f = unit.fields;
    if (!Array.isArray(f.write)) fail(unit, 'falta el campo write (una unidad de solo lectura lleva «write: []»)');
    if (!f.acceptance || !f.acceptance.length) fail(unit, 'falta acceptance');
    if (Array.isArray(f.write) && f.write.length && (!f.verify || !f.verify.length)) fail(unit, 'write no vacío sin verify');
    for (const dep of f.depends_on || []) {
      if (!ids.has(dep)) fail(unit, `depends_on a una unidad que no existe: ${dep}`);
    }
    graph.set(unit.id, (f.depends_on || []).filter((dep) => ids.has(dep)));
    for (const pattern of f.write || []) {
      if (/^([\\/]|[A-Za-z]:)/.test(pattern)) fail(unit, `ruta absoluta en write: ${pattern}`);
      else if (pattern.split(/[\\/]/).includes('..')) fail(unit, `ruta con «..» en write: ${pattern}`);
      else if (isBroadGlob(pattern)) fail(unit, `glob demasiado ancho en write: ${pattern} (usa uno estrecho, p. ej. src/features/x/**)`);
    }
    if (f.round === 0) {
      const late = (f.depends_on || []).filter((dep) => units.some((u) => u.id === dep && u.fields.round !== 0));
      if (late.length) fail(unit, `es de ronda 0 (coordinador) y depende de ${late.join(', ')}, que no lo es`);
    } else {
      const declared = f.shared || [];
      for (const pattern of shared) {
        const touching = (f.write || []).find((w) => overlaps(w, pattern));
        if (touching && !declared.includes(pattern) && !declared.includes(touching)) {
          fail(unit, `write solapa el fichero shared «${pattern}» y no lo declara en shared`);
        }
      }
    }
  }
  for (const cycle of findCycles(units, graph)) {
    errors.push({ unit: cycle[0], line: units.find((u) => u.id === cycle[0]).line, message: `ciclo en depends_on: ${cycle.join(' → ')}` });
  }
  return errors;
}

/** Rondas: 1 + la mayor de sus depends_on, y el empuje por solape dentro de la misma ronda. */
function computeRounds(units) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const minRound = new Map();
  const reasons = new Map(units.map((u) => [u.id, []]));
  const filesOf = (unit) => [...(unit.fields.write || []), ...(unit.fields.shared || [])];

  const compute = () => {
    const rounds = new Map();
    const visiting = new Set();
    const roundOf = (id) => {
      if (rounds.has(id)) return rounds.get(id);
      const unit = byId.get(id);
      if (unit.fields.round === 0) { rounds.set(id, 0); return 0; }
      if (visiting.has(id)) return 0; // ciclo: ya se ha reportado como error
      visiting.add(id);
      const deps = (unit.fields.depends_on || []).filter((dep) => byId.has(dep)).map(roundOf);
      visiting.delete(id);
      const value = Math.max(1 + Math.max(0, ...deps), minRound.get(id) || 1);
      rounds.set(id, value);
      return value;
    };
    for (const unit of units) roundOf(unit.id);
    return rounds;
  };

  let rounds = compute();
  for (let guard = 0; guard < units.length * units.length + 10; guard += 1) {
    let pushed = false;
    const top = Math.max(0, ...rounds.values());
    for (let r = 1; r <= top && !pushed; r += 1) {
      const seen = [];
      for (const unit of units) {
        if (rounds.get(unit.id) !== r) continue;
        const clash = [];
        for (const mine of filesOf(unit)) {
          if (seen.some((other) => filesOf(other).some((theirs) => overlaps(mine, theirs)))) clash.push(mine);
        }
        if (clash.length) {
          minRound.set(unit.id, r + 1);
          reasons.get(unit.id).push(`solape: ${clash.join(', ')}`);
          pushed = true;
          break;
        }
        seen.push(unit);
      }
    }
    if (!pushed) break;
    rounds = compute();
  }
  return { rounds, reasons };
}

function minutesOf(unit, warnings) {
  const f = unit.fields;
  if (f.budget) {
    const minutes = parseBudget(f.budget);
    if (minutes !== null) return minutes;
    warnings.push({ unit: unit.id, line: unit.line, message: `${unit.id}: budget no válido «${f.budget}» (45m, 1h, 1h30m): se usa el de su talla` });
  }
  return SIZE_MINUTES[String(f.size || '').toUpperCase()] || DEFAULT_MINUTES;
}

/** La cuenta «¿compensa?» de 95-multi-agent.md §Cuenta rápida. */
function computeWorth(rows) {
  const work = rows.filter((row) => row.round >= 1);
  const rounds = [...new Set(work.map((row) => row.round))];
  let saving = 0;
  let parallel = false;
  let sharedAcross = null;
  for (const round of rounds) {
    const group = work.filter((row) => row.round === round);
    saving += group.reduce((sum, row) => sum + row.minutes, 0) - Math.max(...group.map((row) => row.minutes));
    if (group.length >= 2) {
      parallel = true;
      const big = group.find((row) => String(row.size).toUpperCase() === 'L');
      if (big && !sharedAcross) sharedAcross = big.id;
    }
  }
  const sharedFiles = new Set(work.flatMap((row) => row.shared));
  const cost = COST_PER_UNIT * work.length + COST_PER_ROUND * rounds.length + COST_PER_SHARED * sharedFiles.size;
  let verdict = 'sí';
  let reason;
  if (!parallel) {
    verdict = 'no';
    reason = 'ninguna ronda tiene 2 unidades: no hay nada que paralelizar';
  } else if (sharedAcross) {
    verdict = 'no';
    reason = `divide la unidad L (${sharedAcross}): comparte ronda con otras`;
  } else if (saving < cost) {
    verdict = 'no';
    reason = `el ahorro no cubre el coste: faltan ${cost - saving} min`;
  } else {
    reason = saving === cost ? 'empate: se reparte' : `sobran ${saving - cost} min`;
  }
  return { saving, cost, verdict, reason };
}

/** Todo el cálculo, sin tocar disco: {run, units, rounds, errors, warnings, worth}. */
function analyze(text, shared = [], run = null) {
  const { units, problems } = parseUnits(text);
  const errors = problems.map((p) => ({ unit: null, line: p.line, message: p.message }));
  const warnings = [];
  if (!units.length) errors.push({ unit: null, line: 0, message: 'units.md no tiene ninguna unidad («### UNIT: U1 — …»)' });
  errors.push(...validate(units, shared));
  const { rounds, reasons } = computeRounds(units);

  const table = units.map((unit) => {
    const f = unit.fields;
    const write = f.write || [];
    const depends = f.depends_on || [];
    return {
      id: unit.id,
      title: unit.title,
      round: rounds.get(unit.id),
      declaredRound: Number.isInteger(f.round) ? f.round : null,
      role: f.role || null,
      tier: f.tier || null,
      agent: f.agent || null,
      engine: f.engine || null,
      size: f.size || null,
      minutes: minutesOf(unit, warnings),
      write,
      shared: f.shared || [],
      depends_on: depends,
      files: write.length ? String(write.length) : 'lectura',
      depends: depends.length ? depends.join(', ') : '—',
      reasons: reasons.get(unit.id),
    };
  });

  const warn = (unit, message) => warnings.push({ unit: unit.id, line: units.find((u) => u.id === unit.id).line, message: `${unit.id}: ${message}` });
  for (const row of table) {
    const size = String(row.size || '').toUpperCase();
    const sameRound = table.filter((other) => other.round === row.round).length;
    if (row.declaredRound !== null && row.declaredRound !== row.round) warn(row, `round declarado ${row.declaredRound} ≠ calculado ${row.round} (manda el calculado)`);
    if (size === 'L') warn(row, 'talla L: divídela antes de delegar');
    if (size === 'S' && row.round >= 1 && sameRound > 1) warn(row, 'talla S en una ronda con otras: agrúpala o hazla inline');
    const review = units.find((u) => u.id === row.id).fields.review;
    if ((size === 'L' || CROSS_ROLES.has(String(row.role || '').toLowerCase())) && review !== 'cross') warn(row, 'falta review: cross (talla L o rol Ariadna/Perséfone)');
  }

  const last = Math.max(0, ...table.map((row) => row.round || 0));
  const roundList = [];
  for (let r = 0; r <= last; r += 1) {
    const ids = table.filter((row) => row.round === r).map((row) => row.id);
    if (ids.length) roundList.push({ round: r, units: ids, parallel: r === 0 ? 'coordinador' : ids.length >= 2 ? 'sí' : '—' });
  }
  return { run, units: table, rounds: roundList, errors, warnings, worth: computeWorth(table) };
}

function renderText(result) {
  const lines = [`run: ${result.run} · unidades: ${result.units.length}`];
  const rows = result.rounds.map((entry) => {
    const notes = entry.units
      .map((id) => ({ id, reasons: result.units.find((u) => u.id === id).reasons }))
      .filter((u) => u.reasons.length)
      .map((u) => `${u.id}: ${u.reasons.join('; ')}`);
    return [String(entry.round), entry.units.join(', '), notes.length ? `${entry.parallel}   (${notes.join(' · ')})` : entry.parallel];
  });
  const table = [['round', 'unidades', 'paralelo'], ...rows];
  const widths = [0, 1].map((col) => Math.max(...table.map((row) => row[col].length)));
  for (const row of table) lines.push(`${row[0].padEnd(widths[0])} | ${row[1].padEnd(widths[1])} | ${row[2]}`);
  for (const e of result.errors) lines.push(`RISK: error${e.line ? ` (línea ${e.line})` : ''}: ${e.message}`);
  for (const w of result.warnings) lines.push(`RISK: aviso: ${w.message}`);
  const { worth } = result;
  lines.push(`compensa: ${worth.verdict} — ahorro ${worth.saving} min, coste ${worth.cost} min (${worth.reason})`);
  return lines.join('\n');
}

/** `omk run plan <run> [--json] [--orchestration <ruta>]`. Devuelve el código de salida. */
function run(sub, args, ctx) {
  const { positional, options } = parseArgs(args, { flags: ['json'], values: ['orchestration'] });
  if (positional.length > 1) throw new RunError(`sobra: ${positional.slice(1).join(' ')}`, 2);
  const id = ctx.resolveRun(ctx.root, positional[0]);
  const unitsFile = path.join(runDir(ctx.root, id), 'units.md');
  if (!fs.existsSync(unitsFile)) throw new RunError(`no existe ${unitsFile}: escribe las unidades antes de planificar`);

  let shared = [];
  const orchestration = options.orchestration ? path.resolve(ctx.cwd, options.orchestration) : path.join(ctx.root, 'ORCHESTRATION.md');
  if (fs.existsSync(orchestration)) shared = parseShared(fs.readFileSync(orchestration, 'utf8'));
  else if (options.orchestration) throw new RunError(`no existe ${orchestration}`, 2);

  const result = analyze(fs.readFileSync(unitsFile, 'utf8'), shared, id);
  console.log(options.json ? JSON.stringify(result, null, 2) : renderText(result));
  return result.errors.length ? 1 : 0;
}

module.exports = { run, analyze, overlaps, isBroadGlob, parseShared, parseBudget, renderText };
