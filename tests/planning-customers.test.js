const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../apps/planning/planning.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor(dataset = {}) { this.dataset = dataset; this.children = []; this.events = {}; this.attributes = {}; this.hidden = false; this.value = ''; this._text = ''; this.classList = { add() {} }; }
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

function setup(detailResponse, fixtures = {}) {
  const ids = ['head', 'body', 'message', 'search', 'detail', 'title', 'description', 'list-nav', 'list-panel', 'unavailable', 'add', 'count', 'empty', 'detail-title', 'detail-subtitle', 'detail-body'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const lists = ['medewerkers', 'klanten', 'materieel', 'artikelen', 'ordernummers', 'tarieven', 'leveranciers', 'instellingen', 'huisstijl', 'rollen'].map(list => new Element({ list }));
  const sections = [new Element({ section: 'Lijsten' })];
  const close = new Element();
  const requests = [];
  const document = {
    createElement: () => new Element(),
    querySelector(selector) {
      if (selector.startsWith('#')) return elements[selector.slice(1)];
      const match = selector.match(/^\[data-list="(.+)"\] \.list-count$/);
      if (match) return lists.find(element => element.dataset.list === match[1]).children.find(child => child instanceof Element);
      throw new Error('Onbekende selector: ' + selector);
    },
    querySelectorAll(selector) { return selector === '[data-list]' ? lists : selector === '[data-section]' ? sections : [close]; }
  };
  const fetch = async url => {
    requests.push(url);
    const data = url === '/api/planning/klanten' ? [{ id: 1, actief: true, debiteurnummer: '1001', bedrijfsnaam: 'Klant Een', telefoon: '010', plaats: 'Delft' }]
      : url === '/api/planning/klanten/1' ? await detailResponse() : fixtures[url] || [];
    return { ok: true, json: async () => data };
  };
  vm.runInNewContext(script, { document, window: { addEventListener() {} }, fetch, Map, Set, Error });
  return { elements, lists, close, requests };
}

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
  assert.deepEqual(switches.map(element => element.attributes['aria-checked']), ['true', 'false', 'true', 'false', 'true']);
  assert.ok(switches.every(element => element.attributes['aria-readonly'] === 'true'));
  assert.ok(switches.every(element => element.attributes['aria-label']));

  view.lists.find(element => element.dataset.list === 'artikelen').click();
  await flush();
  switches = descendants(view.elements.body).filter(element => element.attributes.role === 'switch');
  assert.equal(switches[0].attributes['aria-checked'], 'false');
  assert.equal(switches[0].attributes['aria-readonly'], 'true');
});

test('klantenlijst laadt en toont de contactpersonen bij openen', async () => {
  const view = setup(async () => ({ id: 1, bedrijfsnaam: 'Klant Een', facturatie: { btwNummer: 'NL123', gRekeningPercentage: 0 }, contactpersonen: [{ naam: 'Jan', functie: 'Inkoper', telefoon: '06123', email: 'jan@example.test', isStandaardBesteller: true }] }));
  await flush();
  view.lists.find(element => element.dataset.list === 'klanten').click();
  await flush();
  assert.match(view.elements.body.textContent, /Klant Een/);
  const row = view.elements.body.children[0];
  row.children.at(-1).children[0].click();
  await flush();
  assert.ok(view.requests.includes('/api/planning/klanten/1'));
  assert.match(view.elements['detail-title'].textContent, /Klant Een/);
  assert.match(view.elements['detail-body'].textContent, /Jan/);
  assert.match(view.elements['detail-body'].textContent, /Inkoper/);
  assert.match(view.elements['detail-body'].textContent, /Standaard besteller/);
  assert.match(view.elements['detail-body'].textContent, /NL123/);
  assert.match(view.elements['detail-body'].textContent, /G-rekening \(%\)0/);
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
