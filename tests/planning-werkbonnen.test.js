'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../apps/planning/werkbonnen-scherm.js'), 'utf8'),
  { window, document: { querySelector: () => null }, console, Date, Math, JSON, Promise, setTimeout, clearTimeout, encodeURIComponent });
const m = window.VsvkWerkbonnen.model;
const plain = value => JSON.parse(JSON.stringify(value)); // waarden uit de vm hebben een ander realm

const lijstItem = {
  id: 'b1', nummer: 'WB-0001-01', status: 'niet_geprint', gewijzigdNaUitgifte: false, datum: '2026-11-27',
  startTijd: '07:00:00', eindTijd: '15:30:00', medewerker: 'Jan de Vries', functie: 'Machinist',
  werkopdrachtId: 'w1', werkopdrachtNummer: 'WO-26-0001', klant: 'Gemeente', omschrijving: 'Herinrichting', uitgereiktOp: null, binnenOp: null
};

test('uur leest tijden en TimeSpans uit de API', () => {
  assert.equal(m.uur('07:30:00'), 7.5);
  assert.equal(m.uur('00:45:00'), 0.75);
  assert.equal(m.uur('1.02:00:00'), 26);
  assert.equal(m.uur(null), null);
});

test('API-statussen worden de statussen van het ontwerp', () => {
  assert.equal(m.normSlip(lijstItem).status, 'Aangemaakt');
  assert.equal(m.normSlip({ ...lijstItem, status: 'binnen' }).status, 'Retour');
  assert.equal(m.normSlip({ ...lijstItem, status: 'retour' }).status, 'Retour');
  assert.equal(m.normSlip({ ...lijstItem, status: 'vervallen' }).status, 'Vervallen');
  const s = plain(m.normSlip(lijstItem));
  assert.equal(s.start, 7); assert.equal(s.eind, 15.5); assert.equal(s.mw, 'Jan de Vries'); assert.equal(s.wo, 'WO-26-0001');
});

test('een bon hoort bij de ronde: vertrek van gisteren 18:00 t/m vandaag 18:00', () => {
  assert.equal(m.ronde({ datum: '2026-11-27', start: 7 }), '2026-11-27');
  assert.equal(m.ronde({ datum: '2026-11-27', start: 18 }), '2026-11-28');
  assert.equal(m.ronde({ datum: '2026-11-27', start: 20.5 }), '2026-11-28');
  assert.equal(m.ronde({ datum: '2026-11-27', start: 2 }), '2026-11-27');
  assert.equal(m.ronde({ datum: '2026-11-27', start: null }), '2026-11-27');
});

test('inzetten zonder werkbon zijn "nog te maken", met werkbon niet', () => {
  const orders = [{
    id: 'w1', nummer: 'WO-26-0001', klant: 'Gemeente', korteWerkomschrijving: 'Herinrichting', isOptie: false, status: 'OPEN 1',
    klussen: [{ id: 'k1', startTijd: '07:00:00', eindTijd: '15:00:00', inzetten: [
      { id: 'i1', datum: '2026-11-27', medewerker: 'Jan', startTijd: '07:00:00', eindTijd: '15:00:00', werkbon: null },
      { id: 'i2', datum: '2026-11-27', medewerker: 'Piet', startTijd: null, eindTijd: null, werkbon: { id: 'b', nummer: 'WB-0001-01', status: 'aangemaakt' } }] }]
  }, { id: 'w2', nummer: 'WO-26-0002', klant: 'X', isOptie: true, status: 'OPTIE', klussen: [{ id: 'k2', inzetten: [{ id: 'i3', datum: '2026-11-27', medewerker: 'Kees', werkbon: null }] }] },
  { id: 'w3', nummer: 'WO-26-0003', klant: 'Y', status: 'Geannuleerd', klussen: [{ id: 'k3', inzetten: [{ id: 'i4', datum: '2026-11-27', werkbon: null }] }] }];
  const r = plain(m.maakNieuw(orders));
  assert.deepEqual(r.map(x => [x.mw, x.optie, x.wo]), [['Jan', false, 'WO-26-0001'], ['Kees', true, 'WO-26-0002']]);
  assert.equal(r[0].start, 7); assert.equal(r[0].eind, 15); assert.equal(r[0].orderId, 'w1'); assert.equal(r[0].inzetId, 'i1');
});

test('volgend bonnummer telt door binnen de werkopdracht', () => {
  m.data.slips = [{ nummer: 'WB-0001-01' }, { nummer: 'WB-0001-04' }, { nummer: 'WB-0002-09' }];
  const order = { nummer: 'WO-26-0001', klussen: [{ inzetten: [{ werkbon: { nummer: 'WB-0001-06' } }, { werkbon: null }] }] };
  const gebruikt = [];
  assert.equal(m.volgendNummer(order, gebruikt), 'WB-0001-07');
  assert.equal(m.volgendNummer(order, gebruikt), 'WB-0001-08');
  assert.equal(m.volgendNummer({ nummer: 'WO-26-0007', klussen: [] }, []), 'WB-0007-01');
});

test('werkbon-voorbeeld bevat barcode, medewerker, klant, planning en uren', () => {
  const order = {
    nummer: 'WO-26-0001', korteWerkomschrijving: 'Herinrichting parkeerplaats', werkInhoud: 'Bestrating opbreken', werkadres: 'Oostpolder', werkPlaats: 'Berkel',
    ordernummers: ['PO-1'], bestellerNaam: 'R. de Groot', instructies: 'Afzetten met hekken',
    klussen: [{ id: 'k1', reisHeen: '00:30:00', reisTerug: '00:30:00', inzetten: [
      { id: 'i1', medewerkerId: 'm1', medewerker: 'Jan de Vries', werkbon: { nummer: 'WB-0001-01' } }, { id: 'i2', medewerker: 'Piet Bakker', werkbon: null }],
      materieelInzetten: [{ materieel: 'Minigraver 3t', medewerkerId: 'm1' }] }]
  };
  const html = m.paperHTML(m.normSlip(lijstItem), order);
  for (const tekst of ['WERKBON', 'WB-0001-01', 'Jan de Vries', 'Gemeente', 'Herinrichting parkeerplaats', 'Oostpolder, Berkel', 'PO-1', 'Afzetten met hekken', 'Piet Bakker', 'Minigraver 3t', 'Jij', 'Vertrek VSVK <b>06:30</b>', 'Terug <b>16:00</b>', 'class="bc"'])
    assert.ok(html.includes(tekst), tekst);
  assert.ok(m.paperHTML(m.normSlip(lijstItem), null).includes('WB-0001-01'), 'ook zonder werkopdracht-details');
});

test('tekst in de werkbon wordt geëscaped', () => {
  const html = m.paperHTML({ ...m.normSlip(lijstItem), mw: '<script>x</script>' }, null);
  assert.ok(!html.includes('<script>x'));
});
