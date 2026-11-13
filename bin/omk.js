#!/usr/bin/env node
// omk — CLI de Orca Multiagent Kit. Sin dependencias: envuelve install.sh con comandos cortos y prepara Orca.
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const KIT = path.resolve(__dirname, '..');
const VERSION = fs.readFileSync(path.join(KIT, 'VERSION'), 'utf8').trim();
const AGENTS_HOME = process.env.AGENT_KIT_HOME || path.join(os.homedir(), '.agents');
// Ejecutable autónomo (Node SEA, bin/sea.js)
const STANDALONE = require('./orca').isSea;
// Con esta opción, omk escribe al salir «[omk:fin] <comando> salida=<código>». La pasa el plugin de
// Orca, que lanza omk en un terminal y lee su salida: así sabe que ha terminado y cómo.
const EXIT_MARKER = '--exit-marker';

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const lime = (s) => (color ? `\x1b[38;5;154m${s}\x1b[0m` : s);
const dim = (s) => (color ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s) => (color ? `\x1b[1m${s}\x1b[0m` : s);

const HELP = `
${lime(bold('omk'))} ${dim('v' + VERSION)} — Orca Multiagent Kit

${bold('Uso')}
  omk <comando> [opciones]

${bold('Comandos')}
  ${lime('setup')}    [--yes] [--dry-run]          Lo instala todo: reglas y skills, omk en el PATH, plugin de Orca y su panel
           [--no-plugin] [--no-path] [--no-hooks]
  ${lime('install')}  [--agents a,b] [--dry-run]   Solo la fuente única en ~/.agents (y el plugin de Orca, si ya lo tienes);
           [--no-project]                     si sube de versión dentro de un proyecto del kit, lo pone al día como update
  ${lime('init')}     [ruta]                       Prepara un proyecto (por defecto, la carpeta actual)
  ${lime('verify')}                                Comprueba enlaces, imports y copias divergentes
  ${lime('plugin')}   install|status|uninstall     El plugin de Orca del kit (install pide tu aprobación)
  ${lime('team')}     [set …]                      Enseña o cambia el equipo de roles y la autonomía de ORCHESTRATION.md
  ${lime('gate')}     on|off|status                La puerta de reparto obligatoria de Claude Code (hooks/orca-gate.cjs)
  ${lime('run')}      <subcomando>                 El motor de los runs de la skill orca: estado, rondas, worktrees, merge y limpieza (omk run help)
  ${lime('adopt')}    <carpeta-skill>              Comparte una skill externa con todos los agentes
  ${lime('backups')}                               Lista las copias de seguridad
  ${lime('restore')}  <fecha>                      Deshace una instalación (fecha de "omk backups")
  ${lime('update')}   [--yes] [--offline]          Lo actualiza todo: el kit, ~/.agents, el proyecto de esta carpeta y el plugin de Orca
           [--no-project] [--no-plugin] [--no-hooks] [--dry-run] [--force]
  ${lime('where')}                                 Muestra dónde está cada cosa
  ${lime('version')}                               Muestra la versión
  ${lime('help')}                                  Esta ayuda

${bold('Agentes')}  claude · antigravity · codex · copilot · cursor · devin (opcional)

${bold('Ejemplos')}
  npx orca-multiagent-kit setup ${dim('instalar todo de una vez; pregunta antes de aprobar el plugin')}
  omk update                    ${dim('actualizar todo de una vez: kit, ~/.agents, el proyecto de esta carpeta y el plugin')}
  omk install --dry-run
  omk init ~/Dev/mi-app
  omk team set --provider claude --provider codex --role casandra=codex
  omk update --offline          ${dim('sin descargar nada: reaplica esta versión al kit, al proyecto y al plugin')}
  omk adopt ~/.gemini/config/plugins/user-workflows/skills/impeccable
`;

function die(msg, code = 1) {
  process.stderr.write(`omk: ${msg}\n`);
  process.exit(code);
}

