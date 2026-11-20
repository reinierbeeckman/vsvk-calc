(function () {
  'use strict';

  const state = {
    container: null, request: null, canEdit: false, date: startOfWeek(new Date()),
    references: null, orders: [], filter: 'all', query: '', expanded: new Set(), loading: false
  };
  const dayNames = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  const longDayNames = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  const slipStatuses = { niet_geprint: ['N', 'niet geprint'], uitgereikt: ['U', 'uitgereikt'], binnen: ['✓', 'binnen'] };

  function iso(value) {
    const date = new Date(value); date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 10);
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
    await load();
  }

  async function load() {
    if (!state.container || state.loading) return;
    state.loading = true;
    renderLoading();
    const from = iso(state.date), to = iso(addDays(state.date, 6));
    const finish = window.VsvkLoading?.begin() || (() => {});
    try {
      const [orders, references] = await Promise.all([
        state.request('/api/planning/planbord?from=' + from + '&to=' + to),
        state.request('/api/planning/planbord/referenties')
      ]);
      state.orders = orders; state.references = references;
      state.expanded.clear();
      render();
    } catch (error) {
      state.container.replaceChildren(element('div', 'empty', 'Planbord laden mislukt: ' + error.message));
    } finally { state.loading = false; finish(); }
  }

  function renderLoading() {
    if (!state.container.childNodes.length) state.container.replaceChildren(element('div', 'empty', 'Planbord laden…'));
  }

  function render() {
    const root = element('div', 'planning-board');
    const toolbar = element('div', 'board-toolbar');
    const modes = element('div', 'board-group');
    const byJob = action('Per klus', 'board-toggle'); byJob.disabled = true; byJob.title = 'Buiten week-MVP';
    const byEmployee = action('Per medewerker', 'board-toggle'); byEmployee.disabled = true; byEmployee.title = 'Buiten week-MVP';
    modes.append(byJob, byEmployee, action('Werkopdrachten', 'board-toggle active'));
    const previous = action('◀', 'board-btn', () => { state.date = addDays(state.date, -7); load(); }); previous.setAttribute('aria-label', 'Vorige week');
    const next = action('▶', 'board-btn', () => { state.date = addDays(state.date, 7); load(); }); next.setAttribute('aria-label', 'Volgende week');
    const week = element('strong', 'board-period', weekLabel(state.date));
    toolbar.append(modes, previous, week, next, action('Vandaag', 'board-btn', () => { state.date = startOfWeek(new Date()); load(); }));
    const zoom = element('div', 'board-group');
    const dayZoom = action('Dag', 'board-toggle'); dayZoom.disabled = true; dayZoom.title = 'Buiten week-MVP';
    const monthZoom = action('Maand', 'board-toggle'); monthZoom.disabled = true; monthZoom.title = 'Buiten week-MVP';
    zoom.append(dayZoom, action('Week', 'board-toggle active'), monthZoom);
    toolbar.append(element('span', 'board-spacer'), zoom);
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
    root.append(toolbar, filters, grid, legend());
    state.container.replaceChildren(root);
    state.grid = grid;
    renderGrid();
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
        for (const job of order.klussen) {
          table.append(jobRow(job, dates));
          for (const person of groupAssignments(job.inzetten)) table.append(assignmentRow(person, dates));
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
    if (first >= 0) {
      const bar = element('div', 'board-bar', order.nummer + ' · ' + order.klussen.reduce((sum, job) => sum + job.inzetten.length, 0) + ' inzetten');
      bar.style.gridColumn = (first + 1) + '/' + (last + 2); bar.style.borderColor = order.kleur; bar.style.backgroundColor = colorMix(order.kleur, .16);
      cells.append(bar);
    }
    row.append(label, cells); return row;
  }

  function jobRow(job, dates) {
    const row = element('div', 'board-row board-job');
    const label = element('div', 'board-job-label');
    label.append(element('b', '', 'Klussen'), element('small', '', job.omschrijving + ' · ' + countWorkdays(job.startDatum, job.eindDatum) + ' dagen · ' + job.benodigdeMedewerkers + ' mensen per dag'));
    row.append(label);
    const cells = element('div', 'board-days');
    for (const date of dates) {
      const cell = boardCell(date);
      const dayAssignments = job.inzetten.filter(item => iso(date) === item.datum).length;
      if (iso(date) >= job.startDatum && iso(date) <= job.eindDatum && ![0, 6].includes(date.getDay())) {
        const complete = dayAssignments >= job.benodigdeMedewerkers;
        const chip = element('span', 'board-chip ' + (complete ? 'complete' : dayAssignments ? 'partial' : 'empty'), complete ? '✓ P ' + dayAssignments + '/' + job.benodigdeMedewerkers : 'P ' + dayAssignments + '/' + job.benodigdeMedewerkers);
        cell.append(chip);
      }
      cells.append(cell);
    }
    row.append(cells); return row;
  }

  function assignmentRow(person, dates) {
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
        cell.append(chip, element('small', '', assignment.werkbon?.nummer || ''));
      }
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
        external, name: assignment.medewerker || assignment.inhuurmedewerker,
        role: external && assignment.leverancier
          ? [assignment.functie, assignment.leverancier].filter(Boolean).join(' · ')
          : assignment.functie, days: {}
      });
      result.get(key).days[assignment.datum] = assignment;
    }
    return [...result.values()];
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

  async function editOrder(order) {
    let baseline = null;
    if (order) baseline = await state.request('/api/planning/werkopdrachten/' + order.id);
    const draft = baseline ? clone(baseline) : newOrder();
    delete draft.eTag; delete draft.version; delete draft.status; delete draft.klant;
    const modal = createEditorDialog(state.canEdit ? (baseline ? 'Werkopdracht wijzigen' : 'Werkopdracht toevoegen') : 'Werkopdracht bekijken');
    const body = modal.querySelector('.board-dialog-body');
    const status = modal.querySelector('.board-dialog-status');
    const save = modal.querySelector('.board-dialog-save');
    save.hidden = !state.canEdit;
    const apply = createWorkOrderForm(body, draft, baseline);
    save.onclick = async () => {
      save.disabled = true;
      const value = apply();
      const invalid = validateWorkOrder(value);
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
    if (!state.canEdit) body.querySelectorAll('input,select,button.board-add-row,button.board-remove').forEach(control => control.disabled = true);
    modal.showModal();
  }

  function createWorkOrderForm(body, draft, baseline) {
    const refs = state.references;
    const fields = element('div', 'board-form-grid');
    if (!draft.klussen?.length) draft.klussen = [newJob(draft)];
    const bind = (label, control, key) => {
      const block = element('label', 'board-field', label); block.append(control); fields.append(block);
      control.addEventListener('input', () => draft[key] = control.type === 'checkbox' ? control.checked : control.value);
      control.addEventListener('change', () => draft[key] = control.type === 'checkbox' ? control.checked : control.value);
      return control;
    };
    bind('Werkopdrachtnummer', input(draft.nummer, 'Werkopdrachtnummer'), 'nummer');
    const customer = element('select'); customer.setAttribute('aria-label', 'Klant');
    for (const item of refs.klanten) customer.append(option(item.id, item.naam));
    customer.value = draft.klantId || ''; bind('Klant', customer, 'klantId');
    customer.addEventListener('change', () => draft.klantId = Number(customer.value));
    bind('Omschrijving', input(draft.omschrijving, 'Omschrijving'), 'omschrijving');
    bind('Startdatum', input(draft.startDatum, 'Startdatum', 'date'), 'startDatum');
    bind('Einddatum', input(draft.eindDatum, 'Einddatum', 'date'), 'eindDatum');
    const optionControl = input('', 'Optie', 'checkbox'); optionControl.checked = !!draft.isOptie; bind('Optie', optionControl, 'isOptie');
    const color = input(draft.kleur, 'Kleur', 'color'); bind('Kleur', color, 'kleur');
    body.append(fields);
    const jobs = element('div', 'board-job-editors'); body.append(jobs);
    const renderJobs = () => {
      jobs.replaceChildren();
      for (const [index, job] of draft.klussen.entries()) {
        const section = element('section', 'board-job-editor');
        const head = element('div', 'board-editor-heading'); head.append(element('h3', '', 'Klus ' + (index + 1)));
        if (state.canEdit) head.append(action('Verwijderen', 'board-remove danger', () => { draft.klussen.splice(index, 1); renderJobs(); }));
        section.append(head);
        section.append(jobFields(job), assignmentEditor(job));
        jobs.append(section);
      }
    };
    renderJobs();
    if (state.canEdit) body.append(action('+ Klus toevoegen', 'board-add-row', () => { draft.klussen.push(newJob(draft)); renderJobs(); }));
    return () => ({
      nummer: draft.nummer, klantId: Number(draft.klantId), omschrijving: draft.omschrijving,
      startDatum: draft.startDatum, eindDatum: draft.eindDatum, isOptie: !!draft.isOptie,
      kleur: draft.kleur, klussen: draft.klussen.map((job, index) => ({
        omschrijving: job.omschrijving, startDatum: job.startDatum, eindDatum: job.eindDatum,
        benodigdeMedewerkers: Number(job.benodigdeMedewerkers), startTijd: apiTime(job.startTijd),
        eindTijd: apiTime(job.eindTijd), sorteervolgorde: index,
        inzetten: (job.inzetten || []).map(item => ({
          datum: item.datum, medewerkerId: item.medewerkerId || null, inhuurmedewerkerId: item.inhuurmedewerkerId || null,
          startTijd: apiTime(item.startTijd), eindTijd: apiTime(item.eindTijd),
          werkbon: item.werkbon ? {
            nummer: item.werkbon.nummer, status: item.werkbon.status,
            gewijzigdNaUitgifte: !!item.werkbon.gewijzigdNaUitgifte,
            uitgereiktOp: item.werkbon.uitgereiktOp || null,
            binnenOp: item.werkbon.binnenOp || null
          } : null
        }))
      }))
    });
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
        for (const [value, label] of [['', 'Geen bon'], ['niet_geprint', 'Niet geprint'], ['uitgereikt', 'Uitgereikt'], ['binnen', 'Binnen']]) slipStatus.append(option(value, label));
        slipStatus.value = assignment.werkbon?.status || '';
        const updateSlip = () => {
          if (!slipNumber.value.trim() && !slipStatus.value) assignment.werkbon = null;
          else assignment.werkbon = { ...(assignment.werkbon || {}), nummer: slipNumber.value.trim(), status: slipStatus.value || 'niet_geprint' };
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
  function validateWorkOrder(value) {
    if (!value.nummer.trim()) return 'Vul een werkopdrachtnummer in.';
    if (!value.klantId) return 'Kies een klant.';
    if (!value.omschrijving.trim()) return 'Vul een omschrijving voor de werkopdracht in.';
    if (!value.klussen.length) return 'Voeg minimaal één klus toe.';
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
