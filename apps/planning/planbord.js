(function () {
  'use strict';

  /*
   * Werkopdrachten en Planbord, 1-op-1 naar het klantontwerp "VSVK Planning prototype".
   * Weergave: tijdlijn met werkopdracht › klussen › werkbonnen (+ materieel).
   * Data: /planbord/werkopdrachten (status, open plekken, bonnen, vestigingsscope)
   *       aangevuld met /planbord (klussen, tijden, materieelinzet) en referenties.
   * Wijzigingen: altijd de volledige werkopdracht ophalen en met If-Match terugschrijven.
   */

  const storage = (() => { try { return window.localStorage || null; } catch { return null; } })();
  const store = {
    get(key, fallback) { try { const value = storage?.getItem('vsvk-' + key); return value ? JSON.parse(value) : fallback; } catch { return fallback; } },
    set(key, value) { try { storage?.setItem('vsvk-' + key, JSON.stringify(value)); } catch {} }
  };
  const COLORS = ['#ff4e02', '#1e7a46', '#5b3fa0', '#0d6efd', '#9a6400', '#b3261e', '#00838f'];
  const dayNames = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  const monthNames = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const SLIP = { BINNEN: '✓ binnen', UITGEREIKT: 'UITGEREIKT', GEWIJZIGD: 'GEWIJZIGD !', NIET_GEPRINT: 'NIET GEPRINT', GEEN_BON: 'GEEN BON', GEPLAND: 'gepland' };

  const state = {
    container: null, request: null, canEdit: false,
    view: 'werkopdrachten', date: monday(new Date()), zoom: store.get('tlzoom', 'week') === 'month' ? 'month' : 'week',
    query: '', filter: 'all', expanded: new Set(store.get('tlopen', [])), dockTab: 'people',
    picked: null, dragging: null, busy: false, loading: false, loadSequence: 0,
    orders: [], details: new Map(), refs: null
  };

  /* ---------- helpers ---------- */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function btn(text, className, callback) {
    const node = el('button', className, text); node.type = 'button';
    if (callback) node.addEventListener('click', callback);
    return node;
  }
  function pad(value) { return String(value).padStart(2, '0'); }
  function iso(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }
  function parse(value) { const [y, m, d] = String(value).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(date, count) { const result = new Date(date); result.setDate(result.getDate() + count); return result; }
  function monday(date) { const result = new Date(date.getFullYear(), date.getMonth(), date.getDate()); return addDays(result, -((result.getDay() + 6) % 7)); }
  function weekNr(date) {
    const t = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n);
    const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y) / 864e5 + 1) / 7);
  }
  function hhmm(value) { return value ? String(value).slice(0, 5) : ''; }
  function apiTime(value) { return value ? (/^\d{2}:\d{2}$/.test(value) ? value + ':00' : value) : null; }
  function today() { return iso(new Date()); }
  function shortDay(value) { const x = parse(value); return dayNames[x.getDay()] + ' ' + x.getDate() + ' ' + monthNames[x.getMonth()]; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function sum(items) { return (items || []).reduce((total, item) => total + Number(item.aantal || 0), 0); }

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(text, bad) {
    let node = document.getElementById?.('board-toast');
    if (!node) {
      node = el('div', 'board-toast'); node.id = 'board-toast';
      node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite');
      (document.body || state.container).append(node);
    }
    node.textContent = text;
    node.className = 'board-toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.className = 'board-toast'; }, 3200);
  }

  /* ---------- laden ---------- */
  async function open(config) {
    state.container = config.container;
    state.request = config.request;
    state.canEdit = (await config.canEdit) === true;
    state.view = config.mode === 'workorders' ? 'werkopdrachten' : 'planbord';
    state.picked = null;
    describe();
    await load();
  }

  function describe() {
    const title = document.getElementById?.('title');
    const description = document.getElementById?.('description');
    if (title) title.textContent = state.view === 'planbord' ? 'Planbord' : 'Werkopdrachten';
    if (description) description.textContent = state.view === 'planbord'
      ? 'Sleep mensen en materieel uit de planninglade naar een werkdag. Op een tablet: tik op een kaart en daarna op een dag.'
      : 'Alle werkopdrachten in de periode. Klap een werkopdracht uit voor klussen en werkbonnen per persoon.';
  }

  function dayCount() { return state.view === 'werkopdrachten' && state.zoom === 'month' ? 28 : 7; }
  function period() {
    return Array.from({ length: dayCount() }, (_, index) => {
      const date = addDays(state.date, index);
      return { iso: iso(date), kort: dayNames[date.getDay()], nr: date.getDate(), weekend: [0, 6].includes(date.getDay()), today: iso(date) === today() };
    });
  }
  function periodTitle(days) {
    const a = parse(days[0].iso), b = parse(days.at(-1).iso);
    const week = days.length === 7 ? 'Week ' + weekNr(a) : 'Week ' + weekNr(a) + '–' + weekNr(b);
    return week + ' · ' + a.getDate() + ' ' + monthNames[a.getMonth()] + ' – ' + b.getDate() + ' ' + monthNames[b.getMonth()];
  }

  async function loadReferences() {
    if (state.refs) return state.refs;
    const [board, form, employees] = await Promise.all([
      state.request('/api/planning/planbord/referenties'),
      state.request('/api/planning/werkopdrachten/form-referenties'),
      state.request('/api/planning/medewerkers').catch(() => [])
    ]);
    state.refs = { board, form, employees };
    return state.refs;
  }

  async function load() {
    if (!state.container) return;
    const sequence = ++state.loadSequence;
    if (!state.container.childNodes?.length) state.container.replaceChildren(el('div', 'empty', 'Planning laden…'));
    const days = period();
    const from = days[0].iso, to = days.at(-1).iso;
    const finish = window.VsvkLoading?.begin?.() || (() => {});
    state.loading = true;
    try {
      const [timeline, board] = await Promise.all([
        state.request('/api/planning/planbord/werkopdrachten?van=' + from + '&tot=' + to + '&zoom=week'),
        state.request('/api/planning/planbord?from=' + from + '&to=' + to),
        loadReferences()
      ]);
      if (sequence !== state.loadSequence) return;
      state.details = new Map((board || []).map(order => [order.id, order]));
      state.orders = (timeline.groepen || []).flatMap(group => group.werkopdrachten).map(item => model(item, state.details.get(item.id)));
      render();
    } catch (error) {
      if (sequence === state.loadSequence) state.container.replaceChildren(el('div', 'empty', 'Planning laden mislukt: ' + error.message));
    } finally {
      state.loading = false; finish();
    }
  }

  /* Combineer tijdlijnregel (server-status) met de volledige werkopdracht. */
  function model(line, detail) {
    const jobs = detail?.klussen || [];
    const workDays = [...new Set(jobs.map(job => job.datum).filter(Boolean))].sort();
    const first = jobs.find(job => job.startTijd) || {};
    const materials = new Map();
    for (const job of jobs) for (const item of job.materieelInzetten || []) {
      if (!materials.has(item.materieelId)) materials.set(item.materieelId, { id: item.materieelId, naam: item.materieel || 'Materieel', dagen: new Set() });
      materials.get(item.materieelId).dagen.add(item.datum);
    }
    const people = new Map(), equipment = new Map();
    for (const job of jobs) {
      for (const item of job.inzetten || []) {
        const key = item.medewerkerId || item.inhuurmedewerkerId;
        if (!people.has(key)) people.set(key, new Set());
        people.get(key).add(item.datum);
      }
      for (const item of job.materieelInzetten || []) {
        if (!equipment.has(item.materieelId)) equipment.set(item.materieelId, new Set());
        equipment.get(item.materieelId).add(item.datum);
      }
    }
    const cells = line.dagen || {};
    const nodig = Math.max(0, ...Object.values(cells).map(cell => cell?.nodig || 0), sum(detail?.behoeften));
    return {
      id: line.id, nummer: line.nummer || '—', klant: line.klantNaam, kort: detail?.korteWerkomschrijving || line.kop || '',
      status: line.status || (line.optie ? 'OPTIE' : line.openPlekken ? 'OPEN ' + line.openPlekken : 'GEPLAND'),
      kleur: line.kleur || COLORS[0], optie: !!line.optie, openPlekken: Number(line.openPlekken || 0),
      bonnenTeDoen: Number(line.bonnenTeDoen || 0), bonnen: Number(line.bonnen || 0), binnen: Number(line.bonnenBinnen || 0),
      startDatum: line.startDatum, eindDatum: line.eindDatum,
      tijd: [hhmm(detail?.startOpLocatie || first.startTijd), hhmm(detail?.eindOpLocatie || first.eindTijd)],
      adres: detail?.werkadres || '', plaats: detail?.werkPlaats || '',
      rollen: (detail?.behoeften || []).map(need => need.rol).filter(Boolean),
      werkdagen: workDays.length ? workDays : Object.keys(cells).sort(),
      dagen: cells, nodig, mensen: line.mensen || [], materieel: [...materials.values()],
      inzetPerPersoon: people, inzetPerMaterieel: equipment
    };
  }

  /* ---------- render ---------- */
  function render() {
    const root = el('div', 'planning-board tl-view');
    const days = period();
    const toolbar = el('div', 'board-toolbar');
    const previous = btn('◀', 'board-btn', () => shift(-1)); previous.setAttribute('aria-label', 'Vorige periode');
    const next = btn('▶', 'board-btn', () => shift(1)); next.setAttribute('aria-label', 'Volgende periode');
    toolbar.append(previous, el('strong', 'board-period', periodTitle(days)), next,
      btn('Vandaag', 'board-btn', () => { state.date = monday(new Date()); load(); }), el('span', 'board-spacer'));
    if (state.view === 'werkopdrachten') {
      const zoom = el('div', 'board-group');
      for (const [value, label] of [['week', 'Week'], ['month', '4 weken']])
        zoom.append(btn(label, 'board-toggle' + (state.zoom === value ? ' active' : ''), () => {
          state.zoom = value; store.set('tlzoom', value); load();
        }));
      toolbar.append(zoom);
    }
    if (state.canEdit) toolbar.append(btn('+ Werkopdracht', 'board-btn primary', () => editor(null)));

    const filters = el('div', 'board-filters');
    const search = el('input'); search.type = 'search'; search.value = state.query;
    search.placeholder = 'Zoek WO-nummer, klant, medewerker of bonnummer…'; search.setAttribute('aria-label', 'Zoek werkopdracht');
    search.addEventListener('input', () => { state.query = search.value; drawGrid(); });
    filters.append(search);
    const all = state.orders;
    for (const [value, label, tone] of [
      ['all', 'Alle ' + all.length, ''],
      ['open', 'Open plekken ' + all.filter(order => order.openPlekken > 0).length, ' danger'],
      ['slips', 'Bonnen te doen ' + all.filter(order => order.bonnenTeDoen > 0).length, ' warning']])
      filters.append(btn(label, 'board-filter' + tone + (state.filter === value ? ' active' : ''), () => { state.filter = value; render(); }));
    filters.append(btn(state.expanded.size ? 'Alles inklappen' : 'Alles uitklappen', 'board-btn', () => {
      if (state.expanded.size) state.expanded.clear(); else all.forEach(order => state.expanded.add(order.id));
      store.set('tlopen', [...state.expanded]); render();
    }));

    const grid = el('div', 'board-scroll tl-scroll');
    state.grid = grid;
    const workspace = el('div', 'board-workspace');
    workspace.append(toolbar, filters, grid, legend());
    if (state.view === 'planbord') {
      const layout = el('div', 'board-layout dock-left');
      layout.append(dock(), workspace); root.append(layout);
    } else root.append(workspace);
    state.container.replaceChildren(root);
    drawGrid();
  }

  function shift(direction) { state.date = addDays(state.date, direction * dayCount()); load(); }

  function visible() {
    const query = state.query.trim().toLocaleLowerCase('nl');
    return [...state.orders]
      .sort((a, b) => String(a.startDatum).localeCompare(String(b.startDatum)) || a.nummer.localeCompare(b.nummer))
      .filter(order => {
        if (state.filter === 'open' && !order.openPlekken) return false;
        if (state.filter === 'slips' && !order.bonnenTeDoen) return false;
        if (!query) return true;
        return [order.nummer, order.klant, order.kort,
          ...order.mensen.map(person => person.naam),
          ...order.mensen.flatMap(person => Object.values(person.dagen || {}).filter(Boolean).flatMap(day => [day.nummer || '', day.oudNummer || '']))]
          .join(' ').toLocaleLowerCase('nl').includes(query);
      });
  }

  function drawGrid() {
    const grid = state.grid; if (!grid) return;
    const days = period();
    const zoom = state.view === 'werkopdrachten' ? state.zoom : 'week';
    const table = el('div', 'tl-table tl-zoom-' + zoom);
    table.style.setProperty('--tl-days', days.length);
    const head = el('div', 'tl-row tl-head');
    head.append(el('div', 'tl-label', 'Werkopdracht › klussen › werkbonnen'));
    const headDays = el('div', 'tl-days');
    for (const day of days) {
      const cell = el('div', 'tl-day' + (day.today ? ' today' : '') + (day.weekend ? ' weekend' : ''));
      cell.append(el('span', '', days.length > 7 ? day.kort[0] : day.kort), el('b', '', String(day.nr)));
      headDays.append(cell);
    }
    head.append(headDays); table.append(head);
    const list = visible();
    for (const order of list) {
      const expanded = state.expanded.has(order.id) || !!state.query.trim();
      table.append(orderRow(order, days, expanded));
      if (!expanded) continue;
      table.append(jobRow(order, days));
      for (const person of order.mensen) table.append(personRow(order, person, days));
      for (const material of order.materieel.filter(item => days.some(day => item.dagen.has(day.iso))))
        table.append(materialRow(order, material, days));
      if (!order.mensen.length) {
        const empty = el('div', 'tl-row tl-person');
        empty.append(el('div', 'tl-person-label no-people', 'Nog niemand ingepland'), el('div', 'tl-days'));
        table.append(empty);
      }
    }
    if (!list.length) {
      const query = state.query.trim();
      const empty = el('div', 'empty', query ? 'Niets gevonden voor ‘' + query + '’ ' : 'Geen werkopdrachten in deze periode. ');
      if (query) empty.append(btn('Wis zoekterm', 'board-btn', () => { state.query = ''; render(); }));
      else if (state.canEdit) empty.append(btn('+ Nieuwe werkopdracht', 'board-btn primary', () => editor(null)));
      table.append(empty);
    }
    grid.replaceChildren(table);
  }

  function cell(day, extra) { return el('div', 'tl-cell ' + (extra || '') + (day.today ? ' today' : '') + (day.weekend ? ' weekend' : '')); }
  function statusClass(status) {
    return status === 'GEPLAND' ? 'gepland' : status === 'AFGEROND' ? 'afgerond'
      : (status === 'OPTIE' || status === 'NIET INGEPLAND') ? 'muted' : 'open';
  }

  function orderRow(order, days, expanded) {
    const row = el('div', 'tl-row tl-wo' + (order.optie ? ' option' : ''));
    const label = el('div', 'tl-wo-label'); label.tabIndex = 0;
    label.setAttribute('role', 'button'); label.setAttribute('aria-expanded', String(expanded));
    label.append(el('span', 'tl-chevron', expanded ? '▾' : '▸'), el('span', 'tl-number', order.nummer),
      el('b', 'tl-customer', order.klant), el('small', '', order.kort),
      el('span', 'tl-workorder-status ' + statusClass(order.status), order.status));
    label.append(btn(state.canEdit ? 'Bewerken' : 'Bekijken', 'board-open', event => { event.stopPropagation?.(); editor(order); }));
    const toggle = () => {
      state.expanded.has(order.id) ? state.expanded.delete(order.id) : state.expanded.add(order.id);
      store.set('tlopen', [...state.expanded]); drawGrid();
    };
    label.addEventListener('click', toggle);
    label.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault?.(); toggle(); } });
    const cells = el('div', 'tl-days tl-order-span');
    const indices = days.map((day, index) => order.werkdagen.includes(day.iso) ? index : -1).filter(index => index >= 0);
    for (const day of days) {
      const item = cell(day, 'tl-wo-cell'); item.style.gridRow = '1';
      if (order.werkdagen.includes(day.iso)) dropTarget(item, order, day.iso);
      cells.append(item);
    }
    if (indices.length) {
      const bar = btn('', 'tl-order-bar' + (order.optie ? ' option' : ''), () => editor(order));
      bar.style.setProperty('--wo-color', order.kleur);
      bar.style.gridColumn = (indices[0] + 1) + '/' + (indices.at(-1) + 2);
      bar.textContent = days.length > 7 ? (indices.length >= 3 ? order.nummer : '') : order.nummer + ' · ' + order.bonnen + ' bonnen, ' + order.binnen + ' binnen';
      bar.title = order.nummer + ' · ' + order.tijd.filter(Boolean).join('–') + ' · ' + [order.adres, order.plaats].filter(Boolean).join(' ');
      if (state.view === 'planbord') bar.style.pointerEvents = 'none';
      cells.append(bar);
    }
    row.append(label, cells); return row;
  }

  function jobRow(order, days) {
    const row = el('div', 'tl-row tl-job-row');
    const count = order.werkdagen.length;
    const label = el('div', 'tl-person-label tl-job-label');
    label.append(el('b', '', 'Klussen'), el('small', '', count + (count === 1 ? ' dag' : ' dagen') + ' · ' + order.nodig + ' mensen per dag' +
      (order.tijd[0] ? ' · ' + order.tijd.filter(Boolean).join('–') : '')));
    const cells = el('div', 'tl-days');
    for (const day of days) {
      const item = cell(day, 'tl-person-cell');
      const data = order.dagen[day.iso];
      if (data && order.werkdagen.includes(day.iso)) {
        const full = data.bezetting === 'vol', empty = data.bezetting === 'leeg' || Number(data.bezet) === 0;
        item.append(el('span', 'board-chip ' + (full ? 'complete' : empty ? 'empty' : 'partial'), (full ? '✓ ' : '') + 'P ' + data.bezet + '/' + data.nodig));
        if (days.length <= 7) item.append(el('small', '', 'vertrek ' + (data.vertrek || order.tijd[0] || '—')));
        dropTarget(item, order, day.iso);
      }
      cells.append(item);
    }
    row.append(label, cells); return row;
  }

  function personRow(order, person, days) {
    const row = el('div', 'tl-row tl-person');
    const label = el('div', 'tl-person-label');
    if (person.extern) label.append(el('span', 'board-external', 'INH'));
    label.append(el('b', '', person.naam), el('small', '', person.functie || ''));
    const cells = el('div', 'tl-days');
    for (const day of days) {
      const item = cell(day, 'tl-person-cell');
      const assignment = (person.dagen || {})[day.iso];
      if (assignment) {
        const text = SLIP[assignment.status] || assignment.status;
        const status = btn(text, 'tl-status ' + String(assignment.status).toLowerCase(), () => slipDialog(order, person, day.iso, assignment));
        status.title = person.naam + ', ' + day.kort + ' ' + day.nr + ': ' + text + (assignment.nummer ? ', ' + assignment.nummer : '');
        status.setAttribute('aria-label', status.title); item.append(status);
        if (days.length <= 7 && assignment.nummer) item.append(el('small', '', assignment.nummer));
      }
      cells.append(item);
    }
    row.append(label, cells); return row;
  }

  function materialRow(order, material, days) {
    const row = el('div', 'tl-row tl-person board-row material');
    const label = el('div', 'tl-person-label board-person-label');
    label.append(el('span', 'board-material-label', 'MAT'), el('b', '', material.naam));
    const cells = el('div', 'tl-days');
    for (const day of days) {
      const item = cell(day, 'tl-person-cell');
      if (material.dagen.has(day.iso)) {
        const removable = state.view === 'planbord' && state.canEdit;
        const status = btn('ingepland', 'tl-status gepland', () => {
          if (removable) removeMaterial(order, material, day.iso);
        });
        status.title = removable ? 'Klik om te verwijderen' : material.naam;
        item.append(status);
      }
      cells.append(item);
    }
    row.append(label, cells); return row;
  }

  function legend() {
    const result = el('div', 'board-legend');
    result.append(el('span', 'tl-legend-copy', state.view === 'planbord'
      ? 'Groen = past, rood = niet mogelijk (al ingepland of geen werkdag).'
      : 'Klik op een werkbonstatus om de bon te bekijken.'));
    for (const key of ['BINNEN', 'UITGEREIKT', 'GEWIJZIGD', 'NIET_GEPRINT', 'GEPLAND'])
      result.append(el('span', 'tl-status ' + key.toLowerCase(), SLIP[key]));
    return result;
  }

  /* ---------- planninglade ---------- */
  function dock() {
    const aside = el('aside', 'board-dock'); aside.setAttribute('aria-label', 'Inplanbare middelen');
    const head = el('div', 'board-dock-head'); head.append(el('strong', '', 'PLANNING'));
    const tabs = el('div', 'board-dock-tabs');
    for (const [key, label] of [['people', 'Mensen'], ['equipment', 'Materieel'], ['customers', 'Klanten'], ['stock', 'Voorraad']])
      tabs.append(btn(label, 'board-dock-tab' + (state.dockTab === key ? ' active' : ''), () => { state.dockTab = key; state.picked = null; render(); }));
    const search = el('input'); search.type = 'search'; search.placeholder = 'Zoeken…'; search.setAttribute('aria-label', 'Zoek in planninglade');
    const list = el('div', 'board-dock-list');
    const fill = () => {
      const query = search.value.trim().toLocaleLowerCase('nl');
      const items = dockItems();
      list.replaceChildren();
      for (const item of items.filter(item => !query || (item.title + ' ' + item.sub).toLocaleLowerCase('nl').includes(query)))
        list.append(dockCard(item));
      if (!list.children.length) list.append(el('div', 'empty', state.dockTab === 'stock' ? 'Werkvoorraad is nog niet beschikbaar.' : 'Niets gevonden.'));
    };
    search.addEventListener('input', fill); fill();
    const hint = !state.canEdit ? 'Alleen bekijken: inplannen is niet toegestaan.'
      : state.dockTab === 'stock' ? 'Klik op een opdracht om een datum te kiezen.'
      : state.dockTab === 'customers' ? 'Klantgegevens ter info.'
      : 'Sleep naar een werkdag, of tik op een kaart en daarna op een dag.';
    aside.append(head, tabs, search, el('small', 'hint', hint), list);
    return aside;
  }

  function dockItems() {
    const refs = state.refs || {};
    const days = new Set(period().map(day => day.iso));
    const planned = key => {
      const set = new Set();
      for (const order of state.orders) for (const day of order.inzetPerPersoon.get(key) || []) if (days.has(day)) set.add(day);
      return set.size;
    };
    if (state.dockTab === 'people') {
      const functions = new Map((refs.employees || []).map(item => [item.id, item.functie]));
      return [
        ...(refs.board?.medewerkers || []).map(item => ({
          kind: 'employee', key: item.id, title: item.naam,
          functie: functions.get(item.id) || '', sub: (functions.get(item.id) || 'Eigen medewerker') + ' · ' + planned(item.id) + '/5 dagen ingepland'
        })),
        ...(refs.board?.inhuurmedewerkers || []).map(item => ({
          kind: 'subcontractor', key: item.id, title: item.naam, functie: item.functie || '',
          sub: 'Inhuur · ' + item.leverancier + ' · ' + planned(item.id) + '/5 dagen ingepland'
        }))
      ];
    }
    if (state.dockTab === 'equipment') return (refs.form?.materieel || []).map(item => ({ kind: 'equipment', key: item.id, title: item.naam, sub: 'Materieel' }));
    if (state.dockTab === 'customers') return (refs.form?.klanten || []).map(item => ({
      kind: 'info', key: 'k' + item.id, title: item.naam, sub: [item.debiteurnummer, item.plaats].filter(Boolean).join(' · ')
    }));
    return [];
  }

  function dockCard(item) {
    const card = el('div', 'board-dock-card' + (state.picked?.key === item.key ? ' picked' : ''));
    card.append(el('strong', '', item.title), el('small', '', item.sub));
    if (state.canEdit && ['employee', 'subcontractor', 'equipment'].includes(item.kind)) {
      card.draggable = true; card.tabIndex = 0;
      card.setAttribute('aria-label', 'Sleep ' + item.title + ' naar een werkdag');
      card.addEventListener('dragstart', event => {
        if (state.busy) { event.preventDefault?.(); return; }
        state.dragging = item; card.classList.add('dragging');
        try { event.dataTransfer.setData('text/plain', item.key); event.dataTransfer.effectAllowed = 'copy'; } catch {}
      });
      card.addEventListener('dragend', () => { state.dragging = null; card.classList.remove('dragging'); clearTargets(); });
      const pick = () => {
        state.picked = state.picked?.key === item.key ? null : item;
        state.container.querySelectorAll?.('.board-dock-card.picked').forEach(node => node.classList.remove('picked'));
        if (state.picked) { card.classList.add('picked'); toast(item.title + ' gekozen: tik op een werkdag.'); }
      };
      card.addEventListener('click', pick);
      card.addEventListener('keydown', event => { if (event.key === 'Enter') pick(); });
    } else card.classList.add('readonly');
    return card;
  }

  function clearTargets() {
    state.container?.querySelectorAll?.('.drag-target,.drag-invalid').forEach(node => node.classList.remove('drag-target', 'drag-invalid'));
  }

  function check(item, order, day) {
    if (item.kind === 'equipment') {
      if (order.inzetPerMaterieel.get(item.key)?.has(day)) return 'Al ingepland op deze dag';
      const other = state.orders.find(x => x.id !== order.id && x.inzetPerMaterieel.get(item.key)?.has(day));
      return other ? 'Al in gebruik bij ' + other.nummer : '';
    }
    if (order.inzetPerPersoon.get(item.key)?.has(day)) return 'Al ingepland op deze werkopdracht';
    const other = state.orders.find(x => x.id !== order.id && x.inzetPerPersoon.get(item.key)?.has(day));
    return other ? 'Al ingepland bij ' + other.nummer : '';
  }

  function dropTarget(node, order, day) {
    if (state.view !== 'planbord' || !state.canEdit) return;
    node.classList.add('board-day-drop');
    node.addEventListener('dragover', event => {
      if (!state.dragging || state.busy) return;
      event.preventDefault?.(); clearTargets();
      node.classList.add(check(state.dragging, order, day) ? 'drag-invalid' : 'drag-target');
    });
    node.addEventListener('dragleave', () => node.classList.remove('drag-target', 'drag-invalid'));
    node.addEventListener('drop', event => {
      event.preventDefault?.(); clearTargets();
      const item = state.dragging; state.dragging = null;
      if (item) assign(item, order, day);
    });
    node.addEventListener('click', () => { if (state.picked) assign(state.picked, order, day); });
  }

  /* ---------- schrijven: werkopdracht ophalen, aanpassen, met If-Match opslaan ---------- */
  function writeValue(order, klussen) {
    return {
      nummer: order.nummer || null, klantId: Number(order.klantId) || 0,
      omschrijving: order.korteWerkomschrijving || order.omschrijving || '',
      startDatum: order.startDatum, eindDatum: order.eindDatum, isOptie: !!order.isOptie,
      kleur: order.kleur, vestigingId: order.vestigingId || null, optieTot: order.optieTot || null,
      soort: order.soort || 'regie', internProjectnummer: order.internProjectnummer || null,
      bestellerId: Number(order.bestellerId) || null, bestellerNaam: order.bestellerNaam || null,
      bestellerTelefoon: order.bestellerTelefoon || null, bestellerEmail: order.bestellerEmail || null,
      optieReden: order.optieReden || null, weekendOverslaan: order.weekendOverslaan !== false,
      vrijeDagen: order.vrijeDagen || [], werkvoorraad: !!order.werkvoorraad,
      geschatteUren: order.geschatteUren ? Number(order.geschatteUren) : null,
      uiterlijkKlaar: order.uiterlijkKlaar || null, prioriteit: order.prioriteit || 'normaal',
      korteWerkomschrijving: order.korteWerkomschrijving || null, werkInhoud: order.werkInhoud || null,
      instructies: order.instructies || null, werkadres: order.werkadres || null,
      werkPostcode: order.werkPostcode || null, werkPlaats: order.werkPlaats || null,
      gpsLocatie: order.gpsLocatie || null, contactLocatieNaam: order.contactLocatieNaam || null,
      contactLocatieTelefoon: order.contactLocatieTelefoon || null,
      startOpLocatie: apiTime(order.startOpLocatie), eindOpLocatie: apiTime(order.eindOpLocatie),
      pauzeMinuten: Number(order.pauzeMinuten ?? 30), meerdereDiensten: !!order.meerdereDiensten, diensten: null,
      ordernummers: (order.ordernummers || []).filter(Boolean),
      behoeften: (order.behoeften || []).map(need => ({ aantal: need.aantal, rol: need.rol ?? null, skill: need.skill ?? null, soort: 'mens' })),
      materieel: (order.materieel || []).map(need => ({
        aantal: need.aantal, materieelGroepId: need.materieelGroepId ?? null, materieelId: need.materieelId ?? null,
        type: need.type ?? need.rol ?? null, losseVerhuur: !!need.losseVerhuur
      })),
      materialen: order.materialen || [],
      klussen: klussen ? order.klussen.map(job => ({
        omschrijving: job.omschrijving, startDatum: job.startDatum, eindDatum: job.eindDatum,
        benodigdeMedewerkers: job.benodigdeMedewerkers, startTijd: job.startTijd, eindTijd: job.eindTijd,
        sorteervolgorde: job.sorteervolgorde, behoeften: job.behoeften || [], datum: job.datum,
        reisHeen: job.reisHeen, reisTerug: job.reisTerug,
        inzetten: (job.inzetten || []).map(item => ({
          datum: item.datum, medewerkerId: item.medewerkerId || null, inhuurmedewerkerId: item.inhuurmedewerkerId || null,
          startTijd: item.startTijd, eindTijd: item.eindTijd,
          werkbon: item.werkbon ? {
            nummer: item.werkbon.nummer, status: item.werkbon.status, gewijzigdNaUitgifte: !!item.werkbon.gewijzigdNaUitgifte,
            uitgereiktOp: item.werkbon.uitgereiktOp || null, binnenOp: item.werkbon.binnenOp || null
          } : null
        })),
        materieelInzetten: (job.materieelInzetten || []).map(item => ({ datum: item.datum, materieelId: item.materieelId }))
      })) : []
    };
  }

  /* Eén wijziging aan de inzet: nooit automatisch opnieuw proberen bij 412. */
  async function mutate(orderId, change, success) {
    if (state.busy) return false;
    state.busy = true;
    try {
      const order = await state.request('/api/planning/werkopdrachten/' + orderId);
      const problem = change(order);
      if (problem) { toast(problem, true); return false; }
      await state.request('/api/planning/werkopdrachten/' + orderId, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': order.eTag },
        body: JSON.stringify(writeValue(order, true))
      });
      if (success) toast(success.text, success.bad);
      return true;
    } catch (error) {
      toast(error.status === 412
        ? 'De werkopdracht is intussen door iemand anders gewijzigd. Het scherm is ververst; probeer het opnieuw.'
        : 'Opslaan mislukt: ' + error.message, true);
      return false;
    } finally {
      state.busy = false;
      await load();
    }
  }

  function assign(item, order, day) {
    const problem = check(item, order, day);
    if (problem) { toast(item.title + ': ' + problem.toLocaleLowerCase('nl') + '.', true); return; }
    state.picked = null;
    const functie = item.kind === 'equipment' ? '' : item.functie;
    const warn = functie && order.rollen.length && !order.rollen.includes(functie) ? ' Let op: functie ' + functie + ' wordt niet gevraagd.' : '';
    state.expanded.add(order.id); store.set('tlopen', [...state.expanded]);
    return mutate(order.id, detail => {
      const job = (detail.klussen || []).filter(x => x.datum === day).sort((a, b) => a.sorteervolgorde - b.sorteervolgorde)[0];
      if (!job) return item.title + ': geen werkdag op ' + shortDay(day) + '.';
      if (item.kind === 'equipment') {
        job.materieelInzetten = job.materieelInzetten || [];
        job.materieelInzetten.push({ datum: day, materieelId: item.key });
      } else {
        job.inzetten = job.inzetten || [];
        job.inzetten.push({
          datum: day, medewerkerId: item.kind === 'employee' ? item.key : null,
          inhuurmedewerkerId: item.kind === 'subcontractor' ? item.key : null,
          startTijd: job.startTijd, eindTijd: job.eindTijd, werkbon: null
        });
      }
      return '';
    }, { text: item.title + ' ingepland op ' + order.nummer + ', ' + shortDay(day) + '.' + warn, bad: !!warn });
  }

  function removeMaterial(order, material, day) {
    return mutate(order.id, detail => {
      for (const job of detail.klussen || [])
        job.materieelInzetten = (job.materieelInzetten || []).filter(item => !(item.materieelId === material.id && item.datum === day));
      return '';
    }, { text: material.naam + ' verwijderd van ' + shortDay(day) });
  }

  function findAssignment(detail, person, day, jobId) {
    for (const job of detail.klussen || []) {
      if (jobId && job.id !== jobId) continue;
      const item = (job.inzetten || []).find(x => x.datum === day && (x.medewerkerId === person.id || x.inhuurmedewerkerId === person.id));
      if (item) return { job, item };
    }
    return null;
  }

  /* ---------- werkbon ---------- */
  function dialog(title, wide) {
    const node = el('dialog', 'board-dialog');
    if (!wide) node.style.width = 'min(620px,calc(100% - 24px))';
    const box = el('div', 'board-dialog-box');
    const head = el('div', 'board-dialog-head'); head.append(el('h2', '', title), btn('✕', 'board-btn ghost', () => node.close()));
    const body = el('div', 'board-dialog-body');
    const foot = el('div', 'board-dialog-foot');
    const msg = el('span', 'board-dialog-status'); msg.setAttribute('role', 'status'); foot.append(msg);
    box.append(head, body, foot); node.append(box); state.container.append(node);
    node.addEventListener('close', () => node.remove());
    return { node, body, foot, msg };
  }

  function slipDialog(order, person, day, assignment) {
    const { node, body, foot, msg } = dialog('Werkbon ' + (assignment.nummer || '(nog niet aangemaakt)'));
    const grid = el('div', 'board-form-grid');
    for (const [label, value] of [['Werkopdracht', order.nummer], ['Klant', order.klant], ['Medewerker', person.naam],
      ['Functie', person.functie || '—'], ['Datum', shortDay(day)], ['Status', SLIP[assignment.status] || assignment.status]]) {
      const field = el('div', 'board-field', label); field.append(el('span', 'ro', value)); grid.append(field);
    }
    body.append(grid, el('p', 'hint', 'Werktijd ' + order.tijd.filter(Boolean).join('–') + ' · ' + [order.adres, order.plaats].filter(Boolean).join(', ')));
    const run = async (change, text) => { node.close(); await mutate(order.id, detail => {
      const found = findAssignment(detail, person, day, assignment.klusId);
      if (!found) return 'Deze inzet bestaat niet meer.';
      return change(found);
    }, { text }); };
    const slip = (status, label) => () => run(({ item }) => {
      if (!item.werkbon) return 'Deze inzet heeft nog geen werkbon.';
      const now = new Date().toISOString();
      item.werkbon = { ...item.werkbon, status, gewijzigdNaUitgifte: false,
        uitgereiktOp: status === 'uitgereikt' ? now : item.werkbon.uitgereiktOp,
        binnenOp: status === 'binnen' ? now : item.werkbon.binnenOp };
      return '';
    }, 'Werkbon ' + assignment.nummer + ': ' + label);
    if (state.canEdit) {
      const remove = btn('Inzet verwijderen', 'board-btn board-remove danger', () => run(({ job, item }) => {
        job.inzetten = job.inzetten.filter(x => x !== item); return '';
      }, person.naam + ' verwijderd van ' + order.nummer));
      remove.style.marginRight = 'auto';
      foot.append(remove);
      const status = assignment.status;
      const actions = [];
      if (status === 'GEPLAND' || status === 'GEWIJZIGD') actions.push(btn('Printen', 'board-btn', slip('aangemaakt', SLIP.NIET_GEPRINT)));
      if (status !== 'UITGEREIKT' && status !== 'BINNEN') actions.push(btn('Uitgereikt', 'board-btn', slip('uitgereikt', SLIP.UITGEREIKT)));
      if (status !== 'BINNEN') actions.push(btn('Binnen melden', 'board-btn primary', slip('binnen', SLIP.BINNEN)));
      if (!assignment.bonId) {
        actions.forEach(action => { action.disabled = true; action.title = 'Er is nog geen werkbon voor deze inzet'; });
        if (actions.length) msg.textContent = 'Deze inzet heeft nog geen werkbon.';
      }
      foot.append(...actions);
    }
    foot.append(btn('Werkopdracht openen', 'board-btn', () => { node.close(); editor(order); }));
    node.showModal();
  }

  /* ---------- werkopdracht toevoegen / bewerken ---------- */
  function workDays(draft) {
    if (!draft.startDatum || !draft.eindDatum || draft.werkvoorraad || draft.eindDatum < draft.startDatum) return [];
    const result = [];
    for (let date = parse(draft.startDatum); date <= parse(draft.eindDatum); date = addDays(date, 1)) {
      const value = iso(date);
      if (draft.weekendOverslaan && [0, 6].includes(date.getDay())) continue;
      if ((draft.vrijeDagen || []).includes(value)) continue;
      result.push(value);
    }
    return result;
  }

  function newDraft() {
    return {
      id: null, nummer: '', klantId: null, bestellerId: null, bestellerNaam: '', bestellerTelefoon: '', bestellerEmail: '',
      soort: 'regie', isOptie: false, optieReden: '', korteWerkomschrijving: '', internProjectnummer: '',
      startDatum: '', eindDatum: '', weekendOverslaan: true, vrijeDagen: [], startOpLocatie: '07:00', eindOpLocatie: '16:00',
      werkvoorraad: false, geschatteUren: '', prioriteit: 'normaal', werkInhoud: '', instructies: '',
      werkadres: '', werkPostcode: '', werkPlaats: '', contactLocatieNaam: '', contactLocatieTelefoon: '',
      behoeften: [], materieel: [], materialen: [], ordernummers: [], pauzeMinuten: 30,
      kleur: COLORS[state.orders.length % COLORS.length], klussen: []
    };
  }

  async function editor(summary) {
    let baseline = null;
    if (summary) {
      try { baseline = await state.request('/api/planning/werkopdrachten/' + summary.id); }
      catch (error) { toast('Werkopdracht laden mislukt: ' + error.message, true); return; }
    }
    const refs = await loadReferences();
    const customers = refs.form?.klanten || [];
    const functions = refs.form?.functies || [];
    const equipment = refs.form?.materieel || [];
    const draft = baseline ? Object.assign(newDraft(), clone(baseline), {
      startOpLocatie: hhmm(baseline.startOpLocatie) || '07:00', eindOpLocatie: hhmm(baseline.eindOpLocatie) || '16:00',
      materieel: (baseline.materieel || []).map(need => ({ ...need, type: need.rol ?? null })),
      vrijeDagen: baseline.vrijeDagen || []
    }) : newDraft();
    if (draft.werkvoorraad) { draft.startDatum = draft.startDatum || ''; }
    const editable = state.canEdit;
    const title = baseline ? 'Werkopdracht ' + baseline.nummer + (editable ? ' bewerken' : ' bekijken') : 'Werkopdracht toevoegen';
    const { node, body, foot, msg } = dialog(title, true);
    const shell = el('div', 'wo-form-shell'), form = el('div', 'wo-form'), aside = el('aside', 'wo-summary');
    shell.append(form, aside); body.append(shell);
    const field = (label, control, hint) => { const result = el('label', 'board-field', label); result.append(control); if (hint) result.append(el('small', 'hint', hint)); return result; };
    const grid = (...children) => { const result = el('div', 'board-form-grid'); result.append(...children); return result; };
    const inp = (key, type, label) => {
      const control = el(type === 'textarea' ? 'textarea' : 'input');
      if (type !== 'textarea') control.type = type || 'text';
      control.value = draft[key] ?? ''; control.setAttribute('aria-label', label);
      control.addEventListener('input', () => { draft[key] = control.value; update(); });
      return control;
    };
    const steps = [];
    const section = (number, heading, ok, children) => {
      const step = el('section', 'wo-step'); const top = el('div', 'wo-step-head'); const badge = el('span', 'wo-step-number');
      top.append(badge, el('h3', '', number + ' · ' + heading)); step.append(top, ...children); form.append(step);
      steps.push({ badge, number, ok });
    };
    const customer = () => customers.find(item => item.id === Number(draft.klantId));

    // 1 · Klant
    const klant = el('select'); klant.setAttribute('aria-label', 'Klant');
    klant.append(new Option('— kies klant —', ''), ...customers.map(item => new Option(item.naam + ' (' + item.debiteurnummer + ')', item.id)));
    klant.value = draft.klantId ? String(draft.klantId) : '';
    const buyer = el('select'); buyer.setAttribute('aria-label', 'Besteller');
    const card = el('div', 'wo-customer-card');
    const setBuyer = contact => {
      draft.bestellerId = contact?.id || null; draft.bestellerNaam = contact?.naam || '';
      draft.bestellerTelefoon = contact?.telefoon || ''; draft.bestellerEmail = contact?.email || '';
    };
    const fillBuyer = () => {
      const current = customer();
      buyer.replaceChildren(new Option('— kies besteller —', ''), ...(current?.contacten || []).map(contact => new Option(contact.naam, contact.id)));
      buyer.value = draft.bestellerId ? String(draft.bestellerId) : '';
      card.replaceChildren();
      if (current) {
        const box = el('div', 'wo-card');
        box.append(el('h4', '', current.naam), el('p', '', 'Debiteur ' + current.debiteurnummer),
          el('p', '', [current.straat, current.postcode, current.plaats].filter(Boolean).join(' · ')));
        card.append(box);
      }
    };
    klant.addEventListener('change', () => { draft.klantId = Number(klant.value) || null; setBuyer(customer()?.contacten?.[0]); fillBuyer(); update(); });
    buyer.addEventListener('change', () => { setBuyer(customer()?.contacten?.find(contact => contact.id === Number(buyer.value))); update(); });
    fillBuyer();
    section(1, 'Klant', () => !!draft.klantId, [el('p', 'hint', baseline ? 'WO-nummer ' + baseline.nummer : 'Het WO-nummer volgt bij opslaan.'),
      grid(field('Klant', klant), field('Besteller', buyer)), card]);

    // 2 · Opdracht VSVK
    const kind = el('div', 'wo-segmented'), kindHint = el('p', 'hint');
    const project = field('Intern projectnummer', inp('internProjectnummer', 'text', 'Intern projectnummer'));
    const drawKind = () => {
      kind.replaceChildren(...[['regie', 'Regie'], ['aangenomen', 'Aangenomen']].map(([value, label]) =>
        btn(label, 'board-toggle' + (draft.soort === value ? ' active' : ''), () => { draft.soort = value; drawKind(); update(); })));
      kindHint.textContent = draft.soort === 'regie'
        ? 'Regie: uren en materieel worden achteraf op de werkbon afgerekend.'
        : 'Aangenomen: vaste prijs; uren gaan op het interne project.';
    };
    drawKind();
    const option = el('input'); option.type = 'checkbox'; option.checked = !!draft.isOptie; option.setAttribute('aria-label', 'Optie');
    const optionExtra = grid(field('Voor wie / waarom', inp('optieReden', 'text', 'Optie reden')));
    optionExtra.hidden = !draft.isOptie;
    option.addEventListener('change', () => { draft.isOptie = option.checked; optionExtra.hidden = !option.checked; update(); });
    section(2, 'Opdracht VSVK', () => !!String(draft.korteWerkomschrijving || '').trim() && (draft.soort !== 'aangenomen' || !!String(draft.internProjectnummer || '').trim()), [
      grid(field('Afhandeling', kind), field('Optie (nog niet definitief)', option)),
      grid(field('Korte werkomschrijving', inp('korteWerkomschrijving', 'text', 'Korte werkomschrijving')), project), optionExtra, kindHint]);

    // 3 · Wanneer
    const start = inp('startDatum', 'date', 'Datum op locatie'), end = inp('eindDatum', 'date', 'Tot en met');
    const weekend = el('input'); weekend.type = 'checkbox'; weekend.checked = draft.weekendOverslaan !== false; weekend.setAttribute('aria-label', 'Weekend overslaan');
    const strip = el('div', 'wo-day-strip'), dayHint = el('p', 'hint');
    const t1 = inp('startOpLocatie', 'time', 'Starttijd op locatie'), t2 = inp('eindOpLocatie', 'time', 'Eindtijd op locatie');
    const priority = el('select'); priority.setAttribute('aria-label', 'Prioriteit');
    ['hoog', 'normaal', 'laag'].forEach(value => priority.append(new Option(value, value)));
    priority.value = draft.prioriteit || 'normaal';
    priority.addEventListener('change', () => { draft.prioriteit = priority.value; });
    const stockFields = grid(field('Geschatte uren', inp('geschatteUren', 'number', 'Geschatte uren')), field('Prioriteit', priority));
    const dateFields = grid(field('Datum op locatie', start), field('Tot en met', end), field('Weekend overslaan', weekend));
    const stock = btn('', 'board-btn');
    const drawWhen = () => {
      stock.textContent = draft.werkvoorraad ? '← Toch een datum kiezen' : 'Nog geen datum? Zet in de werkvoorraad →';
      dateFields.hidden = strip.hidden = dayHint.hidden = !!draft.werkvoorraad; stockFields.hidden = !draft.werkvoorraad;
      strip.replaceChildren();
      if (draft.startDatum && draft.eindDatum && draft.eindDatum >= draft.startDatum && !draft.werkvoorraad) {
        for (let date = parse(draft.startDatum); date <= parse(draft.eindDatum); date = addDays(date, 1)) {
          const value = iso(date), isWeekend = draft.weekendOverslaan && [0, 6].includes(date.getDay());
          const off = isWeekend || draft.vrijeDagen.includes(value);
          const day = btn(dayNames[date.getDay()] + ' ' + date.getDate(), 'wo-day' + (off ? ' skipped' : ''), () => {
            if (isWeekend) return;
            draft.vrijeDagen = draft.vrijeDagen.includes(value) ? draft.vrijeDagen.filter(item => item !== value) : [...draft.vrijeDagen, value];
            drawWhen(); update();
          });
          day.title = isWeekend ? 'Weekend' : off ? 'Klik om deze dag weer mee te nemen' : 'Klik om deze dag over te slaan';
          strip.append(day);
        }
      }
      const count = workDays(draft).length;
      dayHint.textContent = count ? count + ' werkdagen. Klik op een dag om hem over te slaan.' : 'Kies een begin- en einddatum.';
    };
    [start, end].forEach(control => control.addEventListener('change', () => {
      if (draft.startDatum && (!draft.eindDatum || draft.eindDatum < draft.startDatum)) { draft.eindDatum = draft.startDatum; end.value = draft.startDatum; }
      drawWhen(); update();
    }));
    weekend.addEventListener('change', () => { draft.weekendOverslaan = weekend.checked; drawWhen(); update(); });
    stock.addEventListener('click', () => { draft.werkvoorraad = !draft.werkvoorraad; drawWhen(); update(); });
    section(3, 'Wanneer', () => !!draft.werkvoorraad || workDays(draft).length > 0, [dateFields, strip, dayHint,
      grid(field('Starttijd op locatie', t1), field('Eindtijd op locatie', t2)), stock, stockFields]);
    drawWhen();

    // 4 · Werk
    const address = inp('werkadres', 'text', 'Werkadres'), postcode = inp('werkPostcode', 'text', 'Postcode'), place = inp('werkPlaats', 'text', 'Plaats');
    const same = btn('Zelfde als klantadres', 'board-btn', () => {
      const current = customer(); if (!current) { msg.textContent = 'Kies eerst een klant.'; return; }
      draft.werkadres = current.straat || ''; draft.werkPostcode = current.postcode || ''; draft.werkPlaats = current.plaats || '';
      address.value = draft.werkadres; postcode.value = draft.werkPostcode; place.value = draft.werkPlaats; update();
    });
    section(4, 'Werk', () => !!String(draft.werkadres || '').trim(), [
      grid(field('Wat moet er gebeuren', inp('werkInhoud', 'textarea', 'Wat moet er gebeuren')), field('Instructies voor de ploeg', inp('instructies', 'textarea', 'Instructies'))),
      grid(field('Werkadres', address), field('Postcode', postcode), field('Plaats', place)), same,
      grid(field('Contact op locatie', inp('contactLocatieNaam', 'text', 'Contact op locatie')), field('Telefoon contact', inp('contactLocatieTelefoon', 'tel', 'Telefoon contact')))]);

    // 5 · Wie & wat nodig
    const managed = need => !need.skill && functions.includes(need.rol);
    const count = role => sum((draft.behoeften || []).filter(need => managed(need) && need.rol === role));
    const setCount = (role, value) => {
      draft.behoeften = (draft.behoeften || []).filter(need => !(managed(need) && need.rol === role));
      if (value > 0) draft.behoeften.push({ aantal: value, rol: role, skill: null, soort: 'mens' });
    };
    const needs = el('div', 'plan-needs');
    for (const role of functions) {
      const row = el('div', 'plan-need'); const value = el('b', 'num', String(count(role)));
      const change = delta => { setCount(role, Math.max(0, count(role) + delta)); value.textContent = String(count(role)); update(); };
      const minus = btn('−', 'board-btn', () => change(-1)); minus.setAttribute('aria-label', role + ' minder');
      const plus = btn('+', 'board-btn', () => change(1)); plus.setAttribute('aria-label', role + ' meer');
      row.append(el('span', '', role), minus, value, plus); needs.append(row);
    }
    const mats = el('div', 'plan-mats');
    for (const item of equipment) {
      const label = el('label', 'swl'); const box = el('input'); box.type = 'checkbox';
      box.checked = (draft.materieel || []).some(need => need.materieelId === item.id);
      box.addEventListener('change', () => {
        draft.materieel = (draft.materieel || []).filter(need => need.materieelId !== item.id);
        if (box.checked) draft.materieel.push({ aantal: 1, materieelId: item.id, materieelGroepId: item.groepId || null, type: item.naam, losseVerhuur: false });
        update();
      });
      label.append(box, document.createTextNode(' ' + item.naam)); mats.append(label);
    }
    const capacity = el('div', 'hint');
    const checkCapacity = btn('Drukte controleren', 'board-btn', async () => {
      const days = workDays(draft);
      if (!days.length) { capacity.textContent = 'Kies eerst de werkdagen.'; return; }
      const skipped = [];
      for (let date = parse(draft.startDatum); date <= parse(draft.eindDatum); date = addDays(date, 1)) if (!days.includes(iso(date))) skipped.push(iso(date));
      capacity.textContent = 'Drukte controleren…';
      try {
        const result = await state.request('/api/planning/werkopdrachten/drukte', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ van: draft.startDatum, tot: draft.eindDatum, vrijeDagen: skipped,
            mensen: draft.behoeften.map(need => ({ aantal: need.aantal, rol: need.rol, skill: need.skill, soort: 'mens' })), materieel: [] })
        });
        capacity.textContent = (result.mensen || []).map(item => item.naam + ': ' + item.gevraagd + ' nodig' +
          (item.druksteDag ? ' op ' + shortDay(item.druksteDag) : '') + ', ' + item.beschikbaar + ' beschikbaar' +
          (item.gevraagd > item.beschikbaar ? ' ⚠ te weinig' : '')).join(' · ') || 'Vul eerst in hoeveel mensen er nodig zijn.';
      } catch (error) { capacity.textContent = 'Drukte controleren mislukt: ' + error.message; }
    });
    section(5, 'Wie & wat nodig', () => sum(draft.behoeften) > 0, [el('h4', 'plan-sub', 'Mensen per dag'), needs,
      el('h4', 'plan-sub', 'Materieel'), mats, checkCapacity, capacity]);

    // Samenvatting
    function update() {
      steps.forEach(step => { const ok = step.ok(); step.badge.textContent = ok ? '✓' : String(step.number); step.badge.classList.toggle('done', ok); });
      project.hidden = draft.soort !== 'aangenomen';
      const current = customer(), days = workDays(draft), people = sum(draft.behoeften);
      aside.replaceChildren(el('h3', '', 'Samenvatting'));
      const line = (label, value) => { const row = el('p', 'plan-sum'); row.append(el('span', '', label), el('b', '', value || '—')); aside.append(row); };
      line('Klant', current?.naam); line('Besteller', draft.bestellerNaam);
      line('Soort', draft.soort === 'regie' ? 'Regie' : 'Aangenomen' + (draft.internProjectnummer ? ' · ' + draft.internProjectnummer : ''));
      line('Periode', draft.werkvoorraad ? 'Werkvoorraad' : days.length ? days.length + (days.length === 1 ? ' dag, ' : ' dagen, ') + draft.startOpLocatie + '–' + draft.eindOpLocatie : '');
      line('Locatie', [draft.werkadres, draft.werkPlaats].filter(Boolean).join(', '));
      line('Mensen', people ? people + ' per dag' + (days.length ? ' = ' + people * days.length + ' inzetten' : '') : '');
      line('Materieel', (draft.materieel || []).map(need => equipment.find(item => item.id === need.materieelId)?.naam || need.type).filter(Boolean).join(', '));
      const missing = steps.filter(step => !step.ok()).map(step => step.number);
      aside.append(missing.length ? el('p', 'wo-summary-missing', 'Nog in te vullen: stap ' + missing.join(', ')) : el('p', 'wo-summary-ok', '✓ Klaar om op te slaan'));
    }
    update();

    if (editable && baseline) {
      const remove = btn('Verwijderen', 'board-btn board-remove danger', async () => {
        if (!remove.dataset.sure) {
          remove.dataset.sure = '1'; remove.textContent = 'Zeker weten? Klik nogmaals';
          msg.textContent = 'Verwijderen kan niet ongedaan worden gemaakt.'; return;
        }
        try {
          await state.request('/api/planning/werkopdrachten/' + baseline.id, { method: 'DELETE', headers: { 'If-Match': baseline.eTag } });
          node.close(); toast(baseline.nummer + ' verwijderd.'); state.expanded.delete(baseline.id); await load();
        } catch (error) {
          msg.textContent = error.status === 412
            ? 'Deze werkopdracht is intussen gewijzigd. Sluit en open hem opnieuw voordat je verwijdert.'
            : 'Verwijderen mislukt: ' + error.message;
        }
      });
      remove.style.marginRight = 'auto'; foot.append(remove);
    }
    foot.append(btn(editable ? 'Annuleren' : 'Sluiten', 'board-btn', () => node.close()));
    if (editable) {
      const save = btn('Opslaan', 'board-btn primary', async () => {
        const missing = steps.filter(step => !step.ok()).map(step => step.number);
        if (missing.length) { msg.textContent = 'Vul eerst stap ' + missing.join(', ') + ' in.'; return; }
        const value = { ...draft };
        if (value.werkvoorraad && !value.startDatum) { value.startDatum = today(); value.eindDatum = today(); }
        if (value.werkvoorraad && (!value.eindDatum || value.eindDatum < value.startDatum)) value.eindDatum = value.startDatum;
        value.omschrijving = value.korteWerkomschrijving;
        if (baseline) value.nummer = baseline.nummer;
        save.disabled = true;
        try {
          const headers = { 'Content-Type': 'application/json' };
          if (baseline) headers['If-Match'] = baseline.eTag;
          const saved = await state.request('/api/planning/werkopdrachten' + (baseline ? '/' + baseline.id : ''), {
            method: baseline ? 'PUT' : 'POST', headers, body: JSON.stringify(writeValue(value, false))
          });
          node.close();
          if (saved?.id) state.expanded.add(saved.id);
          store.set('tlopen', [...state.expanded]);
          if (!baseline && !value.werkvoorraad) state.date = monday(parse(value.startDatum));
          toast((saved?.nummer || baseline?.nummer || 'Werkopdracht') + (baseline ? ' opgeslagen.' : value.werkvoorraad ? ' aangemaakt in de werkvoorraad.' : ' aangemaakt.'));
          await load();
        } catch (error) {
          save.disabled = false;
          if (error.status === 412 && baseline) {
            msg.textContent = 'Deze werkopdracht is intussen door iemand anders gewijzigd. Je invoer staat er nog. ';
            msg.append(btn('Nieuwste versie ophalen', 'board-btn', async () => {
              try {
                baseline = await state.request('/api/planning/werkopdrachten/' + baseline.id);
                msg.textContent = 'De nieuwste versie is opgehaald. Controleer je invoer en klik opnieuw op Opslaan.';
              } catch (reload) { msg.textContent = 'Ophalen mislukt: ' + reload.message; }
            }));
          } else msg.textContent = 'Opslaan mislukt: ' + error.message;
        }
      });
      foot.append(save);
    } else {
      form.querySelectorAll?.('input,select,textarea,button').forEach(control => { control.disabled = true; });
    }
    node.showModal();
  }

  window.VsvkPlanBoard = { open, load };
}());
