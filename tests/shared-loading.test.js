const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const timers = new Map();
  let nextTimer = 0;
  const root = { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; } };
  const status = { textContent: '' };
  const window = {};
  const document = { documentElement: root, querySelector: () => status };
  const setTimeout = callback => { const id = ++nextTimer; timers.set(id, callback); return id; };
  const clearTimeout = id => timers.delete(id);
  const source = fs.readFileSync(path.join(__dirname, '../apps/shared/loading.js'), 'utf8');
  vm.runInNewContext(source, { window, document, setTimeout, clearTimeout });
  return { window, root, status, tick() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } } };
}

test('snelle laadacties flitsen niet en langzame acties zijn toegankelijk', () => {
  const view = setup();
  const fast = view.window.VsvkLoading.begin();
  fast(); view.tick();
  assert.equal(view.root.attributes['data-vsvk-loading'], undefined);
  const finish = view.window.VsvkLoading.begin();
  assert.equal(view.root.attributes['data-vsvk-loading'], undefined);
  view.tick();
  assert.equal(view.root.attributes['data-vsvk-loading'], 'true');
  assert.equal(view.status.textContent, 'Gegevens laden…');
  finish();
  assert.equal(view.root.attributes['data-vsvk-loading'], undefined);
  assert.equal(view.status.textContent, '');
});

test('overlappende laadacties en herhaald beëindigen blijven correct', () => {
  const view = setup();
  const first = view.window.VsvkLoading.begin();
  const second = view.window.VsvkLoading.begin();
  view.tick();
  first(); first();
  assert.equal(view.root.attributes['data-vsvk-loading'], 'true');
  second();
  assert.equal(view.root.attributes['data-vsvk-loading'], undefined);
});

test('gedeelde lichtveeg is beschikbaar in beide applicaties en respecteert bewegingsvoorkeur', () => {
  const css = fs.readFileSync(path.join(__dirname, '../apps/shared/layout.css'), 'utf8');
  assert.match(css, /data-vsvk-loading/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  for (const app of ['planning', 'calculatie']) {
    const html = fs.readFileSync(path.join(__dirname, '../apps', app, 'index.html'), 'utf8');
    assert.match(html, /\/shared\/loading\.js/);
    assert.match(html, /data-vsvk-loading-status/);
  }
});

test('calculatie toont laadindicatie bij leesacties maar niet bij achtergrondverversing', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../apps/calculatie/calculatie.js'), 'utf8');
  const method = source.slice(source.indexOf('  async _json(url,opt,background=false){'), source.indexOf('  async _refreshOv('));
  let started = 0;
  let finished = 0;
  let fail = false;
  const window = { VsvkLoading: { begin() { started++; return () => finished++; } } };
  const fetch = async () => {
    if (fail) throw new Error('verbinding');
    return { ok: true, headers: { get: () => 'application/json' } };
  };
  const store = vm.runInNewContext('({' + method + '})', { window, fetch, Error });
  await store._json('/api/calculaties');
  assert.equal(started, 1);
  assert.equal(finished, 1);
  await store._json('/api/calculaties', undefined, true);
  await store._json('/api/calculaties', { method: 'PUT' });
  assert.equal(started, 1);
  fail = true;
  await assert.rejects(store._json('/api/calculaties'));
  assert.equal(started, 2);
  assert.equal(finished, 2);
});
