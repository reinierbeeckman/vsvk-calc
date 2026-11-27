(function () {
  'use strict';

  /*
   * Werkbonnen: onderdeel 1 (Maken & printen) en 2 (Binnen & digitaliseren), 1-op-1 naar het klantontwerp
   * (VSVK Planning prototype). Opmaak en markup komen uit het prototype; de CSS wordt daaruit gegenereerd
   * (scripts/extract-prototype-css.js) en geldt alleen binnen #werkbonnen-scherm.
   *
   * Koppeling met de database (alleen bestaande API):
   *   lijst       GET  /api/planning/werkbonnen                    alle werkbonnen met medewerker, klant, tijden
   *   te maken    GET  /api/planning/planbord?from&to              inzetten zonder werkbon
   *   wijzigen    GET + PUT /api/planning/werkopdrachten/{id} met If-Match (nieuwe bon, status, vervallen)
   * Bij 412 wordt het scherm ververst en blijft er niets half opgeslagen; er wordt nooit automatisch herhaald.
   * Onderdeel 3 t/m 6 worden in een volgende stap overgenomen en tonen voorlopig de bonnen die binnen zijn.
   */

  const DAG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  const MAAND = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const STATUS = ['Aangemaakt', 'Uitgereikt', 'Retour', 'Verwerkt', 'Vervallen'];
  const WBLBL = { Aangemaakt: 'niet geprint', Uitgereikt: 'uitgereikt', Retour: '✓ binnen', Verwerkt: '✓✓ verwerkt', Vervallen: 'vervallen' };
  const GRENS = 18; /* dag D = vertrek van D-1 18:00 t/m D 18:00 */
  const API_STATUS = { Aangemaakt: 'aangemaakt', Uitgereikt: 'uitgereikt', Retour: 'retour', Verwerkt: 'verwerkt', Vervallen: 'vervallen' };
  const UI_STATUS = { niet_geprint: 'Aangemaakt', aangemaakt: 'Aangemaakt', uitgereikt: 'Uitgereikt', retour: 'Retour', binnen: 'Retour', verwerkt: 'Verwerkt', vervallen: 'Vervallen' };

  /* ---------- helpers ---------- */
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseD = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return iso(d); };
  const vandaag = () => iso(new Date());
  const isWeekend = s => [0, 6].includes(parseD(s).getDay());
  const maandag = s => addDays(s, -((parseD(s).getDay() + 6) % 7));
  const plannerDag = d => { let x = d; while (isWeekend(x)) x = addDays(x, 1); return x; };
  function weeknr(s) {
    const d = parseD(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const w1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
  }
  const datumKort = s => { const x = parseD(s); return DAG[x.getDay()].slice(0, 2) + ' ' + x.getDate() + ' ' + MAAND[x.getMonth()].slice(0, 3); };
  const dagVol = s => DAG[parseD(s).getDay()] + ' ' + parseD(s).getDate() + ' ' + MAAND[parseD(s).getMonth()];
  const langeDatum = s => { const d = parseD(s); return DAG[d.getDay()] + ' ' + d.getDate() + ' ' + MAAND[d.getMonth()] + ' ' + d.getFullYear(); };
  const korteDatum = s => { if (!s) return ''; const d = parseD(s); return pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + d.getFullYear(); };
  const tijd = x => { const m = Math.round(x * 60); return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60); };
  const tijdD = x => tijd(((x % 24) + 24) % 24) + (x >= 24 - 1e-9 ? ' +1' : x < -1e-9 ? ' −1' : '');
  const uurNu = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; };
  const werkdagenTussen = (a, b) => { let n = 0, x = a; while (x < b) { x = addDays(x, 1); if (!isWeekend(x)) n++; } return n; };
  /* '07:30:00' → 7.5 ; TimeSpan '00:45:00' of '0.00:45:00' → 0.75 */
  const uur = t => { if (!t) return null; const m = /^(?:(\d+)\.)?(\d{1,2}):(\d{2})/.exec(String(t)); return m ? (+m[1] || 0) * 24 + +m[2] + +m[3] / 60 : null; };
  const nl = (a, b) => String(a || '').localeCompare(String(b || ''), 'nl');
  const al = x => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  /* ---------- toestand ---------- */
  const ui = {
    view: 'alle', dag: null, filter: { status: '', mw: '', q: '' }, sel: new Set(), printSel: new Set(), printSelDag: '',
    scanLog: [], busy: false, modal: null, fout: '', loading: false
  };
  const data = { slips: [], nieuw: [], orders: new Map() };
  let ctx = null, loadSeq = 0, toastTimer = null;

  function toast(tekst, slecht) {
    let node = document.getElementById('wb-toast');
    if (!node) { node = document.createElement('div'); node.id = 'wb-toast'; node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite'); document.body.appendChild(node); }
    node.textContent = tekst; node.className = 'board-toast show' + (slecht ? ' bad' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.className = 'board-toast'; }, 4500);
  }

  /* ---------- dagkeuze (gedeeld door onderdeel 1 en 2, blijft staan tot je hem zelf verandert) ---------- */
  function standaardDag() { return uurNu() < 12 ? vandaag() : addDays(vandaag(), 1); }
  function dagStand() {
    if (ui.dag == null) {
      let v = null;
      try { const o = JSON.parse(localStorage.getItem('vsvk-wbdag') || 'null'); if (o && o.v && Math.abs((parseD(o.v === 'alle' ? vandaag() : o.v) - parseD(vandaag())) / 864e5) <= 21) v = o.v; } catch { /* geen opslag */ }
      ui.dag = v || standaardDag();
    }
    return ui.dag;
  }
  function dagZet(v) { ui.dag = v; try { localStorage.setItem('vsvk-wbdag', JSON.stringify({ v })); } catch { /* geen opslag */ } }

  /* ---------- gegevens ---------- */
  function normSlip(x) {
    return {
      id: x.id, nummer: x.nummer, status: UI_STATUS[x.status] || x.status, gewijzigd: !!x.gewijzigdNaUitgifte,
      datum: String(x.datum).slice(0, 10), start: uur(x.startTijd), eind: uur(x.eindTijd),
      mw: x.medewerker || '', functie: x.functie || '', woId: x.werkopdrachtId, wo: x.werkopdrachtNummer || '',
      klant: x.klant || '', oms: x.omschrijving || '', uitgereiktOp: x.uitgereiktOp, binnenOp: x.binnenOp
    };
  }
  const ronde = r => addDays(r.datum, Math.floor(((r.start ?? 0) - GRENS) / 24) + 1);
  const verstuurdGewijzigd = w => w.status === 'Uitgereikt' && w.gewijzigd;

  /* inzetten zonder werkbon, uit het planbord */
  function maakNieuw(orders) {
    const uit = [];
    for (const o of orders || []) {
      if (/annul|vervallen/i.test(String(o.status || ''))) continue;
      for (const j of o.klussen || []) for (const i of j.inzetten || []) {
        if (i.werkbon) continue;
        uit.push({
          _nieuw: true, id: 'n' + j.id + i.id, key: j.id + '|' + i.id, orderId: o.id, klusId: j.id, inzetId: i.id,
          wo: o.nummer, klant: o.klant, oms: o.korteWerkomschrijving || o.omschrijving || j.omschrijving || '',
          datum: String(i.datum).slice(0, 10), start: uur(i.startTijd ?? j.startTijd), eind: uur(i.eindTijd ?? j.eindTijd),
          mw: i.medewerker || i.inhuurmedewerker || '', optie: !!o.isOptie
        });
      }
    }
    return uit;
  }

  async function laad() {
    const seq = ++loadSeq, eind = window.VsvkLoading?.begin?.() || (() => {});
    ui.loading = true; ui.fout = '';
    try {
      const van = addDays(vandaag(), -4), tot = addDays(vandaag(), 10);
      const [slips, orders] = await Promise.all([
        ctx.request('/api/planning/werkbonnen'),
        ctx.request('/api/planning/planbord?from=' + van + '&to=' + tot).catch(() => [])
      ]);
      if (seq !== loadSeq) return;
      data.slips = (slips || []).map(normSlip);
      data.orders = new Map((orders || []).map(o => [o.id, o]));
      data.nieuw = maakNieuw(orders || []);
    } catch (error) {
      if (seq === loadSeq) ui.fout = 'Werkbonnen laden mislukt: ' + error.message;
    } finally { if (seq === loadSeq) ui.loading = false; eind(); }
    if (seq === loadSeq) render();
  }

  /* ---------- wijzigen via de werkopdracht (If-Match, geen automatische herhaling) ---------- */
  async function muteer(orderId, verander, melding) {
    if (ui.busy) return false;
    if (!ctx.canEdit) { toast('Je hebt geen rechten om werkbonnen te wijzigen.', true); return false; }
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
      toast(error.status === 412 ? 'De werkopdracht is intussen door iemand anders gewijzigd. Het scherm is ververst; probeer het opnieuw.' : 'Opslaan mislukt: ' + error.message, true);
      return false;
    } finally { ui.busy = false; await laad(); }
  }
  const inzettenVan = order => (order.klussen || []).flatMap(j => (j.inzetten || []).map(i => ({ j, i })));
  const perOrder = lijst => { const m = new Map(); lijst.forEach(x => { const k = x.woId || x.orderId; if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return m; };

  /* nieuw bonnummer: WB-{werkopdrachtvolgnummer}-{nn} */
  function volgendNummer(order, gebruikt) {
    const seq = (/(\d+)\D*$/.exec(String(order.nummer || '')) || [])[1] || '0';
    const pre = 'WB-' + seq.padStart(4, '0') + '-';
    const alle = [...data.slips.map(w => w.nummer), ...inzettenVan(order).map(x => x.i.werkbon && x.i.werkbon.nummer), ...gebruikt];
    const n = alle.reduce((m, nr) => String(nr || '').startsWith(pre) ? Math.max(m, parseInt(String(nr).slice(pre.length)) || 0) : m, 0) + 1;
    const nummer = pre + pad(n); gebruikt.push(nummer); return nummer;
  }
  async function maakBonnen(rijen) {
    const nieuw = rijen.filter(r => r._nieuw); let n = 0;
    for (const [orderId, lijst] of perOrder(nieuw)) {
      const ok = await muteer(orderId, order => {
        const gebruikt = [];
        for (const r of lijst) {
          const hit = inzettenVan(order).find(x => x.i.id === r.inzetId);
          if (!hit) return 'Een inzet bestaat niet meer.';
          if (order.isOptie) return 'Deze werkopdracht is nog een optie: eerst definitief maken, dan pas werkbonnen.';
          if (!hit.i.werkbon) { hit.i.werkbon = { nummer: volgendNummer(order, gebruikt), status: 'aangemaakt', gewijzigdNaUitgifte: false, uitgereiktOp: null, binnenOp: null }; n++; }
        }
        return '';
      });
      if (!ok) return n;
    }
    return n;
  }
  async function zetStatus(slips, status, melding) {
    let gelukt = true;
    for (const [orderId, lijst] of perOrder(slips)) {
      const nu = new Date().toISOString();
      const ok = await muteer(orderId, order => {
        for (const w of lijst) {
          const hit = inzettenVan(order).find(x => x.i.werkbon && x.i.werkbon.nummer === w.nummer);
          if (!hit) return 'Werkbon ' + w.nummer + ' bestaat niet meer.';
          const b = hit.i.werkbon; b.status = API_STATUS[status];
          if (status === 'Uitgereikt') { b.uitgereiktOp = b.uitgereiktOp || nu; b.gewijzigdNaUitgifte = false; b.binnenOp = null; }
          if (status === 'Aangemaakt') { b.uitgereiktOp = null; b.binnenOp = null; b.gewijzigdNaUitgifte = false; }
          if (status === 'Retour') b.binnenOp = b.binnenOp || nu;
        }
        return '';
      });
      if (!ok) gelukt = false;
    }
    if (gelukt && melding) toast(melding);
    return gelukt;
  }

  /* ---------- barcode (Code 128-B) en werkbon-voorbeeld ---------- */
  const C128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
  const code128B = txt => { const v = [...txt].map(c => c.charCodeAt(0) - 32); let sum = 104; v.forEach((x, i) => { sum += x * (i + 1); }); return [104, ...v, sum % 103, 106].map(i => C128[i]).join(''); };
  function barcodeSvg(txt, h = 44) {
    const runs = []; let x = 10, bar = true;
    for (const ch of code128B(txt)) { const w = +ch; if (bar) runs.push([x, w]); x += w; bar = !bar; }
    const total = x + 10;
    return `<svg class="bc" viewBox="0 0 ${total} ${h}" preserveAspectRatio="none" role="img" aria-label="Streepjescode ${esc(txt)}" style="width:${Math.round(total * 1.25)}px;height:${h}px"><rect width="${total}" height="${h}" fill="#ffffff"/>${runs.map(([a, w]) => `<rect x="${a}" y="0" width="${w}" height="${h}" fill="#000000"/>`).join('')}</svg>`;
  }
  const logo = () => { const n = document.querySelector && document.querySelector('.logo-svg'); return n ? n.outerHTML : '<b class="logo-tekst">VSVK</b>'; };

  function paperHTML(w, order) {
    const hit = order ? inzettenVan(order).find(x => x.i.werkbon && x.i.werkbon.nummer === w.nummer) : null;
    const j = hit ? hit.j : null, i = hit ? hit.i : null;
    const adres = order ? [order.werkadres, [order.werkPostcode, order.werkPlaats].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';
    const start = w.start, eind = w.eind;
    const vertrek = start != null ? start - (uur(j && j.reisHeen) || 0) : null, terug = eind != null ? eind + (uur(j && j.reisTerug) || 0) : null;
    const collegas = j ? (j.inzetten || []).filter(x => x.id !== i.id).map(x => x.medewerker || x.inhuurmedewerker).filter(Boolean) : [];
    const mat = j ? (j.materieelInzetten || []) : [];
    const materialen = order ? (order.materialen || []) : [];
    const o = order || {};
    const rij = (kop, inh, stijl) => `<tr><th>${kop}</th><td${stijl ? ` style="${stijl}"` : ''}>${inh}</td></tr>`;
    const leeg = n => Array.from({ length: n }, () => '<tr><td></td><td></td><td></td></tr>').join('');
    return `<div class="paper">
    <div class="ph"><div class="phl">${logo()}${o.internProjectnummer ? `<div class="phord"><span>Projectnummer VSVK</span><b>${esc(o.internProjectnummer)}</b></div>` : ''}</div><div class="bcw">${barcodeSvg(w.nummer)}<span>${esc(w.nummer)}</span></div><div class="t"><b>WERKBON</b><span>${esc(w.nummer)}</span>${w.wo ? `<br><span>Werkopdracht <b style="display:inline;font:600 12.5px var(--f-mono)">${esc(w.wo)}</b></span>` : ''}<br><span>${korteDatum(w.datum)}</span></div></div>
    <div class="cols">
      <div class="box"><span class="lbl">Medewerker</span><b>${esc(w.mw)}</b><br>${esc(w.functie)}</div>
      <div class="box"><span class="lbl">Klant</span><b>${esc(w.klant)}</b><br>${w.wo ? `Werkopdracht <b style="font-family:var(--f-mono)">${esc(w.wo)}</b><br>` : ''}${o.bestellerNaam ? 'Besteller: ' + esc(o.bestellerNaam) : ''}${o.bestellerTelefoon ? ' · ' + esc(o.bestellerTelefoon) : ''}${o.bestellerEmail ? '<br>' + esc(o.bestellerEmail) : ''}</div>
      <div class="box"><span class="lbl">Planning</span><b>${esc(langeDatum(w.datum))}</b>${vertrek != null ? `<br>Vertrek VSVK <b>${tijdD(vertrek)}</b>` : ''}${start != null ? `<br>Aankomst locatie <b>${tijdD(start)}</b>` : ''}${terug != null ? `<br>Terug <b>${tijdD(terug)}</b>` : ''}${adres ? `<br><span class="lbl" style="margin-top:6px">Werkadres</span><b>${esc(adres)}</b>` : ''}</div>
    </div>
    <h4>Werkomschrijving &amp; locatie</h4>
    <table class="kv"><tbody>
      ${rij('Korte werkomschrijving', `<b>${esc(o.korteWerkomschrijving || w.oms || '—')}</b>`)}
      ${rij('Ordernummer klant', esc((o.ordernummers || []).join(', ') || '—'))}
      ${rij('Wat moet er gebeuren', esc(o.werkInhoud || '—'), 'white-space:pre-line')}
      ${rij('Werkadres', esc(adres || '—') + (adres || o.gpsLocatie ? ` <a class="mapslink" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(adres || o.gpsLocatie)}" target="_blank" rel="noopener">📍 Route in Google Maps</a>` : ''))}
      ${rij('Contactpersoon op locatie', esc([o.contactLocatieNaam, o.contactLocatieTelefoon].filter(Boolean).join(' · ') || '—'))}
      ${o.instructies ? rij('Instructies', `<b>${esc(o.instructies)}</b>`, 'white-space:pre-line') : ''}
    </tbody></table>
    ${collegas.length ? `<div><span class="lbl">Collega's op deze klus</span>${collegas.map(esc).join(', ')}</div>` : ''}
    ${mat.length ? `<h4>Materieel</h4><table><thead><tr><th>Omschrijving</th><th>Bij</th></tr></thead><tbody>${mat.map(x => { const eigen = i && x.medewerkerId && x.medewerkerId === i.medewerkerId; return `<tr style="${eigen ? 'font-weight:700' : 'font-weight:400;color:var(--muted)'}"><td>${esc(x.materieel || '')}</td><td>${eigen ? 'Jij' : '—'}</td></tr>`; }).join('')}</tbody></table>` : ''}
    ${materialen.length ? `<h4>Geplande materialen</h4><table><thead><tr><th>Omschrijving</th><th>Aantal</th><th>Eenheid</th></tr></thead><tbody>${materialen.map(x => `<tr><td>${esc(x.omschrijving || '')}</td><td>${esc(x.aantal)}</td><td>${esc(x.eenheid || '')}</td></tr>`).join('')}</tbody></table>` : ''}
    <h4>Uren</h4>
    <table><thead><tr><th>Datum</th><th>Starttijd</th><th>Reistijd</th><th>Pauze</th><th>Eindtijd</th><th>Totaal</th></tr></thead><tbody>
      <tr class="tline"><td>${korteDatum(w.datum)}</td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr class="tline"><td></td><td></td><td></td><td></td><td></td><td></td></tr></tbody></table>
    <h4>Extra meegenomen materialen</h4>
    <table><thead><tr><th style="width:60%">Omschrijving</th><th>Aantal</th><th>Eenheid</th></tr></thead><tbody>${leeg(5)}</tbody></table>
    <h4>Opmerkingen</h4><table><tbody><tr><td style="height:46px"></td></tr></tbody></table>
    <div class="foot"><span>VSVK · Werkbon ${esc(w.nummer)}</span><span>Lever deze bon na afloop in bij de planning</span></div>
  </div>`;
  }
  async function orderVan(woId) {
    if (data.orders.has(woId) && data.orders.get(woId).__vol) return data.orders.get(woId);
    const order = await ctx.request('/api/planning/werkopdrachten/' + woId);
    order.__vol = true; data.orders.set(woId, order); return order;
  }

  /* printen: de bonnen komen in een printlaag; de browser maakt er een PDF van (Opslaan als PDF) */
  async function printBonnen(slips) {
    if (!slips.length) return false;
    const orders = new Map();
    for (const w of slips) if (!orders.has(w.woId)) { try { orders.set(w.woId, await orderVan(w.woId)); } catch { orders.set(w.woId, null); } }
    const gesorteerd = [...slips].sort((a, b) => nl(a.mw, b.mw) || a.datum.localeCompare(b.datum) || (a.start ?? 0) - (b.start ?? 0));
    let laag = ctx.container.querySelector('.printlaag'); if (laag) laag.remove();
    laag = document.createElement('div'); laag.className = 'printlaag';
    laag.innerHTML = gesorteerd.map(w => paperHTML(w, orders.get(w.woId))).join('');
    ctx.container.appendChild(laag);
    if (!document.getElementById('wb-print-css')) {
      const s = document.createElement('style'); s.id = 'wb-print-css';
      s.textContent = '#werkbonnen-scherm .printlaag{display:none}@media print{body *{visibility:hidden}#werkbonnen-scherm .printlaag,#werkbonnen-scherm .printlaag *{visibility:visible}#werkbonnen-scherm .printlaag{display:block;position:absolute;left:0;top:0;width:100%}#werkbonnen-scherm .printlaag .paper{break-after:page;box-shadow:none;border:0}}';
      document.head.appendChild(s);
    }
    try { window.print(); } finally { setTimeout(() => { const l = ctx.container.querySelector('.printlaag'); if (l) l.remove(); }, 400); }
    return true;
  }
  /* maakt ontbrekende bonnen, print ze en zet ze daarna op Uitgereikt */
  async function printRijen(rijen) {
    if (!rijen.length) { toast('Vink eerst bonnen aan.', true); return; }
    const sleutels = new Set(rijen.filter(r => r._nieuw).map(r => r.key));
    if (sleutels.size) {
      const n = await maakBonnen(rijen);
      if (!n) return;
    }
    /* na het maken zijn de nieuwe bonnen terug te vinden op medewerker + werkopdracht + dag */
    const gekozen = rijen.map(r => r._nieuw
      ? data.slips.find(w => w.woId && w.datum === r.datum && w.mw === r.mw && w.wo === r.wo && w.status !== 'Vervallen' && !rijen.some(x => !x._nieuw && x.id === w.id))
      : data.slips.find(w => w.id === r.id)).filter(Boolean);
    if (!gekozen.length) { toast('De werkbonnen zijn gemaakt, maar niet terug te vinden om te printen. Ververs het scherm.', true); return; }
    await printBonnen(gekozen);
    const nog = gekozen.filter(w => w.status === 'Aangemaakt' || verstuurdGewijzigd(w));
    if (nog.length) await zetStatus(nog, 'Uitgereikt', nog.length + ' werkbon' + (nog.length === 1 ? '' : 'nen') + ' op Uitgereikt');
    ui.printSel = new Set();
  }

  /* ---------- weergave ---------- */
  const chip = w => w.status === 'Vervallen' ? `<span class="chip st-Vervallen">vervallen</span>`
    : verstuurdGewijzigd(w) ? `<span class="chip ws-open" title="De planning is gewijzigd nadat de bon is verstuurd">gewijzigd · opnieuw printen</span>`
    : `<span class="chip st-${w.status}">${WBLBL[w.status] || esc(w.status)}</span>`;
  const wijzHTML = w => verstuurdGewijzigd(w) ? `<div class="wbwijz">⚠ Gewijzigd na versturen — <b>opnieuw printen of sturen</b></div>` : '';
  const wkLabel = m => `Week ${weeknr(m)} <span>${esc(datumKort(m))} – ${esc(datumKort(addDays(m, 6)))}</span>`;
  const gepland = w => w.start != null ? tijd(w.start) + '–' + tijdD(w.eind ?? w.start) : '—';

  function dagBar(n, woord, zoek, zonderAlle) {
    const st = dagStand(), alle = st === 'alle' || zoek, d = alle ? vandaag() : st, gt = tijd(GRENS);
    return `<div class="wkbar">
    <div class="wknav"><button class="btn" data-act="dagnav" data-n="-1" aria-label="Vorige dag" ${alle ? 'disabled' : ''}>◀</button><div class="wklbl dagl">${alle ? (zoek ? 'Zoeken in alle dagen' : 'Alle dagen') : `<span class="wkchip">Wk ${weeknr(d)}</span> ${esc(dagVol(d).replace(/^./, c => c.toUpperCase()))} <span>vertrek ${esc(datumKort(addDays(d, -1)))} ${gt} t/m ${esc(datumKort(d))} ${gt}</span>`}</div><button class="btn" data-act="dagnav" data-n="1" aria-label="Volgende dag" ${alle ? 'disabled' : ''}>▶</button></div>
    ${zoek ? '' : `<button class="btn sm" data-act="dagnav" data-n="v" ${!alle && d === vandaag() ? 'disabled' : ''}>Vandaag</button><button class="btn sm" data-act="dagnav" data-n="m" ${!alle && d === addDays(vandaag(), 1) ? 'disabled' : ''}>Morgen</button>${zonderAlle ? `<span class="swl" aria-hidden="true" style="visibility:hidden"><span class="sw"></span>Alle dagen</span>` : `<span class="swl"><button class="sw" role="switch" aria-checked="${st === 'alle'}" data-act="dagalle" aria-label="Alle dagen tonen"></button>Alle dagen</span>`}`}
    <span class="hint wkn">${n} ${woord}</span></div>`;
  }
  function rijGroep(rows, datumVan, cols, aan, rij) {
    if (!aan) return rows.map(rij).join('');
    const tel = new Map(); rows.forEach(r => { const m = maandag(datumVan(r)); tel.set(m, (tel.get(m) || 0) + 1); });
    let last = null;
    return rows.map(r => { const m = maandag(datumVan(r)); const h = m !== last ? (last = m, `<tr class="wkrij" style="display:table-row"><td colspan="${cols}"><div class="wkkop"><h3>${wkLabel(m)}</h3><b>${tel.get(m)}</b></div></td></tr>`) : ''; return h + rij(r); }).join('');
  }
  const colgroup = '<colgroup><col class="k-c"><col class="k-nr"><col class="k-mw"><col><col class="k-gp"><col class="k-st"><col class="k-ac"></colgroup>';
  const klantCel = r => `${r.wo ? `<span class="wonr">${esc(r.wo)}</span> · ` : ''}${esc(r.klant)}${r.oms ? ` <span class="hint">· ${esc(r.oms)}</span>` : ''}`;

  const openRetour = () => data.slips.filter(w => (w.status === 'Aangemaakt' || w.status === 'Uitgereikt') && ronde(w) <= vandaag());
  const herpLijst = () => data.slips.filter(w => verstuurdGewijzigd(w) && w.datum >= addDays(vandaag(), -1));
  const klaarVoorbij = w => (parseD(w.datum) - parseD(vandaag())) / 36e5 + (w.eind ?? w.start ?? 0) <= uurNu();

  function todoHTML() {
    const nHer = herpLijst().length, nRet = openRetour().filter(klaarVoorbij).length;
    const t = [['printen', nHer, `⚠ ${nHer} gewijzigd, opnieuw printen`, '', ''], ['inleveren', nRet, `${nRet} bon${nRet === 1 ? '' : 'nen'} nog niet binnen`, 'ret', 'info']].filter(x => x[1] > 0);
    return `<div class="todobalk"><b>Te doen</b>${t.length ? t.map(([v, , l, k, soort]) => `<button class="todo ${soort}" data-act="todo" data-v="${v}" data-k="${k}">${esc(l)}</button>`).join('<span class="todopijl" aria-hidden="true">›</span>') : '<span class="todo ok">✓ Niets open: alles is bijgewerkt</span>'}</div>`;
  }

  function maakStrook(D) {
    const gt = tijd(GRENS), tm = data.nieuw.filter(r => ronde(r) === D && !r.optie), nN = tm.length;
    const T = plannerDag(D), tmT = T > D ? data.nieuw.filter(r => ronde(r) >= D && ronde(r) <= T && !r.optie).length : 0;
    const herp = herpLijst().filter(w => ronde(w) === D), optie = data.nieuw.filter(r => ronde(r) === D && r.optie).length;
    const heeftKlus = data.slips.some(w => ronde(w) === D) || data.nieuw.some(r => ronde(r) === D);
    return `<div class="wbstrook ${nN || herp.length ? 'open' : 'klaar'}">
    <span>${herp.length ? `<b class="wbherp">⚠ ${herp.length} verstuurde bon${herp.length === 1 ? '' : 'nen'} gewijzigd · opnieuw printen</b>${nN ? ' · ' : ''}` : ''}${nN ? `<b>${nN} bon${nN === 1 ? '' : 'nen'} nog te maken</b>` : herp.length ? '' : heeftKlus ? '<b>✓ Alle bonnen van deze dag zijn gemaakt</b>' : 'Geen klussen in deze ronde'}${optie ? ` <span class="hint">· ${optie} inzet${optie === 1 ? '' : 'ten'} nog een optie</span>` : ''}</span>
    ${nN ? `<button class="btn primary" data-act="wbmaakdag" data-tot="${D}">Werkbonnen maken (${nN})</button>` : ''}
    ${herp.length ? `<button class="btn ${nN ? '' : 'primary'}" data-act="wbherprint" data-ids="${herp.map(w => w.id).join(',')}">Opnieuw printen (${herp.length})</button>` : ''}
    ${tmT && tmT > nN ? `<button class="btn" data-act="wbmaakdag" data-tot="${T}" title="Vertrek ${esc(datumKort(addDays(D, -1)))} ${gt} t/m ${esc(datumKort(T))} ${gt}">Maken t/m ${esc(datumKort(T))} (${tmT})</button>` : ''}
  </div>`;
  }

  function lijstHTML() {
    const f = ui.filter, q = f.q.trim().toLowerCase();
    const alle = [...data.slips].sort((a, b) => b.datum.localeCompare(a.datum) || nl(b.nummer, a.nummer));
    const rows = alle.filter(w => (!f.status || w.status === f.status) && (!f.mw || w.mw === f.mw) && (!q || [w.nummer, w.wo, w.klant, w.oms, w.mw, w.datum].join(' ').toLowerCase().includes(q)));
    const st = dagStand(), wbAlle = st === 'alle' || !!q;
    if (!wbAlle) {
      const vt = w => w.datum + String(1000 + (w.start ?? 0)).padStart(8, '0');
      const keep = rows.filter(w => ronde(w) === st).sort((a, b) => vt(a).localeCompare(vt(b)) || nl(a.nummer, b.nummer));
      rows.length = 0; rows.push(...keep);
      if (!f.status && !f.mw) data.nieuw.filter(r => ronde(r) === st && !r.optie).forEach(r => rows.push(r));
      rows.sort((a, b) => vt(a).localeCompare(vt(b)) || String(a.nummer || '~').localeCompare(String(b.nummer || '~')));
    }
    const retR = rows.filter(w => !w._nieuw && w.status === 'Retour');
    [...ui.sel].forEach(id => { if (!retR.some(w => w.id === id)) ui.sel.delete(id); });
    const namen = [...new Set(data.slips.map(w => w.mw).filter(Boolean))].sort(nl);
    const nSel = [...ui.sel].length;
    const rij = w => {
      if (w._nieuw) return `<tr class="wbnieuw"><td class="c"></td><td class="nw"><span class="chip wbv-nieuw">nog te maken</span></td><td class="nw">${esc(w.mw)}</td><td class="ell">${klantCel(w)}</td><td class="nw num">${gepland(w)}</td><td></td><td></td></tr>`;
      const open = w.status === 'Aangemaakt' || w.status === 'Uitgereikt';
      return `<tr class="wbst-${w.status} ${verstuurdGewijzigd(w) ? 'wbherrij' : ''}">
        <td class="c">${w.status === 'Retour' ? `<input type="checkbox" class="wbvink" data-wbsel="${w.id}" ${ui.sel.has(w.id) ? 'checked' : ''} aria-label="${esc(w.nummer)} aanvinken voor verwerken">` : ''}</td>
        <td class="nw num"><b>${esc(w.nummer)}</b></td>
        <td class="nw">${esc(w.mw)}</td>
        <td class="ell">${klantCel(w)}${wijzHTML(w)}</td>
        <td class="nw num">${wbAlle ? `<small class="gpdag">${datumKort(w.datum)}</small>` : ''}${gepland(w)}</td>
        <td class="nw">${chip(w)}</td>
        <td class="nw acties"><button class="btn sm" data-wbview="${w.id}">Bekijk</button>${open ? `<button class="btn sm" data-wbpdf="${w.id}" title="Print deze werkbon of bewaar hem als PDF">PDF</button>` : ''}${w.status === 'Retour' ? `<button class="btn sm" data-act="wbverwerk" data-ids="${w.id}" title="Uren verwerkt en gefactureerd">Verwerkt</button>` : ''}${open ? `<button class="btn sm ghost" data-wbdel="${w.id}" aria-label="Vervallen" title="Bon laten vervallen (nummer blijft bewaard)">✕</button>` : ''}</td>
      </tr>`;
    };
    return `<div class="panel">
 ${dagBar(rows.length, rows.length === 1 ? 'bon' : 'bonnen', !!q)}
    ${wbAlle ? '' : maakStrook(st)}
    <div class="filters wbfilt"><input type="search" id="wbq" placeholder="Zoek op nummer, klant, medewerker…" value="${esc(f.q)}" aria-label="Zoeken"><select id="wbst" aria-label="Status"><option value="">Alle statussen</option>${STATUS.map(x => `<option ${f.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select><select id="wbmw" aria-label="Medewerker"><option value="">Alle medewerkers</option>${namen.map(m => `<option ${f.mw === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>${nSel ? `<button class="btn sm primary" data-act="wbverwerk" data-ids="${[...ui.sel].join(',')}">Verwerkt (${nSel})</button>` : retR.length ? '<span class="hint">Vink bonnen aan die binnen zijn om ze op Verwerkt te zetten</span>' : ''}<button class="btn sm wbfilt-r" data-act="achteraf" title="Voor werk dat niet ingepland was: maak een nieuwe werkopdracht">+ Werkbon achteraf (spoed)</button></div>
    ${rows.length ? `<div class="scroll"><table class="rijen wb wbt">${colgroup}<thead><tr><th class="c">${retR.length ? `<input type="checkbox" class="wbvink" data-wbselall="1" ${retR.every(w => ui.sel.has(w.id)) ? 'checked' : ''} aria-label="Alle bonnen die binnen zijn aanvinken" title="Alle bonnen die binnen zijn aanvinken">` : ''}</th><th>Werkbon</th><th>Medewerker</th><th>Klant · werkopdracht</th><th>Gepland</th><th>Status</th><th></th></tr></thead><tbody>
    ${rijGroep(rows, x => x.datum, 7, wbAlle, rij)}
    </tbody></table></div>` : `<div class="empty">${alle.length ? (wbAlle ? 'Geen werkbonnen gevonden met deze filters.' : 'Geen werkbonnen voor deze dag.') : 'Nog geen werkbonnen.'}</div>`}
  </div>`;
  }

  /* rijen voor "Printen voor de ploeg": bestaande bonnen en nog te maken bonnen van deze ronde */
  function printRijenVan(d) {
    const rijen = [...data.slips.filter(w => w.status !== 'Vervallen' && ronde(w) === d), ...data.nieuw.filter(r => ronde(r) === d && !r.optie)];
    return rijen.sort((a, b) => nl(a.mw, b.mw) || a.datum.localeCompare(b.datum) || (a.start ?? 0) - (b.start ?? 0));
  }
  function printenHTML() {
    const st = dagStand(), d = st === 'alle' ? vandaag() : st;
    const rijen = printRijenVan(d);
    if (ui.printSelDag !== d) { ui.printSel = new Set(); ui.printSelDag = d; }
    const sel = ui.printSel; [...sel].forEach(x => { if (!rijen.some(r => r.id === x)) sel.delete(x); });
    const nSel = sel.size, alleAan = rijen.length && nSel === rijen.length;
    const nNieuw = rijen.filter(r => r._nieuw).length, nOud = rijen.filter(r => !r._nieuw && verstuurdGewijzigd(r)).length;
    const nGeprint = rijen.filter(r => !r._nieuw && r.status !== 'Aangemaakt').length, nTe = rijen.length - nGeprint;
    const klaar = rijen.length && !nTe && !nOud && !nNieuw;
    const strook = `<div class="wbstrook ${klaar ? 'klaar' : 'open'}"><span>${!rijen.length ? 'Niemand ingepland in deze ronde' : klaar ? '<b>✓ Alle bonnen van deze dag zijn geprint</b>' : `<b>${nTe} nog niet geprint</b>${nNieuw ? ` · ${nNieuw} nog te maken (gebeurt bij printen)` : ''}${nOud ? ` · <b class="wbherp">⚠ ${nOud} gewijzigd · opnieuw printen</b>` : ''} <span class="hint">· ${nGeprint} van ${rijen.length} geprint</span>`}</span>
    <button class="btn" data-act="printsel" ${nSel ? '' : 'disabled'}>Aangevinkte printen (${nSel})</button><button class="btn ${klaar ? '' : 'primary'}" data-act="printdag" ${rijen.length ? '' : 'disabled'}>Alle bonnen printen (${rijen.length})</button></div>`;
    const filt = rijen.length ? `<div class="wbfilt"><span class="hint">Aanvinken:</span><button class="btn sm" data-act="pselset" data-v="alle">Alles</button><button class="btn sm" data-act="pselset" data-v="ongeprint">Nog niet geprint</button><button class="btn sm" data-act="pselset" data-v="verouderd">Gewijzigd</button><button class="btn sm ghost" data-act="pselset" data-v="geen" ${nSel ? '' : 'disabled'}>Niets</button><span class="hint wbfilt-r">Eén PDF, gesorteerd per medewerker · daarna Uitgereikt</span></div>` : '';
    const tabel = rijen.length ? `<div class="scroll"><table class="rijen wbt">${colgroup}<thead><tr><th class="c"><input type="checkbox" class="wbvink" data-pselall="1" ${alleAan ? 'checked' : ''} aria-label="Alles aanvinken"></th><th>Werkbon</th><th>Medewerker</th><th>Klant · werkopdracht</th><th>Gepland</th><th>Status</th><th></th></tr></thead><tbody>
    ${rijen.map(r => `<tr class="prow ${sel.has(r.id) ? 'gekozen' : ''} ${!r._nieuw && r.status !== 'Aangemaakt' && !verstuurdGewijzigd(r) ? 'klaar' : ''}"><td class="c"><input type="checkbox" class="wbvink" data-psel="${r.id}" ${sel.has(r.id) ? 'checked' : ''} aria-label="${esc(r.mw)} aanvinken"></td><td class="nw num"><b>${r._nieuw ? '—' : esc(r.nummer)}</b></td><td class="nw">${esc(r.mw)}</td><td class="ell">${klantCel(r)}</td><td class="nw num">${gepland(r)}</td><td class="nw">${r._nieuw ? '<span class="chip wbv-nieuw">nog te maken</span>' : chip(r)}</td><td class="nw acties">${r._nieuw ? '' : `<button class="btn sm" data-wbview="${r.id}">Bekijk</button>`}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">Er staat niemand ingepland in deze ronde.</div>';
    return `<div class="panel">${dagBar(rijen.length, rijen.length === 1 ? 'bon' : 'bonnen', false, true)}${strook}${filt}${tabel}</div>`;
  }

  function inleverenHTML() {
    const nu = vandaag();
    const alleOpen = openRetour().sort((a, b) => a.datum.localeCompare(b.datum) || nl(a.mw, b.mw));
    const rSt = dagStand(), rAlle = rSt === 'alle', open = rAlle ? alleOpen : alleOpen.filter(w => ronde(w) === rSt);
    const andere = new Map(); if (!rAlle) alleOpen.filter(w => ronde(w) !== rSt).forEach(w => { const m = ronde(w); andere.set(m, (andere.get(m) || 0) + 1); });
    const binnenL = rAlle ? [] : data.slips.filter(w => (w.status === 'Retour' || w.status === 'Verwerkt') && ronde(w) === rSt);
    const volg = w => (w.status === 'Retour' || w.status === 'Verwerkt') ? 2 : 1;
    const rijenR = rAlle ? [...open].sort((a, b) => ronde(a).localeCompare(ronde(b)) || nl(a.mw, b.mw)) : [...open, ...binnenL].sort((a, b) => volg(a) - volg(b) || nl(a.mw, b.mw) || nl(a.nummer, b.nummer));
    const log = ui.scanLog, klaar = !open.length && (binnenL.length || rAlle);
    const strook = `<div class="wbstrook ${klaar ? 'klaar' : 'open'} scanstrook"><label for="scanin"><b>Scan of typ werkbonnummer</b></label><input id="scanin" autocomplete="off" placeholder="WB-0412-01" autofocus><span class="hint">Enter = binnen</span>
    <span class="wbstrook-tel">${rAlle ? `<b>${open.length}</b> nog niet retour` : `<b>${open.length}</b> open · <b>${binnenL.length}</b> binnen`}</span></div>`;
    const filt = `<div class="wbfilt">${log.length ? `<span class="scanlog">${log.slice(-10).reverse().map(x => `<span class="${x.ok ? '' : 'nee'}" title="${esc(x.msg)}">${x.ok ? '✓' : '✕'} ${esc(x.nr)}</span>`).join('')}</span>` : ''}${andere.size ? `<span class="hint">Ook nog open:</span>${[...andere.entries()].sort().map(([m, n]) => `<button class="btn sm ${werkdagenTussen(m, nu) >= 3 ? 'oud' : ''}" data-act="dagspring" data-m="${m}">${esc(datumKort(m))} · ${n}</button>`).join('')}` : ''}<span class="hint wbfilt-r">Oranje: 2 werkdagen buiten · rood: langer</span></div>`;
    const rij = w => {
      const bin = w.status === 'Retour' || w.status === 'Verwerkt', oud = werkdagenTussen(ronde(w), nu);
      return `<tr class="retrow ${bin ? 'binnen' : oud >= 3 ? 'ouder2' : oud >= 2 ? 'ouder1' : ''}"><td class="c"><input type="checkbox" class="wbvink" data-retour="${w.id}" ${bin ? 'checked' : ''} ${w.status === 'Verwerkt' ? 'disabled title="Al verwerkt: zet de status terug in Alle werkbonnen"' : ''} aria-label="${esc(w.nummer)} ${bin ? 'binnen, klik om terug te zetten' : 'is binnen'}"></td><td class="nw num"><b>${esc(w.nummer)}</b></td><td class="nw">${esc(w.mw)}</td><td class="ell">${klantCel(w)}</td><td class="nw num">${gepland(w)}</td><td class="nw">${chip(w)}${!bin && oud >= 2 ? ` <span class="leeft ${oud >= 3 ? 'o2' : 'o1'}">${oud} werkdagen buiten</span>` : ''}</td><td class="nw acties"><button class="btn sm" data-wbview="${w.id}">Bekijk</button></td></tr>`;
    };
    let tabel;
    if (rijenR.length) {
      let body;
      if (rAlle) {
        const g = new Map(); rijenR.forEach(w => { const d = ronde(w); if (!g.has(d)) g.set(d, []); g.get(d).push(w); });
        body = [...g.entries()].map(([d, ws]) => { const oud = werkdagenTussen(d, nu); return `<tr class="wkrij" style="display:table-row"><td colspan="7"><div class="wkkop"><h3>${esc(langeDatum(d))} <span class="leeft ${oud >= 3 ? 'o2' : oud >= 2 ? 'o1' : ''}">${oud === 0 ? 'vandaag' : oud + ' werkdag' + (oud > 1 ? 'en' : '') + ' buiten'}</span></h3><b>${ws.length}</b></div></td></tr>` + ws.map(rij).join(''); }).join('');
      } else body = rijenR.map(rij).join('');
      tabel = `<div class="scroll"><table class="rijen wbt ret">${colgroup}<thead><tr><th class="c">Binnen</th><th>Werkbon</th><th>Medewerker</th><th>Klant · werkopdracht</th><th>Gepland</th><th>Status</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`;
    } else tabel = `<div class="empty">${rAlle ? '✓ Alle werkbonnen tot en met vandaag zijn binnen.' : (rSt > nu ? 'Deze dag ligt nog in de toekomst; bonnen tellen pas mee als het werk gedaan is.' : 'Geen bonnen in deze ronde.')}</div>`;
    return `<div class="panel">${dagBar(rijenR.length, rijenR.length === 1 ? 'bon' : 'bonnen', false)}${strook}${filt}${tabel}</div>`;
  }

  /* onderdeel 3 t/m 6: volgen in een volgende stap */
  function volgendeStapHTML(v) {
    const titel = { inkoop: 'Inkoop', werk: 'Verkoop', uren: 'Verkoop', proforma: 'Proforma & factuur', selfbill: 'Self-bill ZZP' }[v] || v;
    const binnen = data.slips.filter(w => w.status === 'Retour' || w.status === 'Verwerkt').sort((a, b) => b.datum.localeCompare(a.datum) || nl(b.nummer, a.nummer));
    return `<div class="panel"><div class="wbstrook open"><span><b>${esc(titel)}</b> <span class="hint">· dit onderdeel wordt in een volgende stap overgenomen en aan de API gekoppeld</span></span></div>
    ${binnen.length ? `<div class="scroll"><table class="rijen wbt">${colgroup}<thead><tr><th class="c"></th><th>Werkbon</th><th>Medewerker</th><th>Klant · werkopdracht</th><th>Gepland</th><th>Status</th><th></th></tr></thead><tbody>${binnen.map(w => `<tr><td class="c"></td><td class="nw num"><b>${esc(w.nummer)}</b></td><td class="nw">${esc(w.mw)}</td><td class="ell">${klantCel(w)}</td><td class="nw num"><small class="gpdag">${datumKort(w.datum)}</small>${gepland(w)}</td><td class="nw">${chip(w)}</td><td class="nw acties"><button class="btn sm" data-wbview="${w.id}">Bekijk</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Geen werkbonnen die binnen zijn.</div>'}</div>`;
  }

  function paginaHTML() {
    if (ui.loading && !data.slips.length && !ui.fout) return '<div class="empty">Werkbonnen laden…</div>';
    if (ui.fout) return `<div class="empty">${esc(ui.fout)}</div>`;
    const wv = ui.view;
    const WBT = [['maak', '1', 'Maken & printen', 'werkbonnen en PDF', 'alle'], ['binnen', '2', 'Binnen & digitaliseren', 'scannen en overnemen', 'inleveren'], ['inkoop', '3', 'Inkoop', 'tijden controleren', 'inkoop'], ['verkoop', '4', 'Verkoop', 'per werkorder, kansen', 'werk'], ['proforma', '5', 'Proforma & factuur', 'akkoord klant, factuur', 'proforma'], ['selfbill', '6', 'Self-bill ZZP', 'per ZZP\'er per week', 'selfbill']];
    const SUB = { maak: [['alle', 'Werkbonnen'], ['printen', 'Printen voor de ploeg']], verkoop: [['werk', 'Per werkorder'], ['uren', 'Per dag']] };
    const tabVan = v => v === 'printen' || v === 'alle' ? 'maak' : v === 'inleveren' ? 'binnen' : v === 'uren' || v === 'werk' ? 'verkoop' : v;
    const nOpen = openRetour().length, nHer = herpLijst().length;
    const tab = tabVan(wv), subs = SUB[tab];
    const nav = `<div class="wbtabs" role="tablist" style="--nst:${WBT.length}">${WBT.map(([k, n, l, sub, dv]) => `<button role="tab" data-act="wbview" data-v="${dv}" data-tab="${k}" aria-selected="${tab === k}"><i>${n}</i><span><b>${l}</b><small>${sub}</small></span>${k === 'maak' && nHer ? `<em title="Gewijzigd na printen">⚠ ${nHer}</em>` : k === 'binnen' && nOpen ? `<em title="Bonnen nog binnen te melden">${nOpen}</em>` : ''}</button>`).join('')}</div>`;
    const subNav = subs ? `<div class="wbsub" role="tablist">${subs.map(([v, l]) => `<button role="tab" data-act="wbview" data-v="${v}" aria-selected="${wv === v}">${esc(l)}${v === 'printen' && nHer ? ` <em>⚠ ${nHer}</em>` : ''}</button>`).join('')}</div>` : '';
    const inhoud = wv === 'printen' ? printenHTML() : wv === 'inleveren' ? inleverenHTML() : wv === 'alle' ? lijstHTML() : volgendeStapHTML(wv);
    return `${todoHTML()}${nav}${subNav}${inhoud}`;
  }

  /* ---------- modals ---------- */
  function modalHTML() {
    const m = ui.modal; if (!m) return '';
    if (m.type === 'maken') {
      const rows = m.rows, nNieuw = rows.length;
      return `<div class="modal" data-modalbg="1"><div class="mbox wide" role="dialog" aria-modal="true">
      <div class="mhead"><h2>${m.klaar ? 'Werkbonnen klaar' : 'Werkbonnen maken'}</h2><button class="btn ghost" data-act="sluitmodal" aria-label="Sluiten">✕</button></div>
      <div class="mbody">
       ${rows.length ? '' : '<div class="empty">Deze klussen hebben nog geen medewerkers.</div>'}
       ${m.klaar ? `<p class="hint">Elke medewerker heeft een eigen werkbon met uniek nummer. Print ze los of als één PDF.</p>` : `<p class="hint">${nNieuw} nieuwe werkbon${nNieuw === 1 ? '' : 'nen'}. Werkbonnen die al bestaan blijven ongewijzigd.</p>`}
       <div class="scroll"><table class="list"><thead><tr><th>Nummer</th><th>Medewerker</th><th>Klant · klus</th><th>Tijd</th><th>Status</th>${m.klaar ? '<th></th>' : ''}</tr></thead><tbody>
       ${rows.map(r => { const w = m.klaar ? data.slips.find(x => x.woId && x.datum === r.datum && x.mw === r.mw && x.wo === r.wo && x.status !== 'Vervallen') : null; return `<tr><td class="num">${w ? esc(w.nummer) : '<span class="chip">nieuw</span>'}</td><td>${esc(r.mw)}</td><td>${esc(r.klant)}${r.oms ? ' · ' + esc(r.oms) : ''}</td><td class="num">${korteDatum(r.datum)} ${gepland(r)}</td><td>${w ? `<span class="chip st-${w.status}">${w.status}</span>` : ''}</td>${m.klaar && w ? `<td><div class="row"><button class="btn sm" data-wbview="${w.id}">Bekijk</button><button class="btn sm" data-wbpdf="${w.id}">PDF</button></div></td>` : m.klaar ? '<td></td>' : ''}</tr>`; }).join('')}
       </tbody></table></div>
      </div>
      <div class="mfoot">${m.klaar ? `<button class="btn primary" data-act="pdfalle">Alle werkbonnen als één PDF</button><button class="btn" data-act="sluitmodal">Sluiten</button>` : `<button class="btn" data-act="sluitmodal">Annuleren</button><button class="btn primary" data-act="wbok" ${rows.length ? '' : 'disabled'}>Werkbonnen maken</button>`}</div></div></div>`;
    }
    if (m.type === 'bekijk') {
      const w = m.slip;
      return `<div class="modal" data-modalbg="1"><div class="mbox" role="dialog" aria-modal="true">
      <div class="mhead"><h2>${esc(w.nummer)}</h2><button class="btn ghost" data-act="sluitmodal" aria-label="Sluiten">✕</button></div>
      <div class="mbody">${w.status === 'Vervallen' ? `<div class="wbwijz groot verv">Deze bon is <b>vervallen</b> en telt niet meer mee. Het nummer blijft bewaard. Terughalen kan met de keuzelijst Status hieronder.</div>` : ''}${verstuurdGewijzigd(w) ? `<div class="wbwijz groot">⚠ De planning is gewijzigd nadat deze bon is verstuurd. Hieronder de laatst bekende versie; Print maakt de nieuwe en zet hem opnieuw op Uitgereikt.</div>` : ''}${m.fout ? `<div class="empty">${esc(m.fout)}</div>` : paperHTML(w, m.order)}</div>
      <div class="mfoot"><label class="stwijzig">Status <select class="stsel" data-wbsetstat="${w.id}" aria-label="Status aanpassen">${STATUS.map(x => `<option ${x === w.status ? 'selected' : ''}>${x}</option>`).join('')}</select></label><button class="btn" data-wbpdf="${w.id}">Print / PDF</button><button class="btn primary" data-act="sluitmodal">Sluiten</button></div></div></div>`;
    }
    return '';
  }

  function render() {
    if (!ctx) return;
    const actief = document.activeElement, id = actief && actief.id && ctx.container.contains(actief) ? actief.id : '';
    const laag = ctx.container.querySelector('.printlaag');
    ctx.container.innerHTML = `<div class="wb-scherm">${paginaHTML()}</div><div id="wb-modallaag">${modalHTML()}</div>`;
    if (laag) ctx.container.appendChild(laag);
    if (id) { const n = document.getElementById(id); if (n) { n.focus({ preventScroll: true }); try { if (n.setSelectionRange) n.setSelectionRange(n.value.length, n.value.length); } catch { /* geen selectie */ } } }
  }

  /* ---------- acties ---------- */
  function zoekWerkbon(nr) {
    const q = String(nr || '').trim().toUpperCase().replace(/\s+/g, ''); if (!q) return null;
    const ws = data.slips; const r = ws.find(w => String(w.nummer).toUpperCase() === q) || ws.find(w => al(w.nummer) === al(q)); if (r) return r;
    const m = /^(?:WB)?[^0-9]*0*(\d{1,4})[^0-9]+0*(\d{1,3})$/.exec(q);
    if (m) { const nr2 = `WB-${m[1].padStart(4, '0')}-${m[2].padStart(2, '0')}`; return ws.find(w => w.nummer === nr2) || null; }
    return null;
  }
  async function bonBinnen(nr) {
    const w = zoekWerkbon(nr), log = ui.scanLog;
    if (!w) { log.push({ nr: String(nr).trim(), ok: false, msg: 'Onbekend nummer' }); toast('Werkbon ' + String(nr).trim() + ' niet gevonden', true); render(); return; }
    if (w.status === 'Retour' || w.status === 'Verwerkt') { log.push({ nr: w.nummer, ok: true, msg: 'Was al binnen' }); toast(w.nummer + ' was al binnen'); render(); return; }
    if (w.status === 'Vervallen') { log.push({ nr: w.nummer, ok: false, msg: 'Vervallen bon' }); toast(w.nummer + ' is vervallen', true); render(); return; }
    const ok = await zetStatus([w], 'Retour', w.nummer + ' binnen · ' + w.mw);
    log.push({ nr: w.nummer, ok, msg: ok ? 'Binnen' : 'Opslaan mislukt' }); render();
    const x = document.getElementById('scanin'); if (x) x.focus();
  }
  function openMaken(totDag) {
    const D = dagStand() === 'alle' ? vandaag() : dagStand();
    const rows = data.nieuw.filter(r => ronde(r) >= D && ronde(r) <= totDag && !r.optie);
    if (!rows.length) { toast('Er zijn geen bonnen om te maken.'); return; }
    ui.modal = { type: 'maken', rows, klaar: false }; render();
  }
  async function bekijk(id) {
    const w = data.slips.find(x => x.id === id); if (!w) return;
    ui.modal = { type: 'bekijk', slip: w, order: null, fout: '' }; render();
    try { const order = await orderVan(w.woId); if (ui.modal && ui.modal.slip === w) { ui.modal.order = order; render(); } }
    catch (error) { if (ui.modal && ui.modal.slip === w) { ui.modal.fout = 'Details laden mislukt: ' + error.message; render(); } }
  }
  const slipsVan = ids => String(ids || '').split(',').map(id => data.slips.find(w => w.id === id)).filter(Boolean);

  async function klik(e) {
    const b = e.target.closest && e.target.closest('button,[data-wbview]'); if (!b || !ctx.container.contains(b)) return;
    const d = b.dataset;
    if (d.wbview) { await bekijk(d.wbview); return; }
    if (d.wbpdf) { const w = data.slips.find(x => x.id === d.wbpdf); if (w) { await printBonnen([w]); if (w.status === 'Aangemaakt' || verstuurdGewijzigd(w)) await zetStatus([w], 'Uitgereikt', w.nummer + ' op Uitgereikt'); } return; }
    if (d.wbdel) {
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Zeker?'; setTimeout(() => { if (b.isConnected) { b.dataset.confirm = ''; b.textContent = '✕'; } }, 3000); return; }
      const w = data.slips.find(x => x.id === d.wbdel); if (w) await zetStatus([w], 'Vervallen', w.nummer + ' vervallen · het nummer blijft bewaard'); return;
    }
    const a = d.act; if (!a) return;
    if (a === 'sluitmodal') { ui.modal = null; render(); }
    else if (a === 'dagnav') { const st = dagStand(), d0 = st === 'alle' ? vandaag() : st; dagZet(d.n === 'v' ? vandaag() : d.n === 'm' ? addDays(vandaag(), 1) : addDays(d0, +d.n)); render(); }
    else if (a === 'dagalle') { dagZet(dagStand() === 'alle' ? vandaag() : 'alle'); render(); }
    else if (a === 'dagspring') { dagZet(d.m); render(); }
    else if (a === 'wbview') { ui.view = d.v; render(); if (d.v === 'inleveren') setTimeout(() => { const x = document.getElementById('scanin'); if (x) x.focus(); }, 0); }
    else if (a === 'todo') { ui.view = d.v; if (d.k === 'ret') dagZet('alle'); render(); }
    else if (a === 'wbmaakdag') openMaken(d.tot);
    else if (a === 'wbok') { const rows = ui.modal.rows; const n = await maakBonnen(rows); if (ui.modal) { ui.modal.klaar = n > 0; if (!n) ui.modal = null; } if (n) toast(n + ' nieuwe werkbon' + (n === 1 ? '' : 'nen') + ' gemaakt'); render(); }
    else if (a === 'pdfalle') { const m = ui.modal; const ws = m ? m.rows.map(r => data.slips.find(x => x.woId && x.datum === r.datum && x.mw === r.mw && x.wo === r.wo && x.status !== 'Vervallen')).filter(Boolean) : []; await printBonnen(ws); const nog = ws.filter(w => w.status === 'Aangemaakt'); if (nog.length) await zetStatus(nog, 'Uitgereikt', nog.length + ' werkbon' + (nog.length === 1 ? '' : 'nen') + ' op Uitgereikt'); }
    else if (a === 'wbherprint') { const ws = slipsVan(d.ids); await printBonnen(ws); await zetStatus(ws, 'Uitgereikt', ws.length + ' werkbon' + (ws.length === 1 ? '' : 'nen') + ' opnieuw uitgereikt'); }
    else if (a === 'wbverwerk') { const ws = slipsVan(d.ids).filter(w => w.status === 'Retour'); if (ws.length && await zetStatus(ws, 'Verwerkt', ws.length + ' werkbon' + (ws.length === 1 ? '' : 'nen') + ' op Verwerkt')) ui.sel = new Set(); }
    else if (a === 'printdag') { const dd = dagStand() === 'alle' ? vandaag() : dagStand(); await printRijen(printRijenVan(dd)); }
    else if (a === 'printsel') { const dd = dagStand() === 'alle' ? vandaag() : dagStand(); await printRijen(printRijenVan(dd).filter(r => ui.printSel.has(r.id))); }
    else if (a === 'pselset') {
      const dd = dagStand() === 'alle' ? vandaag() : dagStand(), S = new Set();
      printRijenVan(dd).forEach(r => { const ok = d.v === 'alle' || (d.v === 'ongeprint' && (r._nieuw || r.status === 'Aangemaakt')) || (d.v === 'verouderd' && !r._nieuw && verstuurdGewijzigd(r)); if (ok && d.v !== 'geen') S.add(r.id); });
      ui.printSel = S; ui.printSelDag = dd; render();
    }
    else if (a === 'achteraf') ctx.navigate('Werkopdrachten', { nieuw: true });
  }

  async function wijzigEvent(e) {
    const t = e.target, d = t.dataset || {};
    if (t.id === 'wbst') { ui.filter.status = t.value; render(); return; }
    if (t.id === 'wbmw') { ui.filter.mw = t.value; render(); return; }
    if (d.retour) {
      const w = data.slips.find(x => x.id === d.retour); if (!w) return;
      if (t.checked) { if (w.status !== 'Retour' && w.status !== 'Verwerkt' && w.status !== 'Vervallen') await zetStatus([w], 'Retour', w.nummer + ' binnen'); }
      else if (w.status === 'Retour') await zetStatus([w], 'Uitgereikt', w.nummer + ' teruggezet op Uitgereikt');
      const x = document.getElementById('scanin'); if (x) x.focus(); return;
    }
    if (d.wbsetstat) { const w = data.slips.find(x => x.id === d.wbsetstat); if (w && await zetStatus([w], t.value, w.nummer + ' · ' + t.value) && ui.modal) ui.modal.slip = data.slips.find(x => x.id === w.id) || ui.modal.slip; render(); return; }
    if (d.wbsel) { t.checked ? ui.sel.add(d.wbsel) : ui.sel.delete(d.wbsel); render(); return; }
    if (d.wbselall) { ui.sel = new Set(); if (t.checked) ctx.container.querySelectorAll('input[data-wbsel]').forEach(x => ui.sel.add(x.dataset.wbsel)); render(); return; }
    if (d.psel) { t.checked ? ui.printSel.add(d.psel) : ui.printSel.delete(d.psel); render(); return; }
    if (d.pselall) { const dd = dagStand() === 'alle' ? vandaag() : dagStand(); ui.printSel = new Set(t.checked ? printRijenVan(dd).map(r => r.id) : []); render(); }
  }
  function invoer(e) { if (e.target.id === 'wbq') { ui.filter.q = e.target.value; render(); } }
  function toets(e) {
    if (e.target.id === 'scanin' && e.key === 'Enter') { e.preventDefault(); const v = e.target.value; if (v.trim()) bonBinnen(v); return; }
    if (e.key === 'Escape' && ui.modal) { ui.modal = null; render(); }
  }

  let gekoppeld = null;
  function koppel(container) {
    if (gekoppeld === container) return; gekoppeld = container;
    container.addEventListener('click', e => {
      if (e.target.closest && e.target.closest('.mbox') === null && e.target.dataset && e.target.dataset.modalbg) { ui.modal = null; render(); return; }
      klik(e);
    });
    container.addEventListener('change', wijzigEvent);
    container.addEventListener('input', invoer);
    container.addEventListener('keydown', toets);
  }

  async function open(config) {
    ctx = { container: config.container, request: config.request, canEdit: (await config.canEdit) === true, navigate: config.navigate || (() => {}) };
    ctx.container.classList.add('wb-scope');
    koppel(ctx.container);
    ui.modal = null;
    if (config.view) ui.view = config.view;
    render();
    await laad();
  }

  window.VsvkWerkbonnen = {
    open,
    model: { ronde, normSlip, maakNieuw, volgendNummer, uur, barcodeSvg, paperHTML, data, ui }
  };
}());
