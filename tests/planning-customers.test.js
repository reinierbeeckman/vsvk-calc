const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../apps/planning/planning.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor(dataset = {}, tagName = '') { this.dataset = dataset; this.tagName = tagName.toUpperCase(); this.children = []; this.events = {}; this.attributes = {}; this.hidden = false; this.value = ''; this._text = ''; this.classList = { add() {}, remove() {} }; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
  get childNodes() { return this.children; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.events[name] = callback; }
  click() { return this.events.click?.(); }
  insertRow() { const element = new Element(); this.append(element); return element; }
  insertCell() { const element = new Element(); this.append(element); return element; }
  showModal() { this.open = true; }
  close() { this.open = false; this.events.close?.(); }
}

function setup(detailResponse, fixtures = {}, loading = { begin: () => () => {} }) {
  const ids = ['head', 'body', 'message', 'search', 'detail', 'title', 'description', 'list-nav', 'list-panel', 'unavailable', 'add', 'count', 'empty', 'detail-title', 'detail-subtitle', 'detail-body'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const lists = ['medewerkers', 'klanten', 'materieel', 'artikelen', 'ordernummers', 'tarieven', 'leveranciers', 'instellingen', 'huisstijl', 'rollen'].map(list => new Element({ list }));
  const sections = [new Element({ section: 'Lijsten' })];
  const close = new Element();
  const requests = [];
  const requestDetails = [];
  const document = {
    createElement: tagName => new Element({}, tagName),
    querySelector(selector) {
      if (selector.startsWith('#')) return elements[selector.slice(1)];
      const match = selector.match(/^\[data-list="(.+)"\] \.list-count$/);
      if (match) return lists.find(element => element.dataset.list === match[1]).children.find(child => child instanceof Element);
      throw new Error('Onbekende selector: ' + selector);
    },
    querySelectorAll(selector) { return selector === '[data-list]' ? lists : selector === '[data-section]' ? sections : [close]; }
  };
  const fetch = async (url, options) => {
    requests.push(url);
    requestDetails.push({ url, options });
    if (typeof fixtures[url] === 'function') {
      const result = await fixtures[url](options);
      if (result && result.status) return { ok: result.status < 400, status: result.status, json: async () => result.body };
      return { ok: true, json: async () => result };
    }
    const data = url === '/api/planning/klanten' ? [{ id: 1, actief: true, debiteurnummer: '1001', bedrijfsnaam: 'Klant Een', telefoon: '010', plaats: 'Delft' }]
      : url === '/api/planning/klanten/1' ? await detailResponse() : url === '/api/planning/klanten/1/tarieven' ? { eTag: '"1"', afwijkingen: [], historischeTarieven: [] } : fixtures[url] || [];
    return { ok: true, json: async () => data };
  };
  vm.runInNewContext(script, { document, window: { addEventListener() {}, VsvkLoading: loading }, fetch, Map, Set, Error });
  return { elements, lists, close, requests, requestDetails };
}

test('lijst en details stoppen hun laadindicatie bij navigeren of sluiten', async () => {
  let active = 0;
  const loading = { begin() { active++; let ended = false; return () => { if (!ended) { active--; ended = true; } }; } };
  let resolveEmployees;
  let resolveDetail;
  const view = setup(() => new Promise(resolve => { resolveDetail = resolve; }), {
    '/api/planning/medewerkers': () => new Promise(resolve => { resolveEmployees = resolve; })
  }, loading);
  await flush();
  assert.equal(active, 1);
  view.lists.find(element => element.dataset.list === 'klanten').click();
  await flush();
  assert.equal(active, 0);
  resolveEmployees([]);
  await flush();
  view.elements.body.children[0].children.at(-1).children[0].click();
  assert.equal(active, 1);
  view.close.click();
  assert.equal(active, 0);
  resolveDetail({ id: 1, contactpersonen: [] });
  await flush();
  assert.equal(active, 0);
});

function descendants(element) {
  return element.children.filter(child => child instanceof Element).flatMap(child => [child, ...descendants(child)]);
}

test('ja-neewaarden gebruiken toegankelijke schakelaars met behoud van bewerkrechten', async () => {
  const view = setup(async () => ({
    id: 1, actief: true, bedrijfsnaam: 'Klant Een',
    facturatie: { afwijkendFactuuradres: false, btwVerlegd: true, mandagenregisterMeesturen: false },
    contactpersonen: [{ naam: 'Jan', isStandaardBesteller: true }]
  }), {
    '/api/planning/medewerkers': [{ id: 'm1', naam: 'Medewerker', actief: true, eTag: '"1"' }],
    '/api/articles': [{ id: 'a1', naam: 'Artikel', actief: false }]
  });
  await flush();
  let switches = descendants(view.elements.body).filter(element => element.attributes.role === 'switch');
  assert.equal(switches[0].attributes['aria-checked'], 'true');
  assert.notEqual(switches[0].attributes['aria-readonly'], 'true');
  assert.equal(typeof switches[0].events.click, 'function');
  assert.equal(view.elements.head.children[0].children[0].textContent, 'Actief');
  view.elements.body.children[0].children.at(-1).children[0].click();
  let detailSwitches = descendants(view.elements['detail-body']).filter(element => element.attributes.role === 'switch');
  assert.equal(detailSwitches[0].attributes['aria-checked'], 'true');
  assert.equal(detailSwitches[0].attributes['aria-readonly'], 'true');
  assert.equal(detailSwitches[0].attributes['aria-label'], 'Actief');
  view.close.click();

  view.lists.find(element => element.dataset.list === 'klanten').click();
  await flush();
  assert.equal(view.elements.head.children[0].children[0].textContent, 'Actief');
  switches = descendants(view.elements.body).filter(element => element.attributes.role === 'switch');
  assert.equal(switches[0].attributes['aria-checked'], 'true');
  assert.equal(switches[0].attributes['aria-readonly'], 'true');
  assert.equal(switches[0].events.click, undefined);
  view.elements.body.children[0].children.at(-1).children[0].click();
  await flush();
  switches = descendants(view.elements['detail-body']).filter(element => element.attributes.role === 'switch');
  assert.deepEqual(switches.map(element => element.attributes['aria-checked']), ['true', 'false', 'true', 'false']);
  assert.ok(switches.every(element => element.attributes['aria-readonly'] === 'true'));
  assert.ok(switches.every(element => element.attributes['aria-label']));

  view.lists.find(element => element.dataset.list === 'artikelen').click();
  await flush();
  switches = descendants(view.elements.body).filter(element => element.attributes.role === 'switch');
  assert.equal(switches[0].attributes['aria-checked'], 'false');
  assert.equal(switches[0].attributes['aria-readonly'], 'true');
});

test('klantenlijst laadt en toont de contactpersonen bij openen', async () => {
  const view = setup(async () => ({ id: 1, bedrijfsnaam: 'Klant Een', debiteurnummer: '1001', facturatie: { btwNummer: 'NL123', iban: 'NL91ABNA0417164300', gRekeningPercentage: 0, facturerenPer: 'week' }, contactpersonen: [{ naam: 'Jan', functie: 'Inkoper', telefoon: '06123', email: 'jan@example.test', isStandaardBesteller: true }, { naam: 'Piet', isStandaardBesteller: false }] }));
  await flush();
  view.lists.find(element => element.dataset.list === 'klanten').click();
  await flush();
  assert.match(view.elements.body.textContent, /Klant Een/);
  const row = view.elements.body.children[0];
  row.children.at(-1).children[0].click();
  await flush();
  assert.ok(view.requests.includes('/api/planning/klanten/1'));
  assert.match(view.elements['detail-title'].textContent, /Klant Een/);
  const nodes = descendants(view.elements['detail-body']);
  assert.ok(nodes.some(element => element.value === 'Jan' && element.readOnly));
  assert.ok(nodes.some(element => element.value === 'Inkoper' && element.readOnly));
  assert.ok(nodes.some(element => element.value === 'NL123' && element.readOnly));
  assert.ok(nodes.some(element => element.value === 'NL91ABNA0417164300' && element.readOnly));
  assert.ok(nodes.some(element => element.value === '0' && element.readOnly));
  assert.deepEqual(nodes.filter(element => element.type === 'radio').map(element => [element.checked, element.disabled]), [[true, true], [false, true]]);
  const grid = nodes.find(element => element.className === 'kgrid');
  assert.ok(grid);
  assert.deepEqual(grid.children.map(section => section.children[0].textContent), ['Bedrijf', 'Vestigingsadres', 'Facturatie']);
  assert.ok(nodes.some(element => element.className === 'crow2 hd'));
  assert.equal(nodes.filter(element => element.className === 'crow2').length, 2);
  const billingPeriod = nodes.find(element => element.tagName === 'SELECT');
  assert.equal(billingPeriod.value, 'week');
  assert.equal(billingPeriod.disabled, true);
  assert.ok(nodes.some(element => element.tagName === 'TEXTAREA' && element.placeholder === 'Bijv. melden bij de bouwkeet, sleutel bij de beheerder'));
  for (const heading of ['Bedrijf', 'Vestigingsadres', 'Facturatie', 'Contactpersonen & bestellers', 'Afwijkende tarieven', 'Opmerkingen', 'Werkopdrachten']) assert.match(view.elements['detail-body'].textContent, new RegExp(heading));
  assert.match(view.elements['detail-body'].textContent, /standaard besteller/i);
  assert.match(view.elements['detail-body'].textContent, /G-rekening \(%\)/);
  assert.match(view.elements['detail-body'].textContent, /Geen standaardtarieven beschikbaar/);
  assert.match(view.elements['detail-subtitle'].textContent, /Debiteur 1001/);
});

test('sluiten tijdens laden opent de klantdetails niet opnieuw', async () => {
  let resolveDetail;
  const view = setup(() => new Promise(resolve => { resolveDetail = resolve; }));
  await flush();
  view.lists.find(element => element.dataset.list === 'klanten').click();
  await flush();
  view.elements.body.children[0].children.at(-1).children[0].click();
  view.close.click();
  resolveDetail({ id: 1, bedrijfsnaam: 'Klant Een', contactpersonen: [] });
  await flush();
  assert.equal(view.elements.detail.open, false);
});

test('klantvenster toont geen verzonnen facturatie of werkopdrachten', async () => {
  const view = setup(async () => ({ id: 1, bedrijfsnaam: 'Klant Een', contactpersonen: [] }));
  await flush();
  view.lists.find(element => element.dataset.list === 'klanten').click();
  await flush();
  view.elements.body.children[0].children.at(-1).children[0].click();
  await flush();
  const nodes = descendants(view.elements['detail-body']);
  assert.equal(nodes.find(element => element.tagName === 'SELECT').value, '');
  assert.match(view.elements['detail-body'].textContent, /Nog geen contactpersonen/);
  assert.match(view.elements['detail-body'].textContent, /Werkopdrachten zijn nog niet gekoppeld/);
});

test('standaardtarieven zijn zichtbaar en afwijkingen worden met versie opgeslagen', async () => {
  let saved;
  const view = setup(async () => ({ id: 1, bedrijfsnaam: 'Klant Een', contactpersonen: [] }), {
    '/api/planning/tarieven': [{ functieId: 1, functie: 'Grondwerker', actief: true, prijs: 50, eenheid: 'uur', geldigVanaf: '2026-01-01' }],
    '/api/planning/klanten/1/tarieven': options => {
      if (options?.method === 'PUT') { saved = options; return { eTag: '"2"', afwijkingen: [{ functieId: 1, tarief: 55 }], historischeTarieven: [] }; }
      return { eTag: '"1"', afwijkingen: [], historischeTarieven: [] };
    }
  });
  await flush();
  view.lists.find(element => element.dataset.list === 'tarieven').click();
  await flush();
  assert.match(view.elements.body.textContent, /Grondwerker/);
  view.lists.find(element => element.dataset.list === 'klanten').click();
  await flush();
  view.elements.body.children[0].children.at(-1).children[0].click();
  await flush(); await flush();
  const nodes = descendants(view.elements['detail-body']);
  assert.match(view.elements['detail-body'].textContent, /Grondwerker/);
  assert.match(view.elements['detail-body'].textContent, /50,00/);
  const input = nodes.find(element => element.attributes['aria-label'] === 'Afwijkend tarief Grondwerker');
  input.value = '55.00'; input.events.input();
  const save = nodes.find(element => element.textContent === 'Tarieven opslaan');
  await save.events.click();
  assert.equal(saved.headers['If-Match'], '"1"');
  assert.deepEqual(JSON.parse(saved.body), { afwijkingen: [{ functieId: 1, tarief: 55 }] });
  assert.equal(save.disabled, true);
});

test('standaardtarief kan per regel worden gewijzigd en conflicten behouden de invoer', async () => {
  let writes = 0;
  const view = setup(async () => ({}), {
    '/api/planning/tarieven': [{ standaardTariefId: 2, functieId: 1, functie: 'Grondwerker', actief: true, prijs: 50, eenheid: 'uur' }],
    '/api/planning/tarieven/2/prijs': options => {
      if (options?.method === 'PUT') { writes++; return writes === 1 ? { status: 412 } : { prijs: 55, eTag: '"3"' }; }
      return writes ? { prijs: 60, eTag: '"2"' } : { prijs: 50, eTag: '"1"' };
    }
  });
  await flush(); view.lists.find(element => element.dataset.list === 'tarieven').click(); await flush();
  let nodes = descendants(view.elements.body);
  assert.equal(nodes.some(element => element.tagName === 'INPUT'), false);
  nodes.find(element => element.attributes['aria-label'] === 'Tarief Grondwerker wijzigen').click(); await flush();
  nodes = descendants(view.elements.body);
  let input = nodes.find(element => element.attributes['aria-label'] === 'Prijs Grondwerker');
  assert.equal(nodes.some(element => element.textContent === 'Openen'), false);
  assert.equal(nodes.find(element => element.textContent === 'Opslaan').disabled, true);
  input.value = '55'; input.events.input();
  assert.equal(nodes.find(element => element.textContent === 'Opslaan').disabled, false);
  view.lists.find(element => element.dataset.list === 'klanten').click(); await flush();
  view.lists.find(element => element.dataset.list === 'tarieven').click(); await flush();
  nodes = descendants(view.elements.body);
  assert.equal(nodes.find(element => element.attributes['aria-label'] === 'Prijs Grondwerker').value, '55');
  await nodes.find(element => element.textContent === 'Opslaan').events.click();
  nodes = descendants(view.elements.body);
  input = nodes.find(element => element.attributes['aria-label'] === 'Prijs Grondwerker');
  assert.equal(input.value, '55');
  assert.match(view.elements.body.textContent, /60,00/);
  assert.equal(writes, 1);
  nodes.find(element => element.textContent === 'Mijn wijziging opnieuw toepassen').click();
  nodes = descendants(view.elements.body);
  await nodes.find(element => element.textContent === 'Opslaan').events.click();
  assert.equal(writes, 2);
  assert.equal(view.requestDetails.filter(entry => entry.options?.method === 'PUT')[1].options.headers['If-Match'], '"2"');
  assert.equal(descendants(view.elements.body).some(element => element.textContent === 'Openen'), true);
});

test('bij een conflict blijven wijzigingen staan en is opnieuw toepassen expliciet', async () => {
  let reads = 0;
  let writes = 0;
  const view = setup(async () => ({ id: 1, bedrijfsnaam: 'Klant Een', contactpersonen: [] }), {
    '/api/planning/tarieven': [{ functieId: 1, functie: 'Grondwerker', actief: true, prijs: 50, eenheid: 'uur' }],
    '/api/planning/klanten/1/tarieven': options => {
      if (options?.method === 'PUT') { writes++; return { status: 412 }; }
      reads++;
      return reads === 1 ? { eTag: '"1"', afwijkingen: [], historischeTarieven: [] }
        : { eTag: '"2"', afwijkingen: [{ functieId: 1, tarief: 60 }], historischeTarieven: [] };
    }
  });
  await flush(); view.lists.find(element => element.dataset.list === 'klanten').click();
  await flush(); view.elements.body.children[0].children.at(-1).children[0].click();
  await flush(); await flush();
  let nodes = descendants(view.elements['detail-body']);
  const input = nodes.find(element => element.attributes['aria-label'] === 'Afwijkend tarief Grondwerker');
  input.value = '55'; input.events.input();
  await nodes.find(element => element.textContent === 'Tarieven opslaan').events.click();
  nodes = descendants(view.elements['detail-body']);
  assert.equal(input.value, '55');
  assert.equal(writes, 1);
  assert.match(view.elements['detail-body'].textContent, /60,00/);
  assert.ok(nodes.some(element => element.textContent === 'Mijn wijzigingen opnieuw toepassen'));
});

test('opnieuw toepassen bewaart wijzigingen van een ander bij ongewijzigde functies', async () => {
  let reads = 0;
  const writes = [];
  const view = setup(async () => ({ id: 1, bedrijfsnaam: 'Klant Een', contactpersonen: [] }), {
    '/api/planning/tarieven': [
      { functieId: 1, functie: 'Grondwerker', actief: true, prijs: 50, eenheid: 'uur' },
      { functieId: 2, functie: 'Uitvoerder', actief: true, prijs: 70, eenheid: 'uur' }
    ],
    '/api/planning/klanten/1/tarieven': options => {
      if (options?.method === 'PUT') {
        writes.push(options);
        return writes.length === 1 ? { status: 412 } : { eTag: '"3"', afwijkingen: [{ functieId: 1, tarief: 55 }, { functieId: 2, tarief: 75 }], historischeTarieven: [] };
      }
      reads++;
      return reads === 1 ? { eTag: '"1"', afwijkingen: [], historischeTarieven: [] }
        : { eTag: '"2"', afwijkingen: [{ functieId: 2, tarief: 75 }], historischeTarieven: [] };
    }
  });
  await flush(); view.lists.find(element => element.dataset.list === 'klanten').click();
  await flush(); view.elements.body.children[0].children.at(-1).children[0].click();
  await flush(); await flush();
  let nodes = descendants(view.elements['detail-body']);
  const input = nodes.find(element => element.attributes['aria-label'] === 'Afwijkend tarief Grondwerker');
  input.value = '55'; input.events.input();
  const save = nodes.find(element => element.textContent === 'Tarieven opslaan');
  await save.events.click();
  nodes = descendants(view.elements['detail-body']);
  nodes.find(element => element.textContent === 'Mijn wijzigingen opnieuw toepassen').click();
  assert.equal(writes.length, 1);
  assert.equal(nodes.find(element => element.attributes['aria-label'] === 'Afwijkend tarief Uitvoerder').value, '75');
  await save.events.click();
  assert.equal(writes[1].headers['If-Match'], '"2"');
  assert.deepEqual(JSON.parse(writes[1].body), { afwijkingen: [{ functieId: 1, tarief: 55 }, { functieId: 2, tarief: 75 }] });
});
