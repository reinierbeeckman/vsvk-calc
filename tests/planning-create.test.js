const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.events = {}; this.attributes = {}; this.dataset = {};
    this.value = ''; this.disabled = false; this.hidden = false; this.open = false; this.textContent = '';
    this.classList = { add() {}, remove() {} };
  }
  get childNodes() { return this.children; }
  append(...items) { this.children.push(...items.filter(item => typeof item !== 'string')); }
  replaceChildren(...items) { this.children = items; this.textContent = ''; }
  insertRow() { const row = new Element('tr'); this.append(row); return row; }
  insertCell() { const cell = new Element('td'); this.append(cell); return cell; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.events[name] = callback; }
  click() { if (!this.disabled) return this.onclick?.() ?? this.events.click?.(); }
  showModal() { this.open = true; }
  close() { this.open = false; this.events.close?.(); }
}
const descendants = item => item.children.flatMap(child => [child, ...descendants(child)]);
const flush = () => new Promise(resolve => setImmediate(resolve));

async function setup(canEdit, options = {}) {
  const ids = ['head', 'body', 'message', 'search', 'detail', 'detail-save', 'title', 'description',
    'list-nav', 'list-panel', 'planbord-panel', 'werkopdrachten-panel', 'global-pagehead', 'planning-pages-panel', 'unavailable', 'add', 'list-hint', 'count', 'empty', 'detail-title', 'detail-subtitle', 'detail-body'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const lists = ['medewerkers', 'klanten', 'materieel', 'artikelen', 'tarieven', 'leveranciers'].map(name => {
    const element = new Element('button'); element.dataset.list = name; return element;
  });
  const sections = [];
  const requests = [];
  const document = {
    createElement: tag => new Element(tag),
    querySelector(selector) {
      if (selector.startsWith('#')) return elements[selector.slice(1)];
      const match = /^\[data-list="(.+)"\] \.list-count$/.exec(selector);
      if (match) return lists.find(item => item.dataset.list === match[1]).children[0];
      throw new Error('Onbekende selector: ' + selector);
    },
    querySelectorAll(selector) {
      if (selector === '[data-list]') return lists;
      if (selector === '[data-section]') return sections;
      if (selector === '[data-close]') return [];
      throw new Error('Onbekende selector: ' + selector);
    }
  };
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    let data = [];
    const response = await argumentsForResponse(url, options);
    if (response) return { ok: response.status < 400, status: response.status, json: async () => response.data };
    if (url === '/bff/user') data = { permissions: { canEditPlanningRecords: canEdit, canManageSettings: canEdit } };
    else if (url === '/api/planning/medewerkers') data = employeeData;
    else if (url === '/api/planning/materieel/referenties') data = { groepen: [], vestigingen: [] };
    else if (url === '/api/article-categories' || url === '/api/article-units') data = [{ id: '123', naam: 'Keuze', actief: true }];
    else if (options.method === 'POST') data = { ...JSON.parse(options.body), eTag: '"1"' };
    return { ok: true, json: async () => data };
  };
  const employeeData = options.employees || [];
  const argumentsForResponse = options.respond || (() => null);
  const window = { addEventListener() {}, confirm: () => true, VsvkLoading: { begin: () => () => {} } };
  const context = vm.createContext({ window, document, fetch, JSON, Set, Map, Object, String, Number, Intl, encodeURIComponent });
  for (const name of ['record-editor.js', 'planning.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps', 'planning', name), 'utf8'), context);
  await flush(); await flush();
  return { elements, lists, requests };
}

function employeeSwitch(view) {
  return descendants(view.elements.body).find(element => element.attributes.role === 'switch');
}

test('de medewerkerstatus wordt direct opgeslagen zonder rijknop', async () => {
  const employee = { id: '1', naam: 'A', actief: true, eTag: '"1"', skills: [] };
  const view = await setup(true, { employees: [employee], respond(url, options) {
    if (url.endsWith('/actief') && options.method === 'PUT')
      return { status: 200, data: { ...employee, actief: false, eTag: '"2"' } };
  } });
  assert.equal(descendants(view.elements.body).some(element => element.textContent === 'Opslaan'), false);
  await employeeSwitch(view).click(); await flush();
  const write = view.requests.find(item => item.options.method === 'PUT');
  assert.equal(write.options.headers['If-Match'], '"1"');
  assert.equal(JSON.parse(write.options.body).actief, false);
  assert.equal(employeeSwitch(view).attributes['aria-checked'], 'false');
  assert.equal(descendants(view.elements.body).some(element => element.textContent === 'Opgeslagen.'), false);
});