// En Windows, el `bash` del PATH puede ser el lanzador de WSL (System32\bash.exe): tiene otro $HOME y no
// entiende rutas C:\, así que instalaría en Linux y no en el Windows del usuario. Solo vale un bash MSYS/Cygwin.
function isWindowsBash(bash) {
  const r = spawnSync(bash, ['-c', 'uname -s'], { encoding: 'utf8' });
  return r.status === 0 && /^(MINGW|MSYS|CYGWIN)/.test((r.stdout || '').trim());
}

function findBash() {
  if (process.platform !== 'win32') return 'bash';
  if (process.env.OMK_BASH) return process.env.OMK_BASH;
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')];
  for (const root of roots.filter(Boolean)) {
    const c = path.join(root, 'Git', 'bin', 'bash.exe');
    if (fs.existsSync(c)) return c;
  }
  if (isWindowsBash('bash')) return 'bash';
  die('Windows necesita Git Bash. Instala Git for Windows, define OMK_BASH con la ruta de su bash.exe, o ejecuta omk dentro de WSL (instala en el $HOME de WSL).');
}

/** Ejecuta install.sh dibujando su salida; resuelve con su código de salida. */
function installer(args) {
  const child = spawn(findBash(), [path.join(KIT, 'install.sh'), ...args], {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, OMK_CLI: '1', OMK_EVENTS: '1' },
  });
  child.on('error', (e) => die(e.message));
  // Ctrl+C: deja la terminal limpia (sin el spinner a medias)
  const onInterrupt = () => { process.stdout.write('\r\x1b[2K'); child.kill('SIGINT'); process.exit(130); };
  process.on('SIGINT', onInterrupt);
  return require('./ui').render(child).finally(() => process.off('SIGINT', onInterrupt));
}

function runInstaller(args) {
  installer(args).then((code) => process.exit(code));
}

// Un fallo inesperado de setup/plugin se cuenta y sale con error; nunca se queda a medias en silencio.
function finish(promise) {
  const { pauseIfAsked } = require('./setup');
  promise
    .catch((e) => { process.stderr.write(`omk: ${e.message}\n`); return 1; })
    .then(pauseIfAsked)
    .then((code) => process.exit(code));
}

/**
 * omk gate: la puerta de reparto obligatoria de Claude Code. `hook` es el propio hook (lee la entrada de
 * Claude Code por stdin); lo usa el ejecutable autónomo cuando no hay node en el PATH.
 */
function gate([sub = 'status']) {
  const gateModule = require(path.join(KIT, 'hooks', 'orca-gate.cjs'));
  const off = path.join(gateModule.stateDir(), 'off');
  if (sub === 'hook') {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      const output = gateModule.run(Buffer.concat(chunks).toString('utf8'));
      if (output) process.stdout.write(output);
    });
    return 0;
  }
  if (sub === 'off') {
    fs.mkdirSync(path.dirname(off), { recursive: true });
    fs.writeFileSync(off, '');
    console.log(`${lime('✓')} Puerta de reparto apagada: Claude Code edita sin esperar al veredicto de la skill orca. Volver a encenderla: omk gate on`);
    return 0;
  }
  if (sub === 'on') {
    fs.rmSync(off, { force: true });
    console.log(`${lime('✓')} Puerta de reparto encendida.`);
    return 0;
  }
  if (sub !== 'status') die(`subcomando desconocido: ${sub} (on, off, status)`, 2);
  const { claudeDir, KIT_MARK } = require('./hooks');
  const settings = path.join(claudeDir(), 'settings.json');
  let installed = false;
  try {
    const hooks = (JSON.parse(fs.readFileSync(settings, 'utf8')).hooks || {}).PreToolUse || [];
    installed = hooks.some((entry) => (entry.hooks || []).some((hook) => String(hook.command || '').includes(KIT_MARK)));
  } catch (e) {
    if (e.code !== 'ENOENT') console.log(`${dim('·')} No pude leer ${settings}: ${e.message}`);
  }
  const disabled = process.env.OMK_NO_GATE === '1' || fs.existsSync(off);
  console.log(`${bold('hook')}      ${installed ? 'instalado en ' + settings : 'no instalado: omk update (o omk setup)'}`);
  console.log(`${bold('estado')}    ${disabled ? 'apagada (omk gate on para encenderla)' : 'encendida'}`);
  console.log(`${bold('script')}    ${path.join(AGENTS_HOME, 'hooks', 'orca-gate.cjs')}${fs.existsSync(path.join(AGENTS_HOME, 'hooks', 'orca-gate.cjs')) ? '' : ' (falta: omk install)'}`);
  return installed && !disabled ? 0 : 1;
}

