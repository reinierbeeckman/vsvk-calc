(function () {
  'use strict';

  /*
   * Werkopdrachten: lijst en formulier 1-op-1 naar het klantontwerp (VSVK Planning prototype).
   * Opmaak en markup komen uit het prototype (.analysis-input/vsvk-planning); de CSS wordt daaruit gegenereerd
   * (scripts/extract-prototype-css.js) en geldt alleen binnen .wo-scope.
   *
   * Koppeling met de database (alleen bestaande API):
   *   lijst        GET  /api/planning/planbord/werkopdrachten (status, bezetting, bonnen, vestigingsscope)
   *                GET  /api/planning/planbord (besteller, tijden, behoefte, ordernummers)
   *   formulier    GET  /api/planning/werkopdrachten/{id} en /form-referenties, /klanten/{id}/recente-werkopdrachten
   *                POST /api/planning/werkopdrachten/drukte (drukte per functie en materieelsoort)
   *   opslaan      POST /api/planning/werkopdrachten, PUT /api/planning/werkopdrachten/{id} met If-Match
   *   levenscyclus POST /api/planning/werkopdrachten/{id}/voorraad en /annuleren met If-Match
   * Bij 412 blijft de invoer staan; er wordt nooit automatisch opnieuw geprobeerd.
   * De API genereert de klussen zelf uit de werkopdracht (klussen: []), zodat bestaande inzet en werkbonnen
   * ongemoeid blijven.
   */

  const DAG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  const MAAND = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const KLEUREN = ['#ff4e02', '#2f6fb5', '#2f8a5b', '#8b5cc7', '#c48a12', '#c2416b', '#3d8f99', '#5d5a54'];
  const DAGEN_ALLE = 252;       // "Alle weken": vandaag t/m ruim acht maanden vooruit (API: max 63 dagen per aanvraag)
  const DAGEN_TERUG = 63;       // "Afgelopen tonen" en zoeken: twee maanden terug
  const STATUSTEKST = { open: 'Open', deels: 'Deels', vol: 'Gepland', leeg: 'Niet ingepland', geann: 'Geannuleerd' };

  /* ---------- helpers ---------- */
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseD = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return iso(d); };
  const vandaag = () => iso(new Date());
  const isWeekend = s => [0, 6].includes(parseD(s).getDay());
  const maandag = s => addDays(s, -((parseD(s).getDay() + 6) % 7));
  function weeknr(s) {
    const d = parseD(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const w1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
  }
  const isoJaar = s => { const d = parseD(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); return d.getFullYear(); };
  const datumKort = s => { if (!s) return ''; const x = parseD(s); return DAG[x.getDay()].slice(0, 2) + ' ' + x.getDate() + ' ' + MAAND[x.getMonth()].slice(0, 3); };
  const dagVol = s => DAG[parseD(s).getDay()] + ' ' + datumKort(s).split(' ').slice(1).join(' ');
  const langeDatum = s => { const d = parseD(s); return DAG[d.getDay()] + ' ' + d.getDate() + ' ' + MAAND[d.getMonth()] + ' ' + d.getFullYear(); };
  const kortNr = s => { const x = parseD(s); return DAG[x.getDay()].slice(0, 2) + ' ' + x.getDate() + '/' + (x.getMonth() + 1); };
  const tijd = x => { const m = Math.round(x * 60); return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60); };
  const tijdD = x => tijd(((x % 24) + 24) % 24) + (x >= 24 - 1e-9 ? ' +1' : x < -1e-9 ? ' −1' : '');
  const hm = x => { const m = Math.round((+x || 0) * 60); return Math.floor(m / 60) + ':' + pad(m % 60); };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const vestKort = n => String(n || '').replace(/^VSVK\s+/i, '').replace(/\s+B\.?V\.?$/i, '') || '—';
  const clone = v => JSON.parse(JSON.stringify(v));
  const som = l => (l || []).reduce((a, x) => a + (+x.aantal || 0), 0);

  function leesTijd(x) {
    const t = String(x ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(/u(ur)?$/, '');
    let h, m = 0;
    if (!t) return NaN;
    if (/^\d{1,2}[:.,;h]\d{1,2}$/.test(t)) { const [a, b] = t.split(/[:.,;h]/); h = +a; m = b.length === 1 ? +b * 10 : +b; }
    else if (/^\d{1,2}$/.test(t)) h = +t;
    else if (/^\d{3}$/.test(t)) { h = +t[0]; m = +t.slice(1); }
    else if (/^\d{4}$/.test(t)) { h = +t.slice(0, 2); m = +t.slice(2); }
    else return NaN;
    if (h === 24 && m === 0) h = 0;
    if (h > 23 || m > 59) return NaN;
    return h + m / 60;
  }
  /* "07:30:00" of "07:30" → 7.5 ; 7.5 → "07:30:00" ; "00:30:00" (TimeSpan) → 0.5 */
  const urenVan = t => { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return (h || 0) + (m || 0) / 60; };
  const apiTijd = uren => { const m = Math.round((((uren % 24) + 24) % 24) * 60); return pad(Math.floor(m / 60)) + ':' + pad(m % 60) + ':00'; };

  /* ---------- tijden (uren, relatief aan de datum op locatie) ---------- */
  function wTijden(w) {
    const rh = Math.max(0, +w.reisHeen || 0), rt = Math.max(0, +w.reisTerug || 0);
    const aanw = (((+w.aanwezig || 0) % 24) + 24) % 24;
    const werk = Math.max(.25, w.werkuren != null ? +w.werkuren : 8);
    return { vertrek: aanw - rh, aanwezig: aanw, eindLoc: aanw + werk, terug: aanw + werk + rt, rh, rt, werk, duur: rh + werk + rt };
  }
  const isNacht = w => !w.multi && wTijden(w).terug > 24 + 1e-9;
  function dienstInfo(vertrek, terug) {
    const st = +vertrek || 0, e = Math.max(st, +terug || st); let n = 0, tot = 0;
    for (let t = st; t < e - 1e-9; t += .25) { const h = ((t % 24) + 24) % 24, stap = Math.min(.25, e - t); tot += stap; if (h >= 18 || h < 6) n += stap; }
    const v = ((st % 24) + 24) % 24;
    const soort = tot <= 0 ? (v >= 18 || v < 6 ? 'nacht' : 'dag') : n * 2 > tot + 1e-9 ? 'nacht' : n * 2 < tot - 1e-9 ? 'dag' : (v >= 18 || v < 6 ? 'nacht' : 'dag');
    return { soort, nacht: n, dag: tot - n, tot };
  }
  function werkDagen(w) {
    const out = [];
    if (!w.van || w.geannuleerd) return out;
    const tot = w.tot && w.tot >= w.van ? w.tot : w.van, uit = w.uitDagen || [];
    for (let d = w.van; d <= tot && out.length < 120; d = addDays(d, 1)) if (!(w.skip && isWeekend(d)) && !uit.includes(d)) out.push(d);
    return out;
  }

  /* ---------- API → formulier en terug ---------- */
  function kleurVoorKlant(id) { return KLEUREN[Math.abs(Number(id) || 0) % KLEUREN.length]; }
  function klantAdresVol(k) { return k ? [k.straat, [k.postcode, k.plaats].filter(Boolean).join(' ')].filter(Boolean).join(', ') : ''; }
  function mapsLink(adres, pin) {
    const p = String(pin || '').trim();
    if (/^https?:\/\//i.test(p)) return p;
    const c = /^(-?\d{1,2}[.,]\d+)\s*[,; ]\s*(-?\d{1,3}[.,]\d+)$/.exec(p);
    if (c) return 'https://www.google.com/maps/search/?api=1&query=' + c[1].replace(',', '.') + ',' + c[2].replace(',', '.');
    const q = p || String(adres || '').trim();
    return q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : '';
  }

  function nieuwConcept(refs, opties) {
    const t = vandaag();
    return {
      _isNew: true, id: null, nummer: '', klantId: '', vestigingId: opties?.vestigingId || (refs.vestigingen.length === 1 ? refs.vestigingen[0].id : ''),
      soort: 'regie', internNr: '', optie: false, optieNoot: '', optieTot: '', van: opties?.van || t, tot: opties?.van || t,
      skip: true, uitDagen: [], voorraad: false, schatUren: '', uiterlijk: '', prio: 'normaal',
      kop: '', omschrijving: '', instructies: '', locatie: '', maps: '', contactLocatie: '', contactLocatieTel: '',
      kleur: KLEUREN[0], besteller: { naam: '', telefoon: '', email: '', _keuze: '' }, ordernrs: [''],
      pauze: 30, multi: false, diensten: [], mensen: [], materieel: [], artikelen: [],
      aanwezig: 7, werkuren: 8, reisHeen: .5, reisTerug: .5, _reisHand: false, _reisBron: 'standaard reistijd'
    };
  }

  function uitApi(d, refs) {
    const w = nieuwConcept(refs);
    const eerste = (d.klussen || []).find(k => k.reisHeen != null || k.reisTerug != null);
    const start = urenVan(d.startOpLocatie), eind = urenVan(d.eindOpLocatie);
    Object.assign(w, {
      _isNew: false, id: d.id, nummer: d.nummer, eTag: d.eTag, version: d.version, klantId: d.klantId, vestigingId: d.vestigingId || '',
      soort: d.soort || 'regie', internNr: d.internProjectnummer || '', optie: !!d.isOptie, optieNoot: d.optieReden || '', optieTot: d.optieTot || '',
      van: d.startDatum, tot: d.eindDatum, skip: d.weekendOverslaan !== false, uitDagen: d.vrijeDagen || [], voorraad: !!d.werkvoorraad,
      schatUren: d.geschatteUren ?? '', uiterlijk: d.uiterlijkKlaar || '', prio: d.prioriteit || 'normaal',
      kop: d.korteWerkomschrijving || '', omschrijving: d.werkInhoud || '', instructies: d.instructies || '',
      locatie: d.werkadres || '', maps: d.gpsLocatie || '', contactLocatie: d.contactLocatieNaam || '', contactLocatieTel: d.contactLocatieTelefoon || '',
      kleur: d.kleur || KLEUREN[0],
      besteller: { naam: d.bestellerNaam || '', telefoon: d.bestellerTelefoon || '', email: d.bestellerEmail || '', _keuze: d.bestellerId != null ? String(d.bestellerId) : (d.bestellerNaam ? '_ander' : '') },
      ordernrs: (d.ordernummers || []).length ? d.ordernummers.slice() : [''],
      pauze: d.pauzeMinuten ?? 30, multi: !!d.meerdereDiensten,
      mensen: (d.behoeften || []).filter(n => (n.soort || 'mens') === 'mens').map(n => ({ id: uid(), aantal: n.aantal, rol: n.rol || '', skill: n.skill || '' })),
      materieel: (d.materieel || []).map(n => ({ id: uid(), aantal: n.aantal, type: n.rol || '', grp: n.materieelGroepId || null, mid: n.materieelId || '', verhuur: !!n.losseVerhuur })),
      artikelen: (d.materialen || []).map(m => ({ id: m.artikelId || '', aantal: m.aantal, oms: m.omschrijving || '', eenheid: m.eenheid || '', cat: '' })),
      aanwezig: start ?? 7, werkuren: start != null && eind != null ? (((eind - start) % 24) + 24) % 24 || 24 : 8,
      reisHeen: eerste ? urenVan(eerste.reisHeen) ?? .5 : .5, reisTerug: eerste ? urenVan(eerste.reisTerug) ?? .5 : .5,
      _reisBron: eerste ? 'zoals eerder opgeslagen' : 'standaard reistijd', _basis: clone(d)
    });
    w.diensten = [];
    if (w.multi) {
      const dag = (d.klussen || [])[0]?.datum;
      w.diensten = (d.klussen || []).filter(k => k.datum === dag).map((k, i) => {
        const a = urenVan(k.startTijd) ?? 7, e = urenVan(k.eindTijd) ?? 15;
        return { id: uid(), naam: 'Dienst ' + (i + 1), aanwezig: a, werk: (((e - a) % 24) + 24) % 24 || 24 };
      });
    }
    w.mensen.forEach(l => { l.rol = l.rol || ''; });
    return w;
  }

  /* Formulier → PlanningBoardWorkOrderWriteDto. Velden buiten het ontwerp blijven uit de oorspronkelijke werkopdracht staan. */
  function naarApi(w, refs) {
    const basis = w._basis || {};
    const T = wTijden(w), voorraad = !!w.voorraad, nk = w._nk;
    const bst = w.besteller && String(w.besteller.naam || '').trim() ? { naam: w.besteller.naam.trim(), telefoon: (w.besteller.telefoon || '').trim() || null, email: (w.besteller.email || '').trim() || null } : null;
    const bestaandeContact = !nk && bst && /^\d+$/.test(String(w.besteller._keuze || ''));
    const van = voorraad ? (w.van || vandaag()) : w.van;
    const tot = voorraad ? van : (w.tot && w.tot >= w.van ? w.tot : w.van);
    const groep = naam => (refs.materieelTypes.find(g => g.naam === naam) || {}).id || null;
    const orders = (w.ordernrs || []).map(x => String(x).trim()).filter(Boolean);
    const adresGewijzigd = !basis.werkadres || basis.werkadres !== w.locatie;
    const value = {
      nummer: w._isNew ? null : w.nummer, klantId: nk ? 0 : Number(w.klantId) || 0,
      omschrijving: String(w.kop || w.omschrijving || '').trim().slice(0, 500),
      startDatum: van, eindDatum: tot, isOptie: !!w.optie, kleur: /^#[0-9a-f]{6}$/i.test(w.kleur) ? w.kleur : KLEUREN[0],
      klussen: [], vestigingId: w.vestigingId || null, optieTot: w.optie && w.optieTot ? w.optieTot : null,
      soort: w.soort === 'aangenomen' ? 'aangenomen' : 'regie', internProjectnummer: w.soort === 'aangenomen' ? String(w.internNr || '').trim() : null,
      bestellerId: bestaandeContact ? Number(w.besteller._keuze) : null,
      bestellerNaam: bst ? bst.naam : null, bestellerTelefoon: bst ? bst.telefoon : null, bestellerEmail: bst ? bst.email : null,
      optieReden: w.optie ? (w.optieNoot || null) : null, weekendOverslaan: !!w.skip, vrijeDagen: voorraad ? [] : (w.uitDagen || []).filter(d => d >= van && d <= tot),
      werkvoorraad: voorraad, geschatteUren: voorraad && w.schatUren !== '' && w.schatUren != null ? Number(w.schatUren) : null,
      uiterlijkKlaar: voorraad && w.uiterlijk ? w.uiterlijk : null, prioriteit: w.prio || 'normaal',
      korteWerkomschrijving: String(w.kop || '').trim() || null, werkInhoud: String(w.omschrijving || '').trim() || null,
      instructies: String(w.instructies || '').trim() || null,
      werkadres: String(w.locatie || '').trim() || null,
      werkPostcode: adresGewijzigd ? (w._wpc ?? null) : basis.werkPostcode ?? null, werkPlaats: adresGewijzigd ? (w._wpl ?? null) : basis.werkPlaats ?? null,
      gpsLocatie: String(w.maps || '').trim() || null, contactLocatieNaam: String(w.contactLocatie || '').trim() || null,
      contactLocatieTelefoon: String(w.contactLocatieTel || '').trim() || null,
      startOpLocatie: w.multi && w.diensten.length ? apiTijd(w.diensten[0].aanwezig) : apiTijd(T.aanwezig),
      eindOpLocatie: w.multi && w.diensten.length ? apiTijd(w.diensten[0].aanwezig + w.diensten[0].werk) : apiTijd(T.eindLoc),
      pauzeMinuten: Math.max(0, Math.round(+w.pauze || 0)), meerdereDiensten: !!w.multi, ordernummers: orders,
      behoeften: (w.mensen || []).filter(l => +l.aantal > 0).map(l => ({ aantal: Math.round(+l.aantal), rol: l.rol || null, skill: l.skill || null, soort: 'mens' })),
      materieel: (w.materieel || []).filter(l => +l.aantal > 0).map(l => ({
        aantal: Math.round(+l.aantal), materieelGroepId: l.grp || groep(l.type), materieelId: l.mid || null, type: l.type || null, losseVerhuur: !!l.verhuur
      })),
      materialen: (w.artikelen || []).filter(a => a.id || String(a.oms || '').trim()).map(a => ({
        aantal: +a.aantal || 0, artikelId: a.id || null, omschrijving: a.id ? null : String(a.oms || '').trim(), eenheid: a.id ? null : String(a.eenheid || '').trim() || null
      })),
      diensten: w.multi && w.diensten.length ? w.diensten.map(D => ({ naam: D.naam || 'Dienst', start: apiTijd(D.aanwezig), eind: apiTijd(D.aanwezig + D.werk) })) : null
    };
    if (nk) value.nieuweKlant = { bedrijfsnaam: String(nk.bedrijf || '').trim(), straat: [nk.straat, nk.huisnr, nk.toev].map(x => String(x || '').trim()).filter(Boolean).join(' ') || null, postcode: String(nk.postcode || '').trim() || null, plaats: String(nk.plaats || '').trim() || null, telefoon: String(nk.telefoon || '').trim() || null, email: String(nk.email || '').trim() || null };
    if ((nk || (w.klantId && bst && !bestaandeContact)) && bst) value.nieuweBesteller = { naam: bst.naam, telefoon: bst.telefoon, email: bst.email };
    return value;
  }

  /* Lijstregel: tijdlijnregel (status, bezetting, bonnen) + volledige werkopdracht (besteller, tijden, behoefte). */
  function lijstRegel(item, detail, refs) {
    const dagen = Object.values(item.dagen || {});
    const nodig = dagen.reduce((a, c) => a + (c.nodig || 0), 0), bezet = dagen.reduce((a, c) => a + (c.bezet || 0), 0);
    const st = !dagen.length ? 'leeg' : !nodig ? 'vol' : bezet === 0 ? 'open' : bezet < nodig ? 'deels' : 'vol';
    const d = detail || {};
    const eerste = (d.klussen || []).find(k => k.reisHeen != null);
    const aanw = urenVan(d.startOpLocatie), eind = urenVan(d.eindOpLocatie);
    const vest = (refs.vestigingen.find(v => v.id === d.vestigingId) || {}).naam || '';
    const verleden = (item.eindDatum || '') < vandaag(), binnen = item.bonnen > 0 && item.bonnenBinnen === item.bonnen;
    const fase = item.status === 'AFGEROND' ? { f: 'Afgerond', txt: 'Alle werkbonnen zijn binnen' }
      : verleden ? (binnen ? { f: 'Bonnen binnen', txt: 'Alle werkbonnen zijn binnen' } : { f: 'Uitgevoerd', txt: 'Werkbonnen nog niet allemaal binnen' })
      : (item.startDatum || '') <= vandaag() && dagen.length ? { f: 'In uitvoering', txt: 'De werkopdracht loopt' } : null;
    return {
      id: item.id, nummer: item.nummer, klant: item.klantNaam, kop: item.kop, optie: !!item.optie, optieVerlopen: !!d.isOptie && !item.optie,
      optieTekst: d.optieReden ? d.optieReden : '', soort: d.soort || 'regie', internNr: d.internProjectnummer || '', vestiging: vest,
      van: item.startDatum, tot: item.eindDatum, titel: (d.ordernummers || []).join('; '), locatie: d.werkadres || '',
      besteller: d.bestellerNaam || '', aanwezig: aanw, eindLoc: eind, mensen: som((d.behoeften || []).filter(n => (n.soort || 'mens') === 'mens')) || (d.klussen?.[0]?.benodigdeMedewerkers || 0),
      materieel: som(d.materieel), behoefte: [...(d.behoeften || []).map(n => n.aantal + '× ' + (n.rol || 'Elke functie')), ...(d.materieel || []).map(n => n.aantal + '× ' + (n.rol || 'materieel'))].join(', '),
      nodig, bezet, open: nodig - bezet, st, bonnen: item.bonnen || 0, fase, dagen: dagen.length,
      reisHeen: eerste ? urenVan(eerste.reisHeen) : null
    };
  }

  /* ---------- schermtoestand ---------- */
  const ui = { wk: null, oud: false, q: '', edit: null, loading: false, menu: false, bericht: '', fout: '', cap: null, eerder: [], busy: false };
  let ctx = null;           // { container, request, canEdit, navigate }
  let data = { regels: [], refs: null };
  let loadSeq = 0, capSeq = 0, capTimer = null, samenTimer = null, tijdPop = null, toastTimer = null;

  const wkStand = () => ui.wk === 'alle' ? 'alle' : (ui.wk || maandag(vandaag()));
  const inWeek = (m, van, tot) => van <= addDays(m, 6) && (tot || van) >= m;
  function wkLabel(m) {
    return 'Week ' + weeknr(m) + (isoJaar(m) !== isoJaar(vandaag()) ? ' · ' + isoJaar(m) : '') + ' <span>' + esc(datumKort(m)) + ' – ' + esc(datumKort(addDays(m, 6))) + '</span>';
  }

  function toast(tekst, slecht) {
    let node = document.getElementById('wo-toast');
    if (!node) { node = document.createElement('div'); node.id = 'wo-toast'; node.className = 'toast'; node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite'); document.body.append(node); }
    node.textContent = tekst; node.className = 'toast show' + (slecht ? ' bad' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.className = 'toast'; }, 4500);
  }

  /* ---------- laden ---------- */
  async function laadReferenties() {
    if (data.refs) return data.refs;
    const form = await ctx.request('/api/planning/werkopdrachten/form-referenties');
    data.refs = {
      klanten: form.klanten || [], vestigingen: form.vestigingen || [], functies: form.functies || [],
      materieelTypes: form.materieelTypes || [], materieel: form.materieel || [], artikelen: form.artikelen || []
    };
    return data.refs;
  }

  function vensters(van, tot) {
    const out = [];
    for (let a = van; a <= tot; a = addDays(a, 63)) out.push([a, addDays(a, 62) < tot ? addDays(a, 62) : tot]);
    return out;
  }

  async function laadLijst() {
    const seq = ++loadSeq, eind = window.VsvkLoading?.begin?.() || (() => {});
    ui.loading = true; ui.fout = '';
    try {
      const refs = await laadReferenties();
      const nu = vandaag(), st = wkStand(), zoek = !!ui.q.trim();
      const [van, tot] = st === 'alle' || zoek
        ? [ui.oud || zoek ? addDays(nu, -DAGEN_TERUG) : nu, addDays(nu, DAGEN_ALLE)]
        : [st, addDays(st, 6)];
      const lijsten = await Promise.all(vensters(van, tot).map(([a, b]) => Promise.all([
        ctx.request('/api/planning/planbord/werkopdrachten?van=' + a + '&tot=' + b + '&zoom=week'),
        ctx.request('/api/planning/planbord?from=' + a + '&to=' + b)
      ])));
      if (seq !== loadSeq) return;
      const details = new Map(), items = new Map();
      lijsten.forEach(([tijdlijn, bord]) => {
        (bord || []).forEach(o => { if (!details.has(o.id)) details.set(o.id, o); });
        (tijdlijn.groepen || []).flatMap(g => g.werkopdrachten).forEach(o => {
          const bestaand = items.get(o.id);
          if (!bestaand) items.set(o.id, { ...o, dagen: { ...o.dagen } });
          else { Object.assign(bestaand.dagen, o.dagen); bestaand.bonnen = Math.max(bestaand.bonnen || 0, o.bonnen || 0); bestaand.bonnenBinnen = Math.max(bestaand.bonnenBinnen || 0, o.bonnenBinnen || 0); }
        });
      });
      data.regels = [...items.values()].map(o => lijstRegel(o, details.get(o.id), refs)).sort((a, b) => (a.van || '').localeCompare(b.van || '') || a.nummer.localeCompare(b.nummer));
    } catch (error) {
      if (seq === loadSeq) ui.fout = 'Laden mislukt: ' + error.message;
    } finally {
      if (seq === loadSeq) ui.loading = false;
      eind();
    }
    if (seq === loadSeq) render();
  }

  /* ---------- lijst ---------- */
  function lijstHTML() {
    const q = ui.q.trim().toLowerCase(), nu = vandaag(), st = wkStand(), alle = st === 'alle' || !!q, oud = ui.oud;
    const rijen = data.regels.filter(w => (alle ? (oud || q || (w.tot || w.van || '') >= nu) : inWeek(st, w.van || nu, w.tot || w.van)) &&
      (!q || [w.nummer, w.internNr, w.soort === 'aangenomen' ? 'aangenomen' : 'regie', w.klant, w.titel, w.kop, w.locatie, w.besteller].join(' ').toLowerCase().includes(q)));
    const kan = ctx.canEdit;
    const weekBar = () => `<div class="wkbar">
      <div class="wknav"><button class="btn" data-act="wk" data-n="-1" aria-label="Vorige week" ${alle ? 'disabled' : ''}>◀</button><div class="wklbl">${alle ? (q ? 'Zoeken in alle weken' : 'Alle weken') : wkLabel(st)}</div><button class="btn" data-act="wk" data-n="1" aria-label="Volgende week" ${alle ? 'disabled' : ''}>▶</button></div>
      ${q ? '' : `<button class="btn sm" data-act="wk" data-n="0" ${st === maandag(nu) ? 'disabled' : ''}>Deze week</button><span class="swl"><button class="sw" role="switch" aria-checked="${st === 'alle'}" data-act="wkalle" aria-label="Alle weken tonen"></button>Alle weken</span>`}
      <span class="hint wkn">${rijen.length} ${rijen.length === 1 ? 'werkopdracht' : 'werkopdrachten'}</span></div>`;
    const kop = w => {
      const m = maandag(w.van || nu); return m;
    };
    const tel = new Map(); rijen.forEach(w => { const m = kop(w); tel.set(m, (tel.get(m) || 0) + 1); });
    let laatste = null;
    const rij = w => {
      const m = kop(w), koprij = alle && m !== laatste ? (laatste = m, `<tr class="wkrij"><td colspan="7"><div class="wkkop"><h3>${wkLabel(m)}</h3><b>${tel.get(m)}</b></div></td></tr>`) : '';
      const pct = w.nodig ? Math.round(w.bezet / w.nodig * 100) : 100, kort = x => kortNr(x);
      const nacht = false;
      return koprij + `<tr class="st-${w.st}">
        <td class="nw"><span class="wonr">${esc(w.nummer || '—')}</span>${w.optie ? ` <span class="chip optchip" title="${esc(w.optieTekst)}">optie</span>` : ''}${w.optieVerlopen ? ' <span class="chip optchip oud">optie verlopen</span>' : ''}${w.soort === 'aangenomen' ? ` <span class="chip soortA" title="Aangenomen${w.internNr ? ' · intern ' + esc(w.internNr) : ''}">A${w.internNr ? ' · ' + esc(w.internNr) : ''}</span>` : ''}${data.refs.vestigingen.length > 1 && w.vestiging ? ` <span class="chip vchip">${esc(vestKort(w.vestiging))}</span>` : ''}${w.fase ? ` <span class="chip wofase wf-${esc(w.fase.f.replace(/ /g, ''))}" title="${esc(w.fase.txt)}">${esc(w.fase.f)}</span>` : ''}${w.bonnen ? ` <button class="btn link inl" data-act="wbvanwo" title="Toon de werkbonnen">${w.bonnen} bon${w.bonnen > 1 ? 'nen' : ''}</button>` : ''}</td>
        <td class="ell" title="${esc([w.klant, w.kop, w.titel, w.besteller ? 'Besteller: ' + w.besteller : ''].filter(Boolean).join(' · '))}">${esc(w.klant)}${w.kop || w.titel ? ` <span class="hint">· ${esc([w.kop, w.titel].filter(Boolean).join(' · '))}</span>` : ''}</td>
        <td class="nw num" title="${esc(datumKort(w.van))}${w.tot !== w.van ? ' – ' + esc(datumKort(w.tot)) : ''} · ${w.dagen} ${nacht ? 'nacht(en)' : 'dag(en)'}">${kort(w.van)}${w.tot !== w.van ? ' – ' + kort(w.tot) : ''}</td>
        <td class="nw num">${w.aanwezig != null && w.eindLoc != null ? tijd(w.aanwezig) + '–' + tijd(w.eindLoc) : '—'}</td>
        <td class="ell" title="${esc(w.behoefte)}">${w.mensen} ${w.mensen === 1 ? 'persoon' : 'mensen'}${w.materieel ? ` · ${w.materieel} materieel` : ''}</td>
        <td class="nw"><div class="bez"><div class="fill"><div class="bar"><i class="${pct >= 100 ? 'full' : ''}" style="width:${pct}%"></i></div></div><span class="num hint">${w.bezet}/${w.nodig}</span><span class="chip ws-${w.st}">${STATUSTEKST[w.st]}</span></div></td>
        <td class="nw acties">${w.open > 0 ? '<button class="btn sm primary" disabled title="Automatisch invullen is nog niet beschikbaar">Invullen</button>' : ''}<button class="btn sm" data-werkplan="${esc(w.id)}">Planbord</button>${kan ? `<button class="btn sm" data-werkedit="${esc(w.id)}">Bewerken</button>` : `<button class="btn sm" data-werkedit="${esc(w.id)}">Bekijken</button>`}</td>
      </tr>`;
    };
    return `<div class="pagehead"><h1>Werkopdrachten</h1></div>
    <div class="panel">
      <div class="filters">${kan ? '<button class="btn primary" data-act="nieuwwerk">+ Nieuwe werkopdracht</button>' : ''}<button class="btn" disabled title="Aanvragen uit e-mail inlezen is nog niet beschikbaar">✉ Aanvraag uit mail</button><details class="menu"><summary class="btn">Meer ▾</summary><div class="menu-pop"><button disabled title="Nog niet beschikbaar">Snelle klus<small>Direct op het planbord · krijgt een WO-nummer</small></button><button disabled title="Nog niet beschikbaar">Werkbon achteraf<small>Spoedklus die al gedaan is</small></button></div></details><input type="search" id="werkq" placeholder="Zoek op nummer, projectnr, klant of besteller…" value="${esc(ui.q)}" aria-label="Zoeken">${st === 'alle' && !q ? `<span class="swl"><button class="sw" role="switch" aria-checked="${oud}" data-act="werkoud" aria-label="Afgelopen werkopdrachten tonen"></button>Afgelopen tonen</span>` : ''}</div>
      ${ui.fout ? `<p class="foutmelding" role="alert">${esc(ui.fout)}</p>` : ''}
      ${weekBar()}
      ${rijen.length ? `<div class="scroll"><table class="rijen wo"><thead><tr><th>Werkopdracht</th><th>Klant · werkopdracht</th><th>Periode</th><th>Op locatie</th><th>Behoefte per dag</th><th>Gepland</th><th></th></tr></thead><tbody>${rijen.map(rij).join('')}</tbody></table></div>`
        : `<div class="empty">${ui.loading ? 'Werkopdrachten laden…' : data.regels.length ? (alle ? 'Geen werkopdrachten gevonden.' : 'Geen werkopdrachten in deze week.') : 'Nog geen werkopdrachten. Klik op “+ Nieuwe werkopdracht” om de eerste aanvraag van een klant in te vullen.'}</div>`}
    </div>`;
  }

  /* ---------- formulier ---------- */
  const schuif = ({ id, act, aan, vAan, vUit, links, rechts, titel, uitleg }) => {
    const tid = 'tip_' + id;
    return `<span class="tip"><span class="swl duo">${links ? `<button type="button" class="swlbl ${aan ? '' : 'act'}" data-act="${act}" data-v="${vUit}" tabindex="-1">${links}</button>` : ''}<button class="sw" role="switch" id="${id}" aria-checked="${!!aan}" data-act="${act}" data-v="${aan ? vUit : vAan}" aria-describedby="${tid}" aria-label="${esc(titel)}"></button><button type="button" class="swlbl ${aan || !links ? 'act' : ''}" data-act="${act}" data-v="${links ? vAan : (aan ? vUit : vAan)}" tabindex="-1">${rechts}</button></span>
    <span class="tippop" role="tooltip" id="${tid}">${uitleg.map(([t, u]) => `<span class="tiprij"><b>${t}</b><small>${u}</small></span>`).join('')}</span></span>`;
  };
  const tijdIn = (id, sel, extra = '') => `<span class="tijdbox"><input id="${id}" ${extra} class="tijdin num" inputmode="numeric" autocomplete="off" placeholder="uu:mm" value="${tijd(((sel % 24) + 24) % 24)}" title="Typ bijv. 730, 0730, 7:30 of 7.30 · of kies met ▾"><button type="button" class="tijdpijl" data-tijdvoor="${id}" tabindex="-1" aria-label="Kies een tijd uit de lijst">▾</button></span>`;
  const tijdlijnHTML = (t, extra) => {
    const di = dienstInfo(t.vertrek, t.terug);
    return `<div class="tl zacht"><div><small>Vertrek VSVK</small><b>${tijdD(t.vertrek)}</b></div><div><small>Aanwezig op locatie</small><b>${tijdD(t.aanwezig)}</b></div><div><small>Eind op locatie</small><b>${tijdD(t.eindLoc)}</b></div><div><small>Terug op VSVK</small><b>${tijdD(t.terug)}</b></div></div>
    ${di.soort === 'nacht' || extra ? `<p class="mini tregel">${di.soort === 'nacht' ? '<span class="dchip nacht" title="Valt grotendeels tussen 18:00 en 06:00">☾ Nacht</span> ' : ''}${extra ? extra.charAt(0).toUpperCase() + extra.slice(1) : ''}</p>` : ''}`;
  };

  function klantVan(w) { return data.refs.klanten.find(k => k.id === Number(w.klantId)) || null; }
  function woCapaciteit(w) {
    const refs = data.refs, cap = ui.cap || { mens: {}, mat: {}, totMens: null, totMat: null };
    const hier = (soort, key) => (soort === 'mens' ? (w.mensen || []).filter(l => key === '_elk' ? !l.rol : l.rol === key) : (w.materieel || []).filter(l => l.type === key)).reduce((a, l) => a + (+l.aantal || 0), 0);
    const reken = (soort, key, lbl) => {
      const item = (soort === 'mens' ? cap.mens : cap.mat)[key === '_elk' ? 'Elke functie' : key];
      const nu = hier(soort, key);
      return { key, lbl, nu, cap: item ? item.beschikbaar : 0, gevraagd: item ? item.gevraagd : nu, dag: item && item.druksteDag && werkDagen(w).length > 1 ? item.druksteDag : '', bekend: !!item, uitleg: item ? `${item.beschikbaar} beschikbaar, ${item.gevraagd} gevraagd (alle opdrachten samen)` : 'Drukte wordt berekend…' };
    };
    const mens = refs.functies.map(f => reken('mens', f, f));
    if ((w.mensen || []).some(l => !l.rol)) mens.push(reken('mens', '_elk', 'Elke functie'));
    const mat = refs.materieelTypes.map(t => reken('mat', t.naam, t.naam));
    return { mens, mat, mensTot: cap.totMens || { gevraagd: som(w.mensen), cap: 0, uitleg: '' }, matTot: cap.totMat || { gevraagd: som(w.materieel), cap: 0, uitleg: '' } };
  }

  function formHTML() {
    const w = ui.edit, refs = data.refs, kl = klantVan(w), dagen = werkDagen(w), nk = w._nk, T = wTijden(w), nacht = isNacht(w);
    const cs = kl ? kl.contacten || [] : [], b = w.besteller || {};
    const bKeuze = b._keuze != null && b._keuze !== '' ? String(b._keuze) : (cs.find(c => c.naam && b.naam && c.naam.toLowerCase() === b.naam.toLowerCase()) || {}).id != null ? String(cs.find(c => c.naam && b.naam && c.naam.toLowerCase() === b.naam.toLowerCase()).id) : (b.naam ? '_ander' : '');
    const bVelden = nk || !cs.length || bKeuze === '_ander';
    const nMens = som(w.mensen), nMat = som(w.materieel);
    const allDays = []; if (w.van) { const tot = w.tot && w.tot >= w.van ? w.tot : w.van; for (let d = w.van; d <= tot && allDays.length < 120; d = addDays(d, 1)) allDays.push(d); }
    const adresOk = !!(String(w.locatie || '').trim() || String(w.maps || '').trim());
    const ok = { klant: !!(w.klantId || (nk && String(nk.bedrijf || '').trim())), vsvk: (!refs.vestigingen.length || !!w.vestigingId) && (w.soort !== 'aangenomen' || !!String(w.internNr || '').trim()), wanneer: w.voorraad || (!!w.van && dagen.length > 0), werk: !!String(w.kop || w.omschrijving || '').trim() && adresOk, nodig: nMens > 0 };
    const STAP = [['klant', 'Klant'], ['vsvk', 'Opdracht VSVK'], ['wanneer', 'Wanneer'], ['werk', 'Werk'], ['nodig', 'Wie & wat nodig']];
    const kop = (i, key, titel, sub) => `<h2><span class="wstapnr ${ok[key] ? 'ok' : ''}">${ok[key] ? '✓' : i}</span>${titel}${sub ? `<small>${sub}</small>` : ''}</h2>`;
    const ontbreekt = STAP.filter(([k]) => !ok[k]).map(([, l]) => l);
    const pauze = w.pauze !== '' && w.pauze != null ? +w.pauze : 30;
    const functies = [...new Set([...refs.functies, ...(w.mensen || []).map(l => l.rol)].filter(Boolean))];
    const types = [...new Set([...refs.materieelTypes.map(t => t.naam), ...(w.materieel || []).map(l => l.type)].filter(Boolean))];
    const arts = refs.artikelen;
    const eerder = kl && w._isNew ? (ui.eerder || []) : [];
    const vestNaam = (refs.vestigingen.find(v => v.id === w.vestigingId) || {}).naam || '';
    const cap = woCapaciteit(w);
    const tegel = (soort, key, lbl, c) => {
      const n = c.nu, g = c.gevraagd, pct = c.cap ? g / c.cap : (g ? 2 : 0), st = !c.bekend ? ['rustig', '…'] : pct > 1 ? ['over', 'Overvraagd'] : pct >= 1 ? ['vol', 'Vol'] : pct >= .7 ? ['druk', 'Druk'] : ['rustig', 'Rustig'];
      return `<div class="caprij ${n ? 'aan' : ''}"><div class="capnaam">${esc(lbl)}</div><div class="capstep"><button type="button" class="capbtn" data-cap="${soort}" data-k="${esc(key)}" data-d="-1" ${n ? '' : 'disabled'} aria-label="Eén minder ${esc(lbl)}">−</button><b>${n}</b><button type="button" class="capbtn" data-cap="${soort}" data-k="${esc(key)}" data-d="1" aria-label="Eén meer ${esc(lbl)}">+</button></div>${soort === 'mat' && n ? `<label class="verhkeus" title="Zonder machinist: geen bediener nodig op de planning"><input type="checkbox" data-wverhuur="${esc(key)}" ${(w.materieel || []).filter(l => l.type === key).every(l => l.verhuur) ? 'checked' : ''}> losse verhuur</label>` : ''}<div class="capdruk d-${st[0]}" title="${esc(c.uitleg)}"><span class="capbalk"><i style="width:${Math.min(100, Math.round(pct * 100))}%"></i></span><span class="capt"><b>${st[1]}</b> ${g}/${c.cap}${c.dag ? ' · ' + esc(datumKort(c.dag)) : ''}</span></div></div>`;
    };
    const ordernrs = w.ordernrs && w.ordernrs.length ? w.ordernrs : [''];
    const dienstenHTML = () => {
      if (!dagen.length) return '<p class="hint">Kies eerst de datum(s); daarna zet je de diensten.</p>';
      const ds = w.diensten || [];
      return `<div class="dnst"><div class="dndag"><div class="dndkop"><b>Elke werkdag</b><span class="dnknop"><button type="button" class="btn sm" data-act="dpreset" data-v="2x12">2 × 12 u</button><button type="button" class="btn sm" data-act="dpreset" data-v="3x8">3 × 8 u</button><button type="button" class="btn sm" data-act="dpreset" data-v="plus">+ dienst</button></span></div>
      ${ds.length ? ds.map(D => { const e = (+D.aanwezig) + (+D.werk); return `<div class="dnrij"><input class="dnnaam" id="dn_n_${D.id}" data-dn="naam" data-di="${D.id}" value="${esc(D.naam || '')}" placeholder="Naam" aria-label="Naam dienst">
        <span class="dntijd">${tijdIn('dn_a_' + D.id, +D.aanwezig, `data-dt="aanw" data-di="${D.id}" aria-label="Begintijd op locatie"`)}<span>–</span>${tijdIn('dn_e_' + D.id, e, `data-dt="eind" data-di="${D.id}" aria-label="Eindtijd op locatie"`)}<small class="plus1">${e > 24 + 1e-9 ? '+1' : ''}</small></span>
        <span class="dnbez"><span class="hint">Aantallen stel je bij stap 5 in; ze gelden voor elke dienst</span></span>
        <button type="button" class="btn ghost dnweg" data-act="ddel" data-di="${D.id}" aria-label="Dienst ${esc(D.naam || '')} verwijderen">✕</button></div>`; }).join('') : '<div class="hint dnleeg">Geen diensten · kies 2 × 12 u, 3 × 8 u of + dienst</div>'}</div>
      <p class="hint">Tijden zijn op locatie; pauze hieronder geldt voor elke dienst. De diensten gelden voor alle werkdagen van deze werkopdracht.</p></div>`;
    };
    return `<div class="pagehead"><span class="wonr">${w._isNew ? 'Het WO-nummer volgt bij opslaan' : esc(w.nummer || '')}</span><h1>${w._isNew ? 'Nieuwe werkopdracht' : 'Werkopdracht ' + esc(w.nummer || '') + (ctx.canEdit ? ' bewerken' : ' bekijken')}</h1></div>
  <div class="wform2">
   <div class="wstappen">
    <section class="wsec wstap" id="stap_klant">${kop(1, 'klant', 'Klant')}
      ${nk ? `<div class="nkblok"><div class="nkkop"><b>Nieuwe klant</b><button class="btn sm ghost" data-act="nkcancel">Bestaande klant kiezen</button></div>
        <label class="f">Bedrijfsnaam *<input id="wk_bedrijf" data-nk="bedrijf" value="${esc(nk.bedrijf || '')}"></label>
        <div class="adr"><label class="f">Straat<input id="wk_straat" data-nk="straat" value="${esc(nk.straat || '')}"></label><label class="f">Huisnr<input id="wk_huisnr" data-nk="huisnr" value="${esc(nk.huisnr || '')}"></label><label class="f">Toev.<input id="wk_toev" data-nk="toev" value="${esc(nk.toev || '')}"></label></div>
        <div class="adr2"><label class="f">Postcode<input id="wk_postcode" data-nk="postcode" value="${esc(nk.postcode || '')}" placeholder="1234 AB"></label><label class="f">Plaats<input id="wk_plaats" data-nk="plaats" value="${esc(nk.plaats || '')}"></label></div>
        <div class="fg t2"><label class="f">Telefoon algemeen<input id="wk_telefoon" data-nk="telefoon" value="${esc(nk.telefoon || '')}"></label><label class="f">E-mail algemeen<input id="wk_email" data-nk="email" value="${esc(nk.email || '')}"></label></div>
        <span class="hint">Debiteurnummer en overige gegevens vul je later aan op de klantkaart.</span></div>`
      : `<div class="klantrij"><label class="f">Klant *<select id="w_klantId" data-w="klantId"><option value="">— kies klant —</option>${refs.klanten.slice().sort((a, c) => String(a.naam).localeCompare(String(c.naam), 'nl')).map(c => `<option value="${c.id}" ${c.id === Number(w.klantId) ? 'selected' : ''}>${esc(c.naam || 'Klant')}${c.plaats ? ' · ' + esc(c.plaats) : ''}</option>`).join('')}</select></label>${w._isNew ? '<button class="btn" data-act="nknew">+ Nieuwe klant</button>' : ''}</div>
        ${kl ? `<div class="kinfo"><div><b>${esc(kl.naam)}</b>${kl.debiteurnummer ? ' · deb. ' + esc(kl.debiteurnummer) : ''}</div><span>${esc(klantAdresVol(kl))}</span>${kl.telefoon || kl.email ? `<span>${esc([kl.telefoon, kl.email].filter(Boolean).join(' · '))}</span>` : ''}</div>` : ''}`}
      <div class="wsub"><h3>Besteller</h3>
      ${!nk && cs.length ? `<select id="w_bkeuze" data-bkeuze="1" aria-label="Besteller"><option value="">— geen besteller —</option>${cs.map(c => `<option value="${esc(c.id)}" ${bKeuze === String(c.id) ? 'selected' : ''}>${esc(c.naam)}</option>`).join('')}<option value="_ander" ${bKeuze === '_ander' ? 'selected' : ''}>Andere persoon…</option></select>` : ''}
      ${bVelden ? `<div class="fg t3"><label class="f">Naam besteller<input id="w_bnaam" data-b="naam" value="${esc(b.naam || '')}"></label><label class="f">Telefoon<input id="w_btel" data-b="telefoon" value="${esc(b.telefoon || '')}" inputmode="tel"></label><label class="f">E-mail<input id="w_bmail" data-b="email" value="${esc(b.email || '')}" inputmode="email"></label></div>`
        : b.naam ? `<div class="bkort">${esc([b.telefoon, b.email].filter(Boolean).join(' · ') || 'geen telefoon of e-mail bekend')}</div>` : ''}
      </div>
      <div class="f ordblok">Ordernummer klant <span class="fnote">staat op de werkbon en is nodig voor de factuur</span>${ordernrs.map((x, i) => `<span class="ordrij"><input ${i === 0 ? 'id="w_titel"' : ''} data-ordnr="${i}" value="${esc(x)}" aria-label="Ordernummer ${i + 1}">${ordernrs.length > 1 ? `<button type="button" class="btn ghost sm" data-act="wordmin" data-i="${i}" aria-label="Ordernummer weghalen">✕</button>` : ''}</span>`).join('')}<button type="button" class="btn sm" data-act="wordplus">+ Ordernummer</button></div>
      ${eerder.length ? `<div class="wsnel"><span class="lbl">Snel starten · klik een eerdere opdracht van ${esc(kl.naam)}</span><div class="wsnelkaarten">${eerder.map(x => `<button type="button" class="wsnelkaart" data-wkopie="${esc(x.id)}" title="Neemt omschrijving, adres, tijden en wie & wat nodig over (geen datum en ordernummer)"><b>${esc(x.korteWerkomschrijving || String(x.omschrijving || '').slice(0, 40))}</b><small>${esc(x.nummer || '')} · ${x.startOpLocatie ? tijd(urenVan(x.startOpLocatie)) : '—'} · ${som((x.behoeften || []))} mens</small></button>`).join('')}</div></div>` : ''}
    </section>

    <section class="wsec wstap" id="stap_vsvk">${kop(2, 'vsvk', 'Opdracht VSVK')}
      ${refs.vestigingen.length > 1 ? `<label class="f vestkeus">Vestiging * <span class="fnote">kies voor wie deze opdracht is</span><select id="w_vestiging" data-w="vestigingId"><option value="">— kies vestiging —</option>${refs.vestigingen.map(v => `<option value="${esc(v.id)}" ${v.id === w.vestigingId ? 'selected' : ''}>${esc(v.naam)}</option>`).join('')}</select></label>` : ''}
      <div class="fg t2 schuifrij">
        <div class="f">Soort opdracht${schuif({ id: 'sw_soort', act: 'wsoort', aan: w.soort === 'aangenomen', vAan: 'aangenomen', vUit: 'regie', links: 'Regie', rechts: 'Aangenomen', titel: 'Regie of aangenomen', uitleg: [['Regie', 'Uren en materieel worden achteraf afgerekend op basis van de werkbonnen: proforma per week, factuur per ordernummer.'], ['Aangenomen', 'Vaste prijs. De uren worden geschreven op een intern projectnummer; er gaat geen urenproforma naar de klant.']] })}</div>
        <div class="f">Status${schuif({ id: 'sw_optie', act: 'woptie', aan: !!w.optie, vAan: '1', vUit: '0', links: 'Definitief', rechts: 'Optie', titel: 'Definitief of optie', uitleg: [['Definitief', 'De opdracht is rond: mensen en materieel inplannen en werkbonnen maken.'], ['Optie', 'Voorlopig reserveren voor een offerte of een klus die nog niet bevestigd is. Mensen en materieel tellen als gepland, op het planbord gestippeld, nog geen werkbonnen. Met één klik definitief te maken.']] })}</div>
      </div>
      ${w.optie ? `<div class="row optievelden"><label class="f" style="flex:2">Voor wie / waarom <span class="fnote">komt op het planbord bij de klus</span><input id="w_optieNoot" data-w="optieNoot" value="${esc(w.optieNoot || '')}" placeholder="bv. offerte 26-118, wacht op akkoord projectleider"></label><label class="f">Optie geldig t/m<input type="date" id="w_optieTot" data-w="optieTot" value="${esc(w.optieTot || '')}"></label></div>` : ''}
      ${w.soort === 'aangenomen' ? `<label class="f">Projectnummer intern *<input id="w_internNr" data-w="internNr" value="${esc(w.internNr || '')}" class="${w._internFout ? 'fout' : ''}"></label>` : ''}
    </section>

    <section class="wsec wstap" id="stap_wanneer">${kop(3, 'wanneer', 'Wanneer', w.voorraad ? 'werkvoorraad, nog geen datum' : '')}
      ${w.voorraad ? `<div class="vrswitch aan"><b>Werkvoorraad · nog geen datum</b><small>Je plant het later in vanuit de <i>werkvoorraad</i> op het planbord.</small></div>
      <div class="fg t3"><label class="f">Geschatte uren<input type="number" id="w_schat" data-w="schatUren" data-num="1" class="num" min="0" step="0.5" value="${w.schatUren !== '' && w.schatUren != null ? esc(w.schatUren) : ''}" placeholder="bijv. 16"></label>
        <label class="f">Uiterlijk klaar<input type="date" id="w_uiterlijk" data-w="uiterlijk" value="${esc(w.uiterlijk || '')}"></label>
        <div class="f">Prioriteit<div class="seg" role="group" aria-label="Prioriteit">${[['hoog', 'Hoog'], ['normaal', 'Normaal'], ['laag', 'Laag']].map(([v, l]) => `<button type="button" data-act="wprio" data-v="${v}" aria-pressed="${(w.prio || 'normaal') === v}">${l}</button>`).join('')}</div></div></div>`
      : `<div class="fg t4 datumrij"><label class="f">${nacht ? 'Eerste nacht begint op *' : 'Datum op locatie *'}<input type="date" id="w_van" data-w="van" data-re="1" value="${esc(w.van)}" ${w._isNew ? `min="${vandaag()}"` : ''}></label>
        <label class="f">${nacht ? 'Laatste nacht eindigt op' : 'Tot en met'}<input type="date" id="w_tot" data-wtot="1" value="${esc(w.tot || w.van)}" min="${esc(w.van)}"></label>
        <div class="f">Weekend${schuif({ id: 'sw_skip', act: 'wskip', aan: !!w.skip, vAan: '1', vUit: '0', rechts: 'overslaan', titel: 'Weekend overslaan', uitleg: [['Weekend overslaan', 'Zaterdag en zondag tussen de begin- en einddatum worden niet ingepland. Losse dagen zet je uit door erop te klikken.']] })}</div>
        <div class="f">Diensten${schuif({ id: 'sw_multi', act: 'wmulti', aan: !!w.multi, vAan: '1', vUit: '0', rechts: 'meerdere per dag', titel: 'Meerdere diensten per dag', uitleg: [['Meerdere diensten per dag', 'Shifts achter elkaar, bijvoorbeeld een weekendklus van 2 × 12 of 3 × 8 uur. Diensten mogen overlappen voor de overdracht.']] })}</div></div>
        ${allDays.length > 1 ? `<div class="dagrij"><div class="daylist" aria-label="Werkdagen">${allDays.map(d => { const we = w.skip && isWeekend(d), uit = (w.uitDagen || []).includes(d); return `<span class="${we ? 'we' : uit ? 'uit' : ''}" ${we ? '' : `data-act="wdag" data-d="${d}" role="button" tabindex="0" aria-pressed="${!uit}"`} title="${esc(langeDatum(d))}${we ? '' : uit ? ' · uitgezet, klik om terug te zetten' : ' · klik om deze dag over te slaan'}">${kortNr(d)}</span>`; }).join('')}</div><span class="hint">${dagen.length} werkdag${dagen.length === 1 ? '' : 'en'} · klik een dag om hem over te slaan</span></div>` : ''}`}
      ${w.multi && !w.voorraad ? dienstenHTML() : ''}
      <div class="fg t3" ${w.multi ? 'hidden' : ''}>
        <label class="f">Starttijd op locatie *${tijdIn('w_aanwezig', T.aanwezig, 'data-wt="aanwezig"')}</label>
        <label class="f">Werktijd (uu:mm)<input id="w_werkuren" data-wt="werkuren" class="num" value="${hm(T.werk)}" inputmode="numeric" placeholder="8:00"></label>
        <label class="f">Eindtijd op locatie${tijdIn('w_eindloc', T.eindLoc, 'data-wt="eindloc"')}</label>
      </div>
      <div class="fg t3">
        <label class="f">Reistijd heen (min)<input type="number" id="w_reisheen" data-wt="reisheen" class="num" min="0" max="600" step="5" value="${Math.round(T.rh * 60)}"></label>
        <label class="f">Reistijd terug (min)<input type="number" id="w_reisterug" data-wt="reisterug" class="num" min="0" max="600" step="5" value="${Math.round(T.rt * 60)}"></label>
        <label class="f">Pauze (min)<input type="number" id="w_pauze" data-w="pauze" data-num="1" class="num" min="0" max="240" step="5" value="${pauze}"></label>
      </div>
      ${w.multi ? '' : tijdlijnHTML(T, w._reisHand ? 'reistijd zelf aangepast · wordt alleen gebruikt voor de berekening' : 'reistijd: ' + (w._reisBron || 'standaard reistijd'))}
      <div class="urenregel" ${w.multi ? 'hidden' : ''}>Te schrijven per persoon per ${nacht ? 'nacht' : 'dag'}: <b>${hm(T.werk + T.rh + T.rt - pauze / 60)}</b> uur <span class="hint">(${hm(T.rh + T.rt)} reis + ${hm(T.werk)} op locatie − ${pauze} min pauze) · op ${w.soort === 'aangenomen' ? 'project ' + esc(w.internNr || '…') : 'de werkopdracht'}</span></div>
      ${w._isNew || w.voorraad ? `<button type="button" class="btn link vrlink" data-act="wvoorraad">${w.voorraad ? '← Toch een datum kiezen' : 'Nog geen datum? Zet in de werkvoorraad →'}</button>` : ''}
    </section>

    <section class="wsec wstap" id="stap_werk">${kop(4, 'werk', 'Werk')}
      <label class="f">Korte werkomschrijving <span class="fnote">komt op het planbord en de werkbon</span><input id="w_kop" data-w="kop" value="${esc(w.kop || '')}"></label>
      <label class="f">Wat moet er gebeuren<textarea id="w_omschrijving" data-w="omschrijving" rows="3">${esc(w.omschrijving)}</textarea></label>
      <label class="f">Instructies voor de ploeg<textarea id="w_instructies" data-w="instructies" rows="2">${esc(w.instructies)}</textarea></label>
      <label class="f">Werkadres *<input id="w_locatie" data-w="locatie" data-re="1" value="${esc(w.locatie)}" class="${w._adresFout && !String(w.locatie || '').trim() && !String(w.maps || '').trim() ? 'fout' : ''}">${kl && !String(w.locatie || '').trim() ? `<button type="button" class="btn link klantadr" data-act="wklantadres">Zelfde als klantadres (${esc(klantAdresVol(kl))})</button>` : ''}</label>
      <label class="f">GPS-locatie <span class="fnote">coördinaten of Google Maps-link</span><span class="adresrij"><input id="w_maps" data-w="maps" data-re="1" value="${esc(w.maps || '')}"><button type="button" class="btn sm" data-act="wgps" title="Gebruik de locatie van dit apparaat">📍 Hier</button></span></label>
      <a class="btn gmaps" href="${esc(mapsLink(w.locatie, w.maps) || 'https://www.google.com/maps')}" target="_blank" rel="noopener"><span class="gm-ico">📍</span><span><b>${String(w.locatie || '').trim() || String(w.maps || '').trim() ? 'Bekijk in Google Maps' : 'Zoek de locatie op in Google Maps'}</b><small>${String(w.locatie || '').trim() || String(w.maps || '').trim() ? 'controleer de plek en de route' : 'kopieer daarna het adres of de coördinaten hierheen'}</small></span></a>
      <div class="fg t2"><label class="f">Contact op locatie<input id="w_contactLocatie" data-w="contactLocatie" value="${esc(w.contactLocatie)}" placeholder="naam"></label><label class="f">Telefoon<input id="w_contactLocatieTel" data-w="contactLocatieTel" value="${esc(w.contactLocatieTel || '')}" inputmode="tel"></label></div>
      <div class="f">Kleur op het planbord<div class="colors">${KLEUREN.map((c, i) => `<button type="button" data-wkleur="${c}" style="--c:${c}" aria-pressed="${String(w.kleur).toLowerCase() === c}" aria-label="Kleur ${i + 1}"></button>`).join('')}</div></div>
    </section>

    <section class="wsec wstap ${w._mensFout && !nMens ? 'fout' : ''}" id="sec_mensen">${kop(5, 'nodig', 'Wie &amp; wat nodig')}
      ${w._mensFout && !nMens ? '<p class="foutmelding">Minstens 1 persoon nodig.</p>' : ''}
      <p class="hint capuitleg">Klik + voor wat de klant vraagt. De balk geeft een gevoel van de drukte ${w.voorraad ? '' : (dagen.length > 1 ? 'op de drukste dag' : 'op die dag')}: hoeveel van wat er is al gevraagd wordt, alle opdrachten samen. Het is een indicatie; wie of welk stuk het wordt, regel je later bij het inplannen.</p>
      <div class="capkolom"><div class="capgroep"><h3>Mensen <span>${nMens}</span><em class="captot" title="${esc(cap.mensTot.uitleg)}">${cap.mensTot.gevraagd} van ${cap.mensTot.cap} mensen gevraagd</em></h3><div class="capgrid">${cap.mens.map(c => tegel('mens', c.key, c.lbl, c)).join('')}</div></div>
      <div class="capgroep"><h3>Materieel <span>${nMat}</span><em class="captot" title="${esc(cap.matTot.uitleg)}">${cap.matTot.gevraagd} van ${cap.matTot.cap} stuks gevraagd</em></h3><div class="capgrid">${cap.mat.map(c => tegel('mat', c.key, c.lbl, c)).join('') || '<span class="hint">Nog geen materieel in de lijsten.</span>'}</div></div></div>
      <details class="wnodig weisen" ${w._eisenOpen ? 'open' : ''}><summary><h3>Eisen &amp; specifiek materieel</h3><span class="hint">bijv. certificaat of één bepaald stuk · optioneel</span></summary>
        ${(w.mensen || []).map((l, i) => `<div class="nrow"><input type="number" class="num" min="1" max="50" id="wm_a_${l.id}" data-ml="${i}" data-f="aantal" value="${esc(l.aantal)}" aria-label="Aantal">
          <select id="wm_r_${l.id}" class="${l.rol ? '' : 'leeg'}" data-ml="${i}" data-f="rol" aria-label="Functie"><option value="">Elke functie</option>${functies.map(f => `<option ${f === l.rol ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>
          <input id="wm_s_${l.id}" class="${l.skill ? '' : 'leeg'}" data-ml="${i}" data-f="skill" value="${esc(l.skill || '')}" placeholder="Geen eis (bijv. VCA)" aria-label="Vaardigheid">
          <button class="btn ghost" data-mldel="${i}" aria-label="Verwijder regel">✕</button></div>`).join('')}
        <button class="btn sm" data-act="mlplus">+ Regel mensen</button>
        ${(w.materieel || []).map((l, i) => { const stuks = refs.materieel.filter(t => (!l.type || (refs.materieelTypes.find(g => g.id === t.groepId) || {}).naam === l.type)); return `<div class="nrow"><input type="number" class="num" min="1" max="50" id="wt_a_${l.id}" data-tl="${i}" data-f="aantal" value="${esc(l.aantal)}" aria-label="Aantal">
          <select id="wt_t_${l.id}" class="${l.type ? '' : 'leeg'}" data-tl="${i}" data-f="type" aria-label="Type"><option value="">Kies type…</option>${types.map(f => `<option ${f === l.type ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>
          <select id="wt_m_${l.id}" class="${l.mid ? '' : 'leeg'}" data-tl="${i}" data-f="mid" aria-label="Materieel"><option value="">Elk stuk</option>${stuks.map(t => `<option value="${esc(t.id)}" ${t.id === l.mid ? 'selected' : ''}>${esc(t.naam)}</option>`).join('')}</select>
          <button class="btn ghost" data-tldel="${i}" aria-label="Verwijder regel">✕</button></div>`; }).join('')}
        <button class="btn sm" data-act="tlplus" ${refs.materieelTypes.length ? '' : 'disabled'}>+ Regel materieel</button>
      </details>
      <details class="wnodig wmat" ${(w.artikelen || []).length ? 'open' : ''}><summary><h3>Materialen</h3><span class="hint">${(w.artikelen || []).length ? (w.artikelen.length + ' regel' + (w.artikelen.length === 1 ? '' : 's')) : 'optioneel'}</span></summary>
        ${(w.artikelen || []).map((x, i) => { const a = arts.find(z => z.id === x.id), vrij = !x.id && (x.vrij || x.oms), cat = x.cat != null && x.cat !== '' ? x.cat : (a && a.categorie) || '', cats = [...new Set([...arts.map(z => z.categorie).filter(Boolean), cat].filter(Boolean))].sort((p, q) => p.localeCompare(q, 'nl')), keuze = arts.filter(z => !cat || z.categorie === cat);
          return `<div class="nrow"><input type="number" class="num" step="any" min="0" id="wa_q_${i}" data-al="${i}" data-f="aantal" value="${esc(x.aantal)}" aria-label="Aantal">
          <select id="wa_c_${i}" class="${cat ? '' : 'leeg'}" data-al="${i}" data-f="cat" aria-label="Categorie"><option value="">Kies categorie…</option>${cats.map(c => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <select id="wa_s_${i}" class="${x.id || vrij ? '' : 'leeg'}" data-al="${i}" data-f="id" aria-label="Materiaal"><option value="" ${!x.id && !vrij ? 'selected' : ''}>Kies materiaal…</option>${keuze.map(a2 => `<option value="${esc(a2.id)}" ${a2.id === x.id ? 'selected' : ''}>${esc(a2.naam)}</option>`).join('')}<option value="_vrij" ${vrij ? 'selected' : ''}>Anders, zelf omschrijven…</option></select>
          <button class="btn ghost" data-aldel="${i}" aria-label="Verwijder regel">✕</button></div>
          ${vrij ? `<div class="nrow"><span></span><input id="wa_o_${i}" data-al="${i}" data-f="oms" value="${esc(x.oms || '')}" placeholder="Omschrijving materiaal" aria-label="Omschrijving materiaal"><input id="wa_e_${i}" data-al="${i}" data-f="eenheid" value="${esc(x.eenheid || '')}" placeholder="Eenheid: st, m, m³" aria-label="Eenheid"><span></span></div>`
            : `<div class="avail">${a ? `Eenheid: <b>${esc(a.eenheid || '—')}</b>` : 'Kies een materiaal of omschrijf het zelf'}</div>`}`; }).join('')}
        <button class="btn sm" data-act="alplus">+ Regel materialen</button>
      </details>
    </section>
   </div>

   <aside class="wsamen">
    <div class="wsamenkop"><span class="wonr">${w._isNew ? 'Nieuw · nummer bij opslaan' : esc(w.nummer || '')}</span><b>${esc(kl ? kl.naam : (nk && nk.bedrijf) || 'Nog geen klant')}</b><small>${esc(w.kop || '')}</small></div>
    <ol class="wstaplijst">${STAP.map(([k, l], i) => `<li class="${ok[k] ? 'ok' : ''}"><button type="button" data-wnaar="${k === 'nodig' ? 'sec_mensen' : 'stap_' + k}"><i>${ok[k] ? '✓' : i + 1}</i>${l}</button></li>`).join('')}</ol>
    <dl class="wsamenlijst">
      ${b.naam ? `<dt>Besteller</dt><dd>${esc(b.naam)}</dd>` : ''}${ordernrs.filter(Boolean).length ? `<dt>Ordernr.</dt><dd>${esc(ordernrs.filter(Boolean).join('; '))}</dd>` : ''}
      <dt>${w.voorraad ? 'Planning' : 'Wanneer'}</dt><dd>${w.voorraad ? 'werkvoorraad' : `${esc(dagVol(w.van))}${dagen.length > 1 ? ` · ${dagen.length} ${nacht ? 'nachten' : 'dagen'}` : ''}<br>${tijd(T.aanwezig % 24)}–${tijdD(T.eindLoc)} op locatie`}</dd>
      <dt>Vestiging</dt><dd>${esc(vestKort(vestNaam)) || '—'}</dd>
      <dt>Nodig</dt><dd>${nMens} ${nMens === 1 ? 'persoon' : 'personen'}${nMat ? ` · ${nMat} materieel` : ''}</dd>
      <dt>Uren op</dt><dd>${w.soort === 'aangenomen' ? 'project ' + esc(w.internNr || '…') : 'deze werkopdracht'}</dd>
    </dl>
    ${ontbreekt.length ? `<p class="wnog">Nog invullen: ${ontbreekt.map(esc).join(', ')}</p>` : '<p class="wklaar">✓ Alles ingevuld</p>'}
    ${ui.bericht ? `<p class="foutmelding" role="alert">${esc(ui.bericht)}${ui.conflict ? ' <button class="btn sm" data-act="nieuwste">Nieuwste versie ophalen</button>' : ''}</p>` : ''}
    <div class="wfoot2">${ctx.canEdit ? (w.voorraad ? `<button class="btn primary" data-act="werksave" ${ui.busy ? 'disabled' : ''}>Opslaan in werkvoorraad</button>` : `<button class="btn primary" data-act="werksave" data-auto="1" disabled title="Automatisch invullen is nog niet beschikbaar">Opslaan &amp; ⚡ Vul aan</button><button class="btn" data-act="werksave" ${ui.busy ? 'disabled' : ''}>Opslaan &amp; zelf inplannen</button>`) : ''}<button class="btn ghost" data-act="werkcancel">${ctx.canEdit ? 'Annuleren' : 'Sluiten'}</button>
    ${ctx.canEdit && !w._isNew && !w.voorraad ? `<button class="btn" data-act="wterug" ${ui.busy ? 'disabled' : ''} title="Niet af? De opdracht gaat terug naar de werkvoorraad">↩ Terug naar werkvoorraad</button>` : ''}
    ${ctx.canEdit && !w._isNew ? `<button class="btn sm danger" data-act="werkdel" ${ui.busy ? 'disabled' : ''} ${w._confirm ? 'data-confirm="1"' : ''}>${w._confirm ? 'Zeker? Annuleren en uit de planning halen' : 'Werkopdracht annuleren'}</button>` : ''}</div>
   </aside>
  </div>`;
  }

  /* ---------- tekenen ---------- */
  function render() {
    if (!ctx) return;
    const actief = document.activeElement, id = actief && actief.id && ctx.container.contains(actief) ? actief.id : '';
    const start = id && actief.selectionStart != null ? [actief.selectionStart, actief.selectionEnd] : null;
    ctx.container.innerHTML = ui.edit ? formHTML() : lijstHTML();
    if (id) { const node = document.getElementById(id); if (node) { node.focus({ preventScroll: true }); try { if (start && node.setSelectionRange) node.setSelectionRange(start[0], start[1]); } catch { /* type zonder selectie */ } } }
    if (ui.edit) planCapaciteit();
  }

  /* samenvatting en stapvinkjes bijwerken tijdens het typen, zonder het formulier opnieuw te tekenen */
  function samenVernieuw() {
    if (!ui.edit) return;
    const oud = ctx.container.querySelector('.wsamen'); if (!oud) return;
    const tmp = document.createElement('div'); tmp.innerHTML = formHTML();
    const nieuw = tmp.querySelector('.wsamen'); if (nieuw) oud.replaceWith(nieuw);
    const kn = [...tmp.querySelectorAll('.wstap>h2 .wstapnr')], ko = [...ctx.container.querySelectorAll('.wstap>h2 .wstapnr')];
    ko.forEach((x, i) => { if (kn[i]) { x.className = kn[i].className; x.textContent = kn[i].textContent; } });
  }

  /* ---------- drukte (server rekent, het formulier toont) ---------- */
  function planCapaciteit() { clearTimeout(capTimer); capTimer = setTimeout(laadCapaciteit, 200); }
  async function laadCapaciteit() {
    const w = ui.edit; if (!w || !w.van) return;
    const seq = ++capSeq, tot = w.voorraad ? w.van : (w.tot && w.tot >= w.van ? w.tot : w.van);
    const uit = []; for (let d = w.van; d <= tot; d = addDays(d, 1)) if ((w.skip && isWeekend(d)) || (w.uitDagen || []).includes(d)) uit.push(d);
    const refs = data.refs;
    const mens = refs.functies.map(f => ({ aantal: w.mensen.filter(l => l.rol === f).reduce((a, l) => a + (+l.aantal || 0), 0), rol: f, skill: null, soort: 'mens' }));
    if (w.mensen.some(l => !l.rol)) mens.push({ aantal: som(w.mensen.filter(l => !l.rol)), rol: null, skill: null, soort: 'mens' });
    const mat = refs.materieelTypes.map(t => ({ aantal: w.materieel.filter(l => l.type === t.naam).reduce((a, l) => a + (+l.aantal || 0), 0), materieelGroepId: t.id, materieelId: null, type: t.naam, losseVerhuur: false }));
    try {
      const r = await ctx.request('/api/planning/werkopdrachten/drukte', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ van: w.van, tot, vrijeDagen: uit, mensen: mens, materieel: mat }) });
      if (seq !== capSeq || ui.edit !== w) return;
      ui.cap = {
        mens: Object.fromEntries((r.mensen || []).map(i => [i.naam, i])), mat: Object.fromEntries((r.materieel || []).map(i => [i.naam, i])),
        totMens: { gevraagd: r.mensenGevraagd ?? som(w.mensen), cap: r.mensenBeschikbaar ?? 0, uitleg: '' }, totMat: { gevraagd: r.materieelGevraagd ?? som(w.materieel), cap: r.materieelBeschikbaar ?? 0, uitleg: '' }
      };
      const nieuw = document.createElement('div'); nieuw.innerHTML = formHTML();
      const oud = ctx.container.querySelector('.capkolom'), vers = nieuw.querySelector('.capkolom');
      if (oud && vers) oud.replaceWith(vers);
    } catch { /* de drukte-indicatie is optioneel; het formulier blijft bruikbaar */ }
  }

  /* ---------- acties ---------- */
  async function openWerk(id) {
    try {
      const refs = await laadReferenties();
      const d = await ctx.request('/api/planning/werkopdrachten/' + id);
      ui.edit = uitApi(d, refs); ui.bericht = ''; ui.conflict = false; ui.cap = null; ui.eerder = [];
      window.scrollTo(0, 0); render();
    } catch (error) { toast('Werkopdracht laden mislukt: ' + error.message, true); }
  }
  async function nieuwWerk() {
    try {
      const refs = await laadReferenties();
      ui.edit = nieuwConcept(refs, { van: wkStand() !== 'alle' && wkStand() > vandaag() ? wkStand() : vandaag() });
      ui.bericht = ''; ui.conflict = false; ui.cap = null; ui.eerder = []; window.scrollTo(0, 0); render();
    } catch (error) { toast('Formulier laden mislukt: ' + error.message, true); }
  }
  function sluitFormulier(herlaad) { ui.edit = null; ui.bericht = ''; ui.conflict = false; window.scrollTo(0, 0); render(); if (herlaad) laadLijst(); }

  async function laadEerder() {
    const w = ui.edit; if (!w || !w._isNew || !w.klantId) { ui.eerder = []; return; }
    const klantId = w.klantId;
    try {
      const lijst = await ctx.request('/api/planning/klanten/' + klantId + '/recente-werkopdrachten');
      if (ui.edit === w && w.klantId === klantId) { ui.eerder = lijst || []; render(); }
    } catch { ui.eerder = []; }
  }
  function kopieer(id) {
    const w = ui.edit, x = (ui.eerder || []).find(e => e.id === id); if (!w || !x) return;
    if (x.korteWerkomschrijving) w.kop = x.korteWerkomschrijving;
    if (x.omschrijving && !w.omschrijving) w.omschrijving = x.omschrijving;
    if (x.werkadres) { w.locatie = x.werkadres; w._wpc = x.werkPostcode || null; w._wpl = x.werkPlaats || null; }
    const a = urenVan(x.startOpLocatie), e = urenVan(x.eindOpLocatie);
    if (a != null) { w.aanwezig = a; if (e != null) w.werkuren = (((e - a) % 24) + 24) % 24 || 24; }
    w.mensen = (x.behoeften || []).map(n => ({ id: uid(), aantal: n.aantal, rol: n.rol || '', skill: n.skill || '' }));
    w.materieel = (x.materieel || []).map(n => ({ id: uid(), aantal: n.aantal, type: n.rol || '', grp: n.materieelGroepId || null, mid: n.materieelId || '', verhuur: !!n.losseVerhuur }));
    w._mensFout = false; render(); toast('Overgenomen van ' + (x.nummer || 'eerdere opdracht') + ' · datum en ordernummer vul je zelf in');
  }

  function kapCap(soort, key, delta) {
    const w = ui.edit, ls = soort === 'mens' ? w.mensen : w.materieel;
    const past = l => soort === 'mens' ? (key === '_elk' ? !l.rol : l.rol === key) : l.type === key;
    if (delta > 0) {
      const l = ls.find(x => past(x) && !(soort === 'mens' ? x.skill : x.mid));
      if (l) l.aantal = (+l.aantal || 0) + 1;
      else ls.push(soort === 'mens' ? { id: uid(), aantal: 1, rol: key === '_elk' ? '' : key, skill: '' } : { id: uid(), aantal: 1, type: key, grp: (data.refs.materieelTypes.find(t => t.naam === key) || {}).id || null, mid: '', verhuur: false });
      w._mensFout = false;
    } else {
      const kand = ls.filter(past), l = kand.find(x => !(soort === 'mens' ? x.skill : x.mid)) || kand[kand.length - 1]; if (!l) return;
      l.aantal = (+l.aantal || 0) - 1; if (l.aantal <= 0) ls.splice(ls.indexOf(l), 1);
    }
    render();
  }

  function totUitEind(w) { if (!w.tot || w.tot < w.van) w.tot = w.van; }

  /* geeft true terug als het formulier opnieuw getekend moet worden */
  function invoer(t) {
    const w = ui.edit; if (!w) return false; const d = t.dataset;
    if (d.dn || d.dt) {
      const D = (w.diensten || []).find(x => x.id === d.di); if (!D) return false;
      if (d.dn === 'naam') { D.naam = t.value; return false; }
      const v = leesTijd(t.value); if (v == null || isNaN(v)) return true; const e = (+D.aanwezig) + (+D.werk);
      if (d.dt === 'aanw') { D.aanwezig = v; let wk = ((e % 24) - v + 24) % 24; if (wk < .25) wk = 24; D.werk = wk; }
      else { let wk = ((v - (+D.aanwezig)) % 24 + 24) % 24; if (wk < .25) wk = 24; D.werk = wk; }
      return true;
    }
    if (d.wt) {
      const T = wTijden(w);
      let v = (d.wt === 'aanwezig' || d.wt === 'eindloc' || (d.wt === 'werkuren' && /[:.h]|^\d{3,4}$/.test(String(t.value).trim()))) ? leesTijd(t.value) : parseFloat(String(t.value).replace(',', '.'));
      if (isNaN(v)) { if (d.wt === 'aanwezig' || d.wt === 'eindloc') { toast('Onbekende tijd. Typ bijv. 730, 07:30 of 7.30', true); return true; } v = 0; }
      w.aanwezig = T.aanwezig; w.werkuren = T.werk; w.reisHeen = T.rh; w.reisTerug = T.rt;
      if (d.wt === 'aanwezig') w.aanwezig = v;
      else if (d.wt === 'werkuren') w.werkuren = Math.max(.25, Math.min(24, v));
      else if (d.wt === 'eindloc') { let wk = ((v - T.aanwezig) % 24 + 24) % 24; if (wk < .25) wk = 24; w.werkuren = wk; }
      else if (d.wt === 'reisheen') { w.reisHeen = Math.max(0, v) / 60; w._reisHand = true; }
      else if (d.wt === 'reisterug') { w.reisTerug = Math.max(0, v) / 60; w._reisHand = true; }
      return true;
    }
    if (d.wtot) { w.tot = t.value || w.van; totUitEind(w); return true; }
    if (d.w) {
      w[d.w] = d.num ? (parseFloat(t.value) || 0) : t.value;
      if (d.w === 'van') { if (w.tot < w.van) w.tot = w.van; }
      if (d.w === 'klantId') {
        const k = klantVan(w), c = k && (k.contacten || [])[0];
        w.besteller = c ? { naam: c.naam, telefoon: c.telefoon || '', email: c.email || '', _keuze: String(c.id) } : { naam: '', telefoon: '', email: '', _keuze: '' };
        if (w._isNew) { w.kleur = kleurVoorKlant(w.klantId); laadEerder(); }
      }
      return !!d.re || d.w === 'klantId';
    }
    if (d.bkeuze) {
      const c = ((klantVan(w) || {}).contacten || []).find(x => String(x.id) === t.value);
      w.besteller = c ? { naam: c.naam, telefoon: c.telefoon || '', email: c.email || '', _keuze: String(c.id) } : { naam: '', telefoon: '', email: '', _keuze: t.value };
      return true;
    }
    if (d.b) { w.besteller = { ...(w.besteller || {}), [d.b]: t.value }; if (d.b === 'naam') { const c = ((klantVan(w) || {}).contacten || []).find(x => String(x.id) === w.besteller._keuze); if (c && c.naam !== t.value) w.besteller._keuze = '_ander'; } return false; }
    if (d.wverhuur != null) { (w.materieel || []).filter(l => l.type === d.wverhuur).forEach(l => { l.verhuur = t.checked; }); return true; }
    if (d.ordnr != null) { w.ordernrs[+d.ordnr] = t.value; return false; }
    if (d.nk) { w._nk[d.nk] = t.value; return false; }
    if (d.ml != null) { const l = w.mensen[+d.ml]; if (!l) return false; l[d.f] = d.f === 'aantal' ? Math.max(1, parseInt(t.value) || 1) : t.value; return d.f !== 'skill'; }
    if (d.tl != null) {
      const l = w.materieel[+d.tl]; if (!l) return false;
      if (d.f === 'aantal') { l.aantal = Math.max(1, parseInt(t.value) || 1); return true; }
      if (d.f === 'type') { l.type = t.value; l.grp = (data.refs.materieelTypes.find(g => g.naam === t.value) || {}).id || null; l.mid = ''; return true; }
      if (d.f === 'mid') { l.mid = t.value; const m = data.refs.materieel.find(x => x.id === t.value); if (m) { l.aantal = 1; const g = data.refs.materieelTypes.find(x => x.id === m.groepId); if (g) { l.type = g.naam; l.grp = g.id; } } return true; }
      return false;
    }
    if (d.al != null) {
      const l = w.artikelen[+d.al]; if (!l) return false;
      if (d.f === 'id') { if (t.value === '_vrij') { l.id = ''; l.vrij = true; } else { l.id = t.value; l.vrij = false; const a = data.refs.artikelen.find(x => x.id === t.value); if (a && a.categorie) l.cat = a.categorie; } return true; }
      if (d.f === 'cat') { l.cat = t.value; const a = data.refs.artikelen.find(x => x.id === l.id); if (a && t.value && a.categorie !== t.value) l.id = ''; return true; }
      l[d.f] = d.f === 'aantal' ? (parseFloat(String(t.value).replace(',', '.')) || 0) : t.value; return false;
    }
    return false;
  }

  async function opslaan() {
    const w = ui.edit; if (!w || ui.busy) return;
    const refs = data.refs, nk = w._nk;
    const naarVeld = (id, tekst) => { toast(tekst, true); setTimeout(() => { const x = document.getElementById(id); if (x) { x.scrollIntoView({ block: 'center' }); x.focus(); } }, 0); };
    if (nk && !String(nk.bedrijf || '').trim()) return naarVeld('wk_bedrijf', 'Vul de bedrijfsnaam van de nieuwe klant in.');
    if (!nk && !w.klantId) return naarVeld('w_klantId', 'Kies eerst een klant.');
    if (refs.vestigingen.length > 1 && !w.vestigingId) return naarVeld('w_vestiging', 'Kies een vestiging.');
    if (w.soort === 'aangenomen' && !String(w.internNr || '').trim()) { w._internFout = true; render(); return naarVeld('w_internNr', 'Vul het interne projectnummer in (verplicht bij aangenomen werk).'); }
    if (!w.voorraad && !w.van) return naarVeld('w_van', 'Vul de startdatum in.');
    if (!w.voorraad && !werkDagen(w).length) return naarVeld('w_van', 'Er valt geen werkdag in deze periode.');
    if (!String(w.kop || w.omschrijving || '').trim()) return naarVeld('w_kop', 'Vul een korte werkomschrijving in.');
    if (!String(w.locatie || '').trim() && !String(w.maps || '').trim()) { w._adresFout = true; render(); return naarVeld('w_locatie', 'Vul het werkadres of de GPS-locatie in.'); }
    if (!som(w.mensen)) { w._mensFout = true; render(); setTimeout(() => document.getElementById('sec_mensen')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50); return toast('Vul bij 5 · Wie & wat nodig in hoeveel mensen er nodig zijn (minstens 1).', true); }
    w._adresFout = false; w._mensFout = false;
    if (w._isNew && !w.kleur) w.kleur = kleurVoorKlant(w.klantId);
    ui.busy = true; ui.bericht = ''; ui.conflict = false; samenVernieuw();
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (!w._isNew) headers['If-Match'] = w.eTag;
      const opgeslagen = await ctx.request('/api/planning/werkopdrachten' + (w._isNew ? '' : '/' + w.id), { method: w._isNew ? 'POST' : 'PUT', headers, body: JSON.stringify(naarApi(w, refs)) });
      toast((opgeslagen?.nummer || w.nummer || 'Werkopdracht') + (w._isNew ? ' aangemaakt' : ' opgeslagen') + (w.voorraad ? ' in de werkvoorraad' : '') + '.');
      ui.busy = false; ui.edit = null; render();
      if (w.voorraad) laadLijst(); else if (ctx.navigate) ctx.navigate('Planbord', { date: w.van }); else laadLijst();
    } catch (error) {
      ui.busy = false;
      if (error.status === 412 && !w._isNew) { ui.bericht = 'Deze werkopdracht is intussen door iemand anders gewijzigd. Je invoer staat er nog.'; ui.conflict = true; }
      else ui.bericht = 'Opslaan mislukt: ' + error.message;
      render();
    }
  }

  async function nieuwsteVersie() {
    const w = ui.edit; if (!w || w._isNew) return;
    try {
      const d = await ctx.request('/api/planning/werkopdrachten/' + w.id);
      w.eTag = d.eTag; w.version = d.version; w._basis = clone(d); ui.conflict = false;
      ui.bericht = 'De nieuwste versie is opgehaald. Controleer je invoer en klik opnieuw op Opslaan.'; render();
    } catch (error) { ui.bericht = 'Ophalen mislukt: ' + error.message; render(); }
  }

  async function levenscyclus(soort) {
    const w = ui.edit; if (!w || ui.busy) return; ui.busy = true; samenVernieuw();
    try {
      await ctx.request('/api/planning/werkopdrachten/' + w.id + '/' + soort, { method: 'POST', headers: { 'If-Match': w.eTag } });
      toast(w.nummer + (soort === 'annuleren' ? ' geannuleerd · het nummer blijft bewaard' : ' staat weer in de werkvoorraad') + '.');
      ui.busy = false; sluitFormulier(true);
    } catch (error) {
      ui.busy = false; w._confirm = false;
      if (error.status === 412) { ui.bericht = 'Deze werkopdracht is intussen gewijzigd. Haal de nieuwste versie op en probeer het opnieuw.'; ui.conflict = true; }
      else ui.bericht = (soort === 'annuleren' ? 'Annuleren' : 'Terugzetten') + ' mislukt: ' + error.message;
      render();
    }
  }

  function klik(b) {
    const d = b.dataset, a = d.act, w = ui.edit;
    if (d.werkedit) { openWerk(d.werkedit); return true; }
    if (d.werkplan) { const r = data.regels.find(x => x.id === d.werkplan); if (ctx.navigate) ctx.navigate('Planbord', { date: r ? (r.van < vandaag() && r.tot >= vandaag() ? vandaag() : r.van) : undefined }); return true; }
    if (a === 'wbvanwo') { if (ctx.navigate) ctx.navigate('Werkbonnen'); return true; }
    if (a === 'nieuwwerk') { nieuwWerk(); return true; }
    if (a === 'wk') { const n = +d.n; ui.wk = n === 0 ? maandag(vandaag()) : addDays(wkStand(), 7 * n); laadLijst(); render(); return true; }
    if (a === 'wkalle') { ui.wk = wkStand() === 'alle' ? maandag(vandaag()) : 'alle'; laadLijst(); render(); return true; }
    if (a === 'werkoud') { ui.oud = !ui.oud; laadLijst(); render(); return true; }
    if (!w) return false;
    if (d.wkleur) { w.kleur = d.wkleur; render(); return true; }
    if (d.cap) { kapCap(d.cap, d.k, +d.d); return true; }
    if (d.wkopie) { kopieer(d.wkopie); return true; }
    if (d.wnaar) { const x = document.getElementById(d.wnaar); if (x) { x.scrollIntoView({ behavior: 'smooth', block: 'start' }); const f = x.querySelector('input:not([type=hidden]),select,textarea'); if (f) setTimeout(() => f.focus({ preventScroll: true }), 350); } return true; }
    if (a === 'wordplus') { w.ordernrs.push(''); render(); setTimeout(() => { const x = ctx.container.querySelectorAll('[data-ordnr]'); if (x.length) x[x.length - 1].focus(); }, 0); return true; }
    if (a === 'wordmin') { w.ordernrs.splice(+d.i, 1); if (!w.ordernrs.length) w.ordernrs.push(''); render(); return true; }
    if (a === 'wklantadres') { const k = klantVan(w); if (k) { w.locatie = klantAdresVol(k); w._wpc = k.postcode || null; w._wpl = k.plaats || null; render(); } return true; }
    if (a === 'wgps') {
      if (!navigator.geolocation) { toast('Locatie opvragen kan op dit apparaat niet.', true); return true; }
      navigator.geolocation.getCurrentPosition(p => { w.maps = p.coords.latitude.toFixed(5) + ', ' + p.coords.longitude.toFixed(5); render(); toast('GPS-locatie ingevuld'); }, () => toast('Locatie niet beschikbaar. Plak de coördinaten zelf.', true), { timeout: 8000 });
      return true;
    }
    if (d.mldel != null) { w.mensen.splice(+d.mldel, 1); render(); return true; }
    if (d.tldel != null) { w.materieel.splice(+d.tldel, 1); render(); return true; }
    if (d.aldel != null) { w.artikelen.splice(+d.aldel, 1); render(); return true; }
    if (a === 'mlplus') { w.mensen.push({ id: uid(), aantal: 1, rol: '', skill: '' }); w._eisenOpen = true; render(); return true; }
    if (a === 'tlplus') { w.materieel.push({ id: uid(), aantal: 1, type: '', grp: null, mid: '', verhuur: false }); w._eisenOpen = true; render(); return true; }
    if (a === 'alplus') { w.artikelen.push({ id: '', aantal: 1, oms: '', eenheid: '', cat: '' }); render(); return true; }
    if (a === 'wskip') { w.skip = !w.skip; render(); return true; }
    if (a === 'wmulti') { w.multi = !w.multi; if (w.multi && !(w.diensten || []).length) { const T = wTijden(w); w.diensten = [{ id: uid(), naam: 'Dienst 1', aanwezig: T.aanwezig, werk: T.werk }]; } render(); return true; }
    if (a === 'dpreset') {
      const T = wTijden(w), voorinstelling = { '2x12': [['Dag', 6, 12], ['Nacht', 18, 12]], '3x8': [['Vroeg', 6, 8], ['Laat', 14, 8], ['Nacht', 22, 8]] };
      if (d.v === 'plus') { const ds = w.diensten, last = ds[ds.length - 1]; ds.push({ id: uid(), naam: 'Dienst ' + (ds.length + 1), aanwezig: last ? ((+last.aanwezig) + (+last.werk)) % 24 : T.aanwezig, werk: last ? +last.werk : T.werk }); }
      else if (voorinstelling[d.v]) w.diensten = voorinstelling[d.v].map(([naam, aanw, uren]) => ({ id: uid(), naam, aanwezig: aanw, werk: uren }));
      render(); return true;
    }
    if (a === 'ddel') { w.diensten = w.diensten.filter(x => x.id !== d.di); render(); return true; }
    if (a === 'wvoorraad') { w.voorraad = !w.voorraad; if (!w.voorraad && !w.van) { w.van = w.tot = vandaag(); } render(); return true; }
    if (a === 'wprio') { w.prio = d.v; render(); return true; }
    if (a === 'woptie') { w.optie = d.v === '1'; render(); if (w.optie) setTimeout(() => { const x = document.getElementById('w_optieNoot'); if (x && !x.value) x.focus(); }, 0); return true; }
    if (a === 'wsoort') { w.soort = d.v; render(); if (d.v === 'aangenomen') setTimeout(() => { const x = document.getElementById('w_internNr'); if (x && !x.value) x.focus(); }, 0); return true; }
    if (a === 'wdag') { const u = new Set(w.uitDagen || []); u.has(d.d) ? u.delete(d.d) : u.add(d.d); w.uitDagen = [...u]; render(); return true; }
    if (a === 'nknew') { w._nk = { bedrijf: '', straat: '', huisnr: '', toev: '', postcode: '', plaats: '', telefoon: '', email: '' }; w.klantId = ''; w.besteller = { naam: '', telefoon: '', email: '', _keuze: '' }; ui.eerder = []; render(); return true; }
    if (a === 'nkcancel') { w._nk = null; render(); return true; }
    if (a === 'nieuwste') { nieuwsteVersie(); return true; }
    if (a === 'werkcancel') { sluitFormulier(false); return true; }
    if (a === 'werksave') { opslaan(); return true; }
    if (a === 'wterug') { levenscyclus('voorraad'); return true; }
    if (a === 'werkdel') { if (!w._confirm) { w._confirm = true; render(); return true; } levenscyclus('annuleren'); return true; }
    return false;
  }

  /* ---------- tijdkeuzelijst (▾) ---------- */
  function sluitTijdPop() { if (tijdPop) { tijdPop.remove(); tijdPop = null; } }
  function openTijdPop(inp) {
    sluitTijdPop(); if (!inp || inp.disabled) return;
    const cur = leesTijd(inp.value), r = inp.closest('.tijdbox').getBoundingClientRect();
    const node = document.createElement('div'); node.className = 'tijdpop'; node.setAttribute('role', 'listbox');
    node.innerHTML = Array.from({ length: 96 }, (_, i) => i / 4).map(t => `<button type="button" role="option" data-tkeuze="${t}" class="${!isNaN(cur) && Math.abs(t - cur) < .01 ? 'on' : ''} ${t === 6 || t === 18 ? 'grens' : ''}">${tijd(t)}</button>`).join('');
    const h = Math.min(260, window.innerHeight - 20); let top = r.bottom + 2; if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 2);
    Object.assign(node.style, { left: Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)) + 'px', top: top + 'px', width: Math.max(r.width, 110) + 'px', maxHeight: h + 'px' });
    document.body.append(node); tijdPop = node; node._inp = inp;
    const doel = node.querySelector('.on') || node.querySelector('[data-tkeuze="7"]'); if (doel) node.scrollTop = doel.offsetTop - h / 2 + 16;
    node.addEventListener('mousedown', e => e.preventDefault());
    node.addEventListener('click', e => { const b = e.target.closest('[data-tkeuze]'); if (!b) return; const i = node._inp; i.value = tijd(+b.dataset.tkeuze); sluitTijdPop(); i.dispatchEvent(new Event('change', { bubbles: true })); });
  }

  /* ---------- koppelen aan de pagina ---------- */
  let gekoppeld = null;
  function koppel(container) {
    if (gekoppeld === container) return;
    gekoppeld = container;
    container.addEventListener('click', e => {
      const t = e.target.closest ? e.target.closest('[data-tijdvoor]') : null;
      if (t) { e.preventDefault(); const inp = document.getElementById(t.dataset.tijdvoor); if (tijdPop && tijdPop._inp === inp) sluitTijdPop(); else openTijdPop(inp); return; }
      const knop = e.target.closest ? e.target.closest('button,[data-act],[data-werkedit],[data-werkplan],[data-wkleur],[data-wnaar],[role=button]') : null;
      if (!knop || knop.disabled || !container.contains(knop)) return;
      if (klik(knop)) e.preventDefault();
    });
    container.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-act=wdag]')) { e.preventDefault(); klik(e.target); }
    });
    ['input', 'change'].forEach(soort => container.addEventListener(soort, e => {
      const t = e.target; if (!t || !t.matches) return;
      if (t.id === 'werkq') { if (soort === 'input') { ui.q = t.value; clearTimeout(capTimer); capTimer = setTimeout(() => { laadLijst(); render(); }, 300); } return; }
      if (!ui.edit) return;
      if (soort === 'input' && (t.matches('select') || t.type === 'checkbox' || t.type === 'date')) return;
      if (soort === 'change' && !(t.matches('select') || t.type === 'checkbox' || t.type === 'date' || t.dataset.wt || t.dataset.dt)) { clearTimeout(samenTimer); samenTimer = setTimeout(samenVernieuw, 0); return; }
      const opnieuw = invoer(t);
      if (opnieuw) render(); else { clearTimeout(samenTimer); samenTimer = setTimeout(samenVernieuw, soort === 'input' ? 250 : 0); planCapaciteitSoms(t); }
    }));
    container.addEventListener('toggle', e => { if (ui.edit && e.target.classList && e.target.classList.contains('weisen')) ui.edit._eisenOpen = e.target.open; }, true);
    document.addEventListener('click', e => { if (tijdPop && !(e.target.closest && e.target.closest('.tijdpop,[data-tijdvoor]'))) sluitTijdPop(); }, true);
  }
  function planCapaciteitSoms(t) { if (t && t.dataset && (t.dataset.w === 'van' || t.dataset.wtot)) planCapaciteit(); }

  async function open(config) {
    ctx = { container: config.container, request: config.request, canEdit: (await config.canEdit) === true, navigate: config.navigate };
    ctx.container.classList.add('wo-scope');
    koppel(ctx.container);
    ui.edit = null; ui.bericht = ''; ui.conflict = false;
    render();
    await laadLijst();
  }

  window.VsvkWorkOrders = {
    open,
    /* zuivere functies, ook gebruikt door de tests */
    model: { wTijden, werkDagen, uitApi, naarApi, lijstRegel, nieuwConcept, leesTijd, urenVan, apiTijd, dienstInfo, isNacht, mapsLink, klantAdresVol, kleurVoorKlant, vensters }
  };
}());
