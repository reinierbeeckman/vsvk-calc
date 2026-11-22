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
  getBoundingClientRect() { return { left: 180, top: 500 }; }
}

const script = fs.readFileSync(path.join(__dirname, '../apps/planning/planbord.js'), 'utf8');
const references = { klanten: [{ id: 1, naam: 'Klant' }], medewerkers: [{ id: 'm1', naam: 'Intern' }],
  inhuurmedewerkers: [{ id: 'h1', naam: 'R. Smit', functie: 'Grondwerker', leverancier: 'Inhuur BV' }], leveranciers: [{ id: 1, naam: 'Inhuur BV' }] };
const formReferences = {
  klanten: [{ id: 1, naam: 'Klant', debiteurnummer: 'D1', straat: 'Straat 1', postcode: '1234AA', plaats: 'Plaats',
    telefoon: '010123', email: 'info@klant.test', contacten: [
      { id: 10, naam: 'Arjen Pelders', telefoon: '06123', email: 'arjen@klant.test', isStandaardBesteller: true }
    ] }],
  vestigingen: [], functies: ['Grondwerker'], materieelTypes: [], materieel: [], artikelen: []
};
const orders = [{
  id: 'w1', nummer: 'WO-26-0422', klantId: 1, klant: 'Klant', omschrijving: 'Werk buiten',
  startDatum: '2026-11-16', eindDatum: '2026-11-20', isOptie: false, kleur: '#2f8a5b', status: 'OPEN 1', version: 1,
  korteWerkomschrijving: 'Werk buiten', werkadres: 'Teststraat 1', behoeften: [{ aantal: 1, rol: 'Grondwerker', skill: null }],
  materieel: [], materialen: [], weekendOverslaan: true, vrijeDagen: [], soort: 'regie', pauzeMinuten: 30,
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
    if (url === '/api/planning/werkopdrachten/form-referenties') return formReferences;
    if (url === '/api/planning/werkopdrachten/w1' && !options?.method) return orders[0];
    return orders[0];
  };
  const values = new Map(timelineMode ? [['vsvk-pbwo', 'true']] : []);
  const localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const context = { document, window: { VsvkLoading: { begin: () => () => {} }, localStorage, confirm: () => true },
    fetch, Date, Intl, Set, Map, String, Number, JSON, Object, Array, setTimeout, clearTimeout };
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
    openPlekken: 1, bonnenTeDoen: 2, groep: 'aandacht', status: 'OPEN 1', bonnen: 3, bonnenBinnen: 1,
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

test('hover op een werkopdracht toont materieel, bezetting en instructies', async () => {
  orders[0].instructies = 'Neem graafmachine mee';
  orders[0].materieel = [{ aantal: 1, rol: 'MG-02 Midigraver', soort: 'materieel' }];
  const view = await setup(false);
  view.container.querySelector('.board-order').events.mouseenter({ clientX: 260, clientY: 500 });
  await new Promise(resolve => setTimeout(resolve, 150));
  const card = view.container.querySelector('.wo-hover-card');
  assert.ok(card);
  assert.match(card.textContent, /WO-26-0422/);
  assert.match(card.textContent, /MG-02 Midigraver/);
  assert.match(card.textContent, /MENSEN/);
  assert.match(card.textContent, /1\/1/);
  assert.match(card.textContent, /Neem graafmachine mee/);
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
  const start = descendants(dialog).find(node => node.attributes['aria-label'] === 'Starttijd op locatie');
  start.value = '07:00'; start.events.input();
  dialog.querySelector('.board-dialog-save').onclick();
  await new Promise(resolve => setImmediate(resolve));
  const write = view.requests.find(item => item.options?.method === 'PUT');
  const body = JSON.parse(write.options.body);
  assert.equal(body.startOpLocatie, '07:00:00');
  assert.equal(body.klussen.length, 0);
});

test('bestaande werkopdracht kan met bevestiging en If-Match worden verwijderd', async () => {
  const view = await setup(true);
  view.container.querySelector('.board-open').events.click({ stopPropagation() {} });
  await new Promise(resolve => setImmediate(resolve));
  const dialog = view.container.children.find(child => child?.tagName === 'DIALOG');
  const remove = dialog.querySelector('.wo-delete-order');
  assert.ok(remove);
  remove.events.click();
  await new Promise(resolve => setImmediate(resolve));
  const deletion = view.requests.find(item => item.options?.method === 'DELETE');
  assert.equal(deletion.url, '/api/planning/werkopdrachten/w1');
  assert.equal(deletion.options.headers['If-Match'], '"1"');
});

test('ontbrekende mensenbehoefte wordt vóór de PUT uitgelegd en niet verstuurd', async () => {
  const view = await setup(true);
  const descendants = root => root.children.filter(child => child && Array.isArray(child.children))
    .flatMap(child => [child, ...descendants(child)]);
  descendants(view.container).find(node => node.textContent === '+ Werkopdracht').events.click();
  await new Promise(resolve => setImmediate(resolve));
  const dialog = view.container.children.find(child => child?.tagName === 'DIALOG');
  dialog.querySelector('.board-dialog-save').onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.requests.filter(item => item.options?.method === 'PUT').length, 0);
  assert.match(dialog.querySelector('.board-dialog-status').textContent, /korte werkomschrijving|mensenbehoefte|werkadres|klant/i);
});

