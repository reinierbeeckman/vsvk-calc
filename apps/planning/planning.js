    'use strict';
    const definitions = {
      medewerkers: { title: 'Medewerkers', singular: 'Medewerker', description: 'Contactgegevens en vaardigheden. Open een medewerker voor certificaten en vervaldata. Zet iemand uit om hem of haar van het planbord te halen.', path: '/api/planning/medewerkers', columns: [['Actief','actief'],['Personeelsnr','personeelsnummer'],['Naam','naam'],['Functie','functie'],['Telefoon','telefoon'],['E-mail','email'],['Vestiging','vestiging'],['Vaardigheden','skills']] },
      klanten: { title: 'Klanten', singular: 'Klant', description: 'Klantgegevens en contactpersonen. Open een klant voor de volledige beschikbare gegevens.', path: '/api/planning/klanten', columns: [['Actief','actief'],['Debiteurnr','debiteurnummer'],['Bedrijfsnaam','bedrijfsnaam'],['Telefoon','telefoon'],['Plaats','plaats'],['Standaard besteller','standaardBesteller']] },
      materieel: { title: 'Materieel', singular: 'Materieel', description: 'Machines, voertuigen en gereedschap. Bekijk de gegevens uit de bestaande materieellijst.', path: '/api/planning/materieel', columns: [['Omschrijving','omschrijving'],['Groep','materieelgroep'],['Vestiging','standplaats'],['Kenteken','kenteken'],['Merk','merk'],['Zoeknaam','zoeknaam'],['Serienummer','serienummer']] },
      artikelen: { title: 'Artikelen', singular: 'Artikel', description: 'Materialen uit de bestaande artikelcatalogus.', path: '/api/articles', columns: [['Omschrijving','naam'],['Categorie','categorie'],['Eenheid','eenheid'],['Prijs','tarief'],['Actief','actief']] },
      ordernummers: { title: 'Ordernummers' }, tarieven: { title: 'Tarieven' }, leveranciers: { title: 'Leveranciers' }, instellingen: { title: 'Instellingen' }, huisstijl: { title: 'Huisstijl' }, rollen: { title: 'Rollen & rechten' }
    };
    const head = document.querySelector('#head');
    const body = document.querySelector('#body');
    const message = document.querySelector('#message');
    const search = document.querySelector('#search');
    const detail = document.querySelector('#detail');
    let current = 'medewerkers';
    let currentSection = 'Lijsten';
    let rows = [];
    let loading = false;
    let loadNumber = 0;
    let detailNumber = 0;
    const drafts = new Map();
    const notices = new Map();
    const saving = new Set();
    const countVersions = new Map();
    window.addEventListener('beforeunload', event => { if (drafts.size) { event.preventDefault(); event.returnValue = ''; } });
    async function request(path, options) {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
      if (!response.ok) { const error = new Error('Aanvraag mislukt (' + response.status + ').'); error.status = response.status; throw error; }
      return response.json();
    }
    async function requestList(list) {
      const version = (countVersions.get(list) || 0) + 1;
      countVersions.set(list, version);
      const counter = document.querySelector('[data-list="' + list + '"] .list-count');
      try {
        const result = await request(definitions[list].path);
        if (countVersions.get(list) === version) { counter.textContent = result.length; counter.hidden = false; }
        return result;
      } catch (error) {
        if (countVersions.get(list) === version) counter.hidden = true;
        throw error;
      }
    }
    function refreshCounts(except) {
      Object.keys(definitions).filter(list => definitions[list].path && list !== except)
        .forEach(list => { requestList(list).catch(() => {}); });
    }
    function showSection(section) {
      currentSection = section;
      document.querySelectorAll('[data-section]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.section === section)));
      document.querySelector('#list-nav').hidden = section !== 'Lijsten';
      if (section === 'Lijsten') { refreshCounts(current); return load(current); }
      ++loadNumber;
      document.querySelector('#title').textContent = section;
      document.querySelector('#description').textContent = 'Dit onderdeel van de planning wordt later gekoppeld.';
      document.querySelector('#list-panel').hidden = true;
      document.querySelector('#unavailable').hidden = false;
    }
    async function load(list) {
      const sequence = ++loadNumber;
      current = list; rows = []; search.value = ''; message.textContent = '';
      const definition = definitions[list];
      document.querySelector('#title').textContent = definition.title;
      document.querySelector('#description').textContent = definition.description || 'Dit onderdeel van de planning wordt later gekoppeld.';
      document.querySelectorAll('[data-list]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.list === list)));
      document.querySelector('#list-panel').hidden = !definition.path;
      document.querySelector('#unavailable').hidden = !!definition.path;
      if (!definition.path) return;
      document.querySelector('#add').textContent = '+ ' + definition.singular;
      search.placeholder = 'Zoeken in ' + definition.title.toLocaleLowerCase('nl') + '…';
      loading = true; message.textContent = 'Gegevens laden…'; render();
      try {
        const result = await requestList(list);
        if (sequence !== loadNumber) return;
        rows = result; message.textContent = '';
      } catch (error) {
        if (sequence !== loadNumber) return;
        message.textContent = error.status === 403 ? 'Geen toegang tot deze lijst of geen vestiging ingesteld voor je account.' : error.message;
      } finally {
        if (sequence === loadNumber) { loading = false; render(); }
      }
    }
    function cell(row, value) { const result = row.insertCell(); result.textContent = value == null || value === '' ? '—' : value; return result; }
    function displayValue(item, field) {
      if (field === 'skills') return (item.skills || []).map(skill => skill.naam + (skill.geldigTot ? ' (tot ' + skill.geldigTot + ')' : '')).join(', ');
      if (field === 'tarief' && item[field] == null) return 'Zie prijs';
      if (typeof item[field] === 'boolean') return item[field] ? 'Ja' : 'Nee';
      return item[field];
    }
    function switchControl(value, label, readOnly = false) {
      const control = document.createElement('button'); control.type = 'button'; control.className = 'vsvk-switch';
      control.setAttribute('role', 'switch'); control.setAttribute('aria-checked', String(value)); control.setAttribute('aria-label', label);
      if (readOnly) { control.setAttribute('aria-readonly', 'true'); control.title = 'Alleen bekijken'; }
      return control;
    }
    function fieldValue(item, field, label) {
      if (typeof item[field] === 'boolean') return switchControl(item[field], label, true);
      const value = document.createElement('span'); const text = displayValue(item, field); value.textContent = text == null || text === '' ? '—' : text; return value;
    }
    function render() {
      const definition = definitions[current];
      if (!definition.path || currentSection !== 'Lijsten') return;
      head.replaceChildren(); body.replaceChildren();
      const header = head.insertRow();
      definition.columns.forEach(([label]) => { const column = document.createElement('th'); column.scope = 'col'; column.textContent = label; header.append(column); });
      const actionHeading = document.createElement('th'); actionHeading.scope = 'col'; actionHeading.textContent = 'Details'; header.append(actionHeading);
      const query = search.value.trim().toLocaleLowerCase('nl');
      const filtered = rows.filter(item => definition.columns.some(([, field]) => String(displayValue(item, field) ?? '').toLocaleLowerCase('nl').includes(query)));
      document.querySelector('#count').textContent = filtered.length === rows.length ? rows.length + ' ' + definition.title.toLocaleLowerCase('nl') : filtered.length + ' van ' + rows.length;
      for (const item of filtered) {
        const row = body.insertRow();
        if (item.actief === false) row.classList.add('off');
        for (const [label, field] of definition.columns) {
          if (current === 'medewerkers' && field === 'actief') { statusCell(row, item); continue; }
          if (typeof item[field] === 'boolean') { row.insertCell().append(switchControl(item[field], label + ' ' + (item.bedrijfsnaam || item.naam || definition.singular), true)); continue; }
          if (field === 'skills') {
            const container = row.insertCell();
            for (const skill of item.skills || []) { const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = skill.naam; container.append(chip); }
            if (!container.childNodes.length) container.textContent = '—';
          } else cell(row, displayValue(item, field));
        }
        const action = row.insertCell(); const open = document.createElement('button'); open.type = 'button'; open.className = 'btn sm'; open.textContent = 'Openen'; open.addEventListener('click', () => openDetail(current, item)); action.append(open);
      }
      const empty = document.querySelector('#empty'); empty.hidden = loading || !!filtered.length || !!message.textContent; empty.textContent = rows.length ? 'Niets gevonden.' : 'Geen gegevens gevonden.';
    }
    function statusCell(row, item) {
      const container = row.insertCell(); container.className = 'status-cell';
      const selected = drafts.has(item.id) ? drafts.get(item.id) : item.actief;
      const toggle = switchControl(selected, 'Actief ' + (item.naam || item.personeelsnummer || 'medewerker')); toggle.disabled = saving.has(item.id);
      toggle.addEventListener('click', () => { const next = !selected; if (next === item.actief) drafts.delete(item.id); else drafts.set(item.id, next); notices.delete(item.id); render(); });
      const save = document.createElement('button'); save.type = 'button'; save.className = 'btn sm'; save.textContent = 'Opslaan'; save.disabled = !drafts.has(item.id) || saving.has(item.id); save.addEventListener('click', () => saveStatus(item));
      const notice = document.createElement('small'); notice.setAttribute('role', 'status'); notice.textContent = notices.get(item.id) || '';
      container.append(toggle, save, notice);
    }
    async function saveStatus(item) {
      const selected = drafts.get(item.id);
      saving.add(item.id); notices.delete(item.id); render();
      try {
        const updated = await request('/api/planning/medewerkers/' + encodeURIComponent(item.id) + '/actief', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': item.eTag }, body: JSON.stringify({ actief: selected }) });
        updateEmployee(item, updated); drafts.delete(item.id); notices.set(item.id, 'Opgeslagen.');
      } catch (error) {
        if (error.status === 412) {
          try {
            const latest = await request('/api/planning/medewerkers/' + encodeURIComponent(item.id));
            updateEmployee(item, latest);
            notices.set(item.id, 'Gewijzigd door een ander. Huidige status: ' + (latest.actief ? 'actief' : 'inactief') + '. Je keuze is behouden; controleer en sla opnieuw op.');
          } catch (refreshError) { notices.set(item.id, 'Conflict; ophalen van de nieuwste versie mislukt. Je keuze blijft staan.'); }
        } else notices.set(item.id, 'Opslaan mislukt: ' + error.message);
      } finally { saving.delete(item.id); render(); }
    }
    function updateEmployee(item, updated) {
      Object.assign(item, updated);
      if (current === 'medewerkers') {
        const visible = rows.find(employee => employee.id === item.id);
        if (visible && visible !== item) Object.assign(visible, updated);
      }
    }
    function addDetailSection(container, title, text) {
      const section = document.createElement('section'); section.className = 'fsec'; const heading = document.createElement('h3'); heading.textContent = title; const paragraph = document.createElement('p'); paragraph.className = 'hint'; paragraph.textContent = text; section.append(heading, paragraph); container.append(section);
    }
    async function openDetail(list, item) {
      const definition = definitions[list];
      const sequence = ++detailNumber;
      document.querySelector('#detail-title').textContent = item.bedrijfsnaam || item.naam || item.omschrijving || definition.singular;
      document.querySelector('#detail-subtitle').textContent = definition.title + ' · Alleen bekijken';
      const content = document.querySelector('#detail-body'); content.replaceChildren();
      if (list === 'klanten') {
        content.textContent = 'Klantgegevens laden…';
        detail.showModal();
        try {
          const customer = await request('/api/planning/klanten/' + encodeURIComponent(item.id));
          if (sequence !== detailNumber || !detail.open) return;
          renderCustomerDetail(content, customer);
        } catch (error) {
          if (sequence !== detailNumber || !detail.open) return;
          content.textContent = 'Klantgegevens ophalen mislukt: ' + error.message;
        }
        return;
      }
      const fields = document.createElement('div'); fields.className = 'fg';
      for (const [label, field] of definition.columns) {
        if (field === 'skills') continue;
        const block = document.createElement('div'); block.className = 'field'; const name = document.createElement('strong'); name.textContent = label; block.append(name, fieldValue(item, field, label)); fields.append(block);
      }
      content.append(fields);
      if (list === 'medewerkers') {
        addDetailSection(content, 'Vaardigheden & certificaten', displayValue(item, 'skills') || 'Geen vaardigheden geregistreerd.');
        addDetailSection(content, 'Contract & tarief', 'Nog niet beschikbaar.');
        addDetailSection(content, 'Afwezigheid', 'Nog niet beschikbaar.');
        addDetailSection(content, 'Komende inzet', 'Nog niet beschikbaar.');
      }
      if (list === 'materieel') {
        addDetailSection(content, 'Verhuurtarief en keuring', 'Nog niet beschikbaar.');
        addDetailSection(content, 'Niet beschikbaar en komende inzet', 'Nog niet beschikbaar.');
      }
      detail.showModal();
    }
    function renderCustomerDetail(content, customer) {
      content.replaceChildren();
      const fields = document.createElement('div'); fields.className = 'fg';
      const customerFields = [['Actief','actief'],['Debiteurnummer','debiteurnummer'],['Bedrijfsnaam','bedrijfsnaam'],['KvK-nummer','kvkNummer'],['Website','website'],['Telefoon','telefoon'],['E-mail','email'],['Straat','straat'],['Huisnummer','huisnummer'],['Toevoeging','toevoeging'],['Postcode','postcode'],['Plaats','plaats'],['Land','land'],['Opmerkingen','opmerkingen']];
      for (const [label, field] of customerFields) {
        const block = document.createElement('div'); block.className = 'field';
        const name = document.createElement('strong'); name.textContent = label;
        block.append(name, fieldValue(customer, field, label)); fields.append(block);
      }
      content.append(fields);
      if (customer.facturatie) {
        const section = document.createElement('section'); section.className = 'fsec';
        const heading = document.createElement('h3'); heading.textContent = 'Facturatie'; section.append(heading);
        const fields = document.createElement('div'); fields.className = 'fg';
        for (const [label, field] of [['Btw-nummer','btwNummer'],['Factuur e-mail','factuurEmail'],['Afwijkend factuuradres','afwijkendFactuuradres'],['Vaste referentie','vasteReferentie'],['G-rekening (%)','gRekeningPercentage'],['Factureren per','facturerenPer'],['Btw verlegd','btwVerlegd'],['Mandagenregister meesturen','mandagenregisterMeesturen']]) {
          const block = document.createElement('div'); block.className = 'field';
          const name = document.createElement('strong'); name.textContent = label;
          block.append(name, fieldValue(customer.facturatie, field, label)); fields.append(block);
        }
        section.append(fields); content.append(section);
      }
      const section = document.createElement('section'); section.className = 'fsec';
      const heading = document.createElement('h3'); heading.textContent = 'Contactpersonen & bestellers'; section.append(heading);
      if (!customer.contactpersonen.length) {
        const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = 'Geen contactpersonen geregistreerd.'; section.append(empty);
      }
      for (const contact of customer.contactpersonen) {
        const fields = document.createElement('div'); fields.className = 'fg';
        for (const [label, field] of [['Naam','naam'],['Functie','functie'],['Telefoon','telefoon'],['E-mail','email'],['Standaard besteller','isStandaardBesteller']]) {
          const block = document.createElement('div'); block.className = 'field';
          const name = document.createElement('strong'); name.textContent = label;
          block.append(name, fieldValue(contact, field, label)); fields.append(block);
        }
        section.append(fields);
      }
      content.append(section);
    }
    document.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => showSection(button.dataset.section)));
    document.querySelectorAll('[data-list]').forEach(button => button.addEventListener('click', () => load(button.dataset.list)));
    document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => detail.close()));
    detail.addEventListener('close', () => { detailNumber++; });
    search.addEventListener('input', render);
    document.querySelectorAll('[data-list]').forEach(button => {
      if (!definitions[button.dataset.list].path) return;
      const counter = document.createElement('span'); counter.className = 'list-count'; counter.hidden = true; button.append(' ', counter);
    });
    refreshCounts(current);
    load(current);