test('een mislukte statuswijziging blijft behouden en kan expliciet opnieuw worden geprobeerd', async () => {
  const employee = { id: '1', naam: 'A', actief: true, eTag: '"1"', skills: [] };
  let writes = 0;
  const view = await setup(true, { employees: [employee], respond(url, options) {
    if (url.endsWith('/actief') && options.method === 'PUT') {
      writes++;
      return writes === 1 ? { status: 500 } : { status: 200, data: { ...employee, actief: false, eTag: '"2"' } };
    }
  } });
  await employeeSwitch(view).click(); await flush();
  assert.equal(employeeSwitch(view).attributes['aria-checked'], 'false');
  assert.ok(descendants(view.elements.body).some(element => element.textContent.includes('Opslaan mislukt')));
  const retry = descendants(view.elements.body).find(element => element.textContent === 'Opnieuw proberen');
  assert.ok(retry); await retry.click(); await flush();
  assert.equal(writes, 2);
});

test('bij een statusconflict wordt de nieuwste versie getoond en alleen na bevestiging opnieuw opgeslagen', async () => {
  const employee = { id: '1', naam: 'A', actief: true, eTag: '"1"', skills: [] };
  let writes = 0;
  const view = await setup(true, { employees: [employee], respond(url, options) {
    if (url.endsWith('/actief') && options.method === 'PUT') {
      writes++;
      return writes === 1 ? { status: 412 } : { status: 200, data: { ...employee, actief: false, eTag: '"3"' } };
    }
    if (url === '/api/planning/medewerkers/1') return { status: 200, data: { ...employee, eTag: '"2"' } };
  } });
  await employeeSwitch(view).click(); await flush();
  assert.equal(writes, 1);
  assert.equal(employeeSwitch(view).attributes['aria-checked'], 'false');
  assert.ok(descendants(view.elements.body).some(element => element.textContent.includes('Huidige status: actief')));
  const reapply = descendants(view.elements.body).find(element => element.textContent === 'Mijn keuze opnieuw toepassen');
  assert.ok(reapply); await reapply.click(); await flush();
  const requests = view.requests.filter(item => item.options.method === 'PUT');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].options.headers['If-Match'], '"2"');
});

test('toevoegen blijft uitgeschakeld zonder developmentrechten', async () => {
  const view = await setup(false);
  for (const list of view.lists) {
    await list.click(); await flush();
    assert.equal(view.elements.add.disabled, true, list.dataset.list);
  }
});

test('als rechten ophalen mislukt blijft toevoegen uit en wordt de fout gemeld', async () => {
  const view = await setup(false, { respond(url) {
    if (url === '/bff/user') return { status: 500 };
  } });
  assert.equal(view.elements.add.disabled, true);
  assert.match(view.elements['list-hint'].textContent, /rechten.*ophalen.*mislukt/i);
});

for (const [list, fields, endpoint] of [
  ['medewerkers', { Naam: 'Medewerker' }, '/api/planning/medewerkers'],
  ['klanten', { Debiteurnummer: '101', Bedrijfsnaam: 'Klant' }, '/api/planning/klanten'],
  ['materieel', { Omschrijving: 'Machine' }, '/api/planning/materieel'],
  ['artikelen', { Omschrijving: 'Artikel', Categorie: '123', Eenheid: '123' }, '/api/articles'],
  ['tarieven', { Functie: 'Planner', Prijs: '55', Eenheid: 'uur', 'Geldig vanaf': '2026-01-01' }, '/api/planning/tarieven'],
  ['leveranciers', { Crediteurnummer: 'L1', Bedrijfsnaam: 'Leverancier Een', 'Telefoon algemeen': '010123', IBAN: 'NL91ABNA0417164300' }, '/api/planning/leveranciers']
]) {
  test(`development kan ${list} toevoegen via POST`, async () => {
    const view = await setup(true);
    await view.lists.find(item => item.dataset.list === list).click(); await flush();
    assert.equal(view.elements.add.disabled, false);
    await view.elements.add.click(); await flush();
    for (const [label, value] of Object.entries(fields)) {
      const input = descendants(view.elements['detail-body']).find(element => element.attributes['aria-label'] === label);
      assert.ok(input, label);
      input.value = value; input.events.input?.(); input.events.change?.();
    }
    await view.elements['detail-save'].click(); await flush();
    const writes = view.requests.filter(item => item.url === endpoint && item.options.method === 'POST');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].options.headers['If-Match'], undefined);
    assert.equal(view.elements.detail.open, false);
  });
}
