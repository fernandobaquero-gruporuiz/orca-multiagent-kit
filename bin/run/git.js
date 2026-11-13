// omk run start | worktree | check | merge: lo que toca git en un run. Base fresca y rama de
// integración, un worktree por unidad, alcance contra write y merge --no-ff con ensayo previo.
// Nunca hace push, reset, --force ni borra nada: ante la duda se niega y explica qué falta.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { RunError, UNIT_ID, checkUnitId, checkBranch, git, parseArgs, runDir } = require('./util');
const { parseUnits } = require('./units');
const ledger = require('./ledger');
const glob = require('./glob');

const { EMPTY } = ledger;
const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SHA = /^[0-9a-f]{7,64}$/;
const MERGE_TREE_MIN = [2, 38];
const LOCKFILES = [
  'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'Cargo.lock',
  'poetry.lock', 'uv.lock', 'Pipfile.lock', 'go.sum', 'composer.lock', 'Gemfile.lock',
];
/**
 * Prohibidos a un worker, sin distinguir mayúsculas: por nombre en cualquier carpeta y por glob
 * (planes y .plans desde la raíz, .work en cualquier nivel). Se comparan en minúsculas.
 */
const FORBIDDEN_NAMES = new Set(['tasks.md', 'ORCHESTRATION.md', 'STACK.md', ...LOCKFILES].map((n) => n.toLowerCase()));
const FORBIDDEN_GLOBS = ['planes/**/*.md', '.plans/**/*.md', '.work/**', '**/.work/**'];
/** Un segmento de ruta que parece de producción: contiene «prod» o la palabra prd o live. */
const PRODUCTION = [/prod/i, /(^|[._-])(prd|live)([._-]|$)/i];
/** Operaciones a medias que dejan el árbol en un estado que start y merge no deben tocar. */
const IN_PROGRESS = [
  ['MERGE_HEAD', 'un merge'], ['CHERRY_PICK_HEAD', 'un cherry-pick'], ['REVERT_HEAD', 'un revert'],
  ['rebase-merge', 'un rebase'], ['rebase-apply', 'un rebase o un am'],
];

// ---------------------------------------------------------------- git y run.md

/** Sha abreviado solo para mensajes; lo que se anota en run.md sale de abbrev() (sin ambigüedad). */
const short = (sha) => sha.slice(0, 7);

function abbrev(cwd, sha) {
  return git(['rev-parse', '--short', sha], { cwd }).stdout.trim();
}

function refSha(cwd, ref) {
  const res = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd, check: false });
  return res.status === 0 ? res.stdout.trim() : null;
}

/** Ruta (absoluta) de un fichero del directorio git de `cwd`; vale también dentro de un worktree. */
function gitPath(cwd, name) {
  return path.resolve(cwd, git(['rev-parse', '--git-path', name], { cwd }).stdout.trim());
}

const mergeInProgress = (cwd) => fs.existsSync(gitPath(cwd, 'MERGE_HEAD'));

/** Se niega si hay un merge, cherry-pick, revert o rebase a medias en `cwd`. */
function requireNoOperation(cwd) {
  for (const [name, what] of IN_PROGRESS) {
    if (fs.existsSync(gitPath(cwd, name))) {
      throw new RunError(`hay ${what} a medias en ${cwd} (${name}): termínalo o abórtalo tú antes de seguir`);
    }
  }
}

function currentBranch(cwd) {
  const res = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd, check: false });
  return res.status === 0 ? res.stdout.trim() : null;
}

/** Cambios en ficheros versionados (los sin versionar no impiden cambiar de rama ni mergear). */
function requireCleanTree(cwd, why) {
  const dirty = git(['status', '--porcelain', '--untracked-files=no'], { cwd }).stdout.trim();
  if (dirty) {
    throw new RunError(`hay cambios sin commitear en ficheros versionados de ${cwd} y ${why}:\n${dirty}\ncommitéalos o apártalos tú antes de seguir`);
  }
}

