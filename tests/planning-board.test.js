const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/* ---------- minimale DOM ---------- */
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.attributes = {};
    this.events = {}; this.dataset = {}; this._text = ''; this.className = ''; this.value = '';
    this.style = { setProperty: (name, value) => { this.style[name] = value; } };
    const set = () => new Set(this.className.split(/\s+/).filter(Boolean));
    this.classList = {
      add: (...names) => { const values = set(); names.forEach(name => values.add(name)); this.className = [...values].join(' '); },
      remove: (...names) => { const values = set(); names.forEach(name => values.delete(name)); this.className = [...values].join(' '); },
      toggle: (name, active) => { const values = set(); active ? values.add(name) : values.delete(name); this.className = [...values].join(' '); },
      contains: name => set().has(name)
    };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent || '').join(''); }
  get childNodes() { return this.children; }
  append(...children) { for (const child of children) { if (child && typeof child === 'object') child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this._text = ''; this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  dispatch(name, event = {}) { for (const callback of this.events[name] || []) callback({ preventDefault() {}, stopPropagation() {}, ...event }); }
  click() { this.dispatch('click'); }
  remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
  matches(selector) {
    return selector.split(',').map(part => part.trim()).some(part => {
      if (part.startsWith('.')) return part.slice(1).split('.').every(name => this.classList.contains(name));
      return this.tagName === part.toUpperCase();
    });
  }
  querySelectorAll(selector) { return all(this).filter(node => node !== this && node.matches?.(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function all(root) {
  const result = [root];
  for (const child of root.children || []) if (child && typeof child === 'object') result.push(...all(child));
  return result;
}
const find = (root, predicate) => all(root).find(node => node.tagName && predicate(node));
const byText = (root, text, tag = 'BUTTON') => find(root, node => node.tagName === tag && node.textContent === text);
const byLabel = (root, label) => find(root, node => node.attributes?.['aria-label'] === label);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

/* ---------- testdata rond de huidige week ---------- */
const pad = value => String(value).padStart(2, '0');
const iso = date => date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
const now = new Date();
const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
const day = offset => iso(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offset));

function detail(id, nummer, inzetten = [], materieelInzetten = []) {
  return {
    id, nummer, klantId: 1, klant: 'Gemeente Rivierstad', omschrijving: 'Afzetting', korteWerkomschrijving: 'Afzetting Kerkstraat',
    startDatum: day(0), eindDatum: day(1), isOptie: false, kleur: '#ff4e02', status: 'OPEN 1', version: 3, eTag: '"3"',
    soort: 'regie', weekendOverslaan: true, vrijeDagen: [], werkvoorraad: false, prioriteit: 'normaal',
    werkadres: 'Kerkstraat 14', werkPlaats: 'Rivierstad', startOpLocatie: '07:00:00', eindOpLocatie: '16:00:00',
    pauzeMinuten: 30, ordernummers: ['PO-1'], behoeften: [{ aantal: 2, rol: 'Verkeersregelaar', skill: null, soort: 'mens' }],
    materieel: [], materialen: [],
    klussen: [0, 1].map(offset => ({
      id: id + '-k' + offset, omschrijving: 'Afzetting', startDatum: day(0), eindDatum: day(1), datum: day(offset),
      benodigdeMedewerkers: 2, startTijd: '07:00:00', eindTijd: '16:00:00', sorteervolgorde: offset,
      behoeften: [{ aantal: 2, rol: 'Verkeersregelaar', skill: null, soort: 'mens' }],
      inzetten: inzetten.filter(item => item.datum === day(offset)),
      materieelInzetten: materieelInzetten.filter(item => item.datum === day(offset))
    }))
  };
}
function line(id, nummer, extra = {}) {
  return {
    id, nummer, klantNaam: 'Gemeente Rivierstad', kop: 'Afzetting', startDatum: day(0), eindDatum: day(1),
    kleur: '#ff4e02', optie: false, openPlekken: 1, bonnenTeDoen: 0, groep: 'aandacht', status: 'OPEN 1', bonnen: 1, bonnenBinnen: 0,
    dagen: { [day(0)]: { nodig: 2, bezet: 1, open: 1, bezetting: 'deels', vertrek: '07:00' }, [day(1)]: { nodig: 2, bezet: 0, open: 2, bezetting: 'leeg', vertrek: '07:00' } },
    mensen: [{ id: 'm1', naam: 'Jan de Vries', functie: 'Verkeersregelaar', extern: false,
      dagen: { [day(0)]: { status: 'UITGEREIKT', bonId: 'b1', nummer: 'WB-1', klusId: id + '-k0' } } }],
    ...extra
  };
}

function setup({ canEdit = true, mode = 'workorders', putStatus = 200, otherOrder = false } = {}) {
  const document = {
    body: new Element('body'), elements: {},
    createElement: tag => new Element(tag), createTextNode: text => ({ textContent: text }),
    getElementById(id) { return this.elements[id] || all(this.body).find(node => node.id === id) || null; }
  };
  document.elements.title = new Element('h1'); document.elements.description = new Element('p');
  function Option(text, value) { const option = new Element('option'); option.textContent = text; option.value = String(value); return option; }
  const memory = {};
  const window = { VsvkLoading: { begin: () => () => {} }, localStorage: { getItem: key => memory[key] ?? null, setItem: (key, value) => { memory[key] = value; } } };
  const context = { window, document, Option, Date, Intl, JSON, Promise, Set, Map, Math, Number, String, Object, Array, setTimeout, clearTimeout, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../apps/planning/planbord.js'), 'utf8'), context);

  const first = detail('w1', 'WO-2026-0412',
    [{ id: 'i1', datum: day(0), medewerkerId: 'm1', inhuurmedewerkerId: null, startTijd: '07:00:00', eindTijd: '16:00:00',
      werkbon: { id: 'b1', nummer: 'WB-1', status: 'uitgereikt', gewijzigdNaUitgifte: false, uitgereiktOp: '2026-01-01T07:00:00Z', binnenOp: null } }],
    [{ id: 'x1', datum: day(0), materieelId: 'eq1', materieel: 'Pijlwagen PW-04' }]);
  const second = detail('w2', 'WO-2026-0413', otherOrder ? [{ id: 'i2', datum: day(1), medewerkerId: 'm2', inhuurmedewerkerId: null, werkbon: null }] : []);
  const calls = [];
  const request = async (url, options = {}) => {
    calls.push({ url, ...options, body: options.body ? JSON.parse(options.body) : undefined });
    if (url.startsWith('/api/planning/planbord/werkopdrachten')) return { groepen: [{ key: 'aandacht', werkopdrachten: [line('w1', 'WO-2026-0412'), line('w2', 'WO-2026-0413', { mensen: [], openPlekken: 0, bonnenTeDoen: 2, status: 'GEPLAND' })] }] };
    if (url.startsWith('/api/planning/planbord?')) return [first, second];
    if (url === '/api/planning/planbord/referenties') return { klanten: [{ id: 1, naam: 'Gemeente Rivierstad' }],
      medewerkers: [{ id: 'm1', naam: 'Jan de Vries' }, { id: 'm2', naam: 'Sanne Jansen' }],
      inhuurmedewerkers: [{ id: 's1', naam: 'Henk Post', functie: 'Verkeersregelaar', leverancierId: 1, leverancier: 'Inhuur Oost' }], leveranciers: [], vestigingen: [] };
    if (url === '/api/planning/werkopdrachten/form-referenties') return {
      klanten: [{ id: 1, naam: 'Gemeente Rivierstad', debiteurnummer: 'D-10021', straat: 'Stadhuisplein 1', postcode: '3511 AA', plaats: 'Rivierstad',
        contacten: [{ id: 10, naam: 'A. Hendriks', telefoon: '06', email: 'a@x.test', isStandaardBesteller: true }], recenteOpdrachten: [] }],
      vestigingen: [], functies: ['Verkeersregelaar', 'Voorman'], materieelTypes: [],
      materieel: [{ id: 'eq1', naam: 'Pijlwagen PW-04', groepId: 'g1' }], artikelen: [] };
    if (url === '/api/planning/medewerkers') return [{ id: 'm1', naam: 'Jan de Vries', functie: 'Verkeersregelaar' }, { id: 'm2', naam: 'Sanne Jansen', functie: 'Voorman' }];
    if (url === '/api/planning/werkopdrachten/w1' && !options.method) return clone(first);
    if (url === '/api/planning/werkopdrachten/w2' && !options.method) return clone(second);
    if (options.method === 'PUT' && putStatus !== 200) { const error = new Error('Precondition failed'); error.status = putStatus; throw error; }
    if (options.method === 'POST' && url === '/api/planning/werkopdrachten') return { id: 'w9', nummer: 'WO-2026-0419' };
    if (options.method === 'DELETE') return null;
    return clone(first);
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const container = new Element('section');
  document.body.append(container);
  const openBoard = () => context.window.VsvkPlanBoard.open({ container, request, canEdit: Promise.resolve(canEdit), mode });
  return { context, container, request, calls, document, openBoard };
}

test('werkopdrachten toont tijdlijn met status, klussen, werkbonnen en materieel', async () => {
  const { container, document, openBoard } = setup();
  await openBoard();
  assert.equal(document.getElementById('title').textContent, 'Werkopdrachten');
  assert.match(container.textContent, /Alle 2/);
  assert.match(container.textContent, /Open plekken 1/);
  assert.match(container.textContent, /Bonnen te doen 1/);
  assert.match(container.textContent, /WO-2026-0412/);
  assert.match(container.textContent, /OPEN 1/);
  assert.ok(byText(container, '4 weken'), 'zoom Week / 4 weken');
  assert.doesNotMatch(container.textContent, /Jan de Vries/);

  find(container, node => node.classList.contains('tl-wo-label') && node.textContent.includes('WO-2026-0412')).click();
  assert.match(container.textContent, /Klussen2 dagen · 2 mensen per dag · 07:00–16:00/);
  assert.match(container.textContent, /P 1\/2/);
  assert.match(container.textContent, /vertrek 07:00/);
  assert.ok(byText(container, 'UITGEREIKT'), 'werkbonstatus per persoon');
  assert.match(container.textContent, /WB-1/);
  assert.match(container.textContent, /MATPijlwagen PW-04/);
  assert.match(container.textContent, /Klik op een werkbonstatus om de bon te bekijken\./);
});

test('filter open plekken en zoeken op bonnummer', async () => {
  const { container, openBoard } = setup();
  await openBoard();
  byText(container, 'Open plekken 1').click();
  assert.match(container.textContent, /WO-2026-0412/);
  assert.doesNotMatch(container.textContent, /WO-2026-0413/);
  byText(container, 'Alle 2').click();
  const search = byLabel(container, 'Zoek werkopdracht');
  search.value = 'WB-1'; search.dispatch('input');
  assert.match(container.textContent, /WO-2026-0412/);
  assert.doesNotMatch(container.textContent, /WO-2026-0413/);
});

test('planbord: medewerker op een vrije werkdag slepen schrijft de inzet met If-Match', async () => {
  const { container, calls, openBoard, document } = setup({ mode: 'board' });
  await openBoard();
  assert.equal(document.getElementById('title').textContent, 'Planbord');
  assert.match(container.textContent, /Verkeersregelaar · 1\/5 dagen ingepland/);
  assert.match(container.textContent, /Inhuur · Inhuur Oost/);
  const card = find(container, node => node.classList.contains('board-dock-card') && node.textContent.startsWith('Sanne Jansen'));
  card.dispatch('dragstart', { dataTransfer: { setData() {} } });
  find(container, node => node.classList.contains('tl-wo-label') && node.textContent.includes('WO-2026-0412')).click();
  const cells = container.querySelectorAll('.board-day-drop');
  const target = cells.find(node => node.classList.contains('tl-person-cell') && node.textContent.includes('P 0/2'));
  target.dispatch('dragover');
  assert.ok(target.classList.contains('drag-target'));
  target.dispatch('drop');
  await tick(); await tick();
  const put = calls.find(call => call.method === 'PUT');
  assert.equal(put.url, '/api/planning/werkopdrachten/w1');
  assert.equal(put.headers['If-Match'], '"3"');
  const job = put.body.klussen.find(item => item.datum === day(1));
  assert.deepEqual(job.inzetten.map(item => item.medewerkerId), ['m2']);
  const kept = put.body.klussen.find(item => item.datum === day(0));
  assert.equal(kept.inzetten[0].werkbon.nummer, 'WB-1', 'bestaande werkbon blijft behouden');
  assert.equal(kept.materieelInzetten[0].materieelId, 'eq1');
  assert.deepEqual(put.body.ordernummers, ['PO-1'], 'velden buiten het ontwerp blijven bewaard');
  assert.match(document.getElementById('board-toast').textContent, /Sanne Jansen ingepland op WO-2026-0412/);
});

test('planbord: tikken op kaart en dag werkt ook; conflict elders wordt niet opgeslagen', async () => {
  const { container, calls, openBoard, document } = setup({ mode: 'board', otherOrder: true });
  await openBoard();
  find(container, node => node.classList.contains('board-dock-card') && node.textContent.startsWith('Sanne Jansen')).click();
  assert.match(document.getElementById('board-toast').textContent, /Sanne Jansen gekozen/);
  const bars = container.querySelectorAll('.tl-wo-cell.board-day-drop');
  bars[1].click(); // WO-0412, dag 2: Sanne staat dan al op WO-0413
  await tick();
  assert.equal(calls.filter(call => call.method === 'PUT').length, 0);
  assert.match(document.getElementById('board-toast').textContent, /al ingepland bij wo-2026-0413/i);
  assert.match(document.getElementById('board-toast').className, /bad/);
});

test('planbord: verouderde versie (412) wordt niet automatisch overschreven', async () => {
  const { container, calls, openBoard, document } = setup({ mode: 'board', putStatus: 412 });
  await openBoard();
  find(container, node => node.classList.contains('board-dock-card') && node.textContent.startsWith('Henk Post')).click();
  container.querySelectorAll('.tl-wo-cell.board-day-drop')[0].click();
  await tick(); await tick();
  assert.equal(calls.filter(call => call.method === 'PUT').length, 1);
  assert.match(document.getElementById('board-toast').textContent, /intussen door iemand anders gewijzigd/);
  assert.ok(calls.filter(call => call.url.startsWith('/api/planning/planbord?')).length >= 2, 'scherm wordt ververst');
});

test('werkbon-dialoog meldt de bon binnen en behoudt het bonnummer', async () => {
  const { container, calls, openBoard } = setup();
  await openBoard();
  find(container, node => node.classList.contains('tl-wo-label') && node.textContent.includes('WO-2026-0412')).click();
  byText(container, 'UITGEREIKT').click();
  const dialog = find(container, node => node.tagName === 'DIALOG');
  assert.match(dialog.textContent, /Werkbon WB-1/);
  assert.ok(!byText(dialog, 'Uitgereikt'), 'al uitgereikt');
  assert.ok(byText(dialog, 'Inzet verwijderen'));
  byText(dialog, 'Binnen melden').click();
  await tick(); await tick();
  const put = calls.find(call => call.method === 'PUT');
  const slip = put.body.klussen.find(item => item.datum === day(0)).inzetten[0].werkbon;
  assert.equal(slip.nummer, 'WB-1');
  assert.equal(slip.status, 'binnen');
  assert.ok(slip.binnenOp);
});

test('nieuwe werkopdracht in vijf stappen wordt met POST aangemaakt', async () => {
  const { container, calls, openBoard } = setup();
  await openBoard();
  byText(container, '+ Werkopdracht').click();
  await tick(); await tick();
  const dialog = find(container, node => node.tagName === 'DIALOG');
  assert.match(dialog.textContent, /Werkopdracht toevoegen/);
  assert.match(dialog.textContent, /Nog in te vullen: stap 1, 2, 3, 4, 5/);
  byText(dialog, 'Opslaan').click();
  assert.match(dialog.textContent, /Vul eerst stap 1, 2, 3, 4, 5 in\./);

  const set = (label, value, event = 'input') => { const control = byLabel(dialog, label); control.value = value; control.dispatch(event); };
  set('Klant', '1', 'change');
  set('Korte werkomschrijving', 'Bebording evenement');
  set('Datum op locatie', day(7)); byLabel(dialog, 'Datum op locatie').dispatch('change');
  set('Tot en met', day(8)); byLabel(dialog, 'Tot en met').dispatch('change');
  byText(dialog, 'Zelfde als klantadres').click();
  byLabel(dialog, 'Verkeersregelaar meer').click();
  byLabel(dialog, 'Verkeersregelaar meer').click();
  assert.match(dialog.textContent, /✓ Klaar om op te slaan/);
  assert.match(dialog.textContent, /2 per dag = 4 inzetten/);
  byText(dialog, 'Opslaan').click();
  await tick(); await tick();
  const post = calls.find(call => call.method === 'POST');
  assert.equal(post.url, '/api/planning/werkopdrachten');
  assert.equal(post.body.klantId, 1);
  assert.equal(post.body.bestellerId, 10);
  assert.equal(post.body.korteWerkomschrijving, 'Bebording evenement');
  assert.equal(post.body.omschrijving, 'Bebording evenement');
  assert.equal(post.body.werkadres, 'Stadhuisplein 1');
  assert.equal(post.body.startOpLocatie, '07:00:00');
  assert.deepEqual(post.body.behoeften, [{ aantal: 2, rol: 'Verkeersregelaar', skill: null, soort: 'mens' }]);
  assert.deepEqual(post.body.klussen, []);
  assert.equal(post.headers['If-Match'], undefined);
});

test('bewerken slaat op met If-Match en verwijderen vraagt een tweede klik', async () => {
  const { container, calls, openBoard } = setup();
  await openBoard();
  byText(container, 'Bewerken').click();
  await tick(); await tick();
  let dialog = find(container, node => node.tagName === 'DIALOG');
  assert.match(dialog.textContent, /Werkopdracht WO-2026-0412 bewerken/);
  assert.match(dialog.textContent, /✓ Klaar om op te slaan/);
  byText(dialog, 'Opslaan').click();
  await tick(); await tick();
  const put = calls.find(call => call.method === 'PUT');
  assert.equal(put.headers['If-Match'], '"3"');
  assert.equal(put.body.nummer, 'WO-2026-0412');
  assert.deepEqual(put.body.ordernummers, ['PO-1']);

  byText(container, 'Bewerken').click();
  await tick(); await tick();
  dialog = find(container, node => node.tagName === 'DIALOG' && node.open);
  byText(dialog, 'Verwijderen').click();
  assert.equal(calls.filter(call => call.method === 'DELETE').length, 0);
  byText(dialog, 'Zeker weten? Klik nogmaals').click();
  await tick();
  const removed = calls.find(call => call.method === 'DELETE');
  assert.equal(removed.headers['If-Match'], '"3"');
});

test('zonder bewerkrecht geen toevoegen en geen slepen', async () => {
  const { container, openBoard } = setup({ canEdit: false, mode: 'board' });
  await openBoard();
  assert.ok(!byText(container, '+ Werkopdracht'));
  assert.match(container.textContent, /Alleen bekijken/);
  const card = find(container, node => node.classList.contains('board-dock-card'));
  assert.ok(card.classList.contains('readonly'));
  assert.equal(container.querySelectorAll('.board-day-drop').length, 0);
});
