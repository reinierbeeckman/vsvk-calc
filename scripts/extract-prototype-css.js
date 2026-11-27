#!/usr/bin/env node
'use strict';

/*
 * Haalt de CSS van een scherm uit het klantprototype (.analysis-input/vsvk-planning) en schrijft die
 * gescoped weg, zodat het scherm 1-op-1 dezelfde opmaak krijgt zonder de rest van de app te raken.
 *
 * Gebruik:
 *   node scripts/extract-prototype-css.js <scope-selector> <uitvoer.css> <bron.js> [<bron.js> ...]
 *
 * Alleen regels waarvan elke class in de opgegeven bronbestanden voorkomt worden overgenomen.
 * Element-selectoren (button, input, h2 …) worden altijd gescoped overgenomen.
 * Klassen met een dynamisch deel (st-${x}) worden herkend aan hun voorvoegsel.
 */

const fs = require('node:fs');
const path = require('node:path');

const [scope, output, ...sources] = process.argv.slice(2);
if (!scope || !output || !sources.length) {
  console.error('Gebruik: extract-prototype-css.js <scope> <uitvoer.css> <bron.js>...');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const prototype = fs.readFileSync(path.join(root, '.analysis-input/vsvk-planning/vsvk-planning/index.html'), 'utf8');
const styleStart = prototype.indexOf('<style>', prototype.indexOf('jspdf')) + 7;
const css = prototype.slice(styleStart, prototype.indexOf('</style>', styleStart));

/* ---------- gebruikte classes en voorvoegsels ---------- */
const used = new Set();
const prefixes = new Set();
for (const file of sources) {
  const text = fs.readFileSync(path.resolve(root, file), 'utf8');
  for (const match of text.matchAll(/[A-Za-z][\w-]*(?:\$\{[^}]*\}[\w-]*)*/g)) {
    const token = match[0];
    if (token.includes('${')) {
      const prefix = token.slice(0, token.indexOf('${'));
      if (prefix) prefixes.add(prefix);
    } else used.add(token);
  }
}
const known = name => used.has(name) || [...prefixes].some(prefix => name.startsWith(prefix));

/* ---------- eenvoudige CSS-parser: top-level regels en @media-blokken ---------- */
function blocks(source) {
  const result = [];
  let index = 0;
  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index])) index++;
    if (source.startsWith('/*', index)) { index = source.indexOf('*/', index) + 2; continue; }
    if (index >= source.length) break;
    const open = source.indexOf('{', index);
    if (open < 0) break;
    let depth = 1, close = open + 1;
    while (close < source.length && depth) {
      if (source.startsWith('/*', close)) { close = source.indexOf('*/', close) + 2; continue; }
      if (source[close] === '{') depth++;
      else if (source[close] === '}') depth--;
      close++;
    }
    result.push({ prelude: source.slice(index, open).trim(), body: source.slice(open + 1, close - 1) });
    index = close;
  }
  return result;
}

function splitSelectors(list) {
  const parts = [];
  let depth = 0, current = '';
  for (const character of list) {
    if ('([' .includes(character)) depth++;
    if (')]'.includes(character)) depth--;
    if (character === ',' && !depth) { parts.push(current.trim()); current = ''; } else current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const ALWAYS_ELEMENT = /^(?:[a-z][a-z0-9]*|\*)(?:[:\[][^ ]*)?$/i;
function scoped(selector) {
  if (/^(?:html|body)\b/.test(selector) || selector.startsWith('header.top') || selector.startsWith('nav.tabs') ||
      /^(?:\.wrap|\.bar|\.brand|\.logo-svg|\.mode|main)\b/.test(selector)) return null;
  if (selector.startsWith(':root')) return selector.replace(/^:root/, scope);
  const classes = [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(match => match[1]);
  if (classes.some(name => !known(name))) return null;
  const ids = [...selector.matchAll(/#([A-Za-z_][\w-]*)/g)].map(match => match[1]);
  if (ids.some(name => !used.has(name))) return null;
  return scope + ' ' + selector;
}

function convert(rules) {
  const out = [];
  for (const rule of rules) {
    if (rule.prelude.startsWith('@media')) {
      const inner = convert(blocks(rule.body));
      if (inner.length) out.push(rule.prelude + '{' + inner.join('') + '}');
    } else if (rule.prelude.startsWith('@keyframes') || rule.prelude.startsWith('@font-face')) {
      out.push(rule.prelude + '{' + rule.body + '}');
    } else if (rule.prelude.startsWith('@')) {
      continue;
    } else {
      const selectors = splitSelectors(rule.prelude).map(scoped).filter(Boolean);
      if (selectors.length) out.push(selectors.join(',') + '{' + rule.body.trim() + '}');
    }
  }
  return out;
}

const body = convert(blocks(css)).join('\n');
const header = '/* Gegenereerd door scripts/extract-prototype-css.js uit .analysis-input/vsvk-planning (klantprototype).\n' +
  '   Niet met de hand aanpassen: pas het prototype of de bronbestanden aan en genereer opnieuw.\n' +
  '   Gescoped op ' + scope + ' zodat andere schermen niet veranderen. */\n';
fs.writeFileSync(path.resolve(root, output), header + body + '\n');
console.log('Geschreven:', output, '(' + body.length + ' tekens)');
