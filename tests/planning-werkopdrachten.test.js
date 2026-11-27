'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../apps/planning/werkopdrachten.js'), 'utf8'), { window, document: {}, navigator: {}, console, Date, Math, JSON, Promise, setTimeout, clearTimeout });
const m = window.VsvkWorkOrders.model;
const plain = value => JSON.parse(JSON.stringify(value)); // waarden uit de vm hebben een ander realm
const refs = { klanten: [], vestigingen: [{ id: 'v1', naam: 'VSVK Pijnacker BV' }], functies: ['Vakman'], materieelTypes: [{ id: 'g1', naam: 'Graafmachine' }], materieel: [], artikelen: [] };
const detail = {
  id: 'w1', nummer: 'WO-26-0001', klantId: 7, eTag: '"3"', version: 3, vestigingId: 'v1', soort: 'regie', startDatum: '2026-12-01', eindDatum: '2026-12-03',
  isOptie: false, weekendOverslaan: true, vrijeDagen: [], werkvoorraad: false, korteWerkomschrijving: 'Kop', werkInhoud: 'Inhoud', werkadres: 'Straat 1',
  startOpLocatie: '07:00:00', eindOpLocatie: '15:30:00', pauzeMinuten: 30, ordernummers: ['A1'], kleur: '#ff4e02',
  behoeften: [{ aantal: 2, rol: 'Vakman', skill: null, soort: 'mens' }], materieel: [{ aantal: 1, rol: 'Graafmachine', materieelGroepId: 'g1', losseVerhuur: false }],
  klussen: [{ datum: '2026-12-01', startTijd: '07:00:00', eindTijd: '15:30:00', reisHeen: '00:20:00', reisTerug: '00:40:00' }], materialen: []
};

test('tijden: vertrek, aanwezig, eind en terug volgen uit starttijd, werktijd en reistijd', () => {
  const t = m.wTijden({ aanwezig: 7, werkuren: 8, reisHeen: .5, reisTerug: 1 });
  assert.deepEqual([t.vertrek, t.aanwezig, t.eindLoc, t.terug], [6.5, 7, 15, 16]);
});

test('leesTijd begrijpt 730, 0730, 7:30 en 7.30 en weigert onzin', () => {
  for (const x of ['730', '0730', '7:30', '7.30', '07:30']) assert.equal(m.leesTijd(x), 7.5);
  assert.ok(Number.isNaN(m.leesTijd('25:00')));
  assert.ok(Number.isNaN(m.leesTijd('abc')));
});

test('werkdagen slaan weekend en vrije dagen over', () => {
  const d = m.werkDagen({ van: '2026-12-04', tot: '2026-12-08', skip: true, uitDagen: ['2026-12-07'] });
  assert.deepEqual(plain(d), ['2026-12-04', '2026-12-08']);
});

test('opslaan stuurt klussen: [] zodat de API de klussen genereert en bestaande inzet ongemoeid blijft', () => {
  const w = m.uitApi(detail, refs);
  const out = m.naarApi(w, refs);
  assert.deepEqual(plain(out.klussen), []);
  assert.equal(out.startOpLocatie, '07:00:00');
  assert.equal(out.eindOpLocatie, '15:30:00');
  assert.equal(out.korteWerkomschrijving, 'Kop');
  assert.equal(out.werkInhoud, 'Inhoud');
  assert.deepEqual(plain(out.ordernummers), ['A1']);
  assert.equal(out.behoeften[0].rol, 'Vakman');
  assert.equal(out.materieel[0].materieelGroepId, 'g1');
  assert.match(out.kleur, /^#[0-9a-f]{6}$/i);
});

test('werkvoorraad krijgt één datum, geen vrije dagen en geschatte uren', () => {
  const w = m.uitApi(detail, refs); w.voorraad = true; w.schatUren = 16; w.uitDagen = ['2026-12-02'];
  const out = m.naarApi(w, refs);
  assert.equal(out.werkvoorraad, true);
  assert.equal(out.startDatum, out.eindDatum);
  assert.deepEqual(plain(out.vrijeDagen), []);
  assert.equal(out.geschatteUren, 16);
});

test('nieuwe klant en besteller gaan als nieuweKlant en nieuweBesteller mee', () => {
  const w = m.nieuwConcept(refs); w.vestigingId = 'v1'; w._nk = { bedrijf: 'Nieuw BV', straat: 'Dorpsstraat', huisnr: '5', postcode: '1234 AB', plaats: 'Delft' };
  w.besteller = { naam: 'Jan', telefoon: '06', email: '', _keuze: '' };
  const out = m.naarApi(w, refs);
  assert.equal(out.klantId, 0);
  assert.equal(out.nieuweKlant.bedrijfsnaam, 'Nieuw BV');
  assert.equal(out.nieuweKlant.straat, 'Dorpsstraat 5');
  assert.equal(out.nieuweBesteller.naam, 'Jan');
});

test('aangenomen werk bewaart het interne projectnummer, regie niet', () => {
  const w = m.uitApi(detail, refs); w.soort = 'aangenomen'; w.internNr = 'P-100';
  assert.equal(m.naarApi(w, refs).internProjectnummer, 'P-100');
  w.soort = 'regie';
  assert.equal(m.naarApi(w, refs).internProjectnummer, null);
});

test('lijstregel bepaalt status en bezetting uit de tijdlijn', () => {
  const item = { id: 'w1', nummer: 'WO-26-0001', klantNaam: 'K', kop: 'x', startDatum: '2026-12-01', eindDatum: '2026-12-01', dagen: { '2026-12-01': { nodig: 3, bezet: 1 } }, bonnen: 0 };
  const r = m.lijstRegel(item, detail, refs);
  assert.equal(r.st, 'deels'); assert.equal(r.open, 2); assert.equal(r.vestiging, 'VSVK Pijnacker BV');
});
