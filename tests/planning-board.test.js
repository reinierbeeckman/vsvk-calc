const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = []; this.attributes = {}; this.events = {}; this._text = ''; this.style = { setProperty: () => {} };
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

async function setup(canEdit, timelineMode = false) {
  const requests = [];
  const document = { createElement: tag => new Element(tag) };
  const request = async (url, options) => {
    requests.push({ url, options });
    if (url.startsWith('/api/planning/planbord?')) return orders;
    if (url.startsWith('/api/planning/planbord/werkopdrachten?')) return timeline;
    if (url === '/api/planning/planbord/referenties') return references;
    if (url === '/api/planning/werkopdrachten/w1' && !options?.method) return orders[0];
    return orders[0];
  };
  const values = new Map(timelineMode ? [['vsvk-pbwo', 'true']] : []);
  const localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const context = { document, window: { VsvkLoading: { begin: () => () => {} }, localStorage }, fetch, Date, Intl, Set, Map, String, Number, JSON, Object, Array };
  vm.runInNewContext(script, context);
  const container = new Element();
  await context.window.VsvkPlanBoard.open({ container, request, canEdit: Promise.resolve(canEdit) });
  return { container, requests, context };
}

const timeline = {
  periode: { van: '2026-11-16', tot: '2026-11-22', vandaag: '2026-11-18', zoom: 'week', titel: 'Wk 47 · 16 – 22 november' },
  dagen: ['16','17','18','19','20','21','22'].map((nr, index) => ({ datum: `2026-11-${nr}`, kort: ['ma','di','wo','do','vr','za','zo'][index], nr: Number(nr), weekend: index > 4, vandaag: nr === '18' })),
  groepen: [{ key: 'aandacht', label: 'Aandacht nodig', werkopdrachten: [{
    id: 'w1', nummer: 'WO-26-0412', klantNaam: 'Infra Noord BV', kop: 'Kabeltracé Parkweg vervangen',
    startDatum: '2026-11-16', eindDatum: '2026-11-20', kleur: '#2f6fb5', optie: false,
    openPlekken: 1, bonnenTeDoen: 2, groep: 'aandacht',
    dagen: { '2026-11-18': { klusIds: ['j1'], nodig: 2, bezet: 2, open: 0, bezetting: 'vol', teDoen: 2, bonSamenvatting: 'teDoen', vertrek: '06:45' } },
    mensen: [{ id: 'h1', naam: 'R. Smit', functie: 'Grondwerker', extern: true,
      dagen: { '2026-11-18': { status: 'GEEN_BON', bonId: null, nummer: null, klusId: 'j1' } } }]
  }] }],
  totaal: { werkopdrachten: 1 }
};

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

test('Werkopdrachten-view rendert groepen, day-health, personen en acties', async () => {
  const view = await setup(true, true);
  assert.match(view.container.textContent, /Aandacht nodig/);
  assert.match(view.container.textContent, /✓ P 2\/2/);
  assert.match(view.container.textContent, /2 bonnen te doen/);
  const wo = view.container.querySelector('.tl-wo-label');
  wo.events.click();
  assert.match(view.container.textContent, /TE DOEN PER DAG/i);
  assert.match(view.container.textContent, /R\. Smit/);
  assert.match(view.container.textContent, /GEEN BON/);
  assert.match(view.container.textContent, /Bonnen \(2\)/);
});
