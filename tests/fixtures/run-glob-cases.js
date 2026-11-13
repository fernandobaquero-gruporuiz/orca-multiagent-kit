#!/usr/bin/env node
// Casos de bin/run/glob.js: el matcher de los globs de write/shared. Sale con 1 si alguno falla.
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const { matches, literalPrefix, isGlob, expandBraces, MAX_EXPANSION } = require(path.join(ROOT, 'bin', 'run', 'glob.js'));
const { RunError } = require(path.join(ROOT, 'bin', 'run', 'util.js'));

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

// [patrón, ruta, ¿encaja?]
const CASES = [
  ['a.txt', 'a.txt', true],
  ['a.txt', 'b/a.txt', false],
  ['./a.txt', 'a.txt', true],
  ['a.txt', './a.txt', true],
  ['*.md', 'README.md', true],
  ['*.md', 'docs/README.md', false],
  ['*.md', '.hidden.md', true],
  ['**', 'a/b/c.txt', true],
  ['**/*.md', 'README.md', true],
  ['**/*.md', 'a/b/README.md', true],
  ['src/**', 'src/a.js', true],
  ['src/**', 'src/a/b/c.js', true],
  ['src/**', 'srcx/a.js', false],
  ['src/', 'src/a/b.js', true],
  ['src/**/*.ts', 'src/a.ts', true],
  ['src/**/*.ts', 'src/a/b/c.ts', true],
  ['src/**/*.ts', 'src/a/b/c.tsx', false],
  ['src/**/*.ts', 'lib/src/a.ts', false],
  ['a/**/b', 'a/b', true],
  ['a/**/b', 'a/x/y/b', true],
  ['a/**/b', 'a/x/y/c', false],
  ['a/**/**/b', 'a/b', true],
  ['src/*/index.js', 'src/x/index.js', true],
  ['src/*/index.js', 'src/x/y/index.js', false],
  ['src/*/index.js', 'src/index.js', false],
  ['file?.js', 'file1.js', true],
  ['file?.js', 'file10.js', false],
  ['file?.js', 'file/.js', false],
  ['src/**/*.{ts,tsx}', 'src/a/b.tsx', true],
  ['src/**/*.{ts,tsx}', 'src/a/b.ts', true],
  ['src/**/*.{ts,tsx}', 'src/a/b.js', false],
  ['{bin,lib}/run/*.js', 'lib/run/x.js', true],
  ['{bin,lib}/run/*.js', 'src/run/x.js', false],
  ['a{b,{c,d}}e', 'ade', true],
  ['{a}.txt', '{a}.txt', true],
  ['{a.txt', '{a.txt', true],
  ['[abc].txt', 'b.txt', true],
  ['[abc].txt', 'd.txt', false],
  ['[a-c].txt', 'c.txt', true],
  ['[!a-c].txt', 'd.txt', true],
  ['[!a-c].txt', 'a.txt', false],
  ['[^a].txt', 'b.txt', true],
  ['[]].txt', '].txt', true],
  ['[ab', '[ab', true],
  ['\\*.txt', '*.txt', true],
  ['\\*.txt', 'a.txt', false],
  ['ruta con espacios/*.md', 'ruta con espacios/x.md', true],
  ['tildes/*.md', 'tildes/año.md', true],
  ['tildes/?.md', 'tildes/ñ.md', true],
  ['*a*a*a*a*a*a*a*a*b', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', false],
  ['**/**/**/**/**/z', 'a/a/a/a/a/a/a/a/a/a/a/a/a/a/a/a/a/a/a/y', false],
  ['', 'a.txt', false],
  ['a.txt', '', false],
];

for (const [pattern, file, expected] of CASES) {
  check(`matches(${JSON.stringify(file)}, ${JSON.stringify(pattern)}) = ${expected}`, () => {
    assert.equal(matches(file, pattern), expected);
  });
}

check('literalPrefix', () => {
  assert.equal(literalPrefix('src/**/*.ts'), 'src/');
  assert.equal(literalPrefix('src/a/*.ts'), 'src/a/');
  assert.equal(literalPrefix('*.md'), '');
  assert.equal(literalPrefix('**'), '');
  assert.equal(literalPrefix('bin/run/git.js'), 'bin/run/git.js');
  assert.equal(literalPrefix('./bin/run.js'), 'bin/run.js');
  assert.equal(literalPrefix('{bin,lib}/x.js'), '');
  assert.equal(literalPrefix('src/[ab]/x.js'), 'src/');
});

check('isGlob', () => {
  assert.equal(isGlob('a/b.txt'), false);
  for (const p of ['*.md', 'a?', '[ab]', '{a,b}', 'a\\*']) assert.equal(isGlob(p), true, p);
});

check('expandBraces mantiene el orden y anida', () => {
  assert.deepEqual(expandBraces('a{b,c}d{1,2}'), ['abd1', 'abd2', 'acd1', 'acd2']);
  assert.deepEqual(expandBraces('x{a,{b,c}}'), ['xa', 'xb', 'xc']);
  assert.deepEqual(expandBraces('sin-llaves'), ['sin-llaves']);
});

check(`expandBraces se niega a pasar de ${MAX_EXPANSION} patrones (entrada hostil)`, () => {
  assert.throws(() => matches('a', '{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}'), RunError);
});

if (failed) {
  process.stdout.write(`  ${failed} caso(s) de glob fallan\n`);
  process.exit(1);
}
