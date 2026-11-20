const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = []; this.attributes = {}; this.events = {}; this._text = ''; this.style = {};
    this.classList = { add: (...names) => names.forEach(name => this.className += ' ' + name) };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent || '').join(''); }
  get childNodes() { return this.children; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) {
    const previous = this.events[name];
    this.events[name] = previous
      ? event => { previous(event); callback(event); }
      : callback;
  }
  querySelector(selector) {
    const match = selector.startsWith('.') && selector.slice(1);
    if (match) {
      for (const child of this.children) if (String(child.className || '').split(/\s+/).includes(match)) return child;
      for (const child of this.children) { const found = child.querySelector?.(selector); if (found) return found; }
    }
    return null;
  }
  showModal() { this.open = true; }
  close() { this.open = false; this.events.close?.(); }
  remove() {}
}

const script = fs.readFileSync(path.join(__dirname, '../apps/planning/planbord.js'), 'utf8');
const references = { klanten: [{ id: 1, naam: 'Klant' }], medewerkers: [{ id: 'm1', naam: 'Intern' }],
  inhuurmedewerkers: [{ id: 'h1', naam: 'R. Smit', functie: 'Grondwerker', leverancier: 'Inhuur BV' }], leveranciers: [{ id: 1, naam: 'Inhuur BV' }] };
const orders = [{
  id: 'w1', nummer: 'WO-26-0422', klantId: 1, klant: 'Klant', omschrijving: 'Werk buiten',
  startDatum: '2026-11-16', eindDatum: '2026-11-20', isOptie: false, kleur: '#2f8a5b', status: 'OPEN 1', version: 1,
  eTag: '"1"', klussen: [{ id: 'j1', omschrijving: 'Sleuf', startDatum: '2026-11-16', eindDatum: '2026-11-20',
    benodigdeMedewerkers: 1, startTijd: '07:00', eindTijd: '16:00', sorteervolgorde: 0,
    inzetten: [{ id: 'a1', datum: '2026-11-16', medewerkerId: null, medewerker: null, functie: 'Grondwerker',
      inhuurmedewerkerId: 'h1', inhuurmedewerker: 'R. Smit', leverancier: 'Inhuur BV', startTijd: '07:00', eindTijd: '16:00', werkbon: null }] }]
}];

async function setup(canEdit) {
  const requests = [];
  const document = { createElement: tag => new Element(tag) };
  const request = async (url, options) => {
    requests.push({ url, options });
    if (url.startsWith('/api/planning/planbord?')) return orders;
    if (url === '/api/planning/planbord/referenties') return references;
    if (url === '/api/planning/werkopdrachten/w1' && !options?.method) return orders[0];
    return orders[0];
  };
  const context = { document, window: { VsvkLoading: { begin: () => () => {} } }, fetch, Date, Intl, Set, Map, String, Number, JSON, Object, Array };
  vm.runInNewContext(script, context);
  const container = new Element();
  await context.window.VsvkPlanBoard.open({ container, request, canEdit: Promise.resolve(canEdit) });
  return { container, requests, context };
}

test('planbord laadt werkopdracht, klussen en inhuur als geneste rijen', async () => {
  const view = await setup(false);
  assert(view.requests.some(item => item.url.startsWith('/api/planning/planbord?')));
  assert(view.requests.some(item => item.url === '/api/planning/planbord/referenties'));
  assert.match(view.container.textContent, /WO-26-0422/);
  assert.doesNotMatch(view.container.textContent, /\+ Werkopdracht/);

  const order = view.container.querySelector('.board-order-label');
  order.events.click();
  assert.match(view.container.textContent, /R\. Smit/);
  assert.match(view.container.textContent, /Inhuur BV/);
});

test('planning-permission toont mutatieknoppen op het planbord', async () => {
  const view = await setup(true);
  assert.match(view.container.textContent, /\+ Werkopdracht/);
  assert.match(view.container.textContent, /Inhuurmedewerkers/);
});

test('werkopdracht-opslaan normaliseert browser-tijden naar TimeOnly JSON', async () => {
  const view = await setup(true);
  view.container.querySelector('.board-open').events.click({ stopPropagation() {} });
  await new Promise(resolve => setImmediate(resolve));
  const dialog = view.container.children.find(child => child?.tagName === 'DIALOG');
  const descendants = root => root.children.filter(child => child && Array.isArray(child.children))
    .flatMap(child => [child, ...descendants(child)]);
  const start = descendants(dialog).find(node => node.attributes['aria-label'] === 'Starttijd');
  start.value = '07:00'; start.events.input();
  dialog.querySelector('.board-dialog-save').onclick();
  await new Promise(resolve => setImmediate(resolve));
  const write = view.requests.find(item => item.options?.method === 'PUT');
  const body = JSON.parse(write.options.body);
  assert.equal(body.klussen[0].startTijd, '07:00:00');
});

test('lege ingezette regel wordt vóór de PUT uitgelegd en niet verstuurd', async () => {
  const view = await setup(true);
  view.container.querySelector('.board-open').events.click({ stopPropagation() {} });
  await new Promise(resolve => setImmediate(resolve));
  const dialog = view.container.children.find(child => child?.tagName === 'DIALOG');
  const descendants = root => root.children.filter(child => child && Array.isArray(child.children))
    .flatMap(child => [child, ...descendants(child)]);
  const addAssignment = descendants(dialog).find(node => node.textContent === '+ Inzet toevoegen');
  addAssignment.events.click();
  dialog.querySelector('.board-dialog-save').onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.requests.filter(item => item.options?.method === 'PUT').length, 0);
  assert.match(dialog.querySelector('.board-dialog-status').textContent, /Kies een interne of ingehuurde medewerker/);
});
