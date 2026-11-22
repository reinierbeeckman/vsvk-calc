(function () {
  'use strict';

  const dutch = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' });
  const state = { section: 'overzicht', request: null, container: null, navigate: () => {} };

  function node(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  }
  function button(text, action, className = 'board-btn') {
    const result = node('button', className, text);
    result.type = 'button'; result.addEventListener('click', action);
    return result;
  }
  function iso(date) {
    const value = new Date(date);
    value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
    return value.toISOString().slice(0, 10);
  }
  function addDays(date, count) {
    const value = new Date(date); value.setDate(value.getDate() + count); return value;
  }
  function monday(date = new Date()) {
    const value = new Date(date); value.setHours(0, 0, 0, 0);
    value.setDate(value.getDate() - ((value.getDay() + 6) % 7)); return value;
  }
  function error(container, reason) {
    container.replaceChildren(node('div', 'empty', 'Pagina laden mislukt: ' + reason.message));
  }

  async function open(config) {
    Object.assign(state, config);
    const finish = window.VsvkLoading?.begin() || (() => {});
    state.container.replaceChildren(node('div', 'empty', 'Laden…'));
    try {
      if (state.section === 'overzicht') await renderOverview();
      else if (state.section === 'werkbonnen') await renderWorkSlips();
      else if (state.section === 'team') await renderTeam();
    } catch (reason) { error(state.container, reason); }
    finally { finish(); }
  }

  async function renderOverview() {
    const from = monday(), to = addDays(from, 13);
    const [timeline, slips] = await Promise.all([
      state.request('/api/planning/planbord/werkopdrachten?van=' + iso(from) + '&tot=' + iso(to) + '&zoom=week'),
      state.request('/api/planning/werkbonnen')
    ]);
    const orders = timeline.groepen.flatMap(group => group.werkopdrachten);
    const tasks = overviewTasks(orders, slips);
    const days = Array.from({ length: 14 }, (_, index) => addDays(from, index));
    const root = node('div', 'planning-pages overview-page');
    const top = node('div', 'board-toolbar');
    const period = node('div', 'board-group');
    for (const [label, offset, amount] of [['Deze week', 0, 7], ['Volgende week', 7, 7], ['14 dagen', 0, 14]])
      period.append(button(label, () => state.navigate('Overzicht'), amount === 14 ? 'board-toggle active' : 'board-toggle'));
    top.append(period, node('span', 'board-spacer'),
      node('strong', 'board-period', dutch.format(from) + ' – ' + dutch.format(to)));
    const dayStrip = node('div', 'overview-days');
    for (const date of days) {
      const key = iso(date);
      const dayOrders = orders.filter(order => order.dagen[key]);
      const open = dayOrders.reduce((sum, order) => sum + Number(order.dagen[key]?.open || 0), 0);
      const todo = dayOrders.reduce((sum, order) => sum + Number(order.dagen[key]?.teDoen || 0), 0);
      const tile = node('button', 'overview-day ' + (!dayOrders.length ? 'empty' : open ? 'open' : todo ? 'warning' : 'complete'));
      tile.type = 'button';
      tile.append(node('small', '', new Intl.DateTimeFormat('nl-NL', { weekday: 'short' }).format(date)),
        node('b', '', dutch.format(date)),
        node('span', '', !dayOrders.length ? '—' : open ? open + ' te doen' : todo ? 'Werkbonnen' : '✓ Rond'));
      tile.addEventListener('click', () => state.navigate('Planbord'));
      dayStrip.append(tile);
    }
    const cols = node('div', 'overview-columns');
    const taskPanel = node('section', 'panel overview-tasks');
    taskPanel.append(node('h2', '', 'Te doen en signalen'));
    if (tasks.length) taskPanel.append(...tasks.map(renderTask));
    else taskPanel.append(node('div', 'empty', '✓ Niets meer te doen. De planning is rond.'));
    const workPanel = node('section', 'panel overview-workorders');
    workPanel.append(node('h2', '', 'Werkopdrachten in deze periode'));
    if (orders.length) workPanel.append(...orders.map(renderOverviewOrder));
    else workPanel.append(node('div', 'empty', 'Geen werkopdrachten in deze periode.'));
    cols.append(taskPanel, workPanel);
    root.append(top, dayStrip, cols);
    state.container.replaceChildren(root);
  }

  function overviewTasks(orders, slips) {
    const tasks = [];
    for (const order of orders) {
      if (order.openPlekken > 0) tasks.push({
        group: 'open', date: order.startDatum, title: `${order.openPlekken} plekken nog open`,
        detail: `${order.nummer} · ${order.klantNaam}`, action: 'Invullen', target: 'Planbord'
      });
      if (order.bonnenTeDoen > 0) tasks.push({
        group: 'werkbon', date: order.startDatum, title: `${order.bonnenTeDoen} werkbonnen te doen`,
        detail: `${order.nummer} · ${order.klantNaam}`, action: 'Werkbonnen', target: 'Werkbonnen'
      });
      if (order.optie) tasks.push({
        group: 'optie', date: order.startDatum, title: 'Optie bewaken',
        detail: `${order.nummer} · ${order.klantNaam}`, action: 'Bewerken', target: 'Werkopdrachten'
      });
    }
    const changed = slips.filter(slip => slip.gewijzigdNaUitgifte);
    if (changed.length) tasks.push({
      group: 'werkbon', date: changed[0].datum, title: `${changed.length} werkbonnen gewijzigd na uitreiken`,
      detail: 'Opnieuw controleren en uitreiken', action: 'Openen', target: 'Werkbonnen'
    });
    return tasks.sort((left, right) => left.date.localeCompare(right.date));
  }

  function renderTask(task) {
    const row = node('div', 'overview-task ' + task.group);
    row.append(node('b', 'overview-task-title', task.title),
      node('span', 'overview-task-detail', task.detail),
      button(task.action, () => state.navigate(task.target), 'btn sm'));
    return row;
  }

  function renderOverviewOrder(order) {
    const card = node('article', 'overview-order');
    const top = node('div', 'overview-order-top');
    top.append(node('span', 'num', order.nummer), node('b', '', order.klantNaam));
    const stateText = order.status || (order.openPlekken ? 'OPEN ' + order.openPlekken : 'GEPLAND');
    top.append(node('span', 'chip', stateText));
    const days = node('div', 'overview-order-days');
    for (const [date, data] of Object.entries(order.dagen)) {
      const day = node('button', data.bezetting === 'vol' ? 'overview-order-day complete' :
        data.bezet ? 'overview-order-day partial' : 'overview-order-day empty');
      day.type = 'button'; day.title = `${date}: ${data.bezet}/${data.nodig} gepland`;
      day.textContent = new Date(date + 'T00:00:00').getDate();
      day.addEventListener('click', () => state.navigate('Planbord'));
      days.append(day);
    }
    card.append(top, node('p', 'hint', order.kop), days,
      button('Naar werkopdracht', () => state.navigate('Werkopdrachten'), 'board-btn'));
    return card;
  }

  async function renderWorkSlips() {
    const slips = await state.request('/api/planning/werkbonnen');
    const root = node('div', 'planning-pages workslips-page');
    const steps = [
      ['1', 'Maken & printen', 'werkbonnen en PDF'], ['2', 'Binnen & digitaliseren', 'scannen en overnemen'],
      ['3', 'Inkoop', 'tijden controleren'], ['4', 'Verkoop', 'per werkorder en kansen'],
      ['5', 'Proforma & factuur', 'akkoord klant en factuur'], ['6', 'Self-bill ZZP', 'per zzp’er per week']
    ];
    const tabs = node('div', 'workslip-tabs');
    for (const [index, [number, label, subtitle]] of steps.entries()) {
      const tab = button('', () => showWorkSlipStage(index, slips, panel, tabs), 'workslip-tab' + (index === 0 ? ' active' : ''));
      tab.append(node('i', '', number), node('span', '', label), node('small', '', subtitle));
      tabs.append(tab);
    }
    const panel = node('section', 'panel workslip-content');
    root.append(tabs, panel);
    showWorkSlipStage(0, slips, panel, tabs);
    state.container.replaceChildren(root);
  }

  function showWorkSlipStage(index, slips, panel, tabs) {
    [...tabs.children].forEach((tab, current) => tab.classList.toggle('active', current === index));
    panel.replaceChildren();
    const title = ['Werkbonnen', 'Binnen & digitaliseren', 'Inkoop', 'Verkoop',
      'Proforma & factuur', 'Self-bill ZZP'][index];
    panel.append(node('h2', '', title));
    if (index > 2) {
      const summary = node('div', 'workslip-stage-summary');
      const returned = slips.filter(slip => ['retour', 'verwerkt'].includes(slip.status));
      summary.append(node('b', '', `${returned.length} beschikbare bonnen`),
        node('p', 'hint', index === 3
          ? 'Alleen bonnen met vastgestelde uren komen hier in aanmerking.'
          : index === 4
            ? 'Proforma en factuur worden opgebouwd uit goedgekeurde regiedagen.'
            : 'Self-bills worden opgebouwd uit goedgekeurde zzp-uren.'));
      panel.append(summary);
    }
    const filtered = index === 0 ? slips
      : index === 1 ? slips.filter(slip => ['uitgereikt', 'retour'].includes(slip.status))
      : slips.filter(slip => ['retour', 'verwerkt'].includes(slip.status));
    panel.append(workSlipTable(filtered));
  }

  function workSlipTable(slips) {
    if (!slips.length) return node('div', 'empty', 'Geen werkbonnen voor dit procesonderdeel.');
    const scroll = node('div', 'scroll');
    const table = node('table', 'list workslip-table');
    const head = node('thead');
    const headRow = node('tr');
    for (const text of ['Werkbon', 'Medewerker', 'Klant · werkopdracht', 'Gepland', 'Status'])
      headRow.append(node('th', '', text));
    head.append(headRow);
    const body = node('tbody');
    for (const slip of slips) {
      const row = node('tr');
      row.append(node('td', 'num', slip.nummer), node('td', '', slip.medewerker),
        node('td', '', `${slip.werkopdrachtNummer} · ${slip.klant} · ${slip.omschrijving}`),
        node('td', 'num', `${slip.startTijd || '—'}–${slip.eindTijd || '—'}`),
        node('td', '', slip.status.replaceAll('_', ' ')));
      body.append(row);
    }
    table.append(head, body); scroll.append(table); return scroll;
  }

  async function renderTeam() {
    const [employees, equipment] = await Promise.all([
      state.request('/api/planning/medewerkers'), state.request('/api/planning/materieel')
    ]);
    const expiring = employees.flatMap(employee => employee.skills
      .filter(skill => skill.geldigTot)
      .map(skill => ({ employee, skill })));
    const root = node('div', 'planning-pages team-page');
    const tiles = node('div', 'team-tiles');
    tiles.append(teamTile('Medewerkers', employees.filter(item => item.actief).length),
      teamTile('Materieel', equipment.length), teamTile('Certificaten', expiring.length),
      teamTile('Verlopen', expiring.filter(item => item.skill.geldigTot <= iso(new Date())).length));
    const tabs = node('div', 'subnav');
    const panel = node('section', 'panel team-content');
    const views = [
      ['Afwezigheid & beschikbaarheid', () => renderAvailability(panel, employees, equipment)],
      ['Certificaten & keuringen', () => renderCertificates(panel, employees, expiring)],
      ['Loon per maand', () => panel.replaceChildren(node('h2', '', 'Loon per maand'),
        node('div', 'empty', 'Er zijn nog geen goedgekeurde uren beschikbaar voor loonberekening.'))]
    ];
    views.forEach(([label, render], index) => tabs.append(button(label, () => {
      [...tabs.children].forEach(child => child.setAttribute('aria-selected', 'false'));
      tabs.children[index].setAttribute('aria-selected', 'true'); render();
    }, '')));
    tabs.children[0].setAttribute('aria-selected', 'true');
    root.append(tiles, tabs, panel);
    renderAvailability(panel, employees, equipment);
    state.container.replaceChildren(root);
  }

  function teamTile(label, value) {
    const tile = node('button', 'team-tile'); tile.type = 'button';
    tile.append(node('small', '', label), node('b', '', value)); return tile;
  }
  function renderAvailability(panel, employees, equipment) {
    panel.replaceChildren(node('h2', '', 'Beschikbaarheid'));
    const table = node('table', 'list team-availability');
    const head = node('thead'), headRow = node('tr'); headRow.append(node('th', '', 'Wie'),
      node('th', '', 'Functie / type'), node('th', '', 'Status'), node('th', '', 'Vestiging'));
    head.append(headRow); const body = node('tbody');
    for (const employee of employees) body.append(teamRow(employee.naam, employee.functie,
      employee.actief ? 'Beschikbaar' : 'Inactief', employee.vestiging));
    for (const item of equipment) body.append(teamRow(item.omschrijving, item.materieelgroep,
      'Beschikbaar', item.standplaats));
    table.append(head, body);
    const scroll = node('div', 'scroll'); scroll.append(table); panel.append(scroll);
  }
  function teamRow(name, role, status, branch) {
    const row = node('tr');
    for (const value of [name, role, status, branch]) row.append(node('td', '', value || '—'));
    return row;
  }
  function renderCertificates(panel, employees, expiring) {
    panel.replaceChildren(node('h2', '', 'Certificaten'));
    const table = node('table', 'list');
    const head = node('thead'), headRow = node('tr');
    for (const text of ['Medewerker', 'Certificaat', 'Geldig tot', 'Status']) headRow.append(node('th', '', text));
    head.append(headRow); const body = node('tbody');
    for (const item of expiring.sort((a, b) => a.skill.geldigTot.localeCompare(b.skill.geldigTot))) {
      const expired = item.skill.geldigTot < iso(new Date());
      const row = node('tr', expired ? 'team-expired' : '');
      row.append(node('td', '', item.employee.naam), node('td', '', item.skill.naam),
        node('td', 'num', item.skill.geldigTot),
        node('td', '', expired ? 'Verlopen' : 'Geldig'));
      body.append(row);
    }
    table.append(head, body); const scroll = node('div', 'scroll'); scroll.append(table); panel.append(scroll);
  }

  window.VsvkPlanningPages = { open };
})();
