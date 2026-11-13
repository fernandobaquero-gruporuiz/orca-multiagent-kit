// Globs de units.md (write, shared) sin dependencias: `**` (cero o más segmentos), `*` y `?` dentro de
// un segmento, `{a,b}` y `[abc]` / `[a-z]` / `[!abc]`. Las rutas van con «/», como las da git. `*` y `?`
// también encajan con ficheros que empiezan por punto (como las pathspecs de git, no como un shell).
'use strict';

const { RunError } = require('./util');

/** Tope de patrones que salen de expandir llaves: `{a,b}{c,d}…` crece exponencialmente. */
const MAX_EXPANSION = 256;
const META = /[*?[{\\]/;

/** Ruta tal como la compara el matcher: sin `./` delante ni «/» repetidas. */
function normalizePath(p) {
  return String(p).replace(/\/{2,}/g, '/').replace(/^(\.\/)+/, '');
}

/** Primera alternativa `{…,…}` de primer nivel de `pattern`: {start, end, parts} o null. */
function findBrace(pattern) {
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch !== '{') continue;
    let depth = 0;
    let partStart = i + 1;
    const parts = [];
    for (let j = i; j < pattern.length; j += 1) {
      const c = pattern[j];
      if (c === '\\') { j += 1; continue; }
      if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) {
          parts.push(pattern.slice(partStart, j));
          if (parts.length > 1) return { start: i, end: j, parts };
          break; // `{a}` sin coma es literal: sigue buscando después.
        }
      } else if (c === ',' && depth === 1) {
        parts.push(pattern.slice(partStart, j));
        partStart = j + 1;
      }
    }
  }
  return null;
}

/** Expande las llaves de un patrón, en orden: `a{b,c}` → [ab, ac]. */
function expandBraces(pattern) {
  const out = [];
  const pending = [String(pattern)];
  while (pending.length) {
    const current = pending.shift();
    const brace = findBrace(current);
    if (!brace) {
      out.push(current);
    } else {
      const head = current.slice(0, brace.start);
      const tail = current.slice(brace.end + 1);
      pending.unshift(...brace.parts.map((part) => head + part + tail));
    }
    if (out.length + pending.length > MAX_EXPANSION) {
      throw new RunError(`el glob «${pattern}» se expande a más de ${MAX_EXPANSION} patrones`);
    }
  }
  return out;
}

/** `[…]` que empieza en chars[i]: {token, next} o null si no se cierra (entonces «[» es literal). */
function parseClass(chars, i) {
  let j = i + 1;
  let negate = false;
  if (chars[j] === '!' || chars[j] === '^') { negate = true; j += 1; }
  const ranges = [];
  let first = true;
  while (j < chars.length && (chars[j] !== ']' || first)) {
    first = false;
    let lo = chars[j];
    if (lo === '\\' && j + 1 < chars.length) { j += 1; lo = chars[j]; }
    let hi = lo;
    if (chars[j + 1] === '-' && j + 2 < chars.length && chars[j + 2] !== ']') {
      hi = chars[j + 2];
      if (hi === '\\' && j + 3 < chars.length) { hi = chars[j + 3]; j += 1; }
      j += 2;
    }
    ranges.push([lo.codePointAt(0), hi.codePointAt(0)]);
    j += 1;
  }
  if (j >= chars.length) return null;
  return { token: { type: 'class', negate, ranges }, next: j + 1 };
}

/** Un segmento del patrón (sin «/») en tokens: lit, any (`?`), star (`*`) y class. */
function tokenize(segment) {
  const chars = Array.from(segment);
  const tokens = [];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (ch === '\\' && i + 1 < chars.length) { i += 1; tokens.push({ type: 'lit', ch: chars[i] }); continue; }
    if (ch === '*') {
      if (!tokens.length || tokens[tokens.length - 1].type !== 'star') tokens.push({ type: 'star' });
      continue;
    }
    if (ch === '?') { tokens.push({ type: 'any' }); continue; }
    if (ch === '[') {
      const parsed = parseClass(chars, i);
      if (parsed) { tokens.push(parsed.token); i = parsed.next - 1; continue; }
    }
    tokens.push({ type: 'lit', ch });
  }
  return tokens;
}

function matchOne(token, ch) {
  if (token.type === 'any') return true;
  if (token.type === 'lit') return token.ch === ch;
  const code = ch.codePointAt(0);
  const inside = token.ranges.some(([lo, hi]) => code >= lo && code <= hi);
  return token.negate ? !inside : inside;
}

/**
 * Comodín clásico sin recursión: avanza y, al fallar, vuelve al último «*» (O(n·m), sin
 * retroceso exponencial). Lo usan tanto los caracteres de un segmento como los segmentos con `**`.
 */
function wildcard(items, subject, isStar, matchItem) {
  let ti = 0;
  let si = 0;
  let starTi = -1;
  let starSi = 0;
  while (si < subject.length) {
    if (ti < items.length && isStar(items[ti])) {
      starTi = ti;
      starSi = si;
      ti += 1;
    } else if (ti < items.length && matchItem(items[ti], subject[si])) {
      ti += 1;
      si += 1;
    } else if (starTi !== -1) {
      ti = starTi + 1;
      starSi += 1;
      si = starSi;
    } else {
      return false;
    }
  }
  while (ti < items.length && isStar(items[ti])) ti += 1;
  return ti === items.length;
}

function matchSegment(tokens, segment) {
  return wildcard(tokens, Array.from(segment), (t) => t.type === 'star', matchOne);
}

/** Patrón ya sin llaves en segmentos compilados; `**` como segmento entero es «cero o más». */
function compile(pattern) {
  let text = normalizePath(pattern);
  if (text.endsWith('/')) text += '**';
  return text.split('/').map((segment) => (segment === '**' ? { globstar: true } : { tokens: tokenize(segment) }));
}

/** Si la ruta (relativa, con «/») encaja en el patrón. */
function matches(filePath, pattern) {
  if (typeof filePath !== 'string' || typeof pattern !== 'string' || !filePath || !pattern.trim()) return false;
  const segments = normalizePath(filePath).split('/');
  return expandBraces(pattern.trim()).some((expanded) => wildcard(
    compile(expanded),
    segments,
    (item) => Boolean(item.globstar),
    (item, segment) => matchSegment(item.tokens, segment),
  ));
}

/** Si el patrón tiene algún comodín (si no, es una ruta literal). */
function isGlob(pattern) {
  return META.test(String(pattern));
}

/**
 * Los segmentos literales del principio del patrón, con «/» final si el patrón sigue:
 * `src/**\/*.ts` → `src/`, `*.md` → ``. Un patrón sin comodines se devuelve entero.
 */
function literalPrefix(pattern) {
  const text = normalizePath(String(pattern).trim());
  if (!isGlob(text)) return text;
  const segments = text.split('/');
  const literal = [];
  for (const segment of segments) {
    if (isGlob(segment)) break;
    literal.push(segment);
  }
  return literal.length ? `${literal.join('/')}/` : '';
}

module.exports = { matches, literalPrefix, isGlob, expandBraces, normalizePath, MAX_EXPANSION };
