'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../apps/planning/planbord-scherm.js'), 'utf8'), { window, document: {}, navigator: {}, console, Date, Math, JSON, Promise, setTimeout, clearTimeout });
const m = window.VsvkPlanbord.model;
const plain = value => JSON.parse(JSON.stringify(value)); // waarden uit de vm hebben een ander realm

const order = {
  id: 'w1', nummer: 'WO-26-0001', klantId: 1, klant: 'Gemeente', kleur: '#2f6fb5', korteWerkomschrijving: 'Herinrichting', isOptie: false,
  klussen: [
    {
      id: 'k1', datum: '2026-12-01', startDatum: '2026-12-01', eindDatum: '2026-12-01', startTijd: '07:00:00', eindTijd: '15:30:00', reisHeen: '00:30:00', reisTerug: '00:45:00',
      benodigdeMedewerkers: 2, behoeften: [{ aantal: 2, soort: 'mens' }, { aantal: 1, soort: 'materieel' }],
      inzetten: [{ datum: '2026-12-01', medewerkerId: 'm1', startTijd: '07:00:00', eindTijd: '15:30:00', werkbon: { nummer: 'WB1' } },
                 { datum: '2026-12-01', medewerkerId: 'm2', startTijd: '09:00:00', eindTijd: '15:30:00' }],
      materieelInzetten: [{ datum: '2026-12-01', materieelId: 'x1', materieel: 'Minigraver' }]
    },
    { id: 'k2', datum: '2026-12-02', startTijd: '22:00:00', eindTijd: '06:00:00', benodigdeMedewerkers: 1, inzetten: [], materieelInzetten: [] }
  ]
};

test('tijden: blok loopt van vertrek tot terug, inclusief reistijd', () => {
  const [k] = m.maakKlussen([order]);
  assert.equal(k.start, 6.5);
  assert.equal(k.aanwezig, 7);
  assert.equal(k.eindLoc, 15.5);
  assert.equal(k.start + k.duur, 16.25);
});

test('nachtklus loopt door na middernacht', () => {
  const k = m.maakKlussen([order]).find(x => x.id === 'k2');
  assert.equal(k.eindLoc, 30);
});

test('eigen tijd per medewerker wordt herkend', () => {
  const [k] = m.maakKlussen([order]);
  assert.equal(plain(k.tijden).m2.start, 8.5);
  assert.equal(plain(k.tijden).m1, undefined);
});

test('vulling telt mensen en materieel uit de behoefte', () => {
  const [k] = m.maakKlussen([order]);
  assert.deepEqual(plain(m.vulling(k)), { nodig: 2, open: 0, nodigMat: 1, openMat: 0 });
  const k2 = m.maakKlussen([order]).find(x => x.id === 'k2');
  assert.equal(m.vulling(k2).open, 1);
});

test('lanes zetten overlappende klussen onder elkaar', () => {
  const r = m.lanes([{ id: 'a', start: 7, duur: 4 }, { id: 'b', start: 8, duur: 2 }, { id: 'c', start: 12, duur: 1 }]);
  assert.equal(r.n, 2);
  assert.equal(r.map.get('a'), 0); assert.equal(r.map.get('b'), 1); assert.equal(r.map.get('c'), 0);
});

test('conflict: dezelfde medewerker op twee overlappende klussen', () => {
  const dubbel = { ...order, klussen: [order.klussen[0], { ...order.klussen[0], id: 'k3', startTijd: '10:00:00', eindTijd: '12:00:00', inzetten: [{ datum: '2026-12-01', medewerkerId: 'm1', startTijd: '10:00:00', eindTijd: '12:00:00' }] }] };
  m.data.klussen = m.maakKlussen([dubbel]);
  const c = m.conflicten('2026-12-01');
  assert.ok(c.mwC.has('k1') && c.mwC.has('k3'));
});

test('tijdnotatie voor de API', () => {
  assert.equal(m.apiTijd(7.5), '07:30:00');
  assert.equal(m.apiTijd(25), '01:00:00');
  assert.equal(m.ts('1.02:00:00'), 26);
  assert.equal(m.ts(null), null);
});