/** La rama por defecto según `<remote>/HEAD`; si no se sabe, main y master cuentan como tales. */
function defaultBranches(cwd, remote = 'origin') {
  const res = git(['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`], { cwd, check: false });
  const prefix = `refs/remotes/${remote}/`;
  const ref = res.stdout.trim();
  if (res.status === 0 && ref.startsWith(prefix)) return [ref.slice(prefix.length)];
  return ['main', 'master'];
}

function gitVersion(cwd) {
  const match = /(\d+)\.(\d+)/.exec(git(['--version'], { cwd }).stdout);
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

/**
 * Ruta canónica (en Windows deshace nombres 8.3 y mayúsculas). Si no existe, la de su antecesor
 * más cercano que exista más el resto; si no se puede leer, solo resuelta.
 */
function canonical(p) {
  let current = path.resolve(p);
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...rest);
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'EPERM', 'EACCES'].includes(error.code)) throw error;
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(p);
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

function samePath(a, b) {
  const x = canonical(a);
  const y = canonical(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/** Si `child` está dentro de `parent` (o es él). */
function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function loadRun(root, id) {
  const run = ledger.readRun(root, id);
  if (run.problems.length) {
    const lines = run.problems.map((p) => `  ${ledger.runFile(root, id)}:${p.line}: ${p.message}`).join('\n');
    throw new RunError(`run.md tiene problemas de formato: arréglalo antes de seguir\n${lines}`);
  }
  return run;
}

function loadUnit(root, id, unitId) {
  const file = path.join(runDir(root, id), 'units.md');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new RunError(`el run ${id} no tiene units.md (${file})`);
    throw error;
  }
  const parsed = parseUnits(text);
  if (parsed.problems.length) {
    const lines = parsed.problems.map((p) => `  ${file}:${p.line}: ${p.message}`).join('\n');
    throw new RunError(`units.md tiene problemas de formato:\n${lines}`);
  }
  const unit = parsed.units.find((u) => u.id === unitId);
  if (!unit) throw new RunError(`units.md del run ${id} no tiene la unidad ${unitId}`);
  return unit;
}

function rowOf(run, unitId) {
  const row = run.units.find((u) => u.unit === unitId);
  if (!row) throw new RunError(`run.md del run ${run.id} no tiene la unidad ${unitId}`);
  return row;
}

const present = (value) => value !== undefined && value !== null && value !== '' && value !== EMPTY;

function integrationOf(run, cwd) {
  if (!present(run.meta.integration)) {
    throw new RunError(`el run ${run.id} no tiene rama de integración: ejecuta antes omk run start ${run.id} --parent <rama>`);
  }
  return checkBranch(run.meta.integration, cwd);
}

/** `<run> <unidad>` o, si solo llega la unidad, el único run activo. */
function runAndUnit(positional, ctx, usage) {
  if (positional.length === 2) return [ctx.resolveRun(ctx.root, positional[0]), checkUnitId(positional[1])];
  if (positional.length === 1 && UNIT_ID.test(positional[0])) return [ctx.resolveRun(ctx.root), positional[0]];
  throw new RunError(`uso: ${usage}`, 2);
}

const unitBranch = (id, unitId) => `wt/${id}/${unitId.toLowerCase()}`;
const defaultWorktree = (root, id, unitId) => path.join(path.dirname(root), `${path.basename(root)}.wt`, id, unitId.toLowerCase());

// ---------------------------------------------------------------- start

/** Commits de `right` que no están en `left` y al revés: [detrás, delante] de `right` respecto a `left`. */
function aheadBehind(cwd, left, right) {
  const counts = git(['rev-list', '--left-right', '--count', `${left}...${right}`], { cwd }).stdout.trim().split(/\s+/).map(Number);
  if (counts.length !== 2 || !counts.every(Number.isInteger)) throw new RunError(`no entiendo la salida de git rev-list: «${counts.join(' ')}»`);
  return counts;
}

/**
 * Base de la rama de integración según la tabla de SKILL.md §4: {ref, sha, note}. Con `noFetch`
 * compara con las refs remotas que ya hay (el usuario decidió seguir sin actualizar).
 */
function freshBase(root, parent, remote, from, noFetch) {
  const remotes = git(['remote'], { cwd: root }).stdout.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  const localSha = refSha(root, `refs/heads/${parent}`);
  if (!remotes.includes(remote)) {
    if (!localSha) throw new RunError(`no existe la rama ${parent} y no hay remoto ${remote}`);
    return { ref: parent, sha: localSha, note: `sin remoto ${remote}: parto de la rama local ${parent}` };
  }
  let fetchNote = '';
  if (noFetch) {
    fetchNote = ` (--no-fetch: refs de ${remote} sin actualizar)`;
  } else {
    // Sin terminal: que un remoto con credenciales falle en vez de quedarse esperando una contraseña.
    if (process.env.GIT_TERMINAL_PROMPT === undefined) process.env.GIT_TERMINAL_PROMPT = '0';
    const fetched = git(['fetch', '--prune', remote], { cwd: root, check: false });
    if (fetched.status !== 0) {
      const reason = (fetched.stderr.trim() || fetched.stdout.trim()).split(/\r?\n/).pop();
      throw new RunError(`RISK: no pude actualizar ${remote} (${reason}). Pregunta al usuario; para seguir con lo que hay: --no-fetch`);
    }
  }
  const pick = (ref, sha, note) => ({ ref, sha, note: `${note}${fetchNote}` });
  const remoteRef = `${remote}/${parent}`;
  const remoteSha = refSha(root, `refs/remotes/${remoteRef}`);
  if (!remoteSha) {
    if (!localSha) throw new RunError(`no existe ${parent} ni ${remoteRef}`);
    return pick(parent, localSha, `${remoteRef} no existe: parto de la rama local ${parent}`);
  }
  if (!localSha) return pick(remoteRef, remoteSha, `${parent} no existe en local: parto de ${remoteRef}`);
  const [behind, ahead] = aheadBehind(root, `refs/remotes/${remoteRef}`, `refs/heads/${parent}`);
  if (ahead === 0 && behind === 0) return pick(parent, localSha, `${parent} y ${remoteRef} coinciden`);
  // La decisión explícita del usuario manda sobre la tabla.
  if (from === 'local') return pick(parent, localSha, `--from local: parto de ${parent} (${ahead} commit(s) sin subir, ${behind} por detrás de ${remoteRef})`);
  if (from === 'remote') return pick(remoteRef, remoteSha, `--from remote: parto de ${remoteRef}${ahead ? ` sin los ${ahead} commit(s) de la local` : ''}`);
  if (ahead === 0) return pick(remoteRef, remoteSha, `${parent} va ${behind} commit(s) por detrás de ${remoteRef}: parto de ${remoteRef} (la local no se toca)`);
  throw new RunError([
    `la rama local ${parent} tiene ${ahead} commit(s) que no están en ${remoteRef}${behind ? ` y le faltan ${behind}` : ''}. Decide la base:`,
    `  --from remote  parte de ${remoteRef} (sin esos commits locales)`,
    `  --from local   parte de ${parent} con sus commits sin subir`,
  ].join('\n'), 3);
}

function cmdStart(args, ctx) {
  const { root } = ctx;
  const { positional, options } = parseArgs(args, { values: ['parent', 'remote', 'from', 'integration'], flags: ['no-fetch'] });
  if (positional.length > 1) throw new RunError(`sobra: ${positional.slice(1).join(' ')}`, 2);
  const id = ctx.resolveRun(root, positional[0]);
  if (options.parent === undefined) throw new RunError('falta --parent <rama> (la rama destino del merge final)', 2);
  const parent = checkBranch(options.parent, root);
  const remote = options.remote === undefined ? 'origin' : options.remote;
  if (!REMOTE_NAME.test(remote)) throw new RunError(`nombre de remoto no válido: «${remote}»`, 2);
  if (options.from !== undefined && !['local', 'remote'].includes(options.from)) throw new RunError('--from admite local o remote', 2);

  const run = loadRun(root, id);
  const saved = present(run.meta.integration) ? run.meta.integration : null;
  if (saved && options.integration !== undefined && options.integration !== saved) {
    throw new RunError(`run.md ya dice integration: ${saved}; si de verdad cambia, hazlo antes con omk run meta ${id} integration=…`);
  }
  const wanted = options.integration !== undefined ? options.integration : saved;
  if (!wanted) throw new RunError('falta la rama de integración: --integration <rama> (o integration en run.md)', 2);
  const integration = checkBranch(wanted, root);
  if (integration === parent) throw new RunError(`la rama de integración no puede ser la padre (${parent})`);
  if (defaultBranches(root, remote).includes(integration)) throw new RunError(`la rama de integración no puede ser la rama por defecto (${integration})`);
  requireNoOperation(root);
  requireCleanTree(root, 'start va a cambiar de rama');

  const base = freshBase(root, parent, remote, options.from, Boolean(options['no-fetch']));
  const baseShort = abbrev(root, base.sha);
  console.log(`base: ${base.ref} @ ${baseShort} — ${base.note}`);

  const existing = refSha(root, `refs/heads/${integration}`);
  const remoteIntegration = refSha(root, `refs/remotes/${remote}/${integration}`);
  let baseRef = run.meta.base_ref;
  if (existing) {
    // --no-overwrite-ignore: un fichero ignorado del checkout (un .env) no se pisa al cambiar de rama.
    if (currentBranch(root) !== integration) git(['switch', '--quiet', '--no-overwrite-ignore', integration], { cwd: root });
    console.log(`la rama de integración ${integration} ya existe (${short(existing)}): no la recreo; estás en ella`);
    if (git(['merge-base', '--is-ancestor', base.sha, existing], { cwd: root, check: false }).status !== 0) {
      console.log(`aviso: la rama padre ha avanzado: ${base.ref} @ ${baseShort} no está en ${integration}; dilo en el plan`);
    }
    if (remoteIntegration) {
      const [behind, ahead] = aheadBehind(root, `refs/remotes/${remote}/${integration}`, `refs/heads/${integration}`);
      if (behind || ahead) console.log(`aviso: ${integration} va ${behind} commit(s) por detrás y ${ahead} por delante de ${remote}/${integration}; no lo toco`);
    }
    if (!present(baseRef)) baseRef = `${base.ref} @ ${baseShort}`;
  } else {
    if (remoteIntegration) {
      throw new RunError(`existe ${remote}/${integration} pero no la rama local: decide si seguir la remota (git switch ${integration}) o usar otro nombre`, 3);
    }
    git(['switch', '--quiet', '--no-overwrite-ignore', '--no-track', '-c', integration, base.sha], { cwd: root });
    console.log(`rama de integración ${integration} creada desde ${base.ref} @ ${baseShort} (sin upstream)`);
    baseRef = `${base.ref} @ ${baseShort}`;
  }

  if (!saved) ledger.setMeta(run, 'integration', integration);
  ledger.setMeta(run, 'base_ref', baseRef);
  if (run.meta.status === 'planned') ledger.setMeta(run, 'status', 'active');
  ledger.addLog(run, `start: ${existing ? 'reanuda' : 'crea'} ${integration} · base ${base.ref} @ ${baseShort} · ${base.note}`);
  ledger.writeRun(root, run);
  return 0;
}

// ---------------------------------------------------------------- worktree

/** Lee .worktreeinclude: rutas literales, una por línea, `#` comentario. */
function readIncludes(root) {
  const file = path.join(root, '.worktreeinclude');
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (!stat.isFile()) throw new RunError('.worktreeinclude no es un fichero regular: no lo sigo');
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/** Motivo por el que una línea de .worktreeinclude no se copia, o null si es válida. */
function includeProblem(root, entry) {
  if (path.isAbsolute(entry) || path.win32.isAbsolute(entry) || /^[A-Za-z]:/.test(entry) || entry.startsWith('\\')) return 'ruta absoluta';
  const segments = entry.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.');
  if (!segments.length) return 'ruta vacía';
  if (segments.includes('..')) return 'sale de la raíz con «..»';
  if (glob.isGlob(entry.replace(/\\/g, '/'))) return 'parece un glob (solo rutas literales)';
  let current = root;
  for (let i = 0; i < segments.length; i += 1) {
    current = path.join(current, segments[i]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return 'no existe';
      throw error;
    }
    if (stat.isSymbolicLink()) return 'es o cruza un enlace simbólico';
    if (i === segments.length - 1 && !stat.isFile()) return 'no es un fichero regular';
  }
  if (!isInside(root, current)) return 'sale de la raíz';
  const rel = segments.join('/');
  if (git(['check-ignore', '-q', '--', rel], { cwd: root, check: false }).status !== 0) return 'no está ignorado por git (lo versionado ya viene en el worktree)';
  return null;
}

/** lstat sin seguir enlaces (uno roto también existe), o null si no hay nada en esa ruta. */
function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

/** Copia los ficheros permitidos de .worktreeinclude. Nunca lee ni enseña su contenido. */
function copyIncludes(root, worktree) {
  const report = [];
  for (const entry of readIncludes(root)) {
    const segments = entry.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.');
    if (segments.some((segment) => PRODUCTION.some((re) => re.test(segment)))) {
      report.push({ entry, copied: false, reason: 'parece de producción', risk: true });
      continue;
    }
    const problem = includeProblem(root, entry);
    if (problem) {
      report.push({ entry, copied: false, reason: problem });
      continue;
    }
    const dest = path.join(worktree, ...segments);
    let parent = worktree;
    let blocked = null;
    for (const segment of segments.slice(0, -1)) {
      parent = path.join(parent, segment);
      try {
        if (fs.lstatSync(parent).isSymbolicLink()) { blocked = 'en el worktree cruza un enlace simbólico'; break; }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (!blocked && lstatOrNull(dest)) blocked = 'ya existe en el worktree (no lo piso)';
    if (blocked) {
      report.push({ entry, copied: false, reason: blocked });
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, ...segments), dest, fs.constants.COPYFILE_EXCL);
    report.push({ entry, copied: true });
  }
  return report;
}

/** Entrada de `git worktree list --porcelain` cuya rama es `branch`, o null. */
function worktreeOfBranch(root, branch) {
  const text = git(['worktree', 'list', '--porcelain'], { cwd: root }).stdout;
  for (const block of text.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const wt = lines.find((l) => l.startsWith('worktree '));
    if (wt && lines.includes(`branch refs/heads/${branch}`)) return wt.slice('worktree '.length);
  }
  return null;
}

function cmdWorktree(args, ctx) {
  const { root, cwd } = ctx;
  const { positional, options } = parseArgs(args, { values: ['path'], flags: ['no-copy'] });
  const [id, unitId] = runAndUnit(positional, ctx, 'omk run worktree <run> <unidad> [--path <ruta>] [--no-copy]');
  const run = loadRun(root, id);
  const row = rowOf(run, unitId);
  loadUnit(root, id, unitId);
  const integration = integrationOf(run, root);
  const baseSha = refSha(root, `refs/heads/${integration}`);
  if (!baseSha) throw new RunError(`no existe la rama de integración ${integration}: ejecuta antes omk run start ${id}`);
  const branch = checkBranch(unitBranch(id, unitId), root);
  const target = options.path !== undefined ? path.resolve(cwd, options.path) : defaultWorktree(root, id, unitId);
  if (/[|\r\n]/.test(target)) throw new RunError('la ruta del worktree no puede llevar «|» ni saltos de línea (rompería run.md)', 2);
  const [realTarget, realRoot] = [canonical(target), canonical(root)];
  if (isInside(realTarget, realRoot)) throw new RunError(`la ruta ${target} contiene el checkout del coordinador`, 2);
  if (isInside(realRoot, realTarget)) throw new RunError(`la ruta ${target} queda dentro del checkout del coordinador: elige una fuera`, 2);
  const otherBranch = present(row.branch) && row.branch !== branch;
  const otherWorktree = present(row.worktree) && !samePath(path.resolve(root, row.worktree), target);
  if (otherBranch || otherWorktree) {
    throw new RunError(`la fila de ${unitId} en run.md ya tiene branch ${row.branch} y worktree ${row.worktree}, distintos de ${branch} y ${target}: no la piso`);
  }

  if (refSha(root, `refs/heads/${branch}`)) {
    const where = worktreeOfBranch(root, branch);
    if (where && samePath(where, target)) {
      console.log(`${unitId}: el worktree ya existe (${target}, rama ${branch}): no toco nada`);
      return 0;
    }
    throw new RunError(`la rama ${branch} ya existe ${where ? `con worktree en ${where}` : 'sin worktree'}: no la piso`);
  }
  let stat = null;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (stat && (!stat.isDirectory() || fs.readdirSync(target).length)) {
    throw new RunError(`${target} ya existe y no es una carpeta vacía: elige otra con --path`);
  }

  git(['worktree', 'add', '--quiet', '-b', branch, target, `refs/heads/${integration}`], { cwd: root });
  const base = abbrev(root, baseSha);
  console.log(`${unitId}: worktree ${target} · rama ${branch} desde ${integration} @ ${base}`);
  // Se anota ya: si la copia falla después, el worktree creado consta en run.md (cleanup lo encuentra).
  ledger.setUnit(run, unitId, { branch, worktree: target, base });
  ledger.addLog(run, `${unitId} worktree ${target} · rama ${branch} · base ${base}`);
  ledger.writeRun(root, run);
  if (options['no-copy']) return 0;

  const report = copyIncludes(root, target);
  for (const r of report) {
    if (r.copied) console.log(`  copiado: ${r.entry}`);
    else if (r.risk) console.log(`RISK: omitido ${r.entry}: ${r.reason}; no se copia a ningún worktree`);
    else console.log(`  omitido: ${r.entry} — ${r.reason}`);
  }
  const copied = report.filter((r) => r.copied).length;
  const risky = report.filter((r) => r.risk).length;
  if (copied || risky) {
    ledger.addLog(run, `${unitId} .worktreeinclude: ${copied} copiado(s)${risky ? `, ${risky} omitido(s) por parecer de producción` : ''}`);
    ledger.writeRun(root, run);
  }
  return 0;
}

// ---------------------------------------------------------------- check

/** Si un worker no puede tocar este fichero aunque lo cubra un glob de write o shared. */
function isForbidden(file) {
  const lower = glob.normalizePath(file).toLowerCase();
  const name = lower.split('/').pop();
  return FORBIDDEN_NAMES.has(name) || FORBIDDEN_GLOBS.some((pattern) => glob.matches(lower, pattern));
}

/**
 * El worktree de la unidad: la celda de run.md (relativa a root) o, si está vacía o entre
 * paréntesis («(Orca)»), el que git tenga registrado para su rama. {path, problem}.
 */
function unitWorktree(root, row, branch) {
  const cell = present(row.worktree) ? row.worktree.trim() : '';
  if (!cell || /^\(.*\)$/.test(cell)) return { path: worktreeOfBranch(root, branch), problem: null };
  const resolved = path.resolve(root, cell);
  if (!lstatOrNull(resolved)) return { path: null, problem: `el worktree ${cell} de run.md no existe` };
  return { path: resolved, problem: null };
}

const splitZ = (text) => text.split('\0').filter(Boolean);

function gitDir(cwd) {
  const res = git(['rev-parse', '--git-common-dir'], { cwd, check: false });
  return res.status === 0 ? path.resolve(cwd, res.stdout.trim()) : null;
}

/**
 * Alcance de una unidad: lo que su rama cambia respecto a la rama de integración (desde su
 * merge-base: si el worker trajo la integración, lo ajeno no cuenta; si revirtió algo integrado, sí)
 * y lo que quede sin commitear en su worktree, contra write ∪ shared. `ok` es false si algo impide integrar.
 */
function checkScope(root, run, unitId) {
  const row = rowOf(run, unitId);
  const unit = loadUnit(root, run.id, unitId);
  if (!present(row.base)) throw new RunError(`${unitId} no tiene base en run.md (la anota omk run worktree)`);
  if (!SHA.test(row.base)) throw new RunError(`${unitId}: base no es un sha: «${row.base}»`);
  if (!present(row.branch)) throw new RunError(`${unitId} no tiene rama en run.md (la anota omk run worktree)`);
  const branch = checkBranch(row.branch, root);
  const integration = integrationOf(run, root);
  const base = refSha(root, row.base);
  if (!base) throw new RunError(`${unitId}: la base ${row.base} no es un commit de este repositorio`);
  if (!refSha(root, `refs/heads/${branch}`)) throw new RunError(`${unitId}: no existe la rama ${branch}`);
  if (!refSha(root, `refs/heads/${integration}`)) throw new RunError(`no existe la rama de integración ${integration}`);

  const problems = [];
  if (git(['merge-base', '--is-ancestor', base, `refs/heads/${branch}`], { cwd: root, check: false }).status !== 0) {
    problems.push(`la base ${row.base} de run.md no es antecesora de ${branch}`);
  }
  const committed = splitZ(git(['diff', '--name-only', '--no-renames', '-z', `refs/heads/${integration}...refs/heads/${branch}`], { cwd: root }).stdout);
  const uncommitted = [];
  const located = unitWorktree(root, row, branch);
  if (located.problem) problems.push(located.problem);
  const worktree = located.path;
  if (worktree) {
    if (gitDir(worktree) === null || !samePath(gitDir(worktree), gitDir(root))) {
      problems.push(`el worktree ${worktree} no es de este repositorio`);
    } else {
      const head = currentBranch(worktree);
      if (head !== branch) problems.push(`el worktree ${worktree} está en ${head || 'HEAD suelto'}, no en ${branch}`);
      const status = git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'], { cwd: worktree }).stdout;
      for (const entry of splitZ(status)) uncommitted.push(entry.slice(3));
    }
  }

  const write = unit.fields.write || [];
  const allowed = [...write, ...(unit.fields.shared || [])];
  const literal = new Set(write.map((w) => glob.normalizePath(w)));
  const changed = [...new Set([...committed, ...uncommitted])].sort();
  const forbidden = [];
  const outOfScope = [];
  for (const file of changed) {
    if (literal.has(file)) continue;
    if (isForbidden(file)) forbidden.push(file);
    else if (!allowed.some((pattern) => glob.matches(file, pattern))) outOfScope.push(file);
  }
  const ok = !problems.length && !forbidden.length && !outOfScope.length && !uncommitted.length;
  return {
    run: run.id, unit: unitId, base: row.base, branch, worktree, ok,
    changed, committed, uncommitted: [...new Set(uncommitted)].sort(), out_of_scope: outOfScope, forbidden, problems,
  };
}

function printScope(report, stream = console.log) {
  stream(`check ${report.unit} (${report.branch}, base ${report.base}): ${report.changed.length} fichero(s) cambiado(s)`);
  for (const p of report.problems) stream(`  problema: ${p}`);
  for (const f of report.out_of_scope) stream(`  fuera de alcance: ${f}`);
  for (const f of report.forbidden) stream(`  prohibido a un worker: ${f}`);
  for (const f of report.uncommitted) stream(`  sin commitear: ${f}`);
  stream(report.ok ? `check ${report.unit}: OK` : `check ${report.unit}: FALLA (merge solo integra commits dentro de write ∪ shared)`);
}

function cmdCheck(args, ctx) {
  const { positional, options } = parseArgs(args, { flags: ['json'] });
  const [id, unitId] = runAndUnit(positional, ctx, 'omk run check <run> <unidad> [--json]');
  const report = checkScope(ctx.root, loadRun(ctx.root, id), unitId);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printScope(report);
  return report.ok ? 0 : 1;
}

// ---------------------------------------------------------------- merge

function cmdMerge(args, ctx) {
  const { root } = ctx;
  const { positional, options } = parseArgs(args, { flags: ['dry-run'] });
  const [id, unitId] = runAndUnit(positional, ctx, 'omk run merge <run> <unidad> [--dry-run]');
  const run = loadRun(root, id);
  const row = rowOf(run, unitId);
  const unit = loadUnit(root, id, unitId);
  const integration = integrationOf(run, root);
  if (defaultBranches(root).includes(integration)) {
    throw new RunError(`la rama de integración ${integration} es la rama por defecto: el merge a ella lo decide el usuario, no omk run`);
  }
  const current = currentBranch(root);
  if (current !== integration) throw new RunError(`estás en ${current || 'HEAD suelto'}, no en la rama de integración ${integration} (git switch ${integration})`);
  requireNoOperation(root);
  requireCleanTree(root, 'merge necesita el árbol limpio');
  if (row.status !== 'accepted') throw new RunError(`${unitId} está en ${row.status}: solo se integra una unidad accepted`);

  const scope = checkScope(root, run, unitId);
  if (!scope.ok) {
    printScope(scope, console.error);
    throw new RunError(`${unitId} no pasa check: no la integro`);
  }
  const branchRef = `refs/heads/${scope.branch}`;
  const pending = Number(git(['rev-list', '--count', `refs/heads/${integration}..${branchRef}`], { cwd: root }).stdout.trim());
  if (pending === 0) {
    throw new RunError(`${unitId}: la rama ${scope.branch} no aporta commits a ${integration}; ¿se quedaron sin commitear? No la marco como merged`);
  }
  // git merge acepta --no-overwrite-ignore pero la estrategia ort (la de siempre desde git 2.34)
  // no lo respeta: se comprueba aquí que nada de la rama caiga sobre un fichero sin versionar o ignorado.
  const tracked = new Set(splitZ(git(['ls-files', '-z'], { cwd: root }).stdout));
  const clobbered = scope.committed.filter((file) => !tracked.has(file) && lstatOrNull(path.join(root, ...file.split('/'))));
  if (clobbered.length) {
    throw new RunError(`${unitId}: el merge pisaría ficheros sin versionar o ignorados de ${root}:\n${clobbered.map((f) => `  ${f}`).join('\n')}\napártalos tú antes de integrar; no toco nada`);
  }

  const [major, minor] = gitVersion(root);
  if (major < MERGE_TREE_MIN[0] || (major === MERGE_TREE_MIN[0] && minor < MERGE_TREE_MIN[1])) {
    throw new RunError(`git ${major}.${minor} no tiene merge-tree --write-tree: hace falta git ≥ ${MERGE_TREE_MIN.join('.')} para ensayar el merge`);
  }
  const trial = git(['merge-tree', '--write-tree', '--name-only', '--no-messages', `refs/heads/${integration}`, branchRef], { cwd: root, check: false });
  if (trial.status === 1) {
    const files = [...new Set(trial.stdout.split(/\r?\n/).slice(1).map((l) => l.trim()).filter(Boolean))];
    throw new RunError(`${unitId}: el ensayo da conflictos con ${integration} en:\n${files.map((f) => `  ${f}`).join('\n')}\nno toco nada (95-multi-agent.md §Conflictos)`);
  }
  if (trial.status !== 0) {
    throw new RunError(`git merge-tree falló (${trial.status}): ${trial.stderr.trim()} — hace falta git ≥ ${MERGE_TREE_MIN.join('.')}`);
  }
  if (options['dry-run']) {
    console.log(`${unitId}: el ensayo de ${scope.branch} sobre ${integration} sale limpio (${scope.changed.length} fichero(s)); no he integrado nada`);
    return 0;
  }

  const message = `merge(${id}): ${unitId}${unit.title ? ` — ${unit.title}` : ''}`;
  const before = refSha(root, 'HEAD');
  // requireNoOperation garantiza que no había MERGE_HEAD: si aparece, lo ha dejado este merge.
  // --no-overwrite-ignore: un fichero ignorado del checkout (un .env) no se pisa con uno de la rama.
  const merged = git(['merge', '--no-ff', '--no-edit', '--no-overwrite-ignore', '-m', message, branchRef], { cwd: root, check: false });
  if (merged.status !== 0) {
    const detail = merged.stderr.trim() || merged.stdout.trim();
    if (!mergeInProgress(root)) throw new RunError(`git merge falló sin empezar a integrar: ${detail}\nla rama de integración está como estaba`);
    const aborted = git(['merge', '--abort'], { cwd: root, check: false });
    throw new RunError(`git merge falló: ${detail}\n${aborted.status === 0 ? 'merge abortado: la rama de integración está como estaba' : `y git merge --abort también falló: ${aborted.stderr.trim()}; revisa ${root} a mano`}`);
  }
  const after = refSha(root, 'HEAD');
  if (!after || after === before) throw new RunError(`git merge salió bien pero HEAD no cambió (${short(before || '')}): no marco ${unitId} como merged; revísalo a mano`);
  const head = abbrev(root, after);
  ledger.setUnit(run, unitId, { status: 'merged', head });
  ledger.addLog(run, `${unitId} integrada en ${integration} · merge ${head}`);
  ledger.writeRun(root, run);
  console.log(`${unitId}: integrada en ${integration} (merge ${head}). No he hecho push`);
  return 0;
}

const COMMANDS = { start: cmdStart, worktree: cmdWorktree, check: cmdCheck, merge: cmdMerge };

/** Contrato de bin/run.js: devuelve el código de salida. */
function run(sub, args, ctx) {
  if (!COMMANDS[sub]) throw new RunError(`subcomando desconocido para bin/run/git.js: ${sub}`, 2);
  return COMMANDS[sub](args, ctx);
}

module.exports = { run, checkScope, isForbidden, defaultBranches, unitBranch, defaultWorktree, FORBIDDEN_GLOBS, FORBIDDEN_NAMES };
