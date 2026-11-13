// Piezas comunes de `omk run`: git sin shell, validación de nombres y escritura atómica.
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/** Error de uso o de estado que el CLI enseña tal cual (sin traza) con su código de salida. */
class RunError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.name = 'RunError';
    this.code = code;
  }
}

// Ids que acaban en rutas (.work/runs/<run>) y en nombres de rama: solo lo que no puede escapar.
const RUN_ID = /^[0-9]{8}-[a-z0-9][a-z0-9-]{0,63}$/;
const UNIT_ID = /^U[0-9]{1,3}[a-z]?$/;

function checkRunId(id) {
  if (typeof id !== 'string' || !RUN_ID.test(id)) {
    throw new RunError(`id de run no válido: «${id ?? ''}» (formato AAAAMMDD-nombre, minúsculas, cifras y guiones)`, 2);
  }
  return id;
}

function checkUnitId(id) {
  if (typeof id !== 'string' || !UNIT_ID.test(id)) {
    throw new RunError(`id de unidad no válido: «${id ?? ''}» (formato U<n>, p. ej. U2 o U2r)`, 2);
  }
  return id;
}

/**
 * Ejecuta git con los argumentos en array (nunca por shell). Devuelve {status, stdout, stderr};
 * con `check` lanza RunError si git sale con error.
 */
function git(args, { cwd, check = true, input } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', input, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new RunError(`no pude ejecutar git: ${result.error.message}`);
  const out = { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
  if (check && out.status !== 0) {
    throw new RunError(`git ${args.join(' ')} falló (${out.status}): ${out.stderr.trim() || out.stdout.trim()}`);
  }
  return out;
}

/** Nombre de rama válido para git (git check-ref-format --branch) y que no empieza por «-». */
function checkBranch(name, cwd) {
  // «@{-1}» y «@» los expande check-ref-format a otra rama: aquí solo valen nombres literales.
  if (typeof name !== 'string' || !name || name === '@' || name.includes('@{') || name.startsWith('-') || /[\s\u0000-\u001f]/.test(name)) {
    throw new RunError(`nombre de rama no válido: «${name ?? ''}»`, 2);
  }
  const res = git(['check-ref-format', '--branch', name], { cwd, check: false });
  if (res.status !== 0) throw new RunError(`nombre de rama no válido: «${name}»`, 2);
  return name;
}

/**
 * Raíz del checkout del coordinador, donde vive .work/runs: la del árbol de trabajo de `cwd`. Con
 * Orca, el coordinador trabaja en su propio workspace (que ya es un worktree), y su run es suyo, no del
 * checkout del que salió. Fuera de un repositorio git, la carpeta dada.
 */
function checkoutRoot(cwd) {
  const top = git(['rev-parse', '--show-toplevel'], { cwd, check: false });
  return top.status === 0 ? path.resolve(top.stdout.trim()) : path.resolve(cwd);
}

const runsDir = (root) => path.join(root, '.work', 'runs');
const runDir = (root, id) => path.join(runsDir(root), checkRunId(id));

/** Escribe sin dejar un fichero a medias: a un temporal en la misma carpeta y renombrado. */
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  try {
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

/**
 * Opciones `--clave valor`, `--clave=valor` y banderas. `flags` son las que no llevan valor.
 * Devuelve {positional, options}; una opción desconocida es un error.
 */
function parseArgs(args, { flags = [], values = [] } = {}) {
  const positional = [];
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') { positional.push(...args.slice(i + 1)); break; }
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const eq = arg.indexOf('=');
    const name = arg.slice(2, eq === -1 ? undefined : eq);
    if (flags.includes(name)) {
      if (eq !== -1) throw new RunError(`--${name} no lleva valor`, 2);
      options[name] = true;
    } else if (values.includes(name)) {
      const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
      if (value === undefined) throw new RunError(`falta el valor de --${name}`, 2);
      options[name] = value;
    } else {
      throw new RunError(`opción desconocida: --${name}`, 2);
    }
  }
  return { positional, options };
}

/** Hora local HH:MM, como la columna `updated` de run.md. */
const clock = (date = new Date()) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

module.exports = { RunError, RUN_ID, UNIT_ID, checkRunId, checkUnitId, checkBranch, git, checkoutRoot, runsDir, runDir, writeAtomic, parseArgs, clock };
