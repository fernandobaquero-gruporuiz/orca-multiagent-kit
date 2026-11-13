// Lectura de units.md (skills/orca/references/units.md): el contrato entre coordinador y workers.
// Solo interpreta el formato; las reglas del reparto (globs, rondas, ciclos) las comprueba `omk run plan`.
'use strict';

const { UNIT_ID } = require('./util');

/** Campos con lista entre corchetes (`[a, b]`) o en líneas `- …` debajo. */
const LIST_FIELDS = new Set(['write', 'read', 'shared', 'depends_on', 'verify', 'out_of_scope', 'acceptance']);
const KNOWN_FIELDS = new Set([
  'source', 'goal', 'write', 'read', 'shared', 'depends_on', 'round', 'size', 'role', 'tier', 'agent',
  'engine', 'acceptance', 'verify', 'out_of_scope', 'notes', 'budget', 'review',
]);

const HEADER = /^###\s+UNIT:\s*(\S+)\s*(?:[—–-]\s*(.*?))?\s*$/;
const FIELD = /^- ([a-z_]+):(?:\s+(.*?))?\s*$/;
const ITEM = /^\s+- (.*?)\s*$/;
// Comentario al final del valor: dos espacios o más, «#» y un espacio (`tasks.md#US2` no lo es).
const COMMENT = /\s{2,}#\s.*$/;

/** Parte «a, b, {c,d}» por las comas de primer nivel (las de un glob con llaves no cuentan). */
function splitList(text) {
  const items = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    if (ch === '}' || ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { items.push(current); current = ''; continue; }
    current += ch;
  }
  items.push(current);
  return items.map((item) => item.trim()).filter(Boolean);
}

function listValue(raw) {
  const text = raw.trim();
  if (text.startsWith('[') && text.endsWith(']')) return splitList(text.slice(1, -1));
  return text ? [text] : [];
}

/**
 * Lee units.md. Devuelve {units, problems}: cada unidad con id, título, línea de su cabecera y sus
 * campos (listas como arrays, `round` como número); `problems` son {line, message} de formato.
 */
function parseUnits(text) {
  const units = [];
  const problems = [];
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  let unit = null;
  let listField = null;
  let fence = false;

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (/^\s*```/.test(line)) { fence = !fence; return; }
    if (fence) return;
    const header = HEADER.exec(line);
    if (header) {
      listField = null;
      const [, id, title = ''] = header;
      if (!UNIT_ID.test(id)) problems.push({ line: lineNo, message: `id de unidad no válido: ${id}` });
      if (units.some((u) => u.id === id)) problems.push({ line: lineNo, message: `unidad repetida: ${id}` });
      unit = { id, title, line: lineNo, fields: {} };
      units.push(unit);
      return;
    }
    if (!unit) return;
    if (/^#{1,3}\s/.test(line)) { unit = null; listField = null; return; }

    const item = listField ? ITEM.exec(line) : null;
    if (item) {
      unit.fields[listField].push(item[1].replace(COMMENT, ''));
      return;
    }
    const field = FIELD.exec(line);
    if (!field) {
      if (line.trim()) listField = null;
      return;
    }
    const [, name, rawValue = ''] = field;
    const value = rawValue.replace(COMMENT, '').trim();
    if (!KNOWN_FIELDS.has(name)) problems.push({ line: lineNo, message: `${unit.id}: campo desconocido «${name}»` });
    if (Object.prototype.hasOwnProperty.call(unit.fields, name)) problems.push({ line: lineNo, message: `${unit.id}: campo repetido «${name}»` });
    if (LIST_FIELDS.has(name)) {
      unit.fields[name] = listValue(value);
      listField = value ? null : name;
      return;
    }
    listField = null;
    if (name === 'round') {
      const round = Number(value);
      if (!Number.isInteger(round) || round < 0) problems.push({ line: lineNo, message: `${unit.id}: round no es un entero ≥0: «${value}»` });
      unit.fields.round = Number.isInteger(round) && round >= 0 ? round : null;
      return;
    }
    unit.fields[name] = value;
  });
  return { units, problems };
}

module.exports = { parseUnits, splitList, LIST_FIELDS, KNOWN_FIELDS };
