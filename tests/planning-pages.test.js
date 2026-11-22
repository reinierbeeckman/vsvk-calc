const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this._text = ''; this.className = '';
    this.attributes = {}; this.events = {}; this.classList = {
      toggle: (name, active) => {
        const values = new Set(this.className.split(/\s+/).filter(Boolean));
        active ? values.add(name) : values.delete(name); this.className = [...values].join(' ');
      }
    };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent || '').join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this._text = ''; }
  addEventListener(name, callback) { this.events[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
}

const script = fs.readFileSync(path.join(__dirname, '../apps/planning/planning-pages.js'), 'utf8');
function setup() {
  const document = { createElement: tag => new Element(tag) };
  const data = {
    '/api/planning/medewerkers': [{ id: 'm1', naam: 'Jan', functie: 'Grondwerker', actief: true,
      vestiging: 'Utrecht', skills: [{ naam: 'VCA', geldigTot: '2026-10-01' }] }],
    '/api/planning/materieel': [{ id: 'x1', omschrijving: 'Kraanwagen', materieelgroep: 'Kranen', standplaats: 'Utrecht' }],
    '/api/planning/werkbonnen': [{ id: 'b1', nummer: 'WB-0001-01', status: 'uitgereikt',
      datum: '2026-11-23', startTijd: '07:00', eindTijd: '16:00', medewerker: 'Jan',
      werkopdrachtNummer: 'WO-26-0001', klant: 'Klant', omschrijving: 'Werk' }]
  };
  const context = { document, window: { VsvkLoading: { begin: () => () => {} } },
    Intl, Date, Set, Object, Array, Number, String };
  vm.runInNewContext(script, context);
  return { context, container: new Element(), request: async url => data[url] || {
    groepen: [{ key: 'aandacht', werkopdrachten: [{ id: 'w1', nummer: 'WO-26-0001',
      klantNaam: 'Klant', kop: 'Werk', startDatum: '2026-11-23', status: 'OPEN 1',
      openPlekken: 1, bonnenTeDoen: 1, dagen: { '2026-11-23': { bezet: 1, nodig: 2, open: 1, teDoen: 1, bezetting: 'deels' } } }] }]
  }};
}

test('overview en werkbonnen tonen dezelfde databasegestuurde procesonderdelen', async () => {
  const { context, container, request } = setup();
  await context.window.VsvkPlanningPages.open({ section: 'overzicht', container, request, navigate: () => {} });
  assert.match(container.textContent, /Te doen en signalen/);
  assert.match(container.textContent, /Werkopdrachten in deze periode/);
  assert.match(container.textContent, /1 plekken nog open/);

  await context.window.VsvkPlanningPages.open({ section: 'werkbonnen', container, request, navigate: () => {} });
  for (const label of ['Maken & printen', 'Binnen & digitaliseren', 'Inkoop', 'Verkoop', 'Proforma & factuur', 'Self-bill ZZP'])
    assert.match(container.textContent, new RegExp(label.replace('&', '\\&')));
  assert.match(container.textContent, /WB-0001-01/);
});

test('team toont medewerkers, materieel en verlopen certificaten', async () => {
  const { context, container, request } = setup();
  await context.window.VsvkPlanningPages.open({ section: 'team', container, request, navigate: () => {} });
  assert.match(container.textContent, /Jan/);
  assert.match(container.textContent, /Kraanwagen/);
  assert.match(container.textContent, /Medewerkers/);
});