test('Werkopdrachten-view volgt de prototype-matrix met status, klussen en personen', async () => {
  const view = await setup(true, true);
  assert.doesNotMatch(view.container.textContent, /Aandacht nodig/);
  assert.match(view.container.textContent, /OPEN 1/);
  assert.match(view.container.textContent, /WO-26-0412 · 3 bonnen, 1 binnen/);
  const wo = view.container.querySelector('.tl-wo-label');
  wo.events.click();
  assert.match(view.container.textContent, /Klussen/);
  assert.match(view.container.textContent, /R\. Smit/);
  assert.match(view.container.textContent, /GEEN BON/);
  assert.match(view.container.textContent, /1 dag · 2 mensen per dag/);
});

test('nieuwe werkopdracht toont nummer als automatisch en verstuurt geen nummer', async () => {
  const view = await setup(true);
  const descendants = root => root.children.filter(child => child && Array.isArray(child.children))
    .flatMap(child => [child, ...descendants(child)]);
  const add = descendants(view.container).find(node => node.textContent === '+ Werkopdracht');
  add.events.click();
  await new Promise(resolve => setImmediate(resolve));
  const dialog = descendants(view.container).find(child => child.tagName === 'DIALOG');
  assert.match(dialog.textContent, /Het WO-nummer volgt bij opslaan/);
  assert.match(dialog.textContent, /1 · Klant/);
  assert.match(dialog.textContent, /5 · Wie & wat nodig/);
});

test('klantselectie is typbaar en vult standaard besteller direct in', async () => {
  const view = await setup(true);
  const descendants = root => root.children.filter(child => child && Array.isArray(child.children))
    .flatMap(child => [child, ...descendants(child)]);
  descendants(view.container).find(node => node.textContent === '+ Werkopdracht').events.click();
  await new Promise(resolve => setImmediate(resolve));
  const dialog = descendants(view.container).find(child => child.tagName === 'DIALOG');
  const customer = descendants(dialog).find(node => node.attributes['aria-label'] === 'Klant');
  assert.equal(customer.tagName, 'INPUT');
  assert.equal(customer.attributes.list, 'wo-klanten');
  customer.value = 'Klant'; customer.events.change();
  await new Promise(resolve => setImmediate(resolve));
  const names = descendants(dialog).filter(node => node.attributes['aria-label'] === 'Naam besteller');
  assert.equal(names.at(-1).value, 'Arjen Pelders');
  assert.equal(names.at(-1).readOnly, true);
  assert.equal(descendants(dialog).filter(node => node.attributes['aria-label'] === 'Telefoon besteller').at(-1).value, '06123');
});

test('wie en wat nodig toont functies en vaste materieelindicatoren in twee kolommen', async () => {
  const view = await setup(true);
  const descendants = root => root.children.filter(child => child && Array.isArray(child.children))
    .flatMap(child => [child, ...descendants(child)]);
  descendants(view.container).find(node => node.textContent === '+ Werkopdracht').events.click();
  await new Promise(resolve => setImmediate(resolve));
  const dialog = descendants(view.container).find(child => child.tagName === 'DIALOG');
  const columns = dialog.querySelector('.wo-need-columns');
  assert.ok(columns);
  assert.match(columns.textContent, /Grondwerker/);
  for (const label of ['Aanhanger', 'Graafmachine', 'Klein materieel', 'Voertuig'])
    assert.match(columns.textContent, new RegExp(label));
  assert.equal(descendants(columns).filter(node => node.attributes['aria-label']?.startsWith('Aantal ')).length, 5);
});
