(function () {
  'use strict';

  const storage = window.localStorage || { getItem: () => null, setItem: () => {} };
  const state = {
    container: null, request: null, canEdit: false, date: startOfWeek(new Date()),
    references: null, formReferences: null, orders: [], timeline: null, filter: 'all', query: '', expanded: new Set(),
    loading: false, mode: storage.getItem('vsvk-pbwo') === 'true' ? 'workorders' : 'board',
    zoom: storage.getItem('vsvk-tlzoom') || 'week',
    detailCache: new Map(), detailHover: null, detailTimer: null, detailSequence: 0,
    dockSide: storage.getItem('vsvk-pbdock') || 'left', dockTab: 'people', dragging: null,
    dropBusy: false, dockOpen: true
  };
  const dayNames = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  const longDayNames = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  const slipStatuses = { niet_geprint: ['N', 'niet geprint'], aangemaakt: ['N', 'niet geprint'], uitgereikt: ['U', 'uitgereikt'], retour: ['✓', 'binnen'], verwerkt: ['✓', 'binnen'], binnen: ['✓', 'binnen'] };

  function iso(value) {
    const date = new Date(value); date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 10);
  }

  function bindBarDropTarget(bar, grid, order, dates) {
    let active = false;
    let targetKey = '';
    const targetDate = event => {
      const rect = grid.getBoundingClientRect?.();
      if (rect?.width) {
        const index = Math.max(0, Math.min(dates.length - 1,
          Math.floor((event.clientX - rect.left) / (rect.width / dates.length))));
        return dates[index];
      }
      const index = Number(bar.dataset.dropIndex || 0);
      return dates[index] || dates[0];
    };
    const showTarget = event => {
      if (!state.dragging || state.dropBusy) return false;
      event.preventDefault();
      event.stopPropagation();
      const jobDates = concreteJobDates(order, dates);
      const valid = jobDates.length > 0;
      const nextKey = 'all:' + valid + ':' + jobDates.length;
      if (!active || targetKey !== nextKey) {
        bar.classList.remove('drag-target', 'drag-invalid');
        bar.classList.add(valid ? 'drag-target' : 'drag-invalid');
        targetKey = nextKey;
        active = true;
        dropTip(event, state.dragging.title + ' → ' + order.nummer + ' · alle ' +
          jobDates.length + ' ' + (jobDates.length === 1 ? 'dag' : 'dagen'), valid);
      }
      if (event.dataTransfer) event.dataTransfer.dropEffect = valid ? 'copy' : 'none';
      return valid;
    };
    bar.addEventListener('dragenter', showTarget);
    bar.addEventListener('dragover', showTarget);
    bar.addEventListener('dragleave', event => {
      if (bar.contains?.(event.relatedTarget)) return;
      bar.classList.remove('drag-target', 'drag-invalid');
      active = false; targetKey = ''; hideDropTip();
    });
    bar.addEventListener('drop', async event => {
      if (state.dropBusy) return;
      const jobDates = concreteJobDates(order, dates);
      const valid = jobDates.length > 0;
      event.preventDefault(); event.stopPropagation();
      let resource = state.dragging;
      if (!resource) {
        try { resource = JSON.parse(event.dataTransfer?.getData('application/json') || 'null'); } catch {}
      }
      state.dragging = null;
      state.dropBusy = true;
      bar.classList.remove('drag-target', 'drag-invalid');
      active = false; targetKey = '';
      clearBoardDropTargets(); hideDropTip();
      state.container?.querySelectorAll?.('.board-dock-card.dragging')
        .forEach(card => card.classList.remove('dragging'));
      if (!valid || !resource) {
        state.dropBusy = false;
        return;
      }
      try { await assignDraggedResource(order, jobDates, resource, bar); }
      finally { state.dropBusy = false; }
    });
  }

  function clearBoardDropTargets() {
    state.container?.querySelectorAll?.('.board-bar.drag-target,.board-bar.drag-invalid,.board-day-drop.drag-target,.board-day-drop.drag-invalid')
      .forEach(target => target.classList.remove('drag-target', 'drag-invalid'));
    hideDropTip();
  }
  function shortDate(value) {
    return new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' }).format(value);
  }
  function dropTip(event, text, valid) {
    let tip = state.container?.querySelector?.('#planning-drop-tip');
    if (!tip) {
      tip = element('div', 'planning-drop-tip');
      tip.id = 'planning-drop-tip'; tip.setAttribute('role', 'status');
      document.body?.appendChild(tip);
      if (!document.body) state.container.append(tip);
    }
    tip.textContent = (valid ? '✓ Laat los: ' : '✕ ') + text;
    tip.className = 'planning-drop-tip ' + (valid ? 'ok' : 'invalid');
    tip.style.left = Math.min(Number(event.clientX || 0) + 16,
      (window.innerWidth || 1200) - 360) + 'px';
    tip.style.top = (Number(event.clientY || 0) + 12) + 'px';
  }
  function hideDropTip() {
    document.getElementById?.('planning-drop-tip')?.remove();
    state.container?.querySelector?.('.planning-drop-tip')?.remove();
  }
  function concreteJobDates(order, dates) {
    const visible = new Set(dates.map(iso));
    return [...new Set(order.klussen.map(job => job.datum).filter(date => date && visible.has(date)))].sort();
  }
  function parse(value) { return new Date(value + 'T00:00:00'); }
  function addDays(value, count) { const result = new Date(value); result.setDate(result.getDate() + count); return result; }
  function startOfWeek(value) { const result = new Date(value); result.setHours(0, 0, 0, 0); result.setDate(result.getDate() - ((result.getDay() + 6) % 7)); return result; }
  function element(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  }
  function action(text, className, callback) {
    const button = element('button', className || 'board-btn', text); button.type = 'button';
    if (callback) button.addEventListener('click', callback);
    return button;
  }
  function input(value, label, type = 'text') {
    const control = element('input'); control.type = type; control.value = value ?? ''; control.setAttribute('aria-label', label);
    return control;
  }

  async function open(config) {
    state.container = config.container;
    state.request = config.request;
    state.canEdit = await config.canEdit;
    if (config.mode) {
      state.mode = config.mode;
      storage.setItem('vsvk-pbwo', String(state.mode === 'workorders'));
    }
    await load();
  }

  async function load() {
    if (!state.container || state.loading) return;
    state.loading = true;
    renderLoading();
    const period = currentPeriod();
    const from = iso(period.from), to = iso(period.to);
    const finish = window.VsvkLoading?.begin() || (() => {});
    try {
      const [orders, references, formReferences] = await Promise.all([
        state.request(state.mode === 'workorders'
          ? '/api/planning/planbord/werkopdrachten?van=' + from + '&tot=' + to + '&zoom=' + state.zoom
          : '/api/planning/planbord?from=' + from + '&to=' + to),
        state.request('/api/planning/planbord/referenties'),
        state.request('/api/planning/werkopdrachten/form-referenties').catch(() => null)
      ]);
      if (state.mode === 'workorders') { state.timeline = orders; state.orders = orders.groepen.flatMap(group => group.werkopdrachten); }
      else { state.orders = orders; state.timeline = null; }
      state.references = references; state.formReferences = formReferences;
      if (!state.expanded.size) {
        try { state.expanded = new Set(JSON.parse(storage.getItem('vsvk-tlopen') || '[]')); } catch {}
      }
      render();
    } catch (error) {
      state.container.replaceChildren(element('div', 'empty', 'Planbord laden mislukt: ' + error.message));
    } finally { state.loading = false; finish(); }
  }

  function renderLoading() {
    if (!state.container.childNodes.length) state.container.replaceChildren(element('div', 'empty', 'Planbord laden…'));
  }

  function render() {
    if (state.mode === 'workorders') return renderTimeline();
    const root = element('div', 'planning-board');
    const toolbar = element('div', 'board-toolbar');
    toolbar.append(modeSwitch());
    const modes = element('div', 'board-group');
    const byJob = action('Per klus', 'board-toggle'); byJob.disabled = true; byJob.title = 'Buiten week-MVP';
    const byEmployee = action('Per medewerker', 'board-toggle'); byEmployee.disabled = true; byEmployee.title = 'Buiten week-MVP';
    modes.append(byJob, byEmployee, action('Werkopdrachten', 'board-toggle active'));
    const previous = action('◀', 'board-btn', () => { shiftPeriod(-1); }); previous.setAttribute('aria-label', 'Vorige periode');
    const next = action('▶', 'board-btn', () => { shiftPeriod(1); }); next.setAttribute('aria-label', 'Volgende periode');
    const week = element('strong', 'board-period', weekLabel(state.date));
    toolbar.append(modes, previous, week, next, action('Vandaag', 'board-btn', () => { state.date = startOfWeek(new Date()); load(); }));
    const zoom = element('div', 'board-group');
    const dayZoom = action('Dag', 'board-toggle'); dayZoom.disabled = true; dayZoom.title = 'Buiten week-MVP';
    const monthZoom = action('Maand', 'board-toggle'); monthZoom.disabled = true; monthZoom.title = 'Buiten week-MVP';
    zoom.append(dayZoom, action('Week', 'board-toggle active'), monthZoom);
    toolbar.append(element('span', 'board-spacer'), zoom);
    if (!state.dockOpen) toolbar.append(action('Planninglade', 'board-btn', () => { state.dockOpen = true; render(); }));
    if (state.canEdit) toolbar.append(
      action('+ Werkopdracht', 'board-btn primary', () => editOrder(null)),
      action('Inhuurmedewerkers', 'board-btn', editSubcontractors));

    const filters = element('div', 'board-filters');
    const search = input(state.query, 'Zoek werkopdracht'); search.type = 'search';
    search.placeholder = 'Zoek WO-nummer, klant, medewerker of bonnummer…';
    search.addEventListener('input', () => { state.query = search.value; renderGrid(); });
    const all = action('Alle ' + state.orders.length, 'board-filter' + (state.filter === 'all' ? ' active' : ''), () => { state.filter = 'all'; render(); });
    const open = action('Open plekken', 'board-filter danger' + (state.filter === 'open' ? ' active' : ''), () => { state.filter = 'open'; render(); });
    const slips = action('Bonnen te doen', 'board-filter warning' + (state.filter === 'slips' ? ' active' : ''), () => { state.filter = 'slips'; render(); });
    const expand = action(state.expanded.size === state.orders.length ? 'Alles inklappen' : 'Alles uitklappen', 'board-btn', () => {
      if (state.expanded.size === state.orders.length) state.expanded.clear();
      else state.orders.forEach(order => state.expanded.add(order.id));
      render();
    });
    filters.append(search, all, open, slips, expand);
    const grid = element('div', 'board-scroll');
    const workspace = element('div', 'board-workspace');
    workspace.append(toolbar, filters, grid, legend());
    const layout = element('div', 'board-layout dock-' + state.dockSide + (state.dockOpen ? '' : ' dock-closed'));
    if (state.dockOpen) layout.append(boardDock());
    layout.append(workspace);
    root.append(layout);
    state.container.replaceChildren(root);
    state.grid = grid;
    renderGrid();
  }

  function modeSwitch() {
    const group = element('div', 'board-group');
    const board = action('Planbord', 'board-toggle' + (state.mode === 'board' ? ' active' : ''), () => setMode('board'));
    const workorders = action('Werkopdrachten', 'board-toggle' + (state.mode === 'workorders' ? ' active' : ''), () => setMode('workorders'));
    group.append(board, workorders);
    return group;
  }

  function boardDock() {
    const dock = element('aside', 'board-dock');
    dock.setAttribute('aria-label', 'Inplanbare middelen');
    const head = element('div', 'board-dock-head');
    head.append(element('strong', '', 'PLANNING'),
      action('◀/▶', 'board-btn ghost board-dock-side', () => {
        state.dockSide = state.dockSide === 'left' ? 'right' : 'left';
        storage.setItem('vsvk-pbdock', state.dockSide); render();
      }),
      action('✕', 'board-btn ghost', () => { state.dockOpen = false; render(); }));
    const tabs = element('div', 'board-dock-tabs');
    for (const [key, label] of [['people','Mensen'],['equipment','Materieel'],['customers','Klanten'],['stock','Voorraad']]) {
      const tab = action(label, 'board-dock-tab' + (state.dockTab === key ? ' active' : ''),
        () => { state.dockTab = key; render(); });
      tabs.append(tab);
    }
    const search = input('', 'Zoek in planninglade'); search.type = 'search';
    search.placeholder = 'Zoeken…';
    const list = element('div', 'board-dock-list');
    const query = () => search.value.trim().toLocaleLowerCase('nl');
    const renderItems = () => {
      list.replaceChildren();
      let items = [];
      if (state.dockTab === 'people') {
        items = (state.references?.medewerkers || []).map(item => ({
          id: item.id, kind: 'employee', title: item.naam, subtitle: 'Eigen medewerker'
        }));
        items.push(...(state.references?.inhuurmedewerkers || []).map(item => ({
          id: item.id, kind: 'subcontractor', title: item.naam, subtitle: item.functie || item.leverancier
        })));
      } else if (state.dockTab === 'equipment') {
        items = (state.formReferences?.materieel || []).map(item => ({
          id: item.id, kind: 'equipment', title: item.naam, subtitle: 'Materieel'
        }));
      } else if (state.dockTab === 'customers') {
        items = (state.references?.klanten || []).map(item => ({
          id: item.id, kind: 'customer', title: item.naam, subtitle: 'Klant'
        }));
      } else {
        items = state.orders.filter(order => order.werkvoorraad).map(order => ({
          id: order.id, kind: 'stock', title: order.nummer || 'Nieuwe opdracht', subtitle: order.klant
        }));
      }
      for (const item of items.filter(item => !query() ||
        (item.title + ' ' + item.subtitle).toLocaleLowerCase('nl').includes(query()))) {
        list.append(dockCard(item));
      }
      if (!list.children.length) list.append(element('div', 'empty', 'Niets gevonden.'));
    };
    search.addEventListener('input', renderItems);
    renderItems();
    dock.append(head, tabs, search, element('small', 'hint', state.canEdit
      ? 'Sleep mensen of materieel naar een werkdag op het planbord.'
      : 'Alleen bekijken: inplannen is niet toegestaan.'), list);
    return dock;
  }
  function dockCard(item) {
    const card = element('div', 'board-dock-card');
    card.append(element('strong', '', item.title), element('small', '', item.subtitle));
    const draggable = item.kind === 'employee' || item.kind === 'subcontractor' || item.kind === 'equipment';
    if (draggable && state.canEdit) {
      card.draggable = true;
      card.setAttribute('aria-label', 'Sleep ' + item.title + ' naar een werkdag');
      card.addEventListener('dragstart', event => {
        if (state.dropBusy) { event.preventDefault?.(); return; }
        state.dragging = item;
        hideWorkOrderPopover();
        event.dataTransfer?.setData('application/json', JSON.stringify(item));
        event.dataTransfer && (event.dataTransfer.effectAllowed = 'copy');
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => {
        state.dragging = null; card.classList.remove('dragging');
        clearBoardDropTargets(); hideDropTip();
      });
    } else card.classList.add('readonly');
    return card;
  }
  function setMode(mode) {
    state.mode = mode; storage.setItem('vsvk-pbwo', String(mode === 'workorders')); load();
  }
  function currentPeriod() {
    if (state.zoom === 'day') return { from: state.date, to: state.date };
    if (state.zoom === 'month') {
      const from = new Date(state.date.getFullYear(), state.date.getMonth(), 1);
      return { from, to: new Date(state.date.getFullYear(), state.date.getMonth() + 1, 0) };
    }
    const from = startOfWeek(state.date); return { from, to: addDays(from, 6) };
  }
  function shiftPeriod(direction) {
    if (state.zoom === 'day') state.date = addDays(state.date, direction);
    else if (state.zoom === 'month') state.date = new Date(state.date.getFullYear(), state.date.getMonth() + direction, 1);
    else state.date = addDays(state.date, direction * 7);
    load();
  }
  function setZoom(zoom) {
    state.zoom = zoom; storage.setItem('vsvk-tlzoom', zoom); state.date = startOfWeek(state.date); load();
  }

  function renderTimeline() {
    if (!state.timeline) return;
    const root = element('div', 'planning-board tl-view');
    const toolbar = element('div', 'board-toolbar');
    const modes = element('div', 'board-group');
    const byJob = action('Per klus', 'board-toggle'); byJob.disabled = true; byJob.title = 'Volgende planbordweergave';
    const byEmployee = action('Per medewerker', 'board-toggle'); byEmployee.disabled = true; byEmployee.title = 'Volgende planbordweergave';
    modes.append(byJob, byEmployee, action('Werkopdrachten', 'board-toggle active'));
    toolbar.append(modes);
    const previous = action('◀', 'board-btn', () => shiftPeriod(-1)); previous.setAttribute('aria-label', 'Vorige periode');
    const next = action('▶', 'board-btn', () => shiftPeriod(1)); next.setAttribute('aria-label', 'Volgende periode');
    toolbar.append(previous, element('strong', 'board-period', state.timeline.periode.titel), next,
      action('Vandaag', 'board-btn', () => { state.date = startOfWeek(new Date()); load(); }));
    toolbar.append(element('span', 'board-spacer'));
    const zoom = element('div', 'board-group');
    for (const [value, label] of [['day', 'Dag'], ['week', 'Week'], ['month', 'Maand']])
      zoom.append(action(label, 'board-toggle' + (state.zoom === value ? ' active' : ''), () => setZoom(value)));
    toolbar.append(zoom);
    if (state.canEdit) toolbar.append(action('+ Werkopdracht', 'board-btn primary', () => editOrder(null)));
    const filters = element('div', 'board-filters');
    const search = input(state.query, 'Zoek werkopdracht'); search.type = 'search';
    search.placeholder = 'Zoek WO-nummer, klant, medewerker of bonnummer…';
    let searchTimer;
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.query = search.value; renderTimelineGrid(); }, 150);
    });
    filters.append(search);
    const counts = timelineFilterCounts();
    for (const [value, label] of [['all', `Alle ${counts.total}`],
      ['open', `Open plekken ${counts.open}`], ['slips', `Bonnen te doen ${counts.slips}`]])
      filters.append(action(label, 'board-filter ' + (state.filter === value ? 'active' : ''), () => { state.filter = value; renderTimeline(); }));
    filters.append(action(state.expanded.size ? 'Alles inklappen' : 'Alles uitklappen', 'board-btn', () => {
      if (state.expanded.size) state.expanded.clear();
      else state.orders.forEach(order => state.expanded.add(order.id));
      persistExpanded(); renderTimeline();
    }));
    const grid = element('div', 'board-scroll tl-scroll');
    root.append(toolbar, filters, grid, timelineLegend());
    state.container.replaceChildren(root); state.timelineGrid = grid; renderTimelineGrid();
  }

  function timelineFilterCounts() {
    const searched = filteredTimelineOrders();
    return {
      total: searched.length,
      open: searched.filter(order => order.openPlekken > 0).length,
      slips: searched.filter(order => order.bonnenTeDoen > 0).length
    };
  }
  function filteredTimelineOrders() {
    const query = state.query.trim().toLocaleLowerCase('nl');
    const all = state.timeline.groepen.flatMap(group => group.werkopdrachten)
      .sort((left, right) => left.startDatum.localeCompare(right.startDatum) || left.nummer.localeCompare(right.nummer));
    return all.filter(order => {
      if (state.filter === 'open' && order.openPlekken <= 0) return false;
      if (state.filter === 'slips' && order.bonnenTeDoen <= 0) return false;
      if (!query) return true;
      const people = order.mensen || [];
      return [order.nummer, order.klantNaam, order.kop,
        ...people.map(person => person.naam),
        ...people.flatMap(person => Object.values(person.dagen || {}).filter(Boolean)
          .flatMap(day => [day.nummer || '', day.oudNummer || '']))]
        .join(' ').toLocaleLowerCase('nl').includes(query);
    });
  }
  function renderTimelineGrid() {
    const grid = state.timelineGrid; if (!grid) return;
    const days = state.timeline.dagen;
    grid.replaceChildren();
    const table = element('div', 'tl-table tl-zoom-' + state.zoom);
    table.style.setProperty('--tl-days', days.length);
    const header = element('div', 'tl-row tl-head');
    header.append(element('div', 'tl-label', 'Werkopdracht › klussen › werkbonnen'));
    const headerDays = element('div', 'tl-days'); for (const day of days) {
      const cell = element('button', 'tl-day' + (day.vandaag ? ' today' : '') + (day.weekend ? ' weekend' : ''), '');
      cell.type = 'button'; cell.title = 'Open deze dag op planbord';
      cell.addEventListener('click', () => { state.mode = 'board'; state.date = parse(day.datum); storage.setItem('vsvk-pbwo', 'false'); load(); });
      cell.append(element('span', '', state.zoom === 'month' ? day.kort[0] : day.kort), element('b', '', String(day.nr)));
      headerDays.append(cell);
    }
    header.append(headerDays); table.append(header);
    const orders = filteredTimelineOrders();
    for (const order of orders) {
      const expanded = state.expanded.has(order.id) || !!state.query.trim();
      table.append(timelineOrderRow(order, days, expanded));
      if (expanded) {
        table.append(timelineJobRow(order, days));
        for (const person of order.mensen) table.append(timelinePersonRow(order, person, days));
        if (!order.mensen.length) {
          const empty = element('div', 'tl-row tl-person'); empty.append(element('div', 'tl-person-label no-people', 'Nog niemand ingepland'), element('div', 'tl-days'));
          table.append(empty);
        }
      }
    }
    if (!table.querySelector?.('.tl-wo')) {
      const empty = element('div', 'empty', state.query.trim()
        ? 'Niets gevonden voor ‘' + state.query.trim() + '’'
        : 'Geen werkopdrachten in deze periode.');
      if (state.query.trim()) empty.append(action('Wis zoekterm', 'board-btn', () => { state.query = ''; renderTimeline(); }));
      else if (state.canEdit) empty.append(action('+ Nieuwe werkopdracht', 'board-btn primary', () => editOrder(null)));
      table.append(empty);
    }
    grid.append(table);
  }
  function timelineOrderRow(order, days, forceExpanded = false) {
    const row = element('div', 'tl-row tl-wo' + (order.optie ? ' option' : ''));
    const expanded = forceExpanded || state.expanded.has(order.id);
    const label = element('button', 'tl-wo-label'); label.type = 'button'; label.setAttribute('aria-expanded', String(expanded));
    label.append(element('span', 'tl-chevron', expanded ? '▾' : '▸'),
      element('span', 'tl-number', order.nummer || '—'), element('b', 'tl-customer', order.klantNaam),
      element('small', '', order.kop));
    const status = order.status || (order.optie ? 'OPTIE' : order.openPlekken
      ? 'OPEN ' + order.openPlekken : 'GEPLAND');
    label.append(element('span', 'tl-workorder-status ' + timelineStatusClass(status), status));
    label.addEventListener('click', () => {
      if (state.expanded.has(order.id)) state.expanded.delete(order.id); else state.expanded.add(order.id);
      persistExpanded(); renderTimelineGrid();
    });
    label.addEventListener('dblclick', event => { event.stopPropagation(); if (state.canEdit) editOrder({ id: order.id }); });
    const cells = element('div', 'tl-days tl-order-span');
    const indices = days.map((day, index) => order.dagen[day.datum] ? index : -1).filter(index => index >= 0);
    for (const [index, day] of days.entries()) {
      cells.append(element('div', 'tl-cell tl-wo-cell' + (day.vandaag ? ' today' : '') + (day.weekend ? ' weekend' : '') + (index >= indices[0] && index <= indices.at(-1) ? ' in-range' : '')));
    }
    if (indices.length) {
      const bar = element('button', 'tl-order-bar' + (order.optie ? ' option' : ''));
      bar.type = 'button';
      bar.style.setProperty('--wo-color', order.kleur);
      bar.style.gridColumn = `${indices[0] + 1}/${indices.at(-1) + 2}`;
      const bonnen = Number(order.bonnen || Object.values(order.dagen).reduce((sum, day) => sum + day.bezet, 0));
      const binnen = Number(order.bonnenBinnen || 0);
      bar.textContent = state.zoom === 'month'
        ? (indices.length >= 3 ? order.nummer : '')
        : state.zoom === 'day'
          ? `${order.nummer} · ${order.klantNaam} · ${Object.values(order.dagen).find(Boolean)?.vertrek || ''}`
          : `${order.nummer} · ${bonnen} bonnen, ${binnen} binnen`;
      bar.title = `${order.nummer}: ${bonnen} bonnen, ${binnen} binnen`;
      bar.addEventListener('click', () => editOrder({ id: order.id }));
      cells.append(bar);
    }
    row.append(label, cells);
    bindWorkOrderPopover(row, order);
    return row;
  }
  function timelineStatusClass(status) {
    if (status === 'AFGEROND' || status === 'GEPLAND') return status.toLowerCase();
    if (status === 'OPTIE' || status === 'NIET INGEPLAND') return 'muted';
    return 'open';
  }
  function timelineJobRow(order, days) {
    const row = element('div', 'tl-row tl-job-row');
    const workDays = days.filter(day => order.dagen[day.datum]);
    const neededPerDay = Math.max(0, ...workDays.map(day => order.dagen[day.datum]?.nodig || 0));
    const label = element('div', 'tl-person-label tl-job-label');
    label.append(element('b', '', 'Klussen'),
      element('small', '', `${workDays.length} ${workDays.length === 1 ? 'dag' : 'dagen'} · ${neededPerDay} mensen per dag`));
    row.append(label);
    const cells = element('div', 'tl-days'); for (const day of days) {
      const cell = element('div', 'tl-cell tl-person-cell' + (day.vandaag ? ' today' : '') + (day.weekend ? ' weekend' : ''));
      const data = order.dagen[day.datum];
      if (data) {
        const className = data.bezetting === 'vol' ? 'complete'
          : data.bezetting === 'leeg' ? 'empty' : 'partial';
        const text = data.bezetting === 'vol' ? `✓ P ${data.bezet}/${data.nodig}`
          : `P ${data.bezet}/${data.nodig}`;
        cell.append(element('span', 'board-chip ' + className, text),
          element('small', '', data.vertrek || ''));
      }
      cells.append(cell);
    }
    row.append(cells); return row;
  }
  function timelinePersonRow(order, person, days) {
    const row = element('div', 'tl-row tl-person');
    const label = element('div', 'tl-person-label');
    if (person.extern) label.append(element('span', 'board-external', 'INH'));
    label.append(element('b', '', person.naam), element('small', '', person.functie || ''));
    const cells = element('div', 'tl-days'); for (const day of days) {
      const cell = element('div', 'tl-cell tl-person-cell' + (day.vandaag ? ' today' : '') + (day.weekend ? ' weekend' : ''));
      const assignment = (person.dagen || {})[day.datum];
      if (assignment) {
        const labelText = { BINNEN:'✓ binnen', UITGEREIKT:'UITGEREIKT', GEWIJZIGD:'GEWIJZIGD !',
          NIET_GEPRINT:'NIET GEPRINT', GEEN_BON:'GEEN BON', GEPLAND:'gepland' }[assignment.status];
        const status = action(labelText, 'tl-status ' + assignment.status.toLowerCase(), () => {
          if (assignment.bonId) viewWorkSlip(order.id, person, day, assignment);
          else editOrder({ id: order.id }, assignment.klusId);
        });
        status.title = `${person.naam}, ${day.kort} ${day.nr}: ${labelText}${assignment.nummer ? ', ' + assignment.nummer : ''}`;
        status.setAttribute('aria-label', status.title); cell.append(status);
        if (state.zoom !== 'month' && assignment.nummer) cell.append(element('small', '', assignment.nummer));
      }
      cells.append(cell);
    }
    row.append(label, cells); return row;
  }
  function persistExpanded() { storage.setItem('vsvk-tlopen', JSON.stringify([...state.expanded])); }
  function timelineLegend() {
    const result = element('div', 'board-legend');
    result.append(element('span', 'tl-legend-copy', 'Klap een werkopdracht uit om de klussen en werkbonnen per persoon te zien.'));
    for (const [key, label] of [['BINNEN','✓ binnen'],['UITGEREIKT','uitgereikt'],['GEWIJZIGD','gewijzigd'],['NIET_GEPRINT','niet geprint'],['GEEN_BON','geen bon']])
      result.append(element('span', 'tl-status ' + key.toLowerCase(), label));
    return result;
  }
  function editOrderByJob(jobId) {
    const order = state.orders.find(order => order.klussen?.some(job => job.id === jobId));
    if (order) editOrder(order, jobId);
  }
  function viewWorkSlip(orderId, person, day, assignment) {
    const modal = createEditorDialog('Werkbon');
    const body = modal.querySelector('.board-dialog-body');
    const save = modal.querySelector('.board-dialog-save');
    const fields = element('div', 'board-form-grid');
    for (const [label, value] of [
      ['Werkbonnummer', assignment.nummer || '—'], ['Status', assignment.status],
      ['Medewerker', person.naam], ['Datum', day.datum], ['Functie', person.functie || '—']
    ]) {
      const field = element('div', 'board-field', label);
      field.append(element('span', '', value)); fields.append(field);
    }
    body.append(fields);
    if (state.canEdit) {
      save.textContent = 'Werkopdracht bewerken';
      save.onclick = () => { modal.close(); editOrder({ id: orderId }, assignment.klusId); };
    } else save.hidden = true;
    modal.showModal();
  }

  function visibleOrders() {
    const query = state.query.trim().toLocaleLowerCase('nl');
    return state.orders.filter(order => {
      const assignments = order.klussen.flatMap(job => job.inzetten);
      const haystack = [order.nummer, order.klant, order.omschrijving,
        ...assignments.map(item => item.medewerker || item.inhuurmedewerker || ''),
        ...assignments.map(item => item.werkbon?.nummer || '')].join(' ').toLocaleLowerCase('nl');
      if (query && !haystack.includes(query)) return false;
      if (state.filter === 'open') return order.status.startsWith('OPEN') || order.status === 'NIET INGEPLAND';
      if (state.filter === 'slips') return assignments.some(item => !item.werkbon || item.werkbon.status !== 'binnen');
      return true;
    });
  }

  function renderGrid() {
    const grid = state.grid; if (!grid) return;
    grid.replaceChildren();
    const dates = Array.from({ length: 7 }, (_, index) => addDays(state.date, index));
    const table = element('div', 'board-table');
    const heading = element('div', 'board-row board-heading');
    heading.append(element('div', 'board-label', 'Werkopdracht › klussen › werkbonnen'));
    const headerCells = element('div', 'board-days');
    for (const date of dates) {
      const cell = element('div', 'board-day' + (iso(date) === iso(new Date()) ? ' today' : '') + ([0, 6].includes(date.getDay()) ? ' weekend' : ''));
      cell.append(element('span', '', dayNames[date.getDay()]), element('strong', '', String(date.getDate())));
      headerCells.append(cell);
    }
    heading.append(headerCells); table.append(heading);
    const visible = visibleOrders();
    for (const order of visible) {
      const expanded = state.expanded.has(order.id);
      table.append(workOrderRow(order, dates, expanded));
      if (expanded) {
        const jobs = order.klussen.filter(job =>
          job.datum && dates.some(date => iso(date) === job.datum));
        const groupedJobs = groupJobs(jobs);
        for (const group of groupedJobs) {
          table.append(jobRow(group, dates, order));
          for (const person of groupAssignments(group.jobs.flatMap(job => job.inzetten)))
            table.append(assignmentRow(person, dates, order));
          for (const item of groupMaterialAssignments(group.jobs))
            table.append(materialAssignmentRow(item, dates, order));
        }
      }
    }
    if (!visible.length) table.append(element('div', 'empty', 'Geen werkopdrachten gevonden.'));
    grid.append(table);
  }

  function workOrderRow(order, dates, expanded) {
    const row = element('div', 'board-row board-order' + (order.isOptie ? ' option' : ''));
    const label = element('div', 'board-order-label');
    label.setAttribute('role', 'button'); label.tabIndex = 0;
    label.append(element('span', 'board-order-summary', (expanded ? '▾' : '▸') + ' ' + order.nummer + ' · ' + order.status));
    const toggle = () => {
      if (state.expanded.has(order.id)) state.expanded.delete(order.id); else state.expanded.add(order.id); renderGrid();
    };
    label.addEventListener('click', toggle);
    label.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } });
    label.style.cursor = 'pointer'; label.setAttribute('aria-expanded', String(expanded));
    label.append(element('b', 'board-customer', order.klant), element('small', '', order.omschrijving));
    const edit = action(state.canEdit ? 'Bewerken' : 'Openen', 'board-open', () => editOrder(order));
    label.append(edit);
    edit.addEventListener('click', event => event.stopPropagation());
    const cells = element('div', 'board-days board-order-timeline');
    const start = parse(order.startDatum), end = parse(order.eindDatum);
    const first = dates.findIndex(date => date >= start && date <= end);
    const last = dates.map(date => date >= start && date <= end).lastIndexOf(true);
    for (const date of dates) cells.append(boardCell(date));
    if (first >= 0) {
      const bar = element('div', 'board-bar', order.nummer + ' · ' + order.klussen.reduce((sum, job) => sum + job.inzetten.length, 0) + ' inzetten');
      bar.style.gridColumn = (first + 1) + '/' + (last + 2); bar.style.borderColor = order.kleur; bar.style.backgroundColor = colorMix(order.kleur, .16);
      bar.setAttribute('aria-label', 'Sleep inzet naar een werkdag van ' + order.nummer);
      if (state.canEdit) bindBarDropTarget(bar, cells, order, dates);
      cells.append(bar);
    }
    row.append(label, cells);
    bindWorkOrderPopover(row, order);
    return row;
  }

  function bindWorkOrderPopover(target, summary) {
    let timer = null;
    const show = event => {
      if (state.dragging) return;
      clearTimeout(timer);
      timer = setTimeout(() => showWorkOrderPopover(target, summary, event), 120);
    };
    const hide = () => {
      clearTimeout(timer);
      hideWorkOrderPopover();
    };
    target.addEventListener('mouseenter', show);
    target.addEventListener('mouseleave', hide);
    target.addEventListener('focusin', show);
    target.addEventListener('focusout', hide);
    target.addEventListener('keydown', event => {
      if (event.key === 'Escape') { hide(); target.blur?.(); }
    });
  }

  async function showWorkOrderPopover(target, summary, event) {
    clearTimeout(state.detailTimer);
    const sequence = ++state.detailSequence;
    let detail = summary;
    if (!detail.klussen) {
      if (!state.detailCache.has(summary.id))
        state.detailCache.set(summary.id, state.request('/api/planning/werkopdrachten/' + summary.id).catch(() => summary));
      detail = await state.detailCache.get(summary.id);
    }
    if (sequence !== state.detailSequence || !state.container) return;
    hideWorkOrderPopover(true);
    const popover = workOrderPopover(detail);
    state.detailHover = popover;
    positionWorkOrderPopover(popover, target, event);
    popover.addEventListener('mouseenter', () => clearTimeout(state.detailTimer));
    popover.addEventListener('mouseleave', hideWorkOrderPopover);
    state.container.append(popover);
  }

  function hideWorkOrderPopover(immediate = true) {
    clearTimeout(state.detailTimer);
    state.detailSequence++;
    const remove = () => {
      state.detailHover?.remove();
      state.detailHover = null;
    };
    if (immediate === true) remove();
    else state.detailTimer = setTimeout(remove, 100);
  }

  function positionWorkOrderPopover(popover, target, event) {
    const width = 340;
    const rect = target.getBoundingClientRect?.() || {};
    const viewportWidth = window.innerWidth || 1280;
    const left = Math.min(
      viewportWidth - width - 12,
      Math.max(12, Number.isFinite(event?.clientX) ? event.clientX - width / 2 : (rect.left || 80)));
    const top = Math.max(10, (rect.top || event?.clientY || 100) - 330);
    popover.style.width = width + 'px';
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';
  }

  function workOrderPopover(order) {
    const popover = element('aside', 'wo-hover-card');
    popover.setAttribute('role', 'tooltip');
    const jobs = order.klussen || [];
    const job = jobs.find(item => item.sorteervolgorde === 0) || jobs[0];
    const humanNeeds = order.behoeften?.length ? order.behoeften
      : uniqueNeeds(jobs, 'mens');
    const equipmentNeeds = order.materieel?.length ? order.materieel
      : uniqueNeeds(jobs, 'materieel');
    const required = Math.max(
      Number(job?.benodigdeMedewerkers || 0),
      humanNeeds.reduce((sum, need) => sum + Number(need.aantal || 0), 0)
    );
    const assigned = [...new Map(jobs.flatMap(item => item.inzetten || []).map(item => [
      item.inhuurmedewerkerId || item.medewerkerId || item.id, item
    ])).values()].length;
    const heading = element('div', 'wo-hover-heading');
    const number = element('span', 'wo-hover-number', order.nummer || 'Nieuwe WO');
    heading.append(number, element('strong', '', order.klant || order.klantNaam || 'Klant onbekend'));
    popover.append(heading, element('small', 'wo-hover-description', order.korteWerkomschrijving || order.omschrijving || order.kop || ''));

    const journey = element('div', 'wo-hover-journey');
    journey.append(hoverLine('Vertrek', formatDuration(job?.reisHeen) || '—'),
      hoverLine('op locatie', (formatClock(order.startOpLocatie || job?.startTijd) + '–'
        + formatClock(order.eindOpLocatie || job?.eindTijd)).replace('–—', '')),
      hoverLine('', [order.werkadres, order.werkPostcode, order.werkPlaats].filter(Boolean).join(', '), true));
    popover.append(journey);

    const equipment = element('section', 'wo-hover-section');
    equipment.append(element('b', 'wo-hover-label', 'MATERIEEL'));
    const equipmentRows = [
      ...equipmentNeeds.map(need => `✓  ${need.aantal}× ${need.rol || need.type || 'Materieel'}`),
      ...(order.materialen || []).map(item => `✓  ${item.aantal} ${item.eenheid || ''} ${item.omschrijving || 'Materiaal'}`.replace(/\s+/g, ' '))
    ];
    for (const text of equipmentRows.length ? equipmentRows : ['Geen materieel vastgelegd'])
      equipment.append(element('span', 'wo-hover-value' + (equipmentRows.length ? '' : ' muted'), text));
    popover.append(equipment);

    const people = element('section', 'wo-hover-section');
    const peopleHeading = element('div', 'wo-hover-people-heading');
    peopleHeading.append(element('b', 'wo-hover-label', 'MENSEN'),
      element('b', assigned >= required ? 'wo-hover-count ok' : 'wo-hover-count', `${assigned}/${required}`));
    people.append(peopleHeading);
    const open = Math.max(0, required - assigned);
    for (const need of humanNeeds) {
      const row = element('div', 'wo-hover-need');
      row.append(element('span', '', need.rol || 'Medewerker'),
        element('b', open ? 'missing' : 'ok', open ? 'nog nodig' : 'ingevuld'));
      people.append(row);
    }
    if (!humanNeeds.length) people.append(element('span', 'wo-hover-value muted', open ? `${open} medewerkers nog in te plannen` : 'Geen functiebehoefte vastgelegd'));
    popover.append(people);

    const instructions = element('section', 'wo-hover-section');
    instructions.append(element('b', 'wo-hover-label', 'INSTRUCTIES'),
      element('span', 'wo-hover-instructions', order.instructies || 'Geen aanvullende instructies.'));
    popover.append(instructions);
    return popover;
  }

  function hoverLine(label, value, muted = false) {
    const line = element('p', 'wo-hover-line' + (muted ? ' muted' : ''));
    line.append(element('span', '', label), element('b', '', value || '—'));
    return line;
  }

  function uniqueNeeds(jobs, soort) {
    const map = new Map();
    for (const need of jobs.flatMap(job => job.behoeften || [])) {
      if ((need.soort || 'mens') !== soort) continue;
      const key = [need.rol, need.skill, need.materieelId, need.materieelGroepId].join('|');
      if (!map.has(key)) map.set(key, { ...need });
    }
    return [...map.values()];
  }

  function formatClock(value) {
    if (!value) return '—';
    return String(value).slice(0, 5);
  }
  function formatDuration(value) {
    if (!value) return '';
    const match = String(value).match(/^(\d+):(\d{2})/);
    return match ? `${match[1]}:${match[2]}` : String(value);
  }

  function groupJobs(jobs) {
    const groups = new Map();
    for (const job of jobs) {
      const key = [job.dienstNaam || '', job.omschrijving].join('|');
      if (!groups.has(key)) groups.set(key, {
        omschrijving: job.omschrijving, dienstNaam: job.dienstNaam, jobs: []
      });
      groups.get(key).jobs.push(job);
    }
    return [...groups.values()];
  }

  function jobRow(group, dates, order) {
    const jobs = group.jobs;
    const row = element('div', 'board-row board-job');
    const label = element('div', 'board-job-label');
    const needed = Math.max(0, ...jobs.map(job => job.benodigdeMedewerkers));
    const materialNeeded = Math.max(0, ...jobs.map(job =>
      (job.behoeften || []).filter(need => need.soort === 'materieel')
        .reduce((sum, need) => sum + Number(need.aantal || 0), 0)));
    label.append(element('b', '', 'Klussen'),
      element('small', '', group.omschrijving + ' · ' + jobs.length + ' dagen · ' +
        needed + ' mensen' + (materialNeeded ? ' · ' + materialNeeded + ' materieel' : '') + ' per dag'));
    row.append(label);
    const cells = element('div', 'board-days');
    for (const date of dates) {
      const cell = boardCell(date);
      const job = jobs.find(item => item.datum === iso(date));
      if (job) {
        const dayAssignments = job.inzetten.filter(item => iso(date) === item.datum).length;
        const complete = dayAssignments >= job.benodigdeMedewerkers;
        const chip = element('span', 'board-chip ' + (complete ? 'complete' : dayAssignments ? 'partial' : 'empty'),
          complete ? '✓ P ' + dayAssignments + '/' + job.benodigdeMedewerkers
            : 'P ' + dayAssignments + '/' + job.benodigdeMedewerkers);
        cell.append(chip);
        const equipment = (job.materieelInzetten || []).filter(item => item.datum === iso(date)).length;
        const requiredEquipment = (job.behoeften || []).filter(need => need.soort === 'materieel')
          .reduce((sum, need) => sum + Number(need.aantal || 0), 0);
        if (requiredEquipment) cell.append(element('small', 'board-material-count',
          'M ' + equipment + '/' + requiredEquipment));
      }

      cells.append(cell);
    }
    row.append(cells); return row;
  }

  async function assignDraggedResource(summary, selectedDates, resource, target) {
    const dates = Array.isArray(selectedDates) ? selectedDates : [selectedDates];
    const order = await state.request('/api/planning/werkopdrachten/' + summary.id);
    if (resource.sourceDate && resource.kind !== 'dock' && !dates.includes(resource.sourceDate)) {
      const sourceJob = order.klussen.find(item => item.datum === resource.sourceDate);
      if (sourceJob && (resource.kind === 'employee' || resource.kind === 'subcontractor'))
        sourceJob.inzetten = (sourceJob.inzetten || []).filter(item =>
          item.medewerkerId !== resource.id && item.inhuurmedewerkerId !== resource.id);
      if (sourceJob && resource.kind === 'equipment')
        sourceJob.materieelInzetten = (sourceJob.materieelInzetten || [])
          .filter(item => item.materieelId !== resource.id);
    }
    for (const date of dates) {
      const job = order.klussen.find(item => item.datum === date);
      if (!job) continue;
      if (resource.kind === 'employee' || resource.kind === 'subcontractor') {
        job.inzetten = job.inzetten || [];
        const duplicate = job.inzetten.some(item =>
          item.medewerkerId === resource.id || item.inhuurmedewerkerId === resource.id);
        if (!duplicate) job.inzetten.push({
          datum: date, medewerkerId: resource.kind === 'employee' ? resource.id : null,
          inhuurmedewerkerId: resource.kind === 'subcontractor' ? resource.id : null,
          startTijd: job.startTijd, eindTijd: job.eindTijd, werkbon: null
        });
      } else if (resource.kind === 'equipment') {
        job.materieelInzetten = job.materieelInzetten || [];
        if (!job.materieelInzetten.some(item => item.materieelId === resource.id))
          job.materieelInzetten.push({ datum: date, materieelId: resource.id });
      }
    }
    const payload = richValue(order);
    payload.klussen = order.klussen.map(item => ({
      omschrijving: item.omschrijving, startDatum: item.startDatum, eindDatum: item.eindDatum,
      benodigdeMedewerkers: item.benodigdeMedewerkers, startTijd: item.startTijd,
      eindTijd: item.eindTijd, sorteervolgorde: item.sorteervolgorde,
      inzetten: (item.inzetten || []).map(assignment => ({
        datum: assignment.datum, medewerkerId: assignment.medewerkerId,
        inhuurmedewerkerId: assignment.inhuurmedewerkerId,
        startTijd: assignment.startTijd, eindTijd: assignment.eindTijd, werkbon: assignment.werkbon
      })),
      behoeften: item.behoeften || [], datum: item.datum, reisHeen: item.reisHeen,
      reisTerug: item.reisTerug, materieelInzetten: (item.materieelInzetten || []).map(assignment => ({
        datum: assignment.datum, materieelId: assignment.materieelId
      }))
    }));
    try {
      await state.request('/api/planning/werkopdrachten/' + order.id, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': order.eTag },
        body: JSON.stringify(payload)
      });
      target.classList.add('drag-saved');
      setTimeout(() => target.classList.remove('drag-saved'), 1200);
      await load();
    } catch (error) {
      target.classList.add('drag-error');
      target.title = error.status === 412
        ? 'De planning is gewijzigd. Ververs en sleep opnieuw.'
        : 'Inplannen mislukt: ' + error.message;
      setTimeout(() => target.classList.remove('drag-error'), 2500);
    }
  }

  function assignmentRow(person, dates, order) {
    const row = element('div', 'board-row board-person' + (person.external ? ' external' : ''));
    const label = element('div', 'board-person-label');
    label.append(person.external ? element('span', 'board-external', 'INH') : element('span', '', ''),
      element('span', 'board-person-name', person.name), element('small', '', person.role || ''));
    const cells = element('div', 'board-days');
    for (const date of dates) {
      const cell = boardCell(date), assignment = person.days[iso(date)];
      if (assignment) {
        const status = assignment.werkbon?.status;
        const className = status === 'binnen' ? 'slip-inside' : status === 'uitgereikt' ? 'slip-issued' : status === 'niet_geprint' ? 'slip-print' : 'slip-none';
        const text = status ? slipStatuses[status][0] : '·';
        const chip = element('span', 'board-chip ' + className, text);
        chip.title = person.name + ', ' + longDayNames[date.getDay()] + ' ' + date.getDate() + ': ' + (status ? slipStatuses[status][1] : 'nog geen bon');
        makeDayResourceDraggable(chip, {
          id: person.id, kind: person.external ? 'subcontractor' : 'employee',
          title: person.name, sourceDate: iso(date)
        });
        cell.append(chip, element('small', '', assignment.werkbon?.nummer || ''));
      }
      if (state.canEdit) bindSingleDayDrop(cell, order, iso(date));
      cells.append(cell);
    }
    row.append(label, cells); return row;
  }

  function groupAssignments(assignments) {
    const result = new Map();
    for (const assignment of assignments) {
      const external = !!assignment.inhuurmedewerkerId;
      const key = (external ? 'e:' + assignment.inhuurmedewerkerId : 'i:' + assignment.medewerkerId);
      if (!result.has(key)) result.set(key, {
        id: external ? assignment.inhuurmedewerkerId : assignment.medewerkerId,
        external, name: assignment.medewerker || assignment.inhuurmedewerker,
        role: external && assignment.leverancier
          ? [assignment.functie, assignment.leverancier].filter(Boolean).join(' · ')
          : assignment.functie, days: {}
      });
      result.get(key).days[assignment.datum] = assignment;
    }
    return [...result.values()];
  }

  function groupMaterialAssignments(jobs) {
    const result = new Map();
    for (const assignment of jobs.flatMap(job => job.materieelInzetten || [])) {
      if (!result.has(assignment.materieelId)) result.set(assignment.materieelId, {
        id: assignment.materieelId, name: assignment.materieel || 'Materieel', days: {}
      });
      result.get(assignment.materieelId).days[assignment.datum] = assignment;
    }
    return [...result.values()];
  }

  function makeDayResourceDraggable(element, resource) {
    if (!state.canEdit) return;
    element.draggable = true;
    element.classList.add('board-draggable-day');
    element.addEventListener('dragstart', event => {
      if (state.dropBusy) { event.preventDefault?.(); return; }
      state.dragging = resource;
      event.dataTransfer?.setData('application/json', JSON.stringify(resource));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      hideWorkOrderPopover();
      clearBoardDropTargets();
      element.classList.add('dragging');
    });
    element.addEventListener('dragend', () => {
      state.dragging = null;
      element.classList.remove('dragging');
      clearBoardDropTargets();
    });
  }

  function bindSingleDayDrop(cell, order, date) {
    const valid = order.klussen.some(job => job.datum === date);
    cell.classList.add('board-day-drop');
    cell.addEventListener('dragover', event => {
      if (!state.dragging || state.dropBusy) return;
      event.preventDefault(); event.stopPropagation();
      const active = valid ? 'drag-target' : 'drag-invalid';
      if (!String(cell.className || '').split(/\s+/).includes(active)) {
        clearBoardDropTargets();
        cell.classList.add(active);
        dropTip(event, state.dragging.title + ' → ' + shortDate(parse(date)), valid);
      }
      if (event.dataTransfer) event.dataTransfer.dropEffect = valid ? 'move' : 'none';
    });
    cell.addEventListener('dragleave', event => {
      if (cell.contains?.(event.relatedTarget)) return;
      cell.classList.remove('drag-target', 'drag-invalid');
      hideDropTip();
    });
    cell.addEventListener('drop', async event => {
      if (state.dropBusy) return;
      event.preventDefault(); event.stopPropagation();
      const resource = state.dragging;
      state.dragging = null; state.dropBusy = true;
      clearBoardDropTargets();
      state.container?.querySelectorAll?.('.dragging')
        .forEach(item => item.classList.remove('dragging'));
      if (!valid || !resource) { state.dropBusy = false; return; }
      try { await assignDraggedResource(order, [date], resource, cell); }
      finally { state.dropBusy = false; }
    });
  }

  function materialAssignmentRow(item, dates, order) {
    const row = element('div', 'board-row board-person material');
    const label = element('div', 'board-person-label');
    label.append(element('span', 'board-material-label', 'MAT'),
      element('span', 'board-person-name', item.name),
      element('small', '', 'Materieel'));
    const cells = element('div', 'board-days');
    for (const date of dates) {
      const cell = boardCell(date);
      if (item.days[iso(date)]) {
        const chip = element('span', 'board-chip complete', '✓ ingepland');
        makeDayResourceDraggable(chip, {
          id: item.id, kind: 'equipment', title: item.name, sourceDate: iso(date)
        });
        cell.append(chip);
      }
      if (state.canEdit) bindSingleDayDrop(cell, order, iso(date));
      cells.append(cell);
    }

    function makeDayResourceDraggable(element, resource) {
      if (!state.canEdit) return;
      element.draggable = true;
      element.classList.add('board-draggable-day');
      element.addEventListener('dragstart', event => {
        if (state.dropBusy) { event.preventDefault?.(); return; }
        state.dragging = resource;
        event.dataTransfer?.setData('application/json', JSON.stringify(resource));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        hideWorkOrderPopover();
        clearBoardDropTargets();
        element.classList.add('dragging');
      });
      element.addEventListener('dragend', () => {
        state.dragging = null;
        element.classList.remove('dragging');
        clearBoardDropTargets();
      });
    }

    function bindSingleDayDrop(cell, order, date) {
      const valid = order.klussen.some(job => job.datum === date);
      cell.classList.add('board-day-drop');
      cell.addEventListener('dragover', event => {
        if (!state.dragging || state.dropBusy) return;
        event.preventDefault(); event.stopPropagation();
        const active = valid ? 'drag-target' : 'drag-invalid';
        if (!cell.classList.contains(active)) {
          clearBoardDropTargets();
          cell.classList.add(active);
          dropTip(event, state.dragging.title + ' → ' + shortDate(parse(date)), valid);
        }
        if (event.dataTransfer) event.dataTransfer.dropEffect = valid ? 'move' : 'none';
      });
      cell.addEventListener('dragleave', event => {
        if (cell.contains?.(event.relatedTarget)) return;
        cell.classList.remove('drag-target', 'drag-invalid');
        hideDropTip();
      });
      cell.addEventListener('drop', async event => {
        if (state.dropBusy) return;
        event.preventDefault(); event.stopPropagation();
        const resource = state.dragging;
        state.dragging = null; state.dropBusy = true;
        clearBoardDropTargets();
        state.container?.querySelectorAll?.('.dragging')
          .forEach(item => item.classList.remove('dragging'));
        if (!valid || !resource) { state.dropBusy = false; return; }
        try { await assignDraggedResource(order, [date], resource, cell); }
        finally { state.dropBusy = false; }
      });
    }
    row.append(label, cells);
    return row;
  }

  function boardCell(date) {
    const value = element('div', 'board-cell' + (iso(date) === iso(new Date()) ? ' today' : '') + ([0, 6].includes(date.getDay()) ? ' weekend' : ''));
    return value;
  }
  function colorMix(color, opacity) {
    const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
    return 'rgba(' + rgb.join(',') + ',' + opacity + ')';
  }
  function weekLabel(value) {
    const start = addDays(startOfWeek(value), 0), end = addDays(start, 6);
    const formatter = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long' });
    return 'WEEK · ' + formatter.format(start) + ' – ' + formatter.format(end);
  }
  function countWorkdays(from, to) {
    let count = 0;
    for (let date = parse(from); date <= parse(to); date = addDays(date, 1)) if (![0, 6].includes(date.getDay())) count++;
    return count;
  }

  function legend() {
    const result = element('div', 'board-legend');
    result.innerHTML = '<b>KLUS</b><span><i class="complete">✓</i> rond</span><span><i class="partial">4/5</i> plek open</span><span><i class="empty">0</i> niemand</span><b>WERKBON</b><span><i class="slip-none">·</i> geen bon</span><span><i class="slip-print">N</i> niet geprint</span><span><i class="slip-issued">U</i> uitgereikt</span><span><i class="slip-inside">✓</i> binnen</span>';
    return result;
  }

  async function editOrder(order, selectedJobId = null) {
    let baseline = null;
    if (order) baseline = await state.request('/api/planning/werkopdrachten/' + order.id);
    const draft = baseline ? clone(baseline) : newOrder();
    delete draft.eTag; delete draft.version; delete draft.status; delete draft.klant;
    const modal = createEditorDialog(state.canEdit
      ? (baseline ? 'Werkopdracht ' + baseline.nummer + ' bewerken' : 'Werkopdracht toevoegen')
      : 'Werkopdracht ' + (baseline?.nummer || '') + ' bekijken');
    const body = modal.querySelector('.board-dialog-body');
    const status = modal.querySelector('.board-dialog-status');
    const save = modal.querySelector('.board-dialog-save');
    save.hidden = !state.canEdit;
    if (baseline && state.canEdit) {
      draft.deleteWorkOrder = async () => {
        const number = baseline.nummer || 'deze werkopdracht';
        if (!window.confirm(`${number} definitief verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return;
        try {
          await state.request('/api/planning/werkopdrachten/' + baseline.id, {
            method: 'DELETE', headers: { 'If-Match': baseline.eTag }
          });
          modal.close();
          await load();
        } catch (error) {
          status.textContent = error.status === 412
            ? 'Deze werkopdracht is door iemand anders gewijzigd. Vernieuw het scherm voordat je verwijdert.'
            : 'Verwijderen mislukt: ' + error.message;
        }
      };
    }
    const apply = createRichWorkOrderForm(body, draft, baseline, selectedJobId);
    save.onclick = async () => {
      save.disabled = true;
      const value = apply();
      const invalid = validateWorkOrder(value, !baseline);
      if (invalid) {
        status.textContent = invalid;
        save.disabled = false;
        return;
      }
      try {
        const endpoint = '/api/planning/werkopdrachten' + (baseline ? '/' + baseline.id : '');
        const headers = { 'Content-Type': 'application/json' };
        if (baseline) headers['If-Match'] = baseline.eTag;
        const result = await state.request(endpoint, { method: baseline ? 'PUT' : 'POST', headers, body: JSON.stringify(value) });
        modal.close(); await load(); return result;
      } catch (error) {
        status.textContent = error.status === 412
          ? 'Deze werkopdracht is door iemand anders gewijzigd. Je invoer blijft behouden.'
          : 'Opslaan mislukt: ' + error.message;
        if (error.status === 412) {
          const retry = action('Nieuwste versie ophalen en mijn invoer opnieuw toepassen', 'board-btn', async () => {
            baseline = await state.request('/api/planning/werkopdrachten/' + baseline.id);
            status.textContent = 'De nieuwste versie is geladen. Controleer je invoer en sla opnieuw op.'; retry.remove();
          });
          status.append(document.createElement('br'), retry);
        }
        save.disabled = false;
      }
    };
    if (baseline && state.canEdit) {
      const lifecycle = element('div', 'wo-lifecycle-actions');
      lifecycle.append(
        action('↩ Terug naar werkvoorraad', 'board-btn', () => lifecycleMutation('voorraad')),
        action('Werkopdracht annuleren', 'board-btn danger', () => {
          if (window.confirm('Werkopdracht annuleren?') ) lifecycleMutation('annuleren');
        }));
      body.append(lifecycle);
      const lifecycleMutation = async kind => {
        const headers = { 'Content-Type': 'application/json', 'If-Match': baseline.eTag };
        try {
          const saved = await state.request('/api/planning/werkopdrachten/' + baseline.id + '/' + kind,
            { method: 'POST', headers, body: '{}' });
          modal.close(); await load(); return saved;
        } catch (error) { status.textContent = 'Wijzigen mislukt: ' + error.message; }
      };
    }
    if (!state.canEdit) body.querySelectorAll('input,select,button.board-add-row,button.board-remove').forEach(control => control.disabled = true);
    modal.showModal();
  }

  function createRichWorkOrderForm(body, draft, baseline) {
    const refs = state.formReferences?.klanten ? state.formReferences : {
      klanten: (state.formReferences?.klanten || state.references?.klanten || []).map(item => ({ ...item, contacten: item.contacted || [], debiteurnummer: '' })),
      vestigingen: state.references?.vestigingen || [], functies: [], materieelTypes: [], artikelen: []
    };
    draft = richDefaults(draft, baseline);
    body.replaceChildren();
    const shell = element('div', 'wo-form-shell');
    const form = element('div', 'wo-form');
    const summary = element('aside', 'wo-summary');
    shell.append(form, summary); body.append(shell);
    let selectedCustomer = refs.klanten.find(item => item.id === Number(draft.klantId)) || null;

    const section = (number, title, ready, children) => {
      const result = element('section', 'wo-step');
      const head = element('div', 'wo-step-head');
      head.append(element('span', 'wo-step-number ' + (ready() ? 'done' : ''), ready() ? '✓' : String(number)),
        element('h3', '', number + ' · ' + title));
      result.append(head, ...children); form.append(result); return result;
    };
    const field = (label, control, hint) => {
      const result = element('label', 'board-field', label); result.append(control);
      if (hint) result.append(element('small', 'hint', hint)); return result;
    };
    const bind = (control, key, transform = value => value) => {
      control.addEventListener('input', () => { draft[key] = transform(control.value); updateSummary(); });
      control.addEventListener('change', () => { draft[key] = transform(control.value); updateSummary(); });
      return control;
    };
    const grid = (...children) => { const result = element('div', 'board-form-grid'); result.append(...children); return result; };

    const customer = element('input'); customer.setAttribute('aria-label', 'Klant'); customer.setAttribute('list', 'wo-klanten');
    customer.placeholder = 'Kies of typ een klant…'; customer.autocomplete = 'off';
    const customerList = element('datalist'); customerList.id = 'wo-klanten';
    refs.klanten.forEach(item => {
      const entry = element('option', '', item.naam);
      entry.value = item.naam; customerList.append(entry);
    });
    const initialCustomer = refs.klanten.find(item => item.id === Number(draft.klantId));
    customer.value = initialCustomer?.naam || '';
    const chooseCustomer = async () => {
      const selected = refs.klanten.find(item =>
        item.naam.toLocaleLowerCase('nl') === customer.value.trim().toLocaleLowerCase('nl') ||
        item.debiteurnummer && item.debiteurnummer.toLocaleLowerCase('nl') === customer.value.trim().toLocaleLowerCase('nl'));
      draft.klantId = selected?.id || null;
      selectedCustomer = refs.klanten.find(item => item.id === draft.klantId) || null;
      draft.nieuweKlant = null; newCustomerArea.replaceChildren();
      if (selectedCustomer) {
        customerCard(selectedCustomer);
        customer.value = selectedCustomer.naam;
        const preferred = selectedCustomer.contacten?.find(contact => contact.isStandaardBesteller)
          || selectedCustomer.contacten?.[0] || null;
        draft.bestellerId = preferred?.id || null;
        draft.bestellerNaam = preferred?.naam || selectedCustomer.naam;
        draft.bestellerTelefoon = preferred?.telefoon || selectedCustomer.telefoon || null;
        draft.bestellerEmail = preferred?.email || selectedCustomer.email || null;
        try {
          recent = await state.request('/api/planning/klanten/' + draft.klantId + '/recente-werkopdrachten');
          renderRecent();
        } catch { recent = []; renderRecent(); }
      } else {
        customerCard(null); draft.bestellerId = null; draft.bestellerNaam = null;
        draft.bestellerTelefoon = null; draft.bestellerEmail = null; recent = []; renderRecent();
      }
      renderBuyer(); updateSummary();
    };
    customer.addEventListener('change', chooseCustomer);
    customer.addEventListener('input', () => {
      const match = refs.klanten.some(item => item.naam.toLocaleLowerCase('nl') === customer.value.trim().toLocaleLowerCase('nl'));
      if (!match && draft.klantId) {
        draft.klantId = null; selectedCustomer = null; customerCard(null);
        draft.bestellerId = null; renderBuyer(); updateSummary();
      }
    });
    const customerCardArea = element('div', 'wo-customer-card');
    const buyerArea = element('div', 'wo-buyer-area');
    const newCustomerToggle = action('+ Nieuwe klant', 'board-btn');
    const newCustomerArea = element('div', 'wo-new-customer');
    let recent = [];
    const recentArea = element('div', 'wo-recent-slot');
    function renderRecent() {
      recentArea.replaceChildren(recentOrdersBox(() => recent, item => {
        applyRecentItem(draft, item); updateSummary();
      }));
    }
    function customerCard(item) {
      if (!item) { customerCardArea.replaceChildren(); return; }
      const card = element('div', 'wo-card');
      card.append(element('h4', '', item.naam),
        element('p', '', 'Debiteur ' + (item.debiteurnummer || '—')),
        element('p', '', [item.straat, item.postcode, item.plaats].filter(Boolean).join(' · ')),
        element('p', '', [item.telefoon, item.email].filter(Boolean).join(' · ')),
        action('Klantkaart', 'board-btn', () => window.open('/planning/?list=klanten&id=' + item.id, '_blank')));
      customerCardArea.replaceChildren(card);
    }
    function renderBuyer() {
      const select = element('select'); select.setAttribute('aria-label', 'Besteller');
      select.append(option('', '— kies besteller —'));
      for (const person of selectedCustomer?.contacten || []) select.append(option(person.id, person.naam));
      select.append(option('other', 'Andere persoon…')); select.value = draft.bestellerId || '';
      select.addEventListener('change', () => {
        draft.bestellerId = select.value === 'other' ? 'other' : Number(select.value) || null;
        const selected = selectedCustomer?.contacten?.find(person => person.id === Number(draft.bestellerId));
        draft.bestellerNaam = selected?.naam || (draft.bestellerId === 'other' ? '' : selectedCustomer?.naam || '');
        draft.bestellerTelefoon = selected?.telefoon || (draft.bestellerId === 'other' ? '' : selectedCustomer?.telefoon || '');
        draft.bestellerEmail = selected?.email || (draft.bestellerId === 'other' ? '' : selectedCustomer?.email || '');
        renderBuyer(); updateSummary();
      });
      const children = [field('Besteller', select)];
      const chosen = selectedCustomer?.contacten?.find(person => person.id === Number(draft.bestellerId));
      const editable = draft.bestellerId === 'other';
      const name = input(editable ? draft.nieuweBesteller?.naam : (chosen?.naam || draft.bestellerNaam), 'Naam besteller');
      const phone = input(editable ? draft.nieuweBesteller?.telefoon : (chosen?.telefoon || draft.bestellerTelefoon), 'Telefoon besteller');
      const email = input(editable ? draft.nieuweBesteller?.email : (chosen?.email || draft.bestellerEmail), 'E-mail besteller');
      name.readOnly = phone.readOnly = email.readOnly = !editable;
      if (editable) {
        name.addEventListener('input', () => { draft.bestellerNaam = name.value; updateSummary(); });
        phone.addEventListener('input', () => { draft.bestellerTelefoon = phone.value; updateSummary(); });
        email.addEventListener('input', () => { draft.bestellerEmail = email.value; updateSummary(); });
      }
      children.push(grid(field('Naam', name), field('Telefoon', phone), field('E-mail', email)));
      buyerArea.replaceChildren(...children);
    }
    newCustomerToggle.addEventListener('click', () => {
      const value = draft.nieuweKlant || { bedrijfsnaam:'', straat:'', postcode:'', plaats:'', telefoon:'', email:'' };
      draft.nieuweKlant = value; draft.klantId = null; customer.value = '';
      selectedCustomer = null; customerCard(null); renderBuyer();
      const controls = grid(...[
        ['Bedrijfsnaam *','bedrijfsnaam'],['Straat','straat'],['Postcode','postcode'],['Plaats','plaats'],
        ['Telefoon','telefoon'],['E-mail','email']
      ].map(([label, key]) => {
        const control = input(value[key], label);
        control.addEventListener('input', () => { value[key] = control.value; updateSummary(); });
        return field(label, control);
      }));
      newCustomerArea.replaceChildren(controls);
    });
    section(1, 'Klant', () => !!draft.klantId || !!draft.nieuweKlant?.bedrijfsnaam, [
      element('p', 'hint', 'Het WO-nummer volgt bij opslaan.'),
      grid(field('Klant', customer), newCustomerToggle), customerList, customerCardArea, buyerArea, newCustomerArea,
      orderNumbersEditor(draft), recentArea
    ]);
    customerCard(selectedCustomer);
    if (selectedCustomer && !draft.bestellerId) {
      const preferred = selectedCustomer.contacten?.find(person => person.isStandaardBesteller)
        || selectedCustomer.contacten?.[0] || null;
      draft.bestellerId = preferred?.id || null;
      draft.bestellerNaam = preferred?.naam || selectedCustomer.naam;
      draft.bestellerTelefoon = preferred?.telefoon || selectedCustomer.telefoon || null;
      draft.bestellerEmail = preferred?.email || selectedCustomer.email || null;
    }
    renderBuyer(); renderRecent();

    const type = element('div', 'wo-segmented');
    for (const [value, label] of [['regie','Regie'],['aangenomen','Aangenomen']]) {
      const button = action(label, 'board-toggle' + (draft.soort === value ? ' active' : ''), () => {
        draft.soort = value; type.querySelectorAll('button').forEach(node => node.classList.toggle('active', node === button)); updateSummary();
      });
      type.append(button);
    }
    const optionReason = field('Voor wie / waarom', bind(input(draft.optieReden, 'Voor wie / waarom'), 'optieReden'));
    const optionUntil = field('Optie geldig t/m', bind(input(draft.optieTot, 'Optie geldig t/m', 'date'), 'optieTot'));
    const optionControl = input('', 'Optie', 'checkbox'); optionControl.checked = !!draft.isOptie;
    optionControl.addEventListener('change', () => { draft.isOptie = optionControl.checked; optionExtra.hidden = !optionControl.checked; updateSummary(); });
    const optionExtra = element('div'); optionExtra.append(grid(optionReason, optionUntil)); optionExtra.hidden = !draft.isOptie;
    section(2, 'Opdracht VSVK', () => !!draft.korteWerkomschrijving && (draft.soort !== 'aangenomen' || !!draft.internProjectnummer), [
      grid(field('Afhandeling', type), field('Optie', optionControl)),
      grid(field('Korte werkomschrijving', bind(input(draft.korteWerkomschrijving, 'Korte werkomschrijving'), 'korteWerkomschrijving')),
        field('Intern projectnummer', bind(input(draft.internProjectnummer, 'Intern projectnummer'), 'internProjectnummer'))),
      optionExtra, element('p', 'hint', draft.soort === 'regie'
        ? 'Regie: uren en materieel worden achteraf op de werkbon afgerekend.'
        : 'Aangenomen: vaste prijs; uren gaan op het interne project en er gaat geen urenproforma naar de klant.')
    ]);

    const stock = action('Nog geen datum? Zet in de werkvoorraad →', 'board-btn', () => {
      draft.werkvoorraad = !draft.werkvoorraad; stock.classList.toggle('active', draft.werkvoorraad);
 updateSummary();
    });
    const weekend = input('', 'Weekend overslaan', 'checkbox'); weekend.checked = draft.weekendOverslaan !== false;
    weekend.addEventListener('change', () => { draft.weekendOverslaan = weekend.checked; rebuildDays(); updateSummary(); });
    const startDate = bind(input(draft.startDatum, 'Datum op locatie', 'date'), 'startDatum');
    const endDate = bind(input(draft.eindDatum, 'Tot en met', 'date'), 'eindDatum');
    const dayStrip = element('div', 'wo-day-strip');
    function rebuildDays() {
      dayStrip.replaceChildren();
      if (!draft.startDatum || !draft.eindDatum || draft.werkvoorraad) return;
      for (let date = parse(draft.startDatum); date <= parse(draft.eindDatum); date = addDays(date, 1)) {
        const value = iso(date), skipped = (draft.vrijeDagen || []).includes(value);
        const day = action(dayNames[date.getDay()] + ' ' + date.getDate(), 'wo-day' + (skipped ? ' skipped' : ''));
        day.addEventListener('click', () => {
          draft.vrijeDagen = skipped ? draft.vrijeDagen.filter(item => item !== value) : [...(draft.vrijeDagen || []), value];
          rebuildDays(); updateSummary();
        });
        dayStrip.append(day);
      }
    }
    startDate.addEventListener('change', rebuildDays); endDate.addEventListener('change', rebuildDays);
    const stockFields = grid(
      field('Geschatte uren', bind(input(draft.geschatteUren, 'Geschatte uren', 'number'), 'geschatteUren', Number)),
      field('Uiterlijk klaar', bind(input(draft.uiterlijkKlaar, 'Uiterlijk klaar', 'date'), 'uiterlijkKlaar')),
      field('Prioriteit', bind(selectValue(['hoog','normaal','laag'], draft.prioriteit, 'Prioriteit'), 'prioriteit'))
    );
    stockFields.hidden = !draft.werkvoorraad;
    const timeFields = grid(
      field('Starttijd op locatie', bind(input(draft.startOpLocatie, 'Starttijd op locatie', 'time'), 'startOpLocatie')),
      field('Eindtijd op locatie', bind(input(draft.eindOpLocatie, 'Eindtijd op locatie', 'time'), 'eindOpLocatie')),
      field('Reistijd heen (min)', bind(input(draft.reisHeenMinuten, 'Reistijd heen', 'number'), 'reisHeenMinuten', Number)),
      field('Reistijd terug (min)', bind(input(draft.reisTerugMinuten, 'Reistijd terug', 'number'), 'reisTerugMinuten', Number)),
      field('Pauze (min)', bind(input(draft.pauzeMinuten, 'Pauze', 'number'), 'pauzeMinuten', Number))
    );
    const multipleServices = input('', 'Diensten · meerdere per dag', 'checkbox');
    multipleServices.checked = !!draft.meerdereDiensten;
    multipleServices.addEventListener('change', () => {
      draft.meerdereDiensten = multipleServices.checked; renderServices(); updateSummary();
    });
    const serviceArea = element('div', 'wo-services');
    const renderServices = () => {
      serviceArea.replaceChildren();
      if (!draft.meerdereDiensten) return;
      const preset = element('div', 'wo-service-presets');
      preset.append(
        action('2 × 12 u', 'board-btn', () => { draft.diensten = [
          { naam:'Dienst A', start:'06:00', eind:'18:00' }, { naam:'Dienst B', start:'18:00', eind:'06:00' }]; renderServices(); }),
        action('3 × 8 u', 'board-btn', () => { draft.diensten = [
          { naam:'Ochtend', start:'06:00', eind:'14:00' }, { naam:'Middag', start:'14:00', eind:'22:00' },
          { naam:'Nacht', start:'22:00', eind:'06:00' }]; renderServices(); }));
      serviceArea.append(preset);
      for (const [index, service] of (draft.diensten || []).entries()) {
        const row = element('div', 'wo-service-row');
        const name = input(service.naam, 'Dienstnaam'), start = input(service.start, 'Dienst start', 'time'), end = input(service.eind, 'Dienst eind', 'time');
        name.addEventListener('input', () => service.naam = name.value);
        start.addEventListener('input', () => service.start = start.value);
        end.addEventListener('input', () => service.eind = end.value);
        row.append(name, start, end, action('✕', 'board-remove', () => { draft.diensten.splice(index, 1); renderServices(); }));
        serviceArea.append(row);
      }
      serviceArea.append(action('+ dienst', 'board-add-row', () => {
        draft.diensten.push({ naam:'Nieuwe dienst', start:'08:00', eind:'16:00' }); renderServices();
      }));
    };
    renderServices();
    section(3, 'Wanneer', () => draft.werkvoorraad || (!!draft.startDatum && !!draft.eindDatum && validWorkDays(draft).length > 0), [
      grid(field('Datum op locatie', startDate), field('Tot en met', endDate), field('Weekend overslaan', weekend)),
      dayStrip, element('p', 'hint wo-days-hint', dayHint(draft)), timeFields, stock, stockFields
      , field('Diensten · meerdere per dag', multipleServices), serviceArea
    ]);
    rebuildDays();

    const sameAddress = action('Zelfde als klantadres', 'board-btn', () => {
      if (!selectedCustomer) return;
      draft.werkadres = selectedCustomer.straat || ''; draft.werkPostcode = selectedCustomer.postcode || '';
      draft.werkPlaats = selectedCustomer.plaats || ''; form.querySelectorAll('[aria-label=\"Werkadres\"], [aria-label=\"Werkpostcode\"], [aria-label=\"Werkplaats\"]').forEach(control => {
        if (control.getAttribute('aria-label') === 'Werkadres') control.value = draft.werkadres;
        if (control.getAttribute('aria-label') === 'Werkpostcode') control.value = draft.werkPostcode;
        if (control.getAttribute('aria-label') === 'Werkplaats') control.value = draft.werkPlaats;
      }); updateSummary();
    });
    const useLocation = action('📍 Hier', 'board-btn', () => navigator.geolocation?.getCurrentPosition(
      position => { draft.gpsLocatie = position.coords.latitude + ',' + position.coords.longitude; updateSummary(); },
      () => updateSummary('Locatie ophalen mislukt.')));
    section(4, 'Werk', () => !!draft.korteWerkomschrijving && (!!draft.werkadres || !!draft.gpsLocatie), [
      grid(field('Wat moet er gebeuren', bind(textarea(draft.werkInhoud, 'Wat moet er gebeuren'), 'werkInhoud')),
        field('Instructies voor de ploeg', bind(textarea(draft.instructies, 'Instructies voor de ploeg'), 'instructies'))),
      grid(field('Werkadres', bind(input(draft.werkadres, 'Werkadres'), 'werkadres')),
        field('Postcode', bind(input(draft.werkPostcode, 'Werkpostcode'), 'werkPostcode')),
        field('Plaats', bind(input(draft.werkPlaats, 'Werkplaats'), 'werkPlaats'))),
      sameAddress,
      grid(field('GPS / Maps-link', bind(input(draft.gpsLocatie, 'GPS-locatie'), 'gpsLocatie')), useLocation,
        field('Contact op locatie', bind(input(draft.contactLocatieNaam, 'Contact op locatie'), 'contactLocatieNaam')),
        field('Telefoon contact', bind(input(draft.contactLocatieTelefoon, 'Telefoon contact'), 'contactLocatieTelefoon'))),
      materialEditor(draft, refs), action('Bekijk in Google Maps', 'board-btn', () => openMaps(draft))
    ]);

    const requirements = needEditor(draft, refs, updateSummary);
    const capacity = element('div', 'wo-capacity'); capacity.append(element('p', 'hint', 'Drukte wordt berekend zodra de periode en behoefte zijn ingevuld.'));
    section(5, 'Wie & wat nodig', () => requirementCount(draft.behoeften) > 0, [requirements, capacity,
      action('Drukte controleren', 'board-btn', async () => {
        capacity.textContent = 'Drukte berekenen…';
        try {
          const result = await state.request('/api/planning/werkopdrachten/drukte', {
            method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({
              van: draft.startDatum, tot: draft.eindDatum, vrijeDagen: draft.vrijeDagen || [],
              mensen: draft.behoeften || [], materieel: draft.materieel || []
            })
          });
          renderCapacity(capacity, result);
        } catch (error) { capacity.textContent = 'Drukte ophalen mislukt: ' + error.message; }
      })
    ]);
    function updateSummary(message = '') {
      renderSummary(summary, draft, message);
      const hint = shell.querySelector('.wo-days-hint'); if (hint) hint.textContent = dayHint(draft);
    }
    updateSummary();
    return () => richValue(draft);
  }

  function textarea(value, label) {
    const control = element('textarea'); control.value = value || ''; control.rows = 3;
    control.setAttribute('aria-label', label); return control;
  }
  function selectValue(values, value, label) {
    const select = element('select'); select.setAttribute('aria-label', label);
    values.forEach(item => select.append(option(item, item[0].toUpperCase() + item.slice(1))));
    select.value = value || values[0]; return select;
  }
  function richDefaults(value) {
    return Object.assign(newOrder(), value, {
      vrijeDagen: value.vrijeDagen || [], ordernummers: value.ordernummers?.length ? value.ordernummers : [''],
      behoeften: (value.behoeften || []).map(item => ({ ...item, soort: item.soort || 'mens' })),
      materieel: (value.materieel || []).map(item => ({ ...item, soort: 'materieel' })),
      materialen: value.materialen || [],
      nieuweBesteller: value.nieuweBesteller || null, nieuweKlant: value.nieuweKlant || null
      , startOpLocatie: value.startOpLocatie || '07:00', eindOpLocatie: value.eindOpLocatie || '16:00'
    });
  }
  function validWorkDays(draft) {
    if (!draft.startDatum || !draft.eindDatum) return [];
    const result = [];
    for (let date = parse(draft.startDatum); date <= parse(draft.eindDatum); date = addDays(date, 1)) {
      const value = iso(date);
      if (draft.weekendOverslaan && [0,6].includes(date.getDay())) continue;
      if ((draft.vrijeDagen || []).includes(value)) continue;
      result.push(value);
    }
    return result;
  }
  function dayHint(draft) {
    const count = validWorkDays(draft).length;
    return count + ' werkdagen · klik een dag om hem over te slaan.';
  }
  function orderNumbersEditor(draft) {
    const area = element('div', 'wo-order-numbers');
    const render = () => {
      area.replaceChildren(element('strong', '', 'Ordernummer(s) klant'));
      draft.ordernummers = draft.ordernummers?.length ? draft.ordernummers : [''];
      draft.ordernummers.forEach((value, index) => {
        const row = element('div', 'wo-inline');
        const control = input(value, 'Ordernummer klant ' + (index + 1));
        control.addEventListener('input', () => draft.ordernummers[index] = control.value);
        row.append(control, action('✕', 'board-remove', () => { draft.ordernummers.splice(index, 1); render(); }));
        area.append(row);
      });
      area.append(element('small', 'hint', 'Staat op de werkbon en is nodig voor de factuur.'),
        action('+ Ordernummer', 'board-add-row', () => { draft.ordernummers.push(''); render(); }));
    };
    render(); return area;
  }
  function recentOrdersBox(source, apply) {
    const box = element('div', 'wo-recent'); box.append(element('strong', '', 'Snel starten: laatste 4 opdrachten'));
    const values = source();
    if (!values.length) box.append(element('small', 'hint', 'Kies een klant om recente opdrachten te tonen.'));
    for (const item of values) box.append(action(item.nummer + ' · ' + item.omschrijving, 'wo-recent-item', () => apply(item)));
    return box;
  }
  function applyRecentItem(draft, item) {
    for (const key of ['korteWerkomschrijving','werkadres','werkPostcode','werkPlaats','startOpLocatie','eindOpLocatie']) draft[key] = item[key];
    draft.behoeften = item.behoeften || []; draft.materieel = item.materieel || [];
    return draft;
  }
  function materialEditor(draft) {
    const area = element('div', 'wo-materials'); area.append(element('h4', '', 'Materialen'));
    const rows = element('div', 'wo-material-rows'); area.append(rows);
    const render = () => {
      rows.replaceChildren();
      draft.materialen.forEach((line, index) => {
        const row = element('div', 'wo-material-row');
        const amount = input(line.aantal, 'Aantal materiaal', 'number'); amount.addEventListener('input', () => line.aantal = Number(amount.value));
        const article = element('select'); article.append(option('', 'Anders, zelf omschrijven…'));
        for (const item of state.formReferences?.artikelen || []) article.append(option(item.id, item.naam + ' · ' + item.eenheid));
        article.value = line.artikelId || ''; article.addEventListener('change', () => line.artikelId = article.value || null);
        const description = input(line.omschrijving, 'Materiaalomschrijving');
        description.addEventListener('input', () => line.omschrijving = description.value);
        const unit = input(line.eenheid, 'Eenheid'); unit.addEventListener('input', () => line.eenheid = unit.value);
        row.append(amount, article, description, unit, action('✕', 'board-remove', () => { draft.materialen.splice(index, 1); render(); }));
        rows.append(row);
      });
    };
    render(); area.append(action('+ Materiaal', 'board-add-row', () => { draft.materialen.push({ aantal:1, artikelId:null, omschrijving:'', eenheid:'' }); render(); }));
    return area;
  }
  function requirementCount(items) { return (items || []).reduce((sum, item) => sum + Number(item.aantal || 0), 0); }
  function needEditor(draft, refs, onChange) {
    const area = element('div', 'wo-needs');
    const hardcodedEquipment = ['Aanhanger', 'Graafmachine', 'Klein materieel', 'Voertuig'];
    const intro = element('p', 'hint',
      'Geef hier indicatief aan welke mensen en hulpmiddelen nodig zijn. Dit is de basis voor de drukte-indicatie.');
    const columns = element('div', 'wo-need-columns');
    columns.append(
      needCountPanel('MENSEN', refs.functies?.length ? refs.functies : ['Elke functie'], 'behoeften'),
      needCountPanel('MATERIEEL', hardcodedEquipment, 'materieel'));
    area.append(intro, columns);

    function needCountPanel(title, values, key) {
      const panel = element('section', 'wo-need-count-panel');
      const heading = element('div', 'wo-need-panel-heading');
      const selectedCount = element('span', 'wo-need-selected',
        requirementCount(draft[key]) + ' geselecteerd');
      heading.append(element('b', '', title), selectedCount);
      panel.append(heading);
      for (const value of values) {
        const soort = key === 'materieel' ? 'materieel' : 'mens';
        const existing = draft[key].find(item => (item.rol || item.type) === value)
          || { aantal: 0, rol: value, type: key === 'materieel' ? value : undefined, soort };
        const row = element('div', 'wo-need-count-row');
        const name = element('b', 'wo-need-name', value);
        const minus = action('−', 'wo-counter', () => {
          existing.aantal = Math.max(0, Number(existing.aantal || 0) - 1);
          saveNeed();
        });
        const amount = input(existing.aantal || 0, 'Aantal ' + value, 'number');
        amount.min = '0'; amount.max = '99';
        amount.addEventListener('input', () => {
          existing.aantal = Math.max(0, Math.min(99, Number(amount.value || 0)));
          saveNeed(false);
        });
        const plus = action('+', 'wo-counter', () => {
          existing.aantal = Math.min(99, Number(existing.aantal || 0) + 1);
          saveNeed();
        });
        const status = element('span', 'wo-need-indication');
        const saveNeed = (syncInput = true) => {
          existing.soort = soort;
          if (key === 'materieel') {
            existing.materieelGroepId = null;
            existing.materieelId = null;
          }
          const index = draft[key].findIndex(item => (item.rol || item.type) === value);
          if (existing.aantal > 0 && index < 0) draft[key].push(existing);
          if (existing.aantal === 0 && index >= 0) draft[key].splice(index, 1);
          if (syncInput) amount.value = existing.aantal;
          status.textContent = existing.aantal
            ? `${existing.aantal} × gepland`
            : 'Niet nodig';
          status.className = 'wo-need-indication ' + (existing.aantal ? 'requested' : 'idle');
          selectedCount.textContent = requirementCount(draft[key]) + ' geselecteerd';
          onChange();
        };
        status.textContent = existing.aantal ? `${existing.aantal} × gepland` : 'Niet nodig';
        status.className = 'wo-need-indication ' + (existing.aantal ? 'requested' : 'idle');
        row.append(name, minus, amount, plus, status);
        panel.append(row);
      }
      return panel;
    }

    const specific = element('details', 'wo-specific'); specific.append(element('summary', '', 'Eisen & specifiek materieel'));
    const specificRow = element('div', 'wo-inline');
    const piece = element('select'); piece.setAttribute('aria-label', 'Specifiek materieel'); piece.append(option('', 'Elk stuk'));
    for (const item of refs.materieel || []) piece.append(option(item.id, item.naam));
    const loose = input('', 'Losse verhuur', 'checkbox');
    const count = input(1, 'Aantal specifiek materieel', 'number'); count.min = '1'; count.max = '99';
    const addSpecific = action('+ Specifiek stuk', 'board-btn', () => {
      const selected = refs.materieel?.find(item => item.id === piece.value);
      draft.materieel.push({ aantal: Math.max(1, Number(count.value || 1)), soort: 'materieel',
        materieelId: piece.value || null,
        materieelGroepId: selected?.groepId || null,
        type: selected?.naam || 'Specifiek materieel', losseVerhuur: loose.checked }); onChange();
    });
    const looseLabel = element('label', 'board-check', 'Losse verhuur'); looseLabel.append(loose);
    specificRow.append(count, piece, looseLabel, addSpecific);
    const remove = action('×', 'board-remove danger', () => {
      piece.value = ''; count.value = 1; loose.checked = false;
    });
    specificRow.append(remove);
    specific.append(specificRow); area.append(specific);
    return area;
  }
  function renderCapacity(container, result) {
    container.replaceChildren(element('h4', '', 'Drukte-indicatie'));
    const rows = element('div', 'wo-capacity-rows');
    for (const item of [...result.mensen, ...result.materieel]) {
      const row = element('div', 'wo-capacity-row ' + item.label.toLocaleLowerCase('nl'));
      const percentage = item.beschikbaar ? Math.min(100, item.gevraagd / item.beschikbaar * 100) : 100;
      row.append(element('strong', '', item.naam), element('span', '', `${item.label} ${item.gevraagd}/${item.beschikbaar}`),
        element('div', 'wo-capacity-bar', '').appendChild(Object.assign(element('i'), { style: `width:${percentage}%` })));
      rows.append(row);
    }
    container.append(rows);
  }
  function renderSummary(container, draft, message = '') {
    const customers = state.formReferences?.klanten || state.references?.klanten || [];
    const jobs = draft.werkvoorraad ? 0 : validWorkDays(draft).length;
    const missing = [];
    if (!draft.klantId && !draft.nieuweKlant?.bedrijfsnaam) missing.push('klant');
    if (!(draft.korteWerkomschrijving || '').trim()) missing.push('korte werkomschrijving');
    if (!(draft.werkadres || draft.gpsLocatie)) missing.push('werkadres/GPS');
    if (!draft.werkvoorraad && !jobs) missing.push('werkdag');
    if (draft.soort === 'aangenomen' && !draft.internProjectnummer) missing.push('intern projectnummer');
    if (requirementCount(draft.behoeften) < 1) missing.push('mensenbehoefte');
    const submit = mode => {
      draft.saveMode = mode;
      container.closest?.('dialog')?.querySelector('.board-dialog-save')?.click();
    };
    const buttons = state.canEdit ? [
      action('Opslaan & ⚡ Vul aan', 'board-btn primary', () => submit('fill')),
      action('Opslaan & zelf inplannen', 'board-btn', () => submit('plan')),
      ...(draft.werkvoorraad ? [action('Opslaan in werkvoorraad', 'board-btn', () => submit('stock'))] : []),
      ...(draft.deleteWorkOrder
        ? [action('Werkopdracht verwijderen', 'board-btn danger wo-delete-order', () => draft.deleteWorkOrder())]
        : [])
    ] : [];
    container.replaceChildren(
      element('h2', '', 'Samenvatting'),
      element('b', '', draft.nieuweKlant?.bedrijfsnaam || customers.find(item => item.id === Number(draft.klantId))?.naam || 'Geen klant'),
      element('p', '', draft.korteWerkomschrijving || 'Nog geen omschrijving'),
      element('p', 'hint', `${draft.klantId ? 'Klant geselecteerd' : 'Nieuwe klant'} · ${draft.soort} · ${draft.werkvoorraad ? 'Werkvoorraad' : jobs + ' werkdagen'}`),
      element('p', '', `${requirementCount(draft.behoeften)} personen · ${requirementCount(draft.materieel)} materieel`),
      element('p', '', `${(draft.ordernummers || []).filter(Boolean).join(', ') || 'Geen klantordernummer'}`),
      element('p', missing.length ? 'wo-summary-missing' : 'wo-summary-ok', missing.length ? 'Nog invullen: ' + missing.join(', ') : '✓ Alles ingevuld'),
      ...buttons
    );
    if (message) container.append(element('p', 'hint', message));
  }
  function richValue(draft) {
    return {
      nummer: draft.id ? draft.nummer : null, klantId: Number(draft.klantId) || 0,
      omschrijving: draft.korteWerkomschrijving || draft.omschrijving || '',
      startDatum: draft.startDatum, eindDatum: draft.eindDatum, isOptie: !!draft.isOptie,
      kleur: draft.kleur, vestigingId: draft.vestigingId || null, optieTot: draft.optieTot || null,
      soort: draft.soort || 'regie', internProjectnummer: draft.internProjectnummer || null,
      bestellerId: Number(draft.bestellerId) || null, bestellerNaam: draft.bestellerNaam || null,
      bestellerTelefoon: draft.bestellerTelefoon || null, bestellerEmail: draft.bestellerEmail || null,
      optieReden: draft.optieReden || null, weekendOverslaan: draft.weekendOverslaan !== false,
      vrijeDagen: draft.vrijeDagen || [], werkvoorraad: !!draft.werkvoorraad,
      geschatteUren: draft.geschatteUren ? Number(draft.geschatteUren) : null,
      uiterlijkKlaar: draft.uiterlijkKlaar || null, prioriteit: draft.prioriteit || 'normaal',
      korteWerkomschrijving: draft.korteWerkomschrijving || null, werkInhoud: draft.werkInhoud || null,
      instructies: draft.instructies || null, werkadres: draft.werkadres || null,
      werkPostcode: draft.werkPostcode || null, werkPlaats: draft.werkPlaats || null,
      gpsLocatie: draft.gpsLocatie || null, contactLocatieNaam: draft.contactLocatieNaam || null,
      contactLocatieTelefoon: draft.contactLocatieTelefoon || null,
      startOpLocatie: apiTime(draft.startOpLocatie), eindOpLocatie: apiTime(draft.eindOpLocatie),
      pauzeMinuten: Number(draft.pauzeMinuten || 30), meerdereDiensten: !!draft.meerdereDiensten,
      diensten: draft.meerdereDiensten ? (draft.diensten || []).map(service => ({
        naam: service.naam, start: apiTime(service.start), eind: apiTime(service.eind)
      })) : null,
      ordernummers: (draft.ordernummers || []).filter(Boolean),
      behoeften: draft.behoeften || [], materieel: draft.materieel || [], materialen: draft.materialen || [],
      nieuweKlant: draft.nieuweKlant?.bedrijfsnaam ? draft.nieuweKlant : null,
      nieuweBesteller: draft.bestellerId === 'other' ? {
        naam: draft.bestellerNaam, telefoon: draft.bestellerTelefoon || null, email: draft.bestellerEmail || null
      } : null,
      klussen: []
    };
  }
  function openMaps(draft) {
    const query = [draft.werkadres, draft.werkPostcode, draft.werkPlaats].filter(Boolean).join(' ');
    if (query) window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query), '_blank');
  }
  function jobFields(job) {
    const grid = element('div', 'board-form-grid compact');
    const bind = (label, key, control) => {
      control.value = job[key] ?? ''; control.setAttribute('aria-label', label);
      control.addEventListener('input', () => job[key] = control.type === 'number' ? Number(control.value) : control.value);
      const field = element('label', 'board-field', label); field.append(control); grid.append(field);
    };
    bind('Omschrijving', 'omschrijving', element('input'));
    bind('Van', 'startDatum', Object.assign(element('input'), { type: 'date' }));
    bind('Tot', 'eindDatum', Object.assign(element('input'), { type: 'date' }));
    bind('Aantal mensen', 'benodigdeMedewerkers', Object.assign(element('input'), { type: 'number' }));
    bind('Starttijd', 'startTijd', Object.assign(element('input'), { type: 'time' }));
    bind('Eindtijd', 'eindTijd', Object.assign(element('input'), { type: 'time' }));
    return grid;
  }

  function assignmentEditor(job) {
    const section = element('div', 'board-assignments');
    section.append(element('h4', '', 'Inzet'));
    const list = element('div', 'board-assignment-list'); section.append(list);
    job.inzetten ||= [];
    const render = () => {
      list.replaceChildren();
      for (const [index, assignment] of job.inzetten.entries()) {
        const row = element('div', 'board-assignment-edit');
        const date = input(assignment.datum, 'Inzetdatum', 'date'); date.addEventListener('input', () => assignment.datum = date.value);
        const resource = element('select'); resource.setAttribute('aria-label', 'Medewerker of inhuur'); resource.required = true;
        resource.append(option('', '— kies persoon —'));
        for (const person of state.references.medewerkers) resource.append(option('i:' + person.id, person.naam));
        for (const person of state.references.inhuurmedewerkers) resource.append(option('e:' + person.id, person.naam + ' · inhuur ' + person.leverancier));
        resource.value = assignment.medewerkerId ? 'i:' + assignment.medewerkerId : assignment.inhuurmedewerkerId ? 'e:' + assignment.inhuurmedewerkerId : '';
        resource.addEventListener('change', () => {
          assignment.medewerkerId = resource.value.startsWith('i:') ? resource.value.slice(2) : null;
          assignment.inhuurmedewerkerId = resource.value.startsWith('e:') ? resource.value.slice(2) : null;
        });
        const slipNumber = input(assignment.werkbon?.nummer, 'Werkbonnummer');
        const slipStatus = element('select'); slipStatus.setAttribute('aria-label', 'Werkbonstatus');
        for (const [value, label] of [['', 'Geen bon'], ['aangemaakt', 'Aangemaakt'], ['niet_geprint', 'Niet geprint'],
          ['uitgereikt', 'Uitgereikt'], ['retour', 'Retour'], ['verwerkt', 'Verwerkt'], ['vervallen', 'Vervallen'], ['binnen', 'Binnen']]) slipStatus.append(option(value, label));
        slipStatus.value = assignment.werkbon?.status || '';
        const updateSlip = () => {
          if (!slipNumber.value.trim() && !slipStatus.value) assignment.werkbon = null;
          else assignment.werkbon = { ...(assignment.werkbon || {}), nummer: slipNumber.value.trim(), status: slipStatus.value || 'aangemaakt' };
        };
        slipNumber.addEventListener('input', updateSlip); slipStatus.addEventListener('change', updateSlip);
        row.append(date, resource, slipNumber, slipStatus);
        if (state.canEdit) row.append(action('✕', 'board-remove', () => { job.inzetten.splice(index, 1); render(); }));
        list.append(row);
      }
    };
    render();
    if (state.canEdit) section.append(action('+ Inzet toevoegen', 'board-add-row', () => {
      job.inzetten.push({ datum: job.startDatum, medewerkerId: null, inhuurmedewerkerId: null, startTijd: job.startTijd, eindTijd: job.eindTijd, werkbon: null }); render();
    }));
    return section;
  }

  async function editSubcontractors() {
    const [people] = await Promise.all([state.request('/api/planning/inhuurmedewerkers')]);
    const modal = createEditorDialog('Inhuurmedewerkers'); const body = modal.querySelector('.board-dialog-body');
    const status = modal.querySelector('.board-dialog-status'); const save = modal.querySelector('.board-dialog-save');
    const selector = element('select'); selector.setAttribute('aria-label', 'Inhuurmedewerker');
    selector.append(option('', 'Nieuwe inhuurmedewerker'));
    people.forEach(person => selector.append(option(person.id, person.naam + ' · ' + person.leverancier)));
    const fields = element('div', 'board-form-grid');
    const supplier = element('select'); supplier.setAttribute('aria-label', 'Leverancier');
    state.references.leveranciers.forEach(item => supplier.append(option(item.id, item.naam)));
    const name = input('', 'Naam'), job = input('', 'Functie'), phone = input('', 'Telefoon'), email = input('', 'E-mail'), active = input('', 'Actief', 'checkbox');
    for (const [label, control] of [['Leverancier', supplier], ['Naam', name], ['Functie', job], ['Telefoon', phone], ['E-mail', email], ['Actief', active]]) {
      const field = element('label', 'board-field', label); field.append(control); fields.append(field);
    }
    let baseline = null;
    selector.addEventListener('change', () => {
      baseline = people.find(person => person.id === selector.value) || null;
      supplier.value = baseline?.leverancierId || ''; name.value = baseline?.naam || ''; job.value = baseline?.functie || '';
      phone.value = baseline?.telefoon || ''; email.value = baseline?.email || ''; active.checked = baseline?.actief ?? true;
    });
    active.checked = true;
    body.append(selector, fields);
    save.onclick = async () => {
      const value = { leverancierId: Number(supplier.value), naam: name.value.trim(), functie: job.value.trim() || null,
        telefoon: phone.value.trim() || null, email: email.value.trim() || null, actief: active.checked };
      try {
        const endpoint = '/api/planning/inhuurmedewerkers' + (baseline ? '/' + baseline.id : '');
        const headers = { 'Content-Type': 'application/json' }; if (baseline) headers['If-Match'] = baseline.eTag;
        await state.request(endpoint, { method: baseline ? 'PUT' : 'POST', headers, body: JSON.stringify(value) });
        modal.close(); await load();
      } catch (error) { status.textContent = 'Opslaan mislukt: ' + error.message; }
    };
    modal.showModal();
  }

  function newOrder() {
    const from = iso(state.date);
    return { id: null, nummer: '', klantId: state.references?.klanten[0]?.id || null, omschrijving: '',
      startDatum: from, eindDatum: iso(addDays(state.date, 4)), isOptie: false, kleur: '#2f8a5b',
      soort: 'regie', internProjectnummer: '', bestellerId: null, bestellerNaam: '', bestellerTelefoon: '',
      bestellerEmail: '', optieReden: '', weekendOverslaan: true, vrijeDagen: [], werkvoorraad: false,
      geschatteUren: null, uiterlijkKlaar: null, prioriteit: 'normaal', korteWerkomschrijving: '',
      werkInhoud: '', instructies: '', werkadres: '', werkPostcode: '', werkPlaats: '', gpsLocatie: '',
      contactLocatieNaam: '', contactLocatieTelefoon: '', startOpLocatie: '07:00', eindOpLocatie: '16:00',
      pauzeMinuten: 30, meerdereDiensten: false, ordernummers: [''], behoeften: [], materieel: [], materialen: [],
      diensten: [{ naam: 'Dagdienst', start: '07:00', eind: '16:00' }],
      klussen: [] };
  }
  function newJob(order) {
    return { omschrijving: '', startDatum: order.startDatum, eindDatum: order.eindDatum,
      benodigdeMedewerkers: 1, startTijd: '07:00', eindTijd: '16:00', sorteervolgorde: 0, inzetten: [] };
  }
  function option(value, text) { const result = element('option', '', text); result.value = value; return result; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function apiTime(value) {
    if (!value) return null;
    return /^\d{2}:\d{2}$/.test(value) ? value + ':00' : value;
  }
  function validateWorkOrder(value, creating = false) {
    if (!creating && !value.nummer?.trim()) return 'Vul een werkopdrachtnummer in.';
    if (!value.klantId && !value.nieuweKlant?.bedrijfsnaam) return 'Kies eerst een klant.';
    if (!value.korteWerkomschrijving?.trim() && !value.omschrijving?.trim()) return 'Vul de korte werkomschrijving in.';
    if (!value.werkvoorraad && !value.startDatum) return 'Vul de startdatum in.';
    if (value.soort === 'aangenomen' && !value.internProjectnummer?.trim())
      return 'Vul het interne projectnummer in (verplicht bij aangenomen werk).';
    if (!value.werkadres && !value.gpsLocatie) return 'Vul het werkadres of de GPS-locatie in.';
    if (!value.werkvoorraad && !validWorkDays(value).length) return 'Er valt geen werkdag in deze periode.';
    if (requirementCount(value.behoeften) < 1)
      return 'Vul bij 5 · Wie & wat nodig in hoeveel mensen er nodig zijn (minstens 1).';
    if (creating || !value.klussen.length) return '';
    for (const [jobIndex, job] of value.klussen.entries()) {
      if (!job.omschrijving.trim()) return 'Vul een omschrijving in voor klus ' + (jobIndex + 1) + '.';
      if (!job.startDatum || !job.eindDatum || job.eindDatum < job.startDatum)
        return 'Controleer de datums van klus ' + (jobIndex + 1) + '.';
      for (const [assignmentIndex, assignment] of job.inzetten.entries()) {
        if (!assignment.medewerkerId && !assignment.inhuurmedewerkerId)
          return 'Kies een interne of ingehuurde medewerker voor inzet ' + (assignmentIndex + 1) + ' van klus ' + (jobIndex + 1) + ', of verwijder die inzetregel.';
        if (!assignment.datum) return 'Vul de datum in voor inzet ' + (assignmentIndex + 1) + ' van klus ' + (jobIndex + 1) + '.';
      }
    }
    return '';
  }
  function createEditorDialog(title) {
    const dialog = element('dialog', 'board-dialog');
    const box = element('div', 'board-dialog-box');
    const head = element('div', 'board-dialog-head');
    const close = action('✕', 'board-btn ghost', () => dialog.close()); head.append(element('h2', '', title), close);
    const body = element('div', 'board-dialog-body'); const status = element('p', 'board-dialog-status'); status.setAttribute('role', 'status');
    const foot = element('div', 'board-dialog-foot');
    const save = action('Opslaan', 'board-btn primary'); save.classList.add('board-dialog-save');
    foot.append(status, save, action('Sluiten', 'board-btn', () => dialog.close()));
    box.append(head, body, foot); dialog.append(box); state.container.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    return dialog;
  }

  window.VsvkPlanBoard = { open, load };
}());