function listBackups() {
  const dir = path.join(AGENTS_HOME, 'backups');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((d) => /^\d{8}-\d{6}$/.test(d)).sort();
}

const argv = process.argv.slice(2);
const [cmd = 'help', ...rest] = argv.filter((a) => a !== EXIT_MARKER);

if (argv.includes(EXIT_MARKER)) {
  // En «exit» ya no corre nada asíncrono: la línea se escribe de forma síncrona o se pierde.
  process.on('exit', (code) => {
    const line = `\n[omk:fin] ${cmd.replace(/[^\w-]/g, '')} salida=${code}\n`;
    try {
      fs.writeSync(process.stdout.fd, line);
    } catch {
      // Una tubería que no admite escritura síncrona (EAGAIN): se deja en la cola normal de stdout.
      process.stdout.write(line);
    }
  });
}

switch (cmd) {
  case 'setup': {
    const { isTransientCopy, installGlobal, REPO } = require('./fetch');
    // Con npx el kit corre desde una caché que npm borra cuando quiere, y el plugin de Orca necesita
    // omk en el PATH y una carpeta del kit que siga ahí: se instala de forma permanente y sigue desde ella.
    if (!STANDALONE && isTransientCopy(KIT) && !rest.includes('--dry-run')) {
      console.log(`${lime('›')} Dejo omk instalado (npm install -g ${REPO}@${VERSION}): el plugin de Orca lo usa desde el PATH.`);
      let entry;
      try {
        entry = installGlobal(VERSION);
      } catch (e) {
        die(e.message);
      }
      const r = spawnSync(process.execPath, [entry, 'setup', ...rest], { stdio: 'inherit' });
      process.exit(r.status === null ? 1 : r.status);
    }
    finish(require('./setup').setup({ kit: KIT, args: rest, installer, standalone: STANDALONE, agentsHome: AGENTS_HOME }));
    break;
  }

  case 'plugin':
    finish(require('./setup').plugin({ kit: KIT, args: rest }));
    break;

  case 'team':
    // exitCode y no exit(): deja terminar de escribir la salida cuando va a una tubería.
    process.exitCode = require('./team').main(rest);
    break;

  case 'install':
  case 'i': {
    // ~/.agents, los hooks de reparto de Claude Code y, si el plugin de Orca ya está instalado, su
    // versión de este kit: quien actualiza desde un omk anterior (que al acabar solo llama a
    // «omk install») también se lleva el plugin.
    const { parseOptions, refreshPlugin } = require('./setup');
    const { applyHooks } = require('./hooks');
    // --no-project solo cuenta aquí (install.sh no la conoce): evita la puesta al día del proyecto de abajo.
    const noProject = rest.includes('--no-project');
    const opts = parseOptions(rest.filter((a) => a !== '--no-project'));
    // Subida de versión dentro de un proyecto del kit: es lo que llama el «omk update» de una versión
    // anterior al terminar. Se hace entero, como «omk update --offline», para que también se ponga al
    // día el proyecto y no haga falta actualizar dos veces.
    const upgrade = require('./update');
    let installed = '';
    try {
      installed = fs.readFileSync(path.join(AGENTS_HOME, 'AGENT_KIT_VERSION'), 'utf8').trim();
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (installed && upgrade.newer(VERSION, installed) && !noProject && upgrade.kitProject(process.cwd())) {
      console.log(`${lime('›')} ~/.agents tiene la v${installed} y este omk es la v${VERSION}: actualizo también este proyecto (como omk update)`);
      finish(upgrade.update({
        kit: KIT, version: VERSION, args: ['--offline', ...rest], installer, standalone: STANDALONE, agentsHome: AGENTS_HOME,
      }));
      break;
    }
    finish(installer(opts.rest).then(async (code) => {
      if (code !== 0) return code;
      const omkBinary = STANDALONE ? require('./setup').installedOmk() : null;
      const hooked = applyHooks({ kit: KIT, agentsHome: AGENTS_HOME, dryRun: opts.dryRun, skip: opts.noHooks, omkBinary });
      if (opts.noPlugin) return hooked ? 0 : 1;
      return (await refreshPlugin({ kit: KIT, yes: opts.yes, dryRun: opts.dryRun, quiet: true })) && hooked ? 0 : 1;
    }));
    break;
  }

  case 'init': {
    const target = path.resolve(rest[0] || process.cwd());
    if (!fs.existsSync(target)) die(`no existe la carpeta ${target}`);
    // Un .claude/settings.json que ya existía no lo pisa el instalador: se le añaden los hooks de reparto.
    finish(installer(['--project-only', target, ...rest.slice(1).filter((a) => a !== '--no-hooks')]).then((code) => {
      if (code !== 0) return code;
      const { applyHooks } = require('./hooks');
      const dryRun = rest.includes('--dry-run');
      return applyHooks({ kit: KIT, agentsHome: AGENTS_HOME, project: target, global: false, dryRun, skip: rest.includes('--no-hooks') }) ? 0 : 1;
    }));
    break;
  }

  case 'verify':
  case 'doctor':
    runInstaller(['--verify', ...rest]);
    break;

  case 'adopt':
    if (!rest[0]) die('falta la carpeta de la skill: omk adopt <carpeta>');
    runInstaller(['--adopt', path.resolve(rest[0])]);
    break;

  case 'backups': {
    const b = listBackups();
    if (!b.length) { console.log('No hay copias de seguridad en ' + path.join(AGENTS_HOME, 'backups')); break; }
    for (const d of b) console.log(d.replace(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/, `$&  ${dim('$3/$2/$1 $4:$5:$6')}`));
    console.log(dim(`\nDeshacer: omk restore ${b[0]}  (la más antigua es el estado previo a la primera instalación)`));
    break;
  }

  case 'restore':
    if (!rest[0]) die('falta la fecha: omk restore <fecha>  (consulta "omk backups")');
    runInstaller(['--restore', rest[0]]);
    break;

  case 'update':
    finish(require('./update').update({
      kit: KIT, version: VERSION, args: rest, installer, standalone: STANDALONE, agentsHome: AGENTS_HOME,
    }));
    break;

  case 'gate':
    process.exitCode = gate(rest);
    break;

  case 'run': {
    const code = require('./run').main(rest);
    if (code && typeof code.then === 'function') code.then((c) => { process.exitCode = c; });
    else process.exitCode = code;
    break;
  }

  case 'where':
    console.log(`${bold('kit')}         ${KIT}`);
    console.log(`${bold('fuente')}      ${AGENTS_HOME}`);
    console.log(`${bold('núcleo')}      ${path.join(AGENTS_HOME, 'AGENTS.md')}`);
    console.log(`${bold('reglas')}      ${path.join(AGENTS_HOME, 'rules')}`);
    console.log(`${bold('skills')}      ${path.join(AGENTS_HOME, 'skills')}`);
    console.log(`${bold('backups')}     ${path.join(AGENTS_HOME, 'backups')}`);
    break;

  case 'version':
  case '-v':
  case '--version':
    console.log(VERSION);
    break;

  case 'help':
  case '-h':
  case '--help':
    console.log(HELP);
    break;

  default:
    die(`comando desconocido: ${cmd}\n${HELP}`, 2);
}
