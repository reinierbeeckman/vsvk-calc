(function () {
  'use strict';

  /*
   * Planbord: dag-, nacht- en weekweergave 1-op-1 naar het klantontwerp (VSVK Planning prototype).
   * Opmaak en markup komen uit het prototype; de CSS wordt daaruit gegenereerd
   * (scripts/extract-prototype-css.js) en geldt alleen binnen #planbord-scherm.
   *
   * Koppeling met de database (alleen bestaande API):
   *   bord        GET  /api/planning/planbord?from&to              werkopdrachten met klussen, inzetten, materieel
   *   lijsten     GET  /api/planning/medewerkers, /werkopdrachten/form-referenties
   *   wijzigen    GET + PUT /api/planning/werkopdrachten/{id} met If-Match (inzet, materieel, tijden, optie)
   * Bij 412 wordt het scherm ververst en blijft er niets half opgeslagen; er wordt nooit automatisch herhaald.
   */

  const DAG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  const MAAND = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

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
  const datumKort = s => { const x = parseD(s); return DAG[x.getDay()].slice(0, 2) + ' ' + x.getDate() + ' ' + MAAND[x.getMonth()].slice(0, 3); };
  const dagVol = s => DAG[parseD(s).getDay()] + ' ' + parseD(s).getDate() + ' ' + MAAND[parseD(s).getMonth()];
  const langeDatum = s => { const d = parseD(s); return DAG[d.getDay()] + ' ' + d.getDate() + ' ' + MAAND[d.getMonth()] + ' ' + d.getFullYear(); };
  const tijd = x => { const m = Math.round(x * 60); return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60); };
  const tijdD = x => tijd(((x % 24) + 24) % 24) + (x >= 24 - 1e-9 ? ' +1' : x < -1e-9 ? ' −1' : '');
  const uren = x => { const m = Math.round((+x || 0) * 60); return Math.floor(m / 60) + ':' + pad(m % 60); };
  const snap = x => Math.round(x * 4) / 4;
  const som = l => (l || []).reduce((a, x) => a + (+x.aantal || 0), 0);
  const byName = (a, b) => String(a.naam).localeCompare(String(b.naam), 'nl');
  const vestKort = n => String(n || '').replace(/^VSVK\s+/i, '').replace(/\s+B\.?V\.?$/i, '');
  const lees = (sleutel, standaard) => { try { const v = localStorage.getItem(sleutel); return v == null ? standaard : JSON.parse(v); } catch { return standaard; } };
  const bewaar = (sleutel, waarde) => { try { localStorage.setItem(sleutel, JSON.stringify(waarde)); } catch { /* opslag niet beschikbaar */ } };

  /* "07:30:00" → 7.5 ; TimeSpan "1.02:00:00" → 26 ; leeg → null */
  function ts(x) {
    if (x == null || x === '') return null;
    const m = /^(?:(\d+)\.)?(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(x));
    return m ? (+(m[1] || 0)) * 24 + (+m[2]) + (+m[3]) / 60 : null;
  }
  const apiTijd = h => { const m = Math.round((((h % 24) + 24) % 24) * 60); return pad(Math.floor(m / 60)) + ':' + pad(m % 60) + ':00'; };
  const absMs = (datum, uur) => { const d = parseD(datum); return d.getTime() + uur * 36e5; };

  /* ---------- toestand ---------- */
  const ui = {
    datum: vandaag(), nacht: false, week: false, compact: !!lees('vsvk-pb-compact', false), zoom: lees('vsvk-pb-zoom', 56),
    toon: 'alle', dicht: {}, uitleg: false, pool: lees('vsvk-pb-pool', 'medewerkers'), q: '', sel: null, snel: null, loading: false, fout: '', busy: false
  };
  const data = { klussen: [], orders: new Map(), mw: [], mat: [], types: [], klanten: [], artikelen: [], inhuur: [] };
  let ctx = null, loadSeq = 0, toastTimer = null, drag = null, hoverT = null, gekoppeld = null, refsKlaar = null;

  const PBA = () => ui.nacht ? 12 : 0, PBE = () => ui.nacht ? 36 : 30, PBN = () => PBE() - PBA();
  const HW = () => ui.zoom, LN = () => ui.compact ? 34 : 46, MLN = () => ui.compact ? 24 : 32;
  const inVenster = k => !ui.nacht || ((+k.start || 0) + (+k.duur || 0) > 12 + 1e-9);

  function toast(tekst, slecht) {
    let node = document.getElementById('pb-toast');
    if (!node) { node = document.createElement('div'); node.id = 'pb-toast'; node.className = 'board-toast'; node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite'); document.body.append(node); }
    node.textContent = tekst; node.className = 'board-toast show' + (slecht ? ' bad' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.className = 'board-toast'; }, 4500);
  }

  /* ---------- gegevens → klussen ---------- */
  function maakKlussen(orders) {
    const out = [];
    for (const order of orders) {
      for (const job of order.klussen || []) {
        const datum = job.datum || job.startDatum;
        if (!datum) continue;
        const aanw = ts(job.startTijd) ?? ts(order.startOpLocatie) ?? 7;
        let eind = ts(job.eindTijd) ?? ts(order.eindOpLocatie) ?? aanw + 8;
        if (eind <= aanw) eind += 24;
        const rh = ts(job.reisHeen) || 0, rt = ts(job.reisTerug) || 0;
        const k = {
          id: job.id, werkId: order.id, order, job, datum, klantId: order.klantId, klant: order.klant || '', kleur: order.kleur || '#ff4e02',
          titel: order.korteWerkomschrijving || order.omschrijving || job.omschrijving || '', start: aanw - rh, duur: eind + rt - (aanw - rh), rh, rt,
          aanwezig: aanw, eindLoc: eind, medewerkers: [], tijden: {}, inhuur: [], materieel: [],
          nodig: som((job.behoeften || []).filter(n => (n.soort || 'mens') === 'mens')) || +job.benodigdeMedewerkers || 0,
          nodigMat: som((job.behoeften || []).filter(n => n.soort && n.soort !== 'mens')),
          bonnen: 0
        };
        for (const inzet of job.inzetten || []) {
          if (inzet.datum && inzet.datum !== datum) continue;
          if (inzet.werkbon) k.bonnen++;
          if (inzet.medewerkerId) {
            if (!k.medewerkers.includes(inzet.medewerkerId)) k.medewerkers.push(inzet.medewerkerId);
            const a = ts(inzet.startTijd), e = ts(inzet.eindTijd);
            if (a != null && e != null && (Math.abs(a - aanw) > .01 || Math.abs((e <= a ? e + 24 : e) - eind) > .01)) {
              const ee = e <= a ? e + 24 : e; k.tijden[inzet.medewerkerId] = { start: a - rh, duur: ee + rt - (a - rh) };
            }
          } else if (inzet.inhuurmedewerkerId) k.inhuur.push({ id: inzet.inhuurmedewerkerId, naam: inzet.inhuurmedewerker || 'Inhuur', lev: inzet.leverancier || '', rol: inzet.functie || '' });
        }
        for (const m of job.materieelInzetten || []) if (!m.datum || m.datum === datum) k.materieel.push({ id: m.materieelId, naam: m.materieel || 'Materieel', mw: m.medewerkerId || '' });
        out.push(k);
      }
    }
    return out;
  }

  const mwNaam = id => (data.mw.find(m => m.id === id) || {}).naam || 'Onbekend';
  const matNaam = id => { const m = data.mat.find(x => x.id === id); return m ? m.naam : (data.klussen.flatMap(k => k.materieel).find(x => x.id === id) || {}).naam || 'Materieel'; };
  const dagKlussen = d => data.klussen.filter(k => k.datum === d);
  const dagStukken = d => {
    const p = addDays(d, -1);
    return [...dagKlussen(d), ...data.klussen.filter(k => k.datum === p && k.start + k.duur > 24 + 1e-9).map(k => ({ ...k, start: k.start - 24, _vervolg: true, _base: k }))].sort((a, b) => a.start - b.start);
  };
  const kVoor = (k, m) => { const o = (k.tijden || {})[m]; if (!o) return k; const sh = k._vervolg ? -24 : 0; return { ...k, start: o.start + sh, duur: o.duur, _eigen: true }; };
  const overlap = (a, b) => a.start < b.start + b.duur - 1e-9 && b.start < a.start + a.duur - 1e-9;
  function lanes(items) {
    const s = items.slice().sort((a, b) => a.start - b.start || b.duur - a.duur), ends = [], map = new Map();
    for (const j of s) { let i = ends.findIndex(e => e <= j.start + 1e-9); if (i < 0) { i = ends.length; ends.push(0); } ends[i] = j.start + j.duur; map.set(j.id, i); }
    return { map, n: Math.max(1, ends.length) };
  }
  function vulling(k) {
    const nodig = k.nodig, ingezet = k.medewerkers.length + k.inhuur.length;
    return { nodig, open: Math.max(0, nodig - ingezet), nodigMat: k.nodigMat, openMat: Math.max(0, k.nodigMat - k.materieel.length) };
  }
  function conflicten(d) {
    const ks = dagStukken(d), mwC = new Set(), matC = new Set(), matPair = new Set();
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const a = ks[i], b = ks[j]; if (!overlap(a, b)) continue;
      if (a.medewerkers.some(m => b.medewerkers.includes(m) && overlap(kVoor(a, m), kVoor(b, m)))) { mwC.add(a.id); mwC.add(b.id); }
      for (const x of a.materieel) if (b.materieel.some(y => y.id === x.id)) { matC.add(a.id); matC.add(b.id); matPair.add(x.id); }
    }
    return { mwC, matC, matPair };
  }
  function klusStatus(k) {
    const st = absMs(k.datum, k.start), e = st + (+k.duur || 0) * 36e5, n = Date.now();
    return n >= e ? 'voorbij' : n >= st ? 'bezig' : 'gepland';
  }
  const isOptie = k => !!(k.order && k.order.isOptie);
  const optieTekst = k => 'Optie voor ' + k.klant + (k.order.optieReden ? ' · ' + k.order.optieReden : '') + (k.order.optieTot ? ' · geldig t/m ' + datumKort(k.order.optieTot) : '');
  const optieVerlopen = k => !!(k.order && k.order.isOptie && k.order.optieTot && k.order.optieTot < vandaag());
  const dienstK = k => { const v = ((k.aanwezig % 24) + 24) % 24; return (v >= 18 || v < 6) && k.eindLoc - k.aanwezig > 0 && (k.eindLoc > 24 || v >= 18 || v < 6) ? 'nacht' : 'dag'; };
  const kopVan = k => k.titel;
  function mwStand(m, d) {
    const ks = dagKlussen(d).filter(k => k.medewerkers.includes(m.id)), u = ks.reduce((s, k) => s + kVoor(k, m.id).duur, 0);
    if (!u) return { cls: 'st-besch', txt: 'Beschikbaar', u: 0 };
    return { cls: 'st-gepland', txt: 'Gepland: ' + ks.map(k => kVoor(k, m.id)).sort((a, b) => a.start - b.start).map(k => tijd(((k.start % 24) + 24) % 24) + '–' + tijdD(k.start + k.duur)).join(', '), u };
  }
  function matStand(t, d) {
    const used = dagKlussen(d).filter(k => k.materieel.some(x => x.id === t.id));
    return used.length ? { cls: 'st-gepland', txt: 'In gebruik: ' + used.map(k => tijd(((k.start % 24) + 24) % 24) + '–' + tijdD(k.start + k.duur)).join(', ') } : { cls: 'st-besch', txt: 'Beschikbaar' };
  }

  /* ---------- laden ---------- */
  async function laadRefs() {
    if (refsKlaar) return refsKlaar;
    refsKlaar = (async () => {
      const [form, mw] = await Promise.all([
        ctx.request('/api/planning/werkopdrachten/form-referenties'),
        ctx.request('/api/planning/medewerkers').catch(() => [])
      ]);
      data.klanten = form.klanten || []; data.types = form.materieelTypes || []; data.artikelen = form.artikelen || [];
      data.mat = (form.materieel || []).map(m => ({ id: m.id, naam: m.naam, groepId: m.groepId, type: (data.types.find(t => t.id === m.groepId) || {}).naam || '', code: '' }));
      data.mw = (mw || []).filter(m => m.actief !== false).map(m => ({ id: m.id, naam: m.naam || 'Medewerker', functie: m.functie || '', vestiging: m.vestiging || '' })).sort(byName);
    })().catch(error => { refsKlaar = null; throw error; });
    return refsKlaar;
  }

  async function laad() {
    const seq = ++loadSeq, eind = window.VsvkLoading?.begin?.() || (() => {});
    ui.loading = true; ui.fout = '';
    try {
      const van = ui.week ? maandag(ui.datum) : addDays(ui.datum, -1), tot = ui.week ? addDays(maandag(ui.datum), 6) : addDays(ui.datum, 1);
      const [orders] = await Promise.all([ctx.request('/api/planning/planbord?from=' + van + '&to=' + tot), laadRefs()]);
      if (seq !== loadSeq) return;
      data.orders = new Map((orders || []).map(o => [o.id, o]));
      data.klussen = maakKlussen(orders || []);
    } catch (error) {
      if (seq === loadSeq) ui.fout = 'Planbord laden mislukt: ' + error.message;
    } finally { if (seq === loadSeq) ui.loading = false; eind(); }
    if (seq === loadSeq) render();
  }

  /* ---------- wijzigen via de werkopdracht (If-Match, geen automatische herhaling) ---------- */
  async function wijzig(orderId, verander, melding) {
    if (ui.busy || !ctx.canEdit) return false;
    ui.busy = true;
    try {
      const order = await ctx.request('/api/planning/werkopdrachten/' + orderId);
      const probleem = verander(order);
      if (probleem) { toast(probleem, true); return false; }
      await ctx.request('/api/planning/werkopdrachten/' + orderId, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': order.eTag }, body: JSON.stringify(window.VsvkPlanBoard.writeValue(order, true))
      });
      if (melding) toast(melding);
      return true;
    } catch (error) {
      toast(error.status === 412 ? 'De werkopdracht is intussen door iemand anders gewijzigd. Het bord is ververst; probeer het opnieuw.' : 'Opslaan mislukt: ' + error.message, true);
      return false;
    } finally { ui.busy = false; await laad(); }
  }
  const jobIn = (order, id) => (order.klussen || []).find(j => j.id === id);

  function plaatsMens(k, mwId) {
    if (klusStatus(k) === 'voorbij') return toast('Deze klus is voorbij.', true);
    if (k.medewerkers.includes(mwId)) return toast(mwNaam(mwId) + ' staat al op deze klus.', true);
    const naam = mwNaam(mwId);
    return wijzig(k.werkId, order => {
      const job = jobIn(order, k.id); if (!job) return 'Deze klus bestaat niet meer.';
      job.inzetten = job.inzetten || [];
      job.inzetten.push({ datum: job.datum || k.datum, medewerkerId: mwId, inhuurmedewerkerId: null, startTijd: job.startTijd, eindTijd: job.eindTijd, werkbon: null });
      return '';
    }, naam + ' ingepland bij ' + k.klant + '.');
  }
  function plaatsMat(k, matId, mwId) {
    if (klusStatus(k) === 'voorbij') return toast('Deze klus is voorbij.', true);
    if (k.materieel.some(x => x.id === matId)) return toast(matNaam(matId) + ' staat al op deze klus.', true);
    const naam = matNaam(matId);
    return wijzig(k.werkId, order => {
      const job = jobIn(order, k.id); if (!job) return 'Deze klus bestaat niet meer.';
      const bediener = mwId && k.medewerkers.includes(mwId) ? mwId : null;
      (job.materieelInzetten = job.materieelInzetten || []).push({ datum: job.datum || k.datum, materieelId: matId, medewerkerId: bediener });
      return '';
    }, naam + ' gekoppeld aan ' + k.klant + (mwId && k.medewerkers.includes(mwId) ? ' · bediener ' + mwNaam(mwId) : '') + '.');
  }
  function plaatsMateriaal(k, artId) {
    const art = data.artikelen.find(a => a.id === artId); if (!art) return;
    return wijzig(k.werkId, order => {
      order.materialen = order.materialen || [];
      const bestaand = order.materialen.find(m => m.artikelId === artId);
      if (bestaand) bestaand.aantal = (+bestaand.aantal || 0) + 1; else order.materialen.push({ aantal: 1, artikelId: artId, omschrijving: null, eenheid: null });
      return '';
    }, art.naam + ' toegevoegd aan ' + k.klant + '.');
  }
  function haalMens(k, mwId) {
    if (klusStatus(k) === 'voorbij') return toast('Deze klus is voorbij.', true);
    return wijzig(k.werkId, order => {
      const job = jobIn(order, k.id); if (!job) return 'Deze klus bestaat niet meer.';
      const voor = (job.inzetten || []).length;
      job.inzetten = (job.inzetten || []).filter(x => !(x.medewerkerId === mwId && (!x.datum || x.datum === k.datum)));
      (job.materieelInzetten || []).forEach(x => { if (x.medewerkerId === mwId) x.medewerkerId = null; });
      return job.inzetten.length === voor ? 'Deze inzet bestaat niet meer.' : '';
    }, mwNaam(mwId) + ' van ' + k.klant + ' gehaald.');
  }
  function koppelBediener(k, matId, mwId) {
    if (klusStatus(k) === 'voorbij') return toast('Deze klus is voorbij.', true);
    if (mwId && !k.medewerkers.includes(mwId)) return toast(mwNaam(mwId) + ' staat niet op deze klus.', true);
    return wijzig(k.werkId, order => {
      const job = jobIn(order, k.id); if (!job) return 'Deze klus bestaat niet meer.';
      const item = (job.materieelInzetten || []).find(x => x.materieelId === matId && (!x.datum || x.datum === k.datum));
      if (!item) return 'Dit materieel staat niet meer op de klus.';
      item.medewerkerId = mwId || null; return '';
    }, mwId ? mwNaam(mwId) + ' gekoppeld aan ' + matNaam(matId) + '.' : matNaam(matId) + ' losgekoppeld.');
  }
  function haalMat(k, matId) {
    return wijzig(k.werkId, order => {
      const job = jobIn(order, k.id); if (!job) return 'Deze klus bestaat niet meer.';
      job.materieelInzetten = (job.materieelInzetten || []).filter(x => !(x.materieelId === matId && (!x.datum || x.datum === k.datum)));
      return '';
    }, matNaam(matId) + ' van ' + k.klant + ' gehaald.');
  }
  function haalMateriaal(k, artId) {
    return wijzig(k.werkId, order => { order.materialen = (order.materialen || []).filter(m => m.artikelId !== artId); return ''; }, 'Materiaal van ' + k.klant + ' gehaald.');
  }
  function zetTijden(k, start, duur) {
    const aanw = start + k.rh, eind = start + duur - k.rt;
    if (eind <= aanw + 1e-9) return toast('De klus moet minstens een kwartier op locatie duren.', true);
    if (absMs(k.datum, aanw) < Date.now() && klusStatus(k) !== 'gepland') return toast('Deze klus is al begonnen of voorbij.', true);
    return wijzig(k.werkId, order => {
      const job = jobIn(order, k.id); if (!job) return 'Deze klus bestaat niet meer.';
      const oudA = ts(job.startTijd), oudE = ts(job.eindTijd);
      job.startTijd = apiTijd(aanw); job.eindTijd = apiTijd(eind);
      for (const i of job.inzetten || []) {
        if (i.startTijd && oudA != null && Math.abs(ts(i.startTijd) - oudA) < .01) i.startTijd = job.startTijd;
        if (i.eindTijd && oudE != null && Math.abs(ts(i.eindTijd) - oudE) < .01) i.eindTijd = job.eindTijd;
      }
      return '';
    }, k.klant + ': op locatie ' + tijd(aanw % 24) + '–' + tijdD(eind) + '.');
  }
  function bevestigOptie(k) {
    return wijzig(k.werkId, order => { order.isOptie = false; order.optieTot = null; order.optieReden = null; return ''; }, k.order.nummer + ' is definitief.');
  }

  /* ---------- blokken ---------- */
  function blokHTML(k, mwId, lane, cMw, cMat, matPair) {
    const s0 = Math.max(PBA(), k.start), w = Math.max(.5, Math.min(k.start + k.duur, PBE()) - s0), v = vulling(k);
    const mine = []; const collegas = k.medewerkers.filter(m => m !== mwId);
    const matBad = k.materieel.some(x => matPair.has(x.id));
    const kst = klusStatus(k._base || k), opt = isOptie(k), wOpt = optieVerlopen(k);
    const tags = (k._eigen ? `<span class="eigen" title="Eigen tijd voor ${esc(mwNaam(mwId))}">⏱</span>` : '') + (dienstK(k) === 'nacht' ? '<span class="dn" title="Nachtdienst">☾</span>' : '') +
      (v.nodig ? `<span class="${v.open ? 'need' : 'needok'}" title="Mensen gepland / nodig">P ${v.nodig - v.open}/${v.nodig}</span>` : '') +
      (v.nodigMat ? `<span class="${v.openMat ? 'need' : 'needok'}" title="Materieel gepland / nodig">M ${v.nodigMat - v.openMat}/${v.nodigMat}</span>` : '');
    const geldig = (cMw && mwId !== '_none' && k.medewerkers.includes(mwId)) || matBad;
    return `<div class="blok ${kst !== 'gepland' ? kst : ''} ${opt ? 'optie' : ''} ${opt && wOpt ? 'optieoud' : ''} ${k._vervolg ? 'vervolg' : ''} ${geldig ? 'conflict' : ''} ${ui.sel === k.id ? 'sel' : ''}" data-drag="blok" data-id="${esc(k.id)}" data-mw="${esc(mwId)}" style="--kc:${esc(k.kleur)};left:${s0 * HW() + 1}px;width:${w * HW() - 3}px;top:${4 + lane * LN()}px" title="${esc((k.order.nummer ? k.order.nummer + ' · ' : '') + k.klant + ' — ' + k.titel + (collegas.length ? ' · met ' + collegas.map(mwNaam).join(', ') : '') + ' · vertrek ' + tijdD(k.start) + ', op locatie ' + tijdD(k.aanwezig) + '–' + tijdD(k.eindLoc) + ', terug ' + tijdD(k.start + k.duur))}">
      <b>${esc(k.klant)}</b><small>${esc(kopVan(k)) || '&nbsp;'}</small>
      <div class="tags">${opt ? `<span class="optag" title="${esc(optieTekst(k))}">${wOpt ? 'OPTIE VERLOPEN' : 'OPTIE'}</span>` : ''}${matBad ? '<span class="bad" title="Materieel dubbel geboekt">!</span>' : ''}${tags}</div>${k.start + k.duur > PBE() ? `<div class="cont" title="${ui.nacht ? 'Loopt door na 12:00' : 'Loopt door na middernacht'}"></div>` : ''}<div class="rz" data-resize="1" data-id="${esc(k.id)}" title="Sleep om de duur te wijzigen"></div></div>`;
  }
  const blokPos = (k, t, top) => `left:${Math.max(PBA(), k.start) * HW() + 1}px;width:${Math.max(.5, Math.min(PBE(), k.start + k.duur) - Math.max(PBA(), k.start)) * HW() - 3}px;top:${top}px`;

  /* ---------- planninglade ---------- */
  function poolHTML() {
    const q = ui.q.trim().toLowerCase(), d = ui.datum, ks = dagKlussen(d), match = s => !q || s.toLowerCase().includes(q);
    let items = '';
    if (ui.pool === 'klanten') {
      items = data.klanten.slice().sort(byName).filter(k => match([k.naam, k.plaats, k.debiteurnummer].join(' '))).map(k => `<div class="pi" data-drag="klant" data-id="${esc(k.id)}"><b>${esc(k.naam || 'Klant')}</b><small>${esc([k.straat, k.plaats].filter(Boolean).join(', ') || 'Geen adres')}</small></div>`).join('');
    } else if (ui.pool === 'medewerkers') {
      items = data.mw.filter(m => match([m.naam, m.functie].join(' '))).sort((a, b) => byName(a, b)).map(m => {
        const st = mwStand(m, d);
        return `<div class="pi pimw ${st.u ? 'busy' : ''}" data-drag="mw" data-id="${esc(m.id)}"><b>${esc(m.naam)}</b><small class="load ${st.cls}" title="${esc(st.txt)}">${esc(st.txt)}</small></div>`;
      }).join('');
    } else if (ui.pool === 'materiaal') {
      const fmt = n => String(Math.round(n * 100) / 100).replace('.', ',');
      const tot = new Map();
      ks.forEach(k => (k.order.materialen || []).forEach(x => { const key = x.artikelId || ('vrij:' + (x.omschrijving || '')); if (!tot.has(key)) tot.set(key, { x, n: 0 }); tot.get(key).n += +x.aantal || 0; }));
      const naamA = r => { const a = data.artikelen.find(z => z.id === r.x.artikelId); return a ? a.naam : (r.x.omschrijving || 'Materiaal'); };
      const eenh = r => { const a = data.artikelen.find(z => z.id === r.x.artikelId); return a ? a.eenheid : (r.x.eenheid || ''); };
      const dag = [...tot.values()].filter(r => match(naamA(r))).sort((a, b) => naamA(a).localeCompare(naamA(b), 'nl'));
      const dagHTML = `<div class="pool-sub">Nodig op ${esc(datumKort(d))}</div>` + (dag.length ? dag.map(r => `<div class="pi nodig" ${r.x.artikelId ? `data-drag="art" data-id="${esc(r.x.artikelId)}"` : ''}><b>${esc(naamA(r))}<span class="qty">${fmt(r.n)} ${esc(eenh(r))}</span></b></div>`).join('') : '<p class="hint" style="padding:0 2px 6px">Nog geen materialen op de klussen van deze dag.</p>');
      const cat = data.artikelen.filter(a => match([a.naam, a.categorie].join(' '))).sort((a, b) => String(a.categorie || '').localeCompare(String(b.categorie || ''), 'nl') || String(a.naam).localeCompare(String(b.naam), 'nl'));
      let laatste = null;
      items = dagHTML + '<div class="pool-sub">Alle materialen</div>' + cat.map(a => {
        const kop = (a.categorie || 'Overig') !== laatste ? `<div class="pool-sub" style="padding-top:4px;color:var(--ink)">${esc(laatste = (a.categorie || 'Overig'))}</div>` : '';
        return kop + `<div class="pi" data-drag="art" data-id="${esc(a.id)}"><b>${esc(a.naam)}</b><small class="load">${esc(a.eenheid || '')}</small></div>`;
      }).join('');
    } else {
      items = data.mat.filter(t => match([t.naam, t.type].join(' '))).sort((a, b) => byName(a, b)).map(t => {
        const used = ks.filter(k => k.materieel.some(x => x.id === t.id)), st = matStand(t, d);
        return `<div class="pi pimat ${used.length ? 'busy' : ''}" data-drag="mat" data-id="${esc(t.id)}"><b>${esc(t.naam)}</b><small class="load ${st.cls}" title="${esc(st.txt)}">${esc(st.txt)}</small></div>`;
      }).join('');
    }
    const lbl = {
      klanten: 'Sleep een klant op een uur in het bord voor een nieuwe werkopdracht.',
      medewerkers: 'Sleep op een klus om toe te voegen. Sleep een blok terug naar deze lijst om iemand van de klus te halen. Grijs = al ingepland.',
      materieel: 'Sleep materieel op een klus.', materiaal: 'Bovenaan wat er op deze dag nodig is. Sleep een materiaal op een klus om het toe te voegen.'
    }[ui.pool];
    const tabs = [['medewerkers', 'Mensen', data.mw.length], ['klanten', 'Klanten', data.klanten.length], ['materieel', 'Materieel', data.mat.length], ['materiaal', 'Materiaal', data.artikelen.length]];
    return `<aside class="pool">
      <div class="pool-tabs" role="tablist">${tabs.map(([k, l, n]) => `<button role="tab" data-pool="${k}" aria-selected="${ui.pool === k}">${l}<span class="pn">${n}</span></button>`).join('')}${[['voorraad', 'Voorraad'], ['ploegen', 'Ploegen']].map(([k, l]) => `<button role="tab" data-pool="${k}" aria-selected="false" disabled title="Nog niet beschikbaar">${l}<span class="pn">0</span></button>`).join('')}</div>
      <div class="pool-search"><input id="poolq" type="search" placeholder="${ui.pool === 'klanten' ? 'Zoek klant, sleep naar het bord' : ui.pool === 'medewerkers' ? 'Zoek medewerker of functie' : ui.pool === 'materiaal' ? 'Zoek materiaal' : 'Zoek materieel'}" value="${esc(ui.q)}" aria-label="Zoeken in lijst" title="${esc(lbl)}"><p class="hint">${lbl}</p></div>
      <div class="pool-list">${items || '<div class="empty">Niets gevonden.</div>'}</div>
    </aside>`;
  }

  /* ---------- dagbord ---------- */
  function dagHTML() {
    const d = ui.datum, ks = dagKlussen(d), st = dagStukken(d).filter(inVenster), { mwC, matC, matPair } = conflicten(d);
    const mws = data.mw.filter(m => true);
    const mats = data.mat;
    const isToday = d === vandaag(), now = new Date(), nowH = now.getHours() + now.getMinutes() / 60;
    const totUren = ks.reduce((s, k) => s + k.duur * k.medewerkers.length, 0);
    const ingezet = new Set(ks.flatMap(k => k.medewerkers));
    const nConf = new Set([...mwC, ...matC]).size;
    const openTot = ks.reduce((s, k) => { const v = vulling(k); return s + v.open + v.openMat; }, 0);
    const nWb = ks.reduce((s, k) => s + k.bonnen, 0);
    const hours = Array.from({ length: PBN() }, (_, i) => {
      const h = (i + PBA()) % 24, volg = i + PBA() >= 24;
      return `<span class="${h < 6 || h >= 18 ? 'night' : ''} ${volg ? 'volg' : ''} ${!volg && isToday && h === Math.floor(nowH) ? 'now' : ''}">${volg && h === 0 ? `<b>${esc(DAG[parseD(addDays(d, 1)).getDay()].slice(0, 2))}</b> ` : ''}${pad(h)}</span>`;
    }).join('');
    const nowPos = isToday ? nowH : (ui.nacht && d === addDays(vandaag(), -1) ? 24 + nowH : null);
    const nowL = nowPos != null ? `<div class="nowline" style="left:${nowPos * HW()}px"></div>` : '';
    const toon = ui.toon, dicht = ui.dicht;
    const heeftKlus = (id, mat) => st.some(k => mat ? k.materieel.some(x => x.id === id) : k.medewerkers.includes(id));
    const zichtbaar = (id, mat) => toon === 'alle' || (toon === 'bezet' ? heeftKlus(id, mat) : !heeftKlus(id, mat));
    const mwsZ = mws.filter(m => zichtbaar(m.id, false)), matsZ = mats.filter(t => zichtbaar(t.id, true));
    const rows = dicht.mw ? '' : mwsZ.map(m => {
      const mine = st.filter(k => k.medewerkers.includes(m.id)).map(k => kVoor(k, m.id)), L = lanes(mine);
      const u = mine.reduce((s, k) => s + Math.min(24, k.start + k.duur) - Math.max(0, k.start), 0), stand = mwStand(m, d);
      return `<div class="grow"><div class="rh klik ${stand.cls === 'st-gepland' ? 'busy' : ''}" data-drag="mw" data-id="${esc(m.id)}" title="${esc(m.naam)}${m.functie ? ' · ' + esc(m.functie) : ''} · ${esc(stand.txt)} · sleep op een klus"><b>${esc(m.naam)}</b><small><span class="rhst ${stand.cls}">${esc(stand.txt)}</span>${u > 10 ? `<span class="u over" title="Meer dan 10 uur ingepland op deze dag">⚠ ${uren(u)} u</span>` : ''}</small></div>
        <div class="track" data-drop="mw" data-mw="${esc(m.id)}" style="--lanes:${L.n}">${nowL}${mine.map(k => blokHTML(k, m.id, L.map.get(k.id), mwC.has(k.id), matC.has(k.id), matPair)).join('')}</div></div>`;
    }).join('');
    const actief = new Set(mws.map(m => m.id));
    const los = st.filter(k => !k._vervolg && (!k.medewerkers.some(m => actief.has(m)) || vulling(k).open > 0 || vulling(k).openMat > 0));
    let losRow = '';
    if (los.length) { const L = lanes(los); losRow = `<div class="grow"><div class="rh open"><b>${openTot} open plek${openTot === 1 ? '' : 'ken'}</b><small><span>Sleep naar een medewerker of klik de klus</span></small></div><div class="track" data-drop="mw" data-mw="_none" style="--lanes:${L.n}">${nowL}${los.map(k => blokHTML(k, '_none', L.map.get(k.id), false, matC.has(k.id), matPair)).join('')}</div></div>`; }
    const matRows = dicht.mat ? '' : matsZ.map(t => {
      const mine = st.filter(k => k.materieel.some(x => x.id === t.id)), L = lanes(mine), stand = matStand(t, d);
      return `<div class="grow"><div class="rh klik ${stand.cls === 'st-gepland' ? 'busy' : ''}" data-drag="mat" data-id="${esc(t.id)}" title="${esc(t.naam)}${t.type ? ' · ' + esc(t.type) : ''} · ${esc(stand.txt)} · sleep op een klus"><b>${esc(t.naam)}</b><small><span class="rhst ${stand.cls}">${esc(stand.txt)}</span></small></div>
        <div class="track mat" style="--lanes:${L.n}">${nowL}${mine.map(k => `<div class="blok matb ${matPair.has(t.id) ? 'conflict' : ''}" data-open="${esc(k.id)}" data-drag="matblok" data-id="${esc(k.id)}" data-t="${esc(t.id)}" style="--kc:${esc(k.kleur)};${blokPos(k, 0, 4 + L.map.get(k.id) * MLN())}" title="${esc(k.klant + ' · ' + tijdD(((k.start % 24) + 24) % 24) + '–' + tijdD(k.start + k.duur))}"><b>${esc(k.klant)}</b></div>`).join('')}</div></div>`;
    }).join('');
    const ihItems = []; st.forEach(k => k.inhuur.forEach(x => ihItems.push({ k, x })));
    const ihMens = dicht.mw || !ihItems.length ? '' : `<div class="grow ihkopregel"><div class="rh"><b>Inhuur personeel</b><small><span>${ihItems.length} ${ihItems.length === 1 ? 'kracht' : 'krachten'} ingehuurd</span></small></div><div class="track"></div></div>` + ihItems.map(({ k, x }) =>
      `<div class="grow"><div class="rh"><b><span class="num ihcode">INH</span> ${esc(x.naam)}</b><small><span>${esc([x.rol, x.lev].filter(Boolean).join(' · '))}</span></small></div><div class="track" style="--lanes:1">${nowL}<div class="blok ihblok" data-open="${esc(k.id)}" style="--kc:${esc(k.kleur)};${blokPos(k, 0, 4)}" title="${esc(k.klant)}"><b>${esc(k.klant)}</b><small>${tijdD(((k.start % 24) + 24) % 24)}–${tijdD(k.start + k.duur)}</small><div class="tags"><span class="ihtag">INH</span></div></div></div></div>`).join('');
    const artMap = new Map(); st.forEach(k => (k.order.materialen || []).forEach(x => { const key = x.artikelId || ('vrij:' + (x.omschrijving || '')); if (!artMap.has(key)) artMap.set(key, { x, ks: [] }); if (!artMap.get(key).ks.some(o => o.k.id === k.id)) artMap.get(key).ks.push({ k, n: +x.aantal || 0 }); }));
    const artNaam = r => { const a = data.artikelen.find(z => z.id === r.x.artikelId); return a ? a.naam : (r.x.omschrijving || 'Materiaal'); };
    const artEh = r => { const a = data.artikelen.find(z => z.id === r.x.artikelId); return a ? a.eenheid : (r.x.eenheid || ''); };
    const artRijen = [...artMap.values()].sort((a, b) => artNaam(a).localeCompare(artNaam(b), 'nl'));
    const fmtN = n => String(Math.round(n * 100) / 100).replace('.', ',');
    const artRows = dicht.art ? '' : artRijen.map(r => {
      const L = lanes(r.ks.map(o => o.k)), tot = r.ks.reduce((a, o) => a + o.n, 0);
      return `<div class="grow"><div class="rh"><b>${esc(artNaam(r))}</b><small><span class="num">${fmtN(tot)} ${esc(artEh(r))}</span> totaal</small></div>
        <div class="track mat art" style="--lanes:${L.n}">${nowL}${r.ks.map(({ k, n }) => `<div class="blok matb artb" data-open="${esc(k.id)}" data-drag="artblok" data-id="${esc(k.id)}" data-t="${esc(r.x.artikelId || '')}" style="--kc:${esc(k.kleur)};${blokPos(k, 0, 4 + L.map.get(k.id) * MLN())}" title="${esc(fmtN(n) + ' ' + artEh(r) + ' ' + artNaam(r) + ' · ' + k.klant)}"><b class="num">${fmtN(n)} ${esc(artEh(r))}</b> <span>${esc(k.klant)}</span></div>`).join('')}</div></div>`;
    }).join('');
    const ovzKl = st.slice().sort((a, b) => (a._vervolg ? -1 : 0) - (b._vervolg ? -1 : 0) || a.start - b.start || a.klant.localeCompare(b.klant, 'nl'));
    const ovzRows = dicht.ovz ? '' : ovzKl.map(k => {
      const kk = k._base || k, v = vulling(kk), mwN = kk.medewerkers.length + kk.inhuur.length, mtN = kk.materieel.length;
      const mNod = v.nodig || mwN, tNod = v.nodigMat || mtN, okM = mwN >= mNod, okT = mtN >= tNod, opt = isOptie(kk);
      return `<div class="grow ovz ${opt ? 'ovzoptie' : ''}"><div class="rh klik" data-open="${esc(k.id)}" title="${esc([opt ? optieTekst(kk) : '', kk.order.nummer, kk.klant, kopVan(kk), kk.medewerkers.map(mwNaam).join(', ')].filter(Boolean).join(' · '))}"><b>${kk.order.nummer ? `<span class="wonr">${esc(kk.order.nummer)}</span> ` : ''}${esc(kk.klant)}</b><small><span class="${okM ? 'ok' : 'mis'}">${mwN}/${mNod} mensen</span>${tNod || mtN ? ` · <span class="${okT ? 'ok' : 'mis'}">${mtN}/${tNod} materieel</span>` : ''}${k._vervolg ? ' · vervolg nacht' : ''}</small></div>
        <div class="track ovzt" data-mw="_ovz" style="--lanes:1">${nowL}${blokHTML(k, '_none', 0, false, matC.has(k.id), matPair)}</div></div>`;
    }).join('');
    const sectKop = (key, label, n, totaal, cls) => `<button type="button" class="sect sectknop ${cls || ''}" data-act="pbdicht" data-k="${key}" aria-expanded="${!dicht[key]}"><span class="st"><i class="pijl">${dicht[key] ? '▸' : '▾'}</i>${label}<em>${n}${totaal != null && totaal !== n ? ' van ' + totaal : ''}</em></span></button>`;
    return { ks, ingezet, mws, nConf, openTot, nWb, totUren, isToday, html: `<div class="gridscroll" id="gridscroll">
        <div class="grid ${ui.nacht ? 'pbnacht' : ''}" style="--uren:${PBN()};--mid:${24 - PBA()}">
          <div class="grow hdr"><div class="rh"><div class="toon" role="group" aria-label="Welke rijen tonen">${[['alle', 'Alle'], ['bezet', 'Ingepland'], ['vrij', 'Beschikbaar']].map(([k, l]) => `<button type="button" data-act="pbtoon" data-v="${k}" aria-pressed="${toon === k}">${l}</button>`).join('')}</div></div><div class="hours">${hours}</div></div>
          ${sectKop('ovz', 'Opdrachten vandaag', ovzKl.length)}
          ${dicht.ovz ? '' : (ovzRows || '<div class="empty">Nog geen opdrachten op deze dag. Maak een werkopdracht of sleep een klant naar het bord.</div>')}
          ${sectKop('los', 'Te plannen', los.length, null, los.length ? 'teb' : '')}
          ${dicht.los ? '' : (losRow || `<div class="grow"><div class="rh"><b class="okt">Alles is gepland</b><small><span>Sleep een klant hierheen voor een nieuwe opdracht</span></small></div><div class="track" data-drop="mw" data-mw="_none" style="--lanes:1">${nowL}</div></div>`)}
          ${sectKop('mw', 'Medewerkers', mwsZ.length, mws.length)}
          ${dicht.mw ? '' : (rows || `<div class="empty">${mws.length ? (toon === 'bezet' ? 'Niemand ingepland op deze dag.' : 'Iedereen is ingepland.') : 'Nog geen actieve medewerkers. Voeg ze toe onder Lijsten.'}</div>`)}
          ${dicht.mw ? '' : ihMens}
          ${sectKop('mat', 'Materieel', matsZ.length, mats.length)}
          ${dicht.mat ? '' : (matRows || `<div class="empty">${mats.length ? (toon === 'bezet' ? 'Geen materieel ingepland op deze dag.' : 'Al het materieel is ingepland.') : 'Nog geen materieel. Voeg het toe onder Lijsten.'}</div>`)}
          ${sectKop('art', 'Materiaal', artRijen.length)}
          ${dicht.art ? '' : (artRows || '<div class="empty">Geen materialen op de klussen van deze dag. Sleep ze vanuit Materiaal links op een klus.</div>')}
        </div></div>` };
  }

  /* ---------- weekbord ---------- */
  function weekHTML() {
    const ma = maandag(ui.datum), dagen = Array.from({ length: 7 }, (_, i) => addDays(ma, i)), v = vandaag();
    const perDag = dagen.map(d => dagKlussen(d));
    const chip = (k, mwId) => {
      const opt = isOptie(k), kv = mwId && mwId !== '_none' ? kVoor(k, mwId) : k, st = klusStatus(k);
      return `<div class="blok wkchip ${opt ? 'optie' : ''} ${st !== 'gepland' ? st : ''}" data-drag="blok" data-id="${esc(k.id)}" data-mw="${esc(mwId || '_none')}" style="--kc:${esc(k.kleur)}" title="${esc([opt ? optieTekst(k) : '', k.order.nummer, k.klant, kopVan(k), tijd(((kv.start % 24) + 24) % 24) + '–' + tijdD(kv.start + kv.duur)].filter(Boolean).join(' · '))}"><b>${dienstK(k) === 'nacht' ? '☾ ' : ''}${opt ? '<i class="wkopt">OPTIE</i> ' : ''}${esc(k.klant)}</b>${kopVan(k) ? `<small>${esc(kopVan(k))}</small>` : ''}</div>`;
    };
    const kop = `<div class="wkrij wkkop"><div class="wkrh">Week ${weeknr(ma)}</div>${dagen.map((d, i) => {
      const inz = new Set(perDag[i].flatMap(k => k.medewerkers)).size, open = perDag[i].reduce((s, k) => s + vulling(k).open, 0);
      return `<button class="wkdk ${d === v ? 'vandaag' : ''} ${parseD(d).getDay() % 6 === 0 ? 'weekend' : ''}" data-act="wkdag" data-d="${d}" title="Open ${esc(dagVol(d))} in de dagweergave"><b>${esc(datumKort(d))}</b><small>${inz}/${data.mw.length} ingezet${open ? ` · <em>${open} open</em>` : ''}</small></button>`;
    }).join('')}</div>`;
    const los = dagen.map((d, i) => perDag[i].filter(k => vulling(k).open > 0 || (!k.medewerkers.length && !vulling(k).nodig)));
    const losRij = los.some(x => x.length) ? `<div class="wkrij wklos"><div class="wkrh"><b>Te plannen</b><small>open plekken</small></div>${dagen.map((d, i) => `<div class="wkcel" data-wkd="${d}" data-mw="_none">${los[i].map(k => chip(k, '_none')).join('')}</div>`).join('')}</div>` : '';
    const rij = m => `<div class="wkrij"><div class="wkrh rh klik" data-drag="mw" data-id="${esc(m.id)}" title="${esc(m.naam)} · sleep op een klus"><b>${esc(m.naam)}</b><small>${esc(m.functie || '')}</small></div>${dagen.map((d, i) => {
      const ks = perDag[i].filter(k => k.medewerkers.includes(m.id));
      return `<div class="wkcel ${d < v ? 'verleden' : ''} ${d === v ? 'vandaag' : ''}" ${d < v ? 'style="position:static"' : ''} data-wkd="${d}" data-mw="${esc(m.id)}">${ks.map(k => chip(k, m.id)).join('')}</div>`;
    }).join('')}</div>`;
    const matRij = t => `<div class="wkrij wkmatrij"><div class="wkrh" data-drag="mat" data-id="${esc(t.id)}" title="${esc(t.naam)}"><b>${esc(t.naam)}</b></div>${dagen.map((d, i) => {
      const ks = perDag[i].filter(k => k.materieel.some(x => x.id === t.id));
      return `<div class="wkcel ${d < v ? 'verleden' : ''}" ${d < v ? 'style="position:static"' : ''}>${ks.map(k => `<span class="wkm" title="${esc(k.klant)}">${esc(k.klant)}</span>`).join('')}</div>`;
    }).join('')}</div>`;
    return `<div class="gridscroll wkscroll" id="gridscroll"><div class="wkgrid">${kop}${losRij}<div class="wksect">Medewerkers <em>${data.mw.length}</em></div>${data.mw.map(rij).join('')}<div class="wksect">Materieel <em>${data.mat.length}</em></div>${data.mat.map(matRij).join('')}</div></div>
    <p class="hint wkhint">Klik op een dag voor de dagweergave · sleep mensen of materieel uit de lijst op een klus</p>`;
  }

  /* ---------- pagina ---------- */
  function paginaHTML() {
    const d = ui.datum, dag = ui.week ? null : dagHTML(), isToday = d === vandaag();
    const ks = dagKlussen(d), mws = data.mw;
    const stats = dag || { ks, ingezet: new Set(ks.flatMap(k => k.medewerkers)), mws, nConf: 0, openTot: ks.reduce((s, k) => s + vulling(k).open + vulling(k).openMat, 0), nWb: ks.reduce((s, k) => s + k.bonnen, 0), totUren: ks.reduce((s, k) => s + k.duur * k.medewerkers.length, 0) };
    const weergave = ui.week ? 'week' : ui.nacht ? 'nacht' : 'dag';
    return `<div class="planner">
    ${poolHTML()}
    <section class="board">
      <div class="pbar"><div class="prij1">
        <div class="wknav"><button class="btn" data-act="dag" data-n="-1" aria-label="${ui.week ? 'Vorige week' : 'Vorige dag'}">◀</button><div class="wklbl dagl pbdag">${ui.week ? `<span class="wkchip">Wk ${weeknr(d)}</span> ${esc(datumKort(maandag(d)))} – ${esc(datumKort(addDays(maandag(d), 6)))}` : `<span class="wkchip">Wk ${weeknr(d)}</span> ${esc(langeDatum(d).replace(/ \d{4}$/, '').replace(/^./, c => c.toUpperCase()))}${isToday ? ' <span>vandaag</span>' : d === addDays(vandaag(), 1) ? ' <span>morgen</span>' : ''}`}</div><button class="btn" data-act="dag" data-n="1" aria-label="${ui.week ? 'Volgende week' : 'Volgende dag'}">▶</button></div>
        <button class="btn sm" data-act="vandaag" ${isToday ? 'disabled' : ''}>Vandaag</button><button class="btn sm" data-act="morgen" ${d === addDays(vandaag(), 1) ? 'disabled' : ''}>Morgen</button>
        <label class="datumkies" title="Kies een datum"><span class="sr">Kies datum</span><input type="date" id="datumkies" value="${d}" aria-label="Kies datum"></label>
        ${d < vandaag() ? '<span class="pastchip">Verleden · alleen inzien</span>' : ''}
        <div class="sp"></div>
        <div class="pacties">${ui.week ? '' : `<button class="btn sm dn-knop" data-act="pbnacht" aria-pressed="${ui.nacht}" title="${ui.nacht ? 'Nachtweergave aan: 12:00 tot 12:00 volgende dag. Klik voor dagweergave.' : 'Nachtweergave: toon 12:00 tot 12:00 volgende dag, zodat een nachtklus één blok is'}">☾<span class="lang"> Nacht</span></button>`}${ui.week ? '<span class="wkmodus">▦ Week</span>' : ''}<details class="menu pbmeer"><summary class="btn sm" title="Meer opties">⋯ Meer</summary><div class="menu-pop">
          <button disabled title="Nog niet beschikbaar">Zoeken <small>Klant, werkopdracht, medewerker… · nog niet beschikbaar</small></button>
          <div class="menu-sub"><span>Weergave</span>${[['dag', '☀ Dag'], ['nacht', '☾ Nacht'], ['week', '▦ Week']].map(([z, l]) => `<button data-act="pbweergave" data-v="${z}" aria-pressed="${weergave === z}">${l}</button>`).join('')}</div>
          <div class="menu-sub"><span>Hoogte rijen</span>${[[0, 'Ruim'], [1, 'Compact']].map(([z, l]) => `<button data-act="compact" data-v="${z}" aria-pressed="${!!ui.compact === !!z}">${l}</button>`).join('')}</div>
          <div class="menu-sub"><span>Breedte uren</span>${[[40, 'Smal'], [56, 'Normaal'], [80, 'Breed']].map(([z, l]) => `<button data-zoom="${z}" aria-pressed="${ui.zoom === z}">${l}</button>`).join('')}</div>
          <button data-act="uitleg">${ui.uitleg ? 'Uitleg verbergen' : 'Hoe werkt het planbord'} <small>Korte uitleg onder het planbord</small></button>
        </div></details>
        ${ctx.canEdit ? '<button class="btn primary nieuwwo" data-act="nieuwwerk" title="Nieuwe werkopdracht">+ Nieuwe <span class="lang">werkopdracht</span><span class="kort">WO</span></button>' : ''}
        </div></div><div class="prij2"><div class="pstats">
          <span><b>${stats.ks.length}</b>klus${stats.ks.length === 1 ? '' : 'sen'}</span>
          <span><b>${stats.ingezet.size}/${stats.mws.length}</b>ingezet</span>
          <span><b>${uren(stats.totUren)}</b>manuren</span>
          <span class="${stats.openTot ? 'bad' : ''}"><b>${stats.openTot}</b>open plek${stats.openTot === 1 ? '' : 'ken'}</span>
          <span class="${stats.nConf ? 'bad' : ''}"><b>${stats.nConf}</b>conflict${stats.nConf === 1 ? '' : 'en'}</span>
          <button type="button" class="pstat-wb" data-act="toonwb" title="Naar de werkbonnen van deze dag"><b>${stats.nWb}</b>werkbon${stats.nWb === 1 ? '' : 'nen'}</button>
        </div><div class="pacties">
          <button type="button" class="memoknop" disabled title="Memo's zijn nog niet beschikbaar">📝 Memo <b>0</b></button>
          <button class="ocknop leeg" disabled title="De dagcheck is nog niet beschikbaar">✓ Dagcheck <b>–</b></button>
          <button class="btn vaknop" disabled title="Automatisch invullen is nog niet beschikbaar">⚡ Vul aan</button>
        </div></div>
      </div>
      ${ui.fout ? `<p class="foutmelding" role="alert">${esc(ui.fout)}</p>` : ''}
      ${ui.week ? weekHTML() : dag.html}
      <div class="pfoot"><button class="btn link" data-act="uitleg" aria-expanded="${!!ui.uitleg}">${ui.uitleg ? 'Uitleg verbergen' : '? Hoe werkt het planbord'}</button></div>
      ${ui.uitleg ? `<div class="uitleg">
        <span><b>Werkopdracht</b> met de behoefte van de klant komt bij <b>Te plannen</b>.</span>
        <span>Sleep een <b>klant</b> op een uur om een nieuwe werkopdracht te starten.</span>
        <span>Sleep een <b>medewerker</b> of <b>materieel</b> op een klus om te koppelen.</span>
        <span>Sleep een klus naar een ander uur in <b>Opdrachten vandaag</b>; trek de <b>rechterrand</b> voor de duur.</span>
        <span>Een blok loopt van vertrek tot terugkomst bij VSVK (reistijd inbegrepen). Rode stippellijn = dubbel geboekt. ☾ = nachtdienst.</span>
        <span>Klik op een klus voor de snelle kaart; klik opnieuw of kies <b>Werkopdracht openen</b> om alles te wijzigen.</span>
      </div>` : ''}
    </section></div>`;
  }

  /* ---------- kaarten: hover en klik ---------- */
  function hkHTML(k) {
    const v = vulling(k), regel = (ok, l, r) => `<div class="hkr ${ok ? 'ok' : 'mis'}"><span class="hki">${ok ? '✓' : '!'}</span><span class="hkl">${l}</span><span class="hkw">${r}</span></div>`;
    const mens = k.medewerkers.map(m => regel(true, esc((data.mw.find(x => x.id === m) || {}).functie || 'Medewerker'), `<b>${esc(mwNaam(m))}</b>`)).join('') +
      k.inhuur.map(x => regel(true, esc(x.rol || 'Inhuur'), `<b>${esc(x.naam)}</b>`)).join('') + (v.open ? regel(false, 'Mens', `<em>nog ${v.open} nodig</em>`) : '');
    const mat = k.materieel.map(x => regel(true, 'Materieel', `<b>${esc(x.naam)}</b>`)).join('') + (v.openMat ? regel(false, 'Materieel', `<em>nog ${v.openMat} nodig</em>`) : '');
    const adres = [k.order.werkadres, k.order.werkPlaats].filter(Boolean).join(', ');
    return `<div class="hkkop" style="--kc:${esc(k.kleur)}">${k.order.nummer ? `<span class="wonr">${esc(k.order.nummer)}</span>` : ''}<b>${esc(k.klant)}</b>${kopVan(k) ? `<small>${esc(kopVan(k))}</small>` : ''}</div>
      ${isOptie(k) ? `<div class="hkoptie ${optieVerlopen(k) ? 'oud' : ''}"><b>${optieVerlopen(k) ? 'Optie verlopen' : 'Optie · nog niet bevestigd'}</b><small>${esc(optieTekst(k))}</small></div>` : ''}
      <div class="hktijd">Vertrek <b>${tijdD(k.start)}</b> · op locatie <b>${tijd(k.aanwezig % 24)}–${tijdD(k.eindLoc)}</b>${adres ? `<br>📍 ${esc(adres)}` : ''}</div>
      ${mat ? `<div class="hksec"><h4>Materieel${v.nodigMat ? ` <em class="${v.openMat ? 'mis' : 'ok'}">${v.nodigMat - v.openMat}/${v.nodigMat}</em>` : ''}</h4>${mat}</div>` : ''}
      ${mens ? `<div class="hksec"><h4>Mensen${v.nodig ? ` <em class="${v.open ? 'mis' : 'ok'}">${v.nodig - v.open}/${v.nodig}</em>` : ''}</h4>${mens}</div>` : ''}`;
  }
  function hoverKaart(el) {
    const k = data.klussen.find(x => x.id === (el && el.dataset.id)); const hk = ctx.container.querySelector('#hkaart');
    if (!k || !hk || !el.dataset.drag || el.dataset.drag !== 'blok') return;
    hk.innerHTML = hkHTML(k); hk.hidden = false;
    const r = el.getBoundingClientRect(), W = hk.offsetWidth, H = hk.offsetHeight;
    hk.style.left = Math.min(Math.max(8, r.left), window.innerWidth - W - 8) + 'px';
    hk.style.top = (r.bottom + 6 + H > window.innerHeight - 8 ? Math.max(8, r.top - H - 6) : r.bottom + 6) + 'px';
  }
  function verbergHover() { clearTimeout(hoverT); const hk = ctx && ctx.container.querySelector('#hkaart'); if (hk) hk.hidden = true; }

  function snelHTML(k) {
    const v = vulling(k), kan = ctx.canEdit && klusStatus(k) !== 'voorbij';
    const aant = m => k.materieel.filter(x => x.mw === m).length;
    const chip = m => `<span class="mwchip ${ui.pick === m ? 'pick-on' : ''} ${m === ui.snelMw ? 'mijn' : ''}" ${kan ? 'draggable="true"' : ''} data-skchip="${esc(m)}" role="button" tabindex="0" title="Sleep op een materieelstuk, of klik de naam en daarna het stuk"><i class="grip">⋮⋮</i>${esc(mwNaam(m))}${aant(m) ? `<small>${aant(m)}</small>` : ''}</span>`;
    const rijen = k.materieel.map(x => `<div class="skrow"><span class="skmat"><b>${esc(x.naam)}</b></span><div class="matzone ${x.mw ? 'vol' : ''} ${ui.pick ? 'wacht' : ''}" ${kan ? `data-skzone="${esc(x.id)}" role="button" tabindex="0"` : ''} aria-label="Medewerker voor ${esc(x.naam)}">${x.mw ? `<span class="mwchip in" ${kan ? 'draggable="true"' : ''} data-skchip="${esc(x.mw)}">${esc(mwNaam(x.mw))}${kan ? `<button type="button" class="x" data-sklos="${esc(x.id)}" aria-label="Loskoppelen">✕</button>` : ''}</span>` : `<span class="leegz">${ui.pick ? 'klik om ' + esc(mwNaam(ui.pick).split(' ')[0]) + ' te koppelen' : 'sleep medewerker hierheen'}</span>`}</div></div>`).join('');
    const nog = [v.open ? v.open + '× mens' : '', v.openMat ? v.openMat + '× materieel' : ''].filter(Boolean);
    return `${isOptie(k) ? `<div class="skoptie ${optieVerlopen(k) ? 'oud' : ''}">${esc(optieTekst(k))}</div>` : ''}<div class="skkop"><div class="skwie">${k.order.nummer ? `<span class="wonr">${esc(k.order.nummer)}</span> ` : ''}<b>${esc(k.klant)}</b><small>${esc([kopVan(k), tijd(k.aanwezig % 24) + '–' + tijdD(k.eindLoc)].filter(Boolean).join(' · '))}</small></div><button type="button" class="btn ghost sm" data-sk="sluit" aria-label="Sluiten">✕</button></div>
      <div class="skbody">
        ${v.nodig || v.nodigMat ? `<div class="sktel"><span class="${v.open ? 'mis' : 'ok'}">P ${v.nodig - v.open}/${v.nodig}</span><span class="${v.openMat ? 'mis' : 'ok'}">M ${v.nodigMat - v.openMat}/${v.nodigMat}</span>${nog.length ? `<em>nog nodig: ${esc(nog.join(', '))}</em>` : ''}</div>` : ''}
        <h4>Ploeg</h4><div class="skploeg">${k.medewerkers.map(chip).join('') + k.inhuur.map(x => `<span class="mwchip"><i class="grip">INH</i>${esc(x.naam)}</span>`).join('') || '<span class="hint">Nog niemand ingepland</span>'}</div>
        <h4>Koppel medewerker aan materieel</h4>${rijen || '<p class="hint" style="margin:0">Geen materieel op deze klus.</p>'}
      </div>
      <div class="skfoot"><span class="hint">Nog een keer klikken op de klus = alles wijzigen</span>${ctx.canEdit && isOptie(k) ? `<button type="button" class="btn sm primary" data-sk="bevestig" title="${esc(optieTekst(k))}">✓ Optie definitief maken</button>` : ''}<button type="button" class="btn sm" data-sk="open">Klus openen</button></div>`;
  }
  function openSnel(id, el) {
    const k = data.klussen.find(x => x.id === id); const sk = ctx.container.querySelector('#snelkaart'); if (!k || !sk) return;
    verbergHover(); if (ui.snel !== id) ui.pick = null; ui.snel = id; ui.sel = id;
    { const tr = el && el.closest && el.closest('.track'); const mw = tr && tr.dataset.mw; ui.snelMw = mw && mw !== '_none' && mw !== '_ovz' ? mw : (ui.snelMw || null); }
    sk.innerHTML = snelHTML(k); sk.hidden = false;
    const r = (el && el.isConnected ? el : ctx.container.querySelector(`.blok[data-id="${CSS.escape(id)}"]`))?.getBoundingClientRect() || { left: 200, top: 200, bottom: 240 };
    const W = sk.offsetWidth, H = sk.offsetHeight; let top = r.bottom + 6; if (top + H > window.innerHeight - 8) top = Math.max(8, r.top - H - 6);
    sk.style.left = Math.min(Math.max(8, r.left + 16), window.innerWidth - W - 8) + 'px'; sk.style.top = top + 'px';
    ctx.container.querySelectorAll('.blok.sel').forEach(b => b.classList.remove('sel'));
    ctx.container.querySelectorAll(`.blok[data-id="${CSS.escape(id)}"]`).forEach(b => b.classList.add('sel'));
  }
  function sluitSnel() { ui.pick = null; ui.snelMw = null; const sk = ctx && ctx.container.querySelector('#snelkaart'); ui.snel = null; ui.sel = null; if (sk) { sk.hidden = true; sk.innerHTML = ''; } ctx && ctx.container.querySelectorAll('.blok.sel').forEach(b => b.classList.remove('sel')); }

  /* ---------- tekenen ---------- */
  function render() {
    if (!ctx) return;
    const actief = document.activeElement, id = actief && actief.id && ctx.container.contains(actief) ? actief.id : '';
    const gs = ctx.container.querySelector('#gridscroll'), sl = gs ? gs.scrollLeft : null, st = gs ? gs.scrollTop : null;
    const poolList = ctx.container.querySelector('.pool-list'), pst = poolList ? poolList.scrollTop : 0;
    ctx.container.style.setProperty('--hw', HW() + 'px'); ctx.container.style.setProperty('--lane', LN() + 'px'); ctx.container.style.setProperty('--mlane', MLN() + 'px');
    ctx.container.innerHTML = `<div class="${ui.compact ? 'compact' : ''}">${paginaHTML()}<div id="hkaart" role="tooltip" hidden></div><div id="snelkaart" role="dialog" aria-label="Klus snel koppelen" hidden></div></div>`;
    const g2 = ctx.container.querySelector('#gridscroll');
    if (g2) { g2.scrollLeft = sl != null ? sl : (ui.week ? 0 : Math.max(0, (6 - PBA()) * HW() - 10)); if (st != null) g2.scrollTop = st; }
    const p2 = ctx.container.querySelector('.pool-list'); if (p2) p2.scrollTop = pst;
    if (id) { const n = document.getElementById(id); if (n) { n.focus({ preventScroll: true }); try { if (n.setSelectionRange) n.setSelectionRange(n.value.length, n.value.length); } catch { /* geen selectie */ } } }
    if (ui.snel) openSnel(ui.snel, null);
  }

  /* ---------- slepen ---------- */
  function ghostTekst(dr) {
    if (dr.type === 'klant') return (data.klanten.find(k => k.id == dr.id) || {}).naam || '';
    if (dr.type === 'mw') return mwNaam(dr.id);
    if (dr.type === 'mat') return matNaam(dr.id);
    if (dr.type === 'art') return (data.artikelen.find(a => a.id === dr.id) || {}).naam || '';
    return '';
  }
  function dropTip(e, tekst, ok) {
    let t = document.getElementById('droptip');
    if (!tekst) { if (t) t.remove(); if (drag && drag.ghost) drag.ghost.classList.remove('ok', 'nee'); return; }
    if (!t) { t = document.createElement('div'); t.id = 'droptip'; t.setAttribute('role', 'status'); ctx.container.appendChild(t); }
    t.className = ok ? 'ok' : 'nee'; t.textContent = (ok ? '✓ Laat los: ' : '✕ ') + tekst;
    t.style.left = Math.min(e.clientX + 16, window.innerWidth - t.offsetWidth - 8) + 'px'; t.style.top = (e.clientY + 34) + 'px';
    if (drag && drag.ghost) { drag.ghost.classList.toggle('ok', !!ok); drag.ghost.classList.toggle('nee', !ok); }
  }
  function wisHover() {
    ctx.container.querySelectorAll('.blok.target').forEach(x => x.classList.remove('target'));
    ctx.container.querySelectorAll('.grow.drophover').forEach(r => r.classList.remove('drophover'));
    ctx.container.querySelectorAll('.pool.dropzone').forEach(p => p.classList.remove('dropzone'));
    ctx.container.querySelectorAll('.track.hover,.track.hovernee').forEach(t => t.classList.remove('hover', 'hovernee'));
    ctx.container.querySelectorAll('.slot').forEach(s => s.remove());
  }
  function beginSleep() {
    drag.started = true; document.body.classList.add('dragging'); verbergHover();
    if (drag.type === 'resize') { drag.k = data.klussen.find(x => x.id === drag.id); return; }
    let g;
    if (['blok', 'matblok', 'artblok'].includes(drag.type)) { g = drag.el.cloneNode(true); g.style.position = 'fixed'; g.style.left = ''; g.style.top = ''; g.style.width = drag.el.offsetWidth + 'px'; g.classList.add('dragghost'); drag.el.classList.add('dim'); drag.k = data.klussen.find(x => x.id === drag.id); }
    else { g = document.createElement('div'); g.className = 'dragghost chipg'; g.textContent = ghostTekst(drag); }
    ctx.container.appendChild(g); drag.ghost = g;
  }
  function beweeg(e) {
    if (drag.type === 'resize') {
      const k = drag.k, r = drag.el.getBoundingClientRect(), dur = Math.max(.5, Math.min(PBE() - k.start, snap((e.clientX - r.left) / HW())));
      drag.newDur = dur; drag.el.style.width = (dur * HW() - 3) + 'px'; return;
    }
    const g = drag.ghost;
    if (drag.type === 'blok') { g.style.left = (e.clientX - drag.grabX) + 'px'; g.style.top = (e.clientY - 14) + 'px'; } else { g.style.left = (e.clientX + 12) + 'px'; g.style.top = (e.clientY + 8) + 'px'; }
    wisHover();
    const t = document.elementFromPoint(e.clientX, e.clientY); drag.target = null; if (!t) return dropTip(e, '');
    const blok = t.closest('.blok[data-drag="blok"]'), track = t.closest('.track[data-mw]'), poolEl = t.closest('.pool');
    const wat = ghostTekst(drag) || 'item';
    if (drag.type === 'blok' && poolEl && drag.from && drag.from !== '_none' && drag.from !== '_ovz') { poolEl.classList.add('dropzone'); drag.target = { kind: 'pool' }; return dropTip(e, mwNaam(drag.from) + ' van deze klus halen', ctx.canEdit); }
    if (drag.type === 'matblok' || drag.type === 'artblok') { if (poolEl) { poolEl.classList.add('dropzone'); drag.target = { kind: 'pool' }; return dropTip(e, 'van de klus halen', ctx.canEdit); } return dropTip(e, 'Sleep naar de lijst links om van de klus te halen', false); }
    if (['mw', 'mat', 'art'].includes(drag.type) && blok) {
      blok.classList.add('target'); const row = blok.closest('.grow'); if (row) row.classList.add('drophover');
      drag.target = { kind: 'blok', id: blok.dataset.id, mw: blok.dataset.mw }; const k = data.klussen.find(x => x.id === blok.dataset.id) || {};
      return dropTip(e, wat + ' → ' + [(k.order || {}).nummer, k.klant].filter(Boolean).join(' · '), ctx.canEdit);
    }
    if (drag.type === 'klant' && track) {
      const tr = track.getBoundingClientRect(), h = Math.max(PBA(), Math.min(23, Math.floor((e.clientX - tr.left) / HW()) + PBA())), past = absMs(ui.datum, h) < Date.now();
      track.classList.add(past ? 'hovernee' : 'hover');
      const s = document.createElement('div'); s.className = 'slot' + (past ? ' nee' : ''); s.style.left = (h * HW() + 1) + 'px'; s.style.width = (4 * HW() - 3) + 'px'; s.style.top = '4px';
      s.textContent = past ? 'Kan niet: dit tijdstip is voorbij' : tijd(h) + '–' + tijdD(h + 4); track.appendChild(s);
      drag.target = { kind: 'track', h }; return dropTip(e, past ? 'dit tijdstip is voorbij' : 'nieuwe werkopdracht voor ' + wat + ' · ' + tijd(h), !past && ctx.canEdit);
    }
    if (drag.type === 'blok' && track && track.dataset.mw === '_ovz' && drag.from === '_none' && drag.el.closest('.track') === track) {
      const tr = track.getBoundingClientRect(), x = e.clientX - tr.left - drag.grabX, h = Math.max(PBA(), Math.min(23.75, snap(x / HW()) + PBA()));
      const k = drag.k, past = absMs(ui.datum, h) < Date.now();
      track.classList.add(past ? 'hovernee' : 'hover');
      const s = document.createElement('div'); s.className = 'slot' + (past ? ' nee' : ''); s.style.left = (h * HW() + 1) + 'px'; s.style.width = (Math.min(k.duur, PBE() - h) * HW() - 3) + 'px'; s.style.top = '4px';
      s.textContent = past ? 'Kan niet: dit tijdstip is voorbij' : tijd(h) + '–' + tijdD(Math.min(PBE(), h + k.duur)); track.appendChild(s);
      drag.target = { kind: 'verplaats', h }; return dropTip(e, past ? 'dit tijdstip is voorbij' : 'verplaatsen naar ' + tijd(h), !past && ctx.canEdit);
    }
    dropTip(e, ['mw', 'mat', 'art'].includes(drag.type) ? 'Sleep ' + wat + ' op een klus' : drag.type === 'blok' ? 'Sleep naar de lijst links of in Opdrachten vandaag' : 'Sleep naar een rij in het planbord', false);
  }
  function eindSleep(e, commit) {
    const d = drag; dropTip(e, ''); drag = null; document.body.classList.remove('dragging'); wisHover();
    if (d.ghost) d.ghost.remove(); if (d.el) d.el.classList.remove('dim');
    if (commit && ctx.canEdit) {
      const k = d.k;
      if (d.type === 'resize' && d.newDur != null && k) { zetTijden(k, k.start, Math.max(d.newDur, k.rh + k.rt + .25)); return; }
      const t = d.target; if (!t) return;
      if (t.kind === 'pool') { if (d.type === 'blok') haalMens(k, d.from); else if (d.type === 'matblok') haalMat(k, d.t); else if (d.type === 'artblok') haalMateriaal(k, d.t); return; }
      if (t.kind === 'blok') { const doel = data.klussen.find(x => x.id === t.id); if (!doel) return; if (d.type === 'mw') plaatsMens(doel, d.id); else if (d.type === 'mat') plaatsMat(doel, d.id, t.mw); else if (d.type === 'art') plaatsMateriaal(doel, d.id); return; }
      if (t.kind === 'track' && d.type === 'klant') { ctx.navigate('Werkopdrachten', { nieuw: { van: ui.datum, klantId: d.id, aanwezig: t.h } }); return; }
      if (t.kind === 'verplaats' && k) zetTijden(k, t.h, k.duur);
    } else if (commit && !ctx.canEdit) toast('Je hebt geen rechten om de planning te wijzigen.', true);
  }

  /* ---------- acties ---------- */
  function zetDatum(d, herlaad = true) { ui.datum = d; sluitSnel(); if (herlaad) laad(); else render(); }
  function klik(b) {
    const d = b.dataset, a = d.act;
    if (d.pool) { ui.pool = d.pool; ui.q = ''; bewaar('vsvk-pb-pool', ui.pool); render(); return true; }
    if (d.zoom) { ui.zoom = +d.zoom; bewaar('vsvk-pb-zoom', ui.zoom); render(); return true; }
    if (d.sk === 'sluit') { sluitSnel(); return true; }
    if (d.sk === 'open') { const k = data.klussen.find(x => x.id === ui.snel); if (k) ctx.navigate('Werkopdrachten', { edit: k.werkId }); return true; }
    if (d.sk === 'bevestig') { const k = data.klussen.find(x => x.id === ui.snel); if (k) { sluitSnel(); bevestigOptie(k); } return true; }
    if (d.sklos) { const k = data.klussen.find(x => x.id === ui.snel); if (k) koppelBediener(k, d.sklos, null); return true; }
    if (d.skzone) { const k = data.klussen.find(x => x.id === ui.snel); if (k && ui.pick) { const mw = ui.pick; ui.pick = null; koppelBediener(k, d.skzone, mw); } return true; }
    if (d.skchip) { ui.pick = ui.pick === d.skchip ? null : d.skchip; const k = data.klussen.find(x => x.id === ui.snel); const sk = ctx.container.querySelector('#snelkaart'); if (k && sk) { sk.innerHTML = snelHTML(k); } return true; }
    if (!a) return false;
    if (a === 'dag') { const n = +d.n; zetDatum(addDays(ui.datum, ui.week ? 7 * n : n)); return true; }
    if (a === 'vandaag') { zetDatum(vandaag()); return true; }
    if (a === 'morgen') { zetDatum(addDays(vandaag(), 1)); return true; }
    if (a === 'wkdag') { ui.week = false; zetDatum(d.d); return true; }
    if (a === 'pbnacht') { ui.nacht = !ui.nacht; render(); return true; }
    if (a === 'pbweergave') { ui.week = d.v === 'week'; ui.nacht = d.v === 'nacht'; sluitSnel(); laad(); return true; }
    if (a === 'compact') { ui.compact = d.v === '1'; bewaar('vsvk-pb-compact', ui.compact); render(); return true; }
    if (a === 'uitleg') { ui.uitleg = !ui.uitleg; render(); return true; }
    if (a === 'pbtoon') { ui.toon = d.v; render(); return true; }
    if (a === 'pbdicht') { ui.dicht = { ...ui.dicht, [d.k]: !ui.dicht[d.k] }; render(); return true; }
    if (a === 'nieuwwerk') { ctx.navigate('Werkopdrachten', { nieuw: { van: ui.datum } }); return true; }
    if (a === 'toonwb') { ctx.navigate('Werkbonnen'); return true; }
    return false;
  }

  /* ---------- koppelen aan de pagina ---------- */
  function koppel(container) {
    if (gekoppeld === container) return;
    gekoppeld = container;
    container.addEventListener('click', e => {
      if (drag && drag.started) return;
      const knop = e.target.closest ? e.target.closest('[data-act],[data-pool],[data-zoom],[data-sk],[data-sklos],[data-skzone],[data-skchip]') : null;
      if (knop && !knop.disabled && container.contains(knop)) { if (klik(knop)) e.preventDefault(); return; }
      const open = e.target.closest ? e.target.closest('[data-open]') : null;
      if (open && container.contains(open)) { const k = data.klussen.find(x => x.id === open.dataset.open); if (k) ctx.navigate('Werkopdrachten', { edit: k.werkId }); return; }
      if (ui.snel && !(e.target.closest && e.target.closest('#snelkaart,.blok'))) sluitSnel();
    });
    container.addEventListener('input', e => { if (e.target && e.target.id === 'poolq') { ui.q = e.target.value; const p = container.querySelector('.pool'); if (p) { const tmp = document.createElement('div'); tmp.innerHTML = poolHTML(); const l = tmp.querySelector('.pool-list'), o = container.querySelector('.pool-list'); if (l && o) o.replaceWith(l); } } });
    container.addEventListener('change', e => { if (e.target && e.target.id === 'datumkies' && e.target.value) zetDatum(e.target.value); });
    container.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const rz = e.target.closest('[data-resize]'), el = rz || e.target.closest('[data-drag]');
      if (!el || !container.contains(el)) return;
      const blokEl = el.closest('.blok');
      drag = { type: rz ? 'resize' : el.dataset.drag, id: el.dataset.id, t: el.dataset.t, from: blokEl ? blokEl.dataset.mw : null, el: blokEl || el, x0: e.clientX, y0: e.clientY, started: false };
      if (blokEl) { const r = blokEl.getBoundingClientRect(); drag.grabX = e.clientX - r.left; }
      if (!['klant', 'mw', 'mat', 'art'].includes(drag.type)) e.preventDefault();
    });
    container.addEventListener('dragstart', e => { const c = e.target.closest ? e.target.closest('[data-skchip]') : null; if (c && e.dataTransfer) { e.dataTransfer.setData('text/plain', c.dataset.skchip); e.dataTransfer.effectAllowed = 'move'; ui.pick = null; } });
    container.addEventListener('dragover', e => { const z = e.target.closest ? e.target.closest('[data-skzone]') : null; if (z) { e.preventDefault(); z.classList.add('over'); } });
    container.addEventListener('dragleave', e => { const z = e.target.closest ? e.target.closest('[data-skzone]') : null; if (z) z.classList.remove('over'); });
    container.addEventListener('drop', e => { const z = e.target.closest ? e.target.closest('[data-skzone]') : null; if (!z) return; e.preventDefault(); const mw = e.dataTransfer && e.dataTransfer.getData('text/plain'), k = data.klussen.find(x => x.id === ui.snel); if (k && mw) koppelBediener(k, z.dataset.skzone, mw); });
    container.addEventListener('mouseover', e => {
      const b = e.target.closest ? e.target.closest('.blok[data-drag="blok"]') : null;
      if (!b || drag || ui.snel) return; clearTimeout(hoverT); hoverT = setTimeout(() => hoverKaart(b), 350);
    });
    container.addEventListener('mouseout', e => { const b = e.target.closest ? e.target.closest('.blok[data-drag="blok"]') : null; if (b) verbergHover(); });
    document.addEventListener('pointermove', e => {
      if (!drag) return;
      if (!drag.started) {
        if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
        if (!ctx.canEdit) { toast('Je hebt geen rechten om de planning te wijzigen.', true); drag = null; return; }
        const k = data.klussen.find(x => x.id === drag.id), st = k ? klusStatus(k) : '';
        if ((drag.type === 'resize' || drag.type === 'blok') && (st === 'voorbij' || (st === 'bezig' && drag.type === 'blok' && drag.from === '_none'))) { toast(st === 'voorbij' ? 'Deze klus is voorbij en kan niet meer verschuiven.' : 'Deze klus is al begonnen; de starttijd ligt vast.', true); drag = null; return; }
        beginSleep();
      }
      beweeg(e);
    });
    document.addEventListener('pointerup', e => {
      if (!drag) return; const d = drag;
      if (!d.started) { drag = null; if (d.type === 'blok') { if (ui.snel === d.id) { const k = data.klussen.find(x => x.id === d.id); if (k) ctx.navigate('Werkopdrachten', { edit: k.werkId }); } else openSnel(d.id, d.el); } return; }
      eindSleep(e, true);
    });
    document.addEventListener('pointercancel', () => { if (drag && drag.started) eindSleep(null, false); drag = null; });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { if (drag && drag.started) eindSleep(null, false); else if (ui.snel) sluitSnel(); }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-skchip],[data-skzone]') && ctx.container.contains(e.target)) { e.preventDefault(); klik(e.target); }
    });
  }

  async function open(config) {
    ctx = { container: config.container, request: config.request, canEdit: (await config.canEdit) === true, navigate: config.navigate || (() => {}) };
    ctx.container.classList.add('pb-scope');
    koppel(ctx.container);
    ui.datum = config.date || ui.datum || vandaag(); ui.snel = null; ui.sel = null; ui.q = '';
    if (config.date) ui.week = false;
    render();
    await laad();
  }

  window.VsvkPlanbord = {
    open,
    model: { ts, apiTijd, maakKlussen, vulling, lanes, conflicten, dagStukken, kVoor, klusStatus, data }
  };
}());
