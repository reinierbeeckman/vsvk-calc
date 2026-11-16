const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const code = fs.readFileSync(require('node:path').join(__dirname, '../apps/planning/record-editor.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.events = {}; this.attributes = {}; this.value = ''; this.textContent = ''; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; this.textContent = ''; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.events[name] = callback; }
  click() { if (!this.disabled) return this.onclick?.() ?? this.events.click?.(); }
}
const descendants = item => item.children.flatMap(child => [child, ...descendants(child)]);
function makeEditor(request) {
  const window = {};
  vm.runInNewContext(code, { window, document: { createElement: tag => new Element(tag) }, JSON, Set, Object, String, Number });
  const content = new Element('div');
  const saveButton = new Element('button');
  const state = window.VsvkPlanningEditor.create({ content, saveButton, request, endpoint: '/record/1', item: { naam: 'Oud', actief: true, eTag: '"1"' }, fields: [{ key: 'naam', label: 'Naam' }, { key: 'actief', label: 'Actief', type: 'boolean' }], isCurrent: () => true, onSaved() {} });
  return { content, state, saveButton };
}

test('wijzigingen worden opgeslagen met de opgehaalde ETag', async () => {
  let call;
  const view = makeEditor(async (url, options) => { call = { url, options }; return { naam: 'Nieuw', actief: true, eTag: '"2"' }; });
  assert.equal(view.saveButton.disabled, true);
  const input = descendants(view.content).find(element => element.attributes['aria-label'] === 'Naam');
  input.value = 'Nieuw'; input.events.input();
  assert.equal(view.state.dirty, true);
  assert.equal(view.saveButton.disabled, false);
  view.saveButton.click();
  await flush();
  assert.equal(call.options.headers['If-Match'], '"1"');
  assert.equal(JSON.parse(call.options.body).naam, 'Nieuw');
  assert.equal(view.state.dirty, false);
  assert.equal(view.saveButton.disabled, true);
});

test('bij conflict blijft de invoer staan tot expliciet opnieuw toepassen', async () => {
  let writes = 0;
  const view = makeEditor(async (url, options) => {
    if (options?.method === 'PUT') { writes++; const error = new Error('conflict'); error.status = 412; throw error; }
    return { naam: 'Anders', actief: false, eTag: '"2"' };
  });
  const input = descendants(view.content).find(element => element.attributes['aria-label'] === 'Naam');
  input.value = 'Mijn invoer'; input.events.input();
  view.saveButton.click();
  await flush();
  assert.equal(input.value, 'Mijn invoer');
  assert.equal(writes, 1);
  assert.ok(descendants(view.content).some(element => element.textContent.includes('Anders')));
  const reapply = descendants(view.content).find(element => element.textContent === 'Mijn wijzigingen opnieuw toepassen');
  assert.ok(reapply); reapply.click();
  assert.equal(writes, 1);
  assert.equal(view.state.dirty, true);
});

test('vaardigheden tonen hun velden met herkenbare labels', () => {
  const window = {};
  vm.runInNewContext(code, { window, document: { createElement: tag => new Element(tag) }, JSON, Set, Object, String, Number });
  const content = new Element('div');
  window.VsvkPlanningEditor.create({ content, saveButton: new Element('button'), endpoint: '/record/1', request: async () => ({}), item: { skills: [{ naam: 'VCA', diplomaOp: null, geldigTot: null }], eTag: '"1"' }, fields: [{ key: 'skills', label: 'Vaardigheden', type: 'skills', options: [{ value: 'VCA', label: 'VCA' }] }], isCurrent: () => true, onSaved() {} });
  const labels = descendants(content).map(element => element.textContent);
  assert.ok(labels.includes('Vaardigheid'));
  assert.ok(labels.includes('Diplomadatum'));
  assert.ok(labels.includes('Geldig tot'));
});
