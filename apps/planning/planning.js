    'use strict';
    const definitions = {
      medewerkers: { title: 'Medewerkers', singular: 'Medewerker', description: 'Contactgegevens en vaardigheden. Open een medewerker voor certificaten en vervaldata. Zet iemand uit om hem of haar van het planbord te halen.', path: '/api/planning/medewerkers', columns: [['Actief','actief'],['Personeelsnr','personeelsnummer'],['Naam','naam'],['Functie','functie'],['Telefoon','telefoon'],['E-mail','email'],['Vestiging','vestiging'],['Vaardigheden','skills']] },
      klanten: { title: 'Klanten', singular: 'Klant', description: 'Klantgegevens en contactpersonen. Open een klant voor de volledige beschikbare gegevens.', path: '/api/planning/klanten', columns: [['Actief','actief'],['Debiteurnr','debiteurnummer'],['Bedrijfsnaam','bedrijfsnaam'],['Telefoon','telefoon'],['Plaats','plaats'],['Standaard besteller','standaardBesteller']] },
      materieel: { title: 'Materieel', singular: 'Materieel', description: 'Machines, voertuigen en gereedschap. Bekijk de gegevens uit de bestaande materieellijst.', path: '/api/planning/materieel', columns: [['Omschrijving','omschrijving'],['Groep','materieelgroep'],['Vestiging','standplaats'],['Kenteken','kenteken'],['Merk','merk'],['Zoeknaam','zoeknaam'],['Serienummer','serienummer']] },
      artikelen: { title: 'Artikelen', singular: 'Artikel', description: 'Materialen uit de bestaande artikelcatalogus.', path: '/api/articles', columns: [['Omschrijving','naam'],['Categorie','categorie'],['Eenheid','eenheid'],['Prijs','tarief'],['Actief','actief']] },
      tarieven: { title: 'Tarieven', singular: 'Tarief', description: 'Actuele standaardtarieven per functie. Klantspecifieke afwijkingen beheer je in het klantvenster.', path: '/api/planning/tarieven', columns: [['Actief','actief'],['Functie','functie'],['Prijs','prijs'],['Eenheid','eenheid'],['Geldig vanaf','geldigVanaf']] },
      ordernummers: { title: 'Ordernummers' }, leveranciers: { title: 'Leveranciers' }, instellingen: { title: 'Instellingen' }, huisstijl: { title: 'Huisstijl' }, rollen: { title: 'Rollen & rechten' }
    };
    const head = document.querySelector('#head');
    const body = document.querySelector('#body');
    const message = document.querySelector('#message');
    const search = document.querySelector('#search');
    const detail = document.querySelector('#detail');
    const detailSave = document.querySelector('#detail-save');
    let current = 'medewerkers';
    let currentSection = 'Lijsten';
    let rows = [];
    let loading = false;
    let loadNumber = 0;
    let detailNumber = 0;
    let stopListLoading = () => {};
    let stopDetailLoading = () => {};
    let customerRatesDirty = false;
    let customerRatesSaving = false;
    let detailDraft = null;
    let planningPermissionsFailed = false;
    const planningPermissions = request('/bff/user').then(user => user.permissions?.canEditPlanningRecords === true).catch(error => {
      planningPermissionsFailed = true; console.error('Rechten ophalen mislukt:', error); return false;
    });
    const drafts = new Map();
    const notices = new Map();
    const statusConflicts = new Map();
    const saving = new Set();
    const countVersions = new Map();
    const priceDrafts = new Map();
    const priceLoading = new Set();
    const priceDirty = draft => draft.value.trim() !== '' && Number(draft.value.replace(',', '.')) !== draft.baseline || draft.value.trim() === '';
    window.addEventListener('beforeunload', event => { if (drafts.size || customerRatesDirty || detailDraft?.dirty || [...priceDrafts.values()].some(priceDirty)) { event.preventDefault(); event.returnValue = ''; } });
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
      stopListLoading();
      loading = false;
      document.querySelector('#title').textContent = section;
      document.querySelector('#description').textContent = 'Dit onderdeel van de planning wordt later gekoppeld.';
      document.querySelector('#list-panel').hidden = true;
      document.querySelector('#unavailable').hidden = false;
    }
    async function load(list) {
      const sequence = ++loadNumber;
      stopListLoading();
      loading = false;
      current = list; rows = []; search.value = ''; message.textContent = '';
      const definition = definitions[list];
      document.querySelector('#title').textContent = definition.title;
      document.querySelector('#description').textContent = definition.description || 'Dit onderdeel van de planning wordt later gekoppeld.';
      document.querySelectorAll('[data-list]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.list === list)));
      document.querySelector('#list-panel').hidden = !definition.path;
      document.querySelector('#unavailable').hidden = !!definition.path;
      if (!definition.path) return;
      const add = document.querySelector('#add');
      add.textContent = '+ ' + definition.singular; add.disabled = true; add.title = 'Nog niet beschikbaar';
      document.querySelector('#list-hint').textContent = 'Nieuwe records, import en export zijn nog niet beschikbaar.';
      planningPermissions.then(canEdit => {
        if (sequence !== loadNumber) return;
        if (!canEdit) {
          add.title = planningPermissionsFailed ? 'Rechten ophalen mislukt' : 'Alleen beschikbaar voor development';
          document.querySelector('#list-hint').textContent = planningPermissionsFailed
            ? 'Rechten ophalen mislukt. Ververs de pagina om het opnieuw te proberen.'
            : 'Nieuwe records toevoegen is alleen beschikbaar voor development. Import en export zijn nog niet beschikbaar.';
          return;
        }
        if (!['medewerkers', 'klanten', 'materieel', 'artikelen', 'tarieven'].includes(list)) return;
        add.disabled = false; add.title = '';
        document.querySelector('#list-hint').textContent = 'Import en export zijn nog niet beschikbaar.';
      });
      search.placeholder = 'Zoeken in ' + definition.title.toLocaleLowerCase('nl') + '…';
      const finishLoading = window.VsvkLoading.begin();
      stopListLoading = finishLoading;
      loading = true; render();
      try {
        const result = await requestList(list);
        if (sequence !== loadNumber) return;
        rows = result; message.textContent = '';
      } catch (error) {
        if (sequence !== loadNumber) return;
        message.textContent = error.status === 403 ? 'Geen toegang tot deze lijst of geen vestiging ingesteld voor je account.' : error.message;
      } finally {
        finishLoading();
        if (sequence === loadNumber) { loading = false; render(); }
      }
    }
    function cell(row, value) { const result = row.insertCell(); result.textContent = value == null || value === '' ? '—' : value; return result; }
    function displayValue(item, field) {
      if (field === 'skills') return (item.skills || []).map(skill => skill.naam + (skill.geldigTot ? ' (tot ' + skill.geldigTot + ')' : '')).join(', ');
      if (field === 'prijs' && item[field] != null) return formatPrice(item[field]);
      if (field === 'tarief' && item[field] == null) return 'Zie prijs';
      if (typeof item[field] === 'boolean') return item[field] ? 'Ja' : 'Nee';
      return item[field];
    }
    function formatPrice(value) { return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(value); }
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
      document.querySelector('#count').textContent = loading ? '' : filtered.length === rows.length ? rows.length + ' ' + definition.title.toLocaleLowerCase('nl') : filtered.length + ' van ' + rows.length;
      for (const item of filtered) {
        const row = body.insertRow();
        if (item.actief === false) row.classList.add('off');
        for (const [label, field] of definition.columns) {
          if (current === 'medewerkers' && field === 'actief') { statusCell(row, item); continue; }
          if (current === 'tarieven' && field === 'prijs' && priceDrafts.has(item.standaardTariefId)) { priceCell(row, item); continue; }
          if (typeof item[field] === 'boolean') { row.insertCell().append(switchControl(item[field], label + ' ' + (item.bedrijfsnaam || item.naam || definition.singular), true)); continue; }
          if (field === 'skills') {
            const container = row.insertCell();
            for (const skill of item.skills || []) { const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = skill.naam; container.append(chip); }
            if (!container.childNodes.length) container.textContent = '—';
          } else cell(row, displayValue(item, field));
        }
        const action = row.insertCell();
        if (current !== 'tarieven' || !priceDrafts.has(item.standaardTariefId)) {
          const open = document.createElement('button'); open.type = 'button'; open.className = 'btn sm'; open.textContent = 'Openen'; open.addEventListener('click', () => openDetail(current, item)); action.append(open);
        }
        if (current === 'tarieven') priceActions(action, item);
      }
      const empty = document.querySelector('#empty'); empty.hidden = loading || !!filtered.length || !!message.textContent; empty.textContent = rows.length ? 'Niets gevonden.' : 'Geen gegevens gevonden.';
    }
    function priceCell(row, item) {
      const draft = priceDrafts.get(item.standaardTariefId);
      const container = row.insertCell(); container.className = 'standard-price-cell';
      const input = document.createElement('input'); input.type = 'text'; input.inputMode = 'decimal';
      input.value = draft.value; input.disabled = draft.saving; input.setAttribute('aria-label', 'Prijs ' + item.functie);
      input.addEventListener('input', () => {
        draft.value = input.value;
        if (draft.updateActions) draft.updateActions();
      });
      container.append(input);
    }
    function priceActions(container, item) {
      container.className = 'standard-price-actions';
      const id = item.standaardTariefId;
      const draft = priceDrafts.get(id);
      if (!draft) {
        const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn sm standard-price-edit';
        edit.textContent = '✎'; edit.title = 'Tarief wijzigen'; edit.setAttribute('aria-label', 'Tarief ' + item.functie + ' wijzigen');
        edit.disabled = priceLoading.has(id); edit.addEventListener('click', () => editPrice(item)); container.append(edit); return;
      }
      const save = document.createElement('button'); save.type = 'button'; save.className = 'btn sm standard-price-save'; save.textContent = 'Opslaan';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn sm'; cancel.textContent = 'Annuleren'; cancel.disabled = draft.saving;
      cancel.addEventListener('click', () => { priceDrafts.delete(id); render(); });
      const notice = document.createElement('small'); notice.setAttribute('role', 'status'); notice.textContent = draft.notice || '';
      draft.updateActions = () => { save.disabled = !priceDirty(draft) || draft.saving || !!draft.conflict; };
      draft.updateActions(); save.addEventListener('click', () => savePrice(item)); container.append(save, cancel, notice);
      if (draft.conflict && !draft.conflict.unavailable) {
        const reapply = document.createElement('button'); reapply.type = 'button'; reapply.className = 'btn sm'; reapply.textContent = 'Mijn wijziging opnieuw toepassen';
        reapply.addEventListener('click', () => { draft.baseline = draft.conflict.prijs; draft.eTag = draft.conflict.eTag; draft.conflict = null; draft.notice = 'Controleer je wijziging en sla opnieuw op.'; render(); });
        container.append(reapply);
      } else if (draft.conflict) {
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn sm'; retry.textContent = 'Nieuwste prijs ophalen';
        retry.disabled = draft.saving; retry.addEventListener('click', () => refreshPriceConflict(item, draft)); container.append(retry);
      }
    }
    async function refreshPriceConflict(item, draft) {
      draft.saving = true; render(); const finishLoading = window.VsvkLoading.begin();
      try {
        draft.conflict = await request('/api/planning/tarieven/' + encodeURIComponent(item.standaardTariefId) + '/prijs');
        draft.notice = 'Dit tarief is door iemand anders gewijzigd. Nieuwste prijs: ' + formatPrice(draft.conflict.prijs) + '. Jouw prijs: ' + draft.value + '.';
      } catch (error) { draft.conflict = { unavailable: true }; draft.notice = 'Nieuwste prijs ophalen mislukt. Je invoer blijft behouden; probeer opnieuw.'; }
      finally { draft.saving = false; finishLoading(); render(); }
    }
    async function editPrice(item) {
      const id = item.standaardTariefId;
      priceLoading.add(id); render(); const finishLoading = window.VsvkLoading.begin();
      try {
        const price = await request('/api/planning/tarieven/' + encodeURIComponent(id) + '/prijs');
        priceDrafts.set(id, { value: String(price.prijs), baseline: price.prijs, eTag: price.eTag });
        updatePrice(item, price.prijs);
      } catch (error) { message.textContent = 'Tarief ophalen mislukt: ' + error.message; }
      finally { priceLoading.delete(id); finishLoading(); render(); }
    }
    function updatePrice(item, price) {
      item.prijs = price;
      if (current === 'tarieven') {
        const visible = rows.find(rate => rate.standaardTariefId === item.standaardTariefId);
        if (visible) visible.prijs = price;
      }
    }
    async function savePrice(item) {
      const id = item.standaardTariefId; const draft = priceDrafts.get(id);
      const value = draft.value.trim().replace(',', '.');
      if (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) >= 100000000) { draft.notice = 'Vul een geldig tarief in met maximaal twee decimalen.'; render(); return; }
      draft.saving = true; draft.notice = ''; render(); const finishLoading = window.VsvkLoading.begin();
      try {
        const saved = await request('/api/planning/tarieven/' + encodeURIComponent(id) + '/prijs', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': draft.eTag }, body: JSON.stringify({ prijs: Number(value) }) });
        updatePrice(item, saved.prijs); priceDrafts.delete(id);
      } catch (error) {
        if (error.status === 412) {
          draft.notice = 'Dit tarief is door iemand anders gewijzigd. Je invoer is behouden.';
          try {
            draft.conflict = await request('/api/planning/tarieven/' + encodeURIComponent(id) + '/prijs');
            draft.notice += ' Nieuwste prijs: ' + formatPrice(draft.conflict.prijs) + '. Jouw prijs: ' + draft.value + '.';
          } catch (refreshError) { draft.notice += ' Nieuwste prijs ophalen mislukt; probeer opnieuw.'; draft.conflict = { unavailable: true }; }
        } else draft.notice = 'Opslaan mislukt: ' + error.message;
      } finally { draft.saving = false; finishLoading(); render(); }
    }
    function statusCell(row, item) {
      const container = row.insertCell(); container.className = 'status-cell';
      const selected = drafts.has(item.id) ? drafts.get(item.id) : item.actief;
      const conflict = statusConflicts.get(item.id);
      const toggle = switchControl(selected, 'Actief ' + (item.naam || item.personeelsnummer || 'medewerker')); toggle.disabled = saving.has(item.id) || conflict === 'unavailable';
      toggle.addEventListener('click', () => {
        const next = !selected;
        if (next === item.actief) { drafts.delete(item.id); notices.delete(item.id); statusConflicts.delete(item.id); render(); }
        else { drafts.set(item.id, next); if (conflict) render(); else saveStatus(item); }
      });
      const notice = document.createElement('small'); notice.setAttribute('role', 'status'); notice.textContent = notices.get(item.id) || '';
      container.append(toggle, notice);
      if (drafts.has(item.id) && notices.has(item.id) && !saving.has(item.id)) {
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn sm';
        retry.textContent = conflict === 'unavailable' ? 'Nieuwste status ophalen' : conflict ? 'Mijn keuze opnieuw toepassen' : 'Opnieuw proberen';
        retry.addEventListener('click', () => {
          if (conflict === 'unavailable') return refreshStatusConflict(item);
          statusConflicts.delete(item.id); return saveStatus(item);
        });
        container.append(retry);
        if (conflict === 'latest') {
          const discard = document.createElement('button'); discard.type = 'button'; discard.className = 'btn sm'; discard.textContent = 'Nieuwste status behouden';
          discard.addEventListener('click', () => { drafts.delete(item.id); notices.delete(item.id); statusConflicts.delete(item.id); render(); });
          container.append(discard);
        }
      }
    }
    async function refreshStatusConflict(item) {
      saving.add(item.id); render();
      const finishLoading = window.VsvkLoading.begin();
      try {
        const latest = await request('/api/planning/medewerkers/' + encodeURIComponent(item.id));
        updateEmployee(item, latest); statusConflicts.set(item.id, 'latest');
        notices.set(item.id, 'Gewijzigd door een ander. Huidige status: ' + (latest.actief ? 'actief' : 'inactief') + '. Je keuze is behouden; controleer en pas die zo nodig opnieuw toe.');
      } catch (error) {
        statusConflicts.set(item.id, 'unavailable');
        notices.set(item.id, 'Conflict; ophalen van de nieuwste versie mislukt. Je keuze blijft staan.');
      } finally { saving.delete(item.id); finishLoading(); render(); }
    }
    async function saveStatus(item) {
      const selected = drafts.get(item.id);
      saving.add(item.id); notices.delete(item.id); render();
      try {
        const updated = await request('/api/planning/medewerkers/' + encodeURIComponent(item.id) + '/actief', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': item.eTag }, body: JSON.stringify({ actief: selected }) });
        updateEmployee(item, updated); drafts.delete(item.id); notices.set(item.id, 'Opgeslagen.');
      } catch (error) {
        if (error.status === 412) {
          statusConflicts.set(item.id, 'unavailable');
          await refreshStatusConflict(item);
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
    function employeeFields(skills, branches, requiredName = false) {
      const options = entries => entries.map(entry => ({ value: entry.naam, label: entry.naam }));
      return [{ key: 'actief', label: 'Actief', type: 'boolean' }, { key: 'personeelsnummer', label: 'Personeelsnummer' },
        { key: 'naam', label: 'Naam', required: requiredName }, { key: 'functie', label: 'Functie' }, { key: 'telefoon', label: 'Telefoon' }, { key: 'email', label: 'E-mail' },
        { key: 'vestiging', label: 'Vestiging', type: 'select', options: options(branches) }, { key: 'skills', label: 'Vaardigheden & certificaten', type: 'skills', options: options(skills) }];
    }
    async function openCreate() {
      const list = current;
      if (!['medewerkers', 'klanten', 'materieel', 'artikelen', 'tarieven'].includes(list) || !await planningPermissions || current !== list || currentSection !== 'Lijsten') return;
      const sequence = ++detailNumber;
      stopDetailLoading(); customerRatesDirty = false;
      detailSave.disabled = true; detailSave.onclick = null; detailSave.title = '';
      detail.classList.remove('customer-detail');
      document.querySelector('#detail-title').textContent = definitions[list].singular + ' toevoegen';
      document.querySelector('#detail-subtitle').textContent = definitions[list].title + ' · Nieuw';
      const content = document.querySelector('#detail-body'); content.textContent = 'Gegevens laden…';
      detail.showModal();
      const finishLoading = window.VsvkLoading.begin(); stopDetailLoading = finishLoading;
      try {
        if (list === 'medewerkers') {
          const [skills, branches] = await Promise.all([request('/api/planning/medewerkers/vaardigheden'), request('/api/planning/medewerkers/vestigingen')]);
          if (sequence !== detailNumber || !detail.open) return;
          detailDraft = window.VsvkPlanningEditor.create({ content, saveButton: detailSave, method: 'POST',
            endpoint: '/api/planning/medewerkers', request,
            item: { actief: true, personeelsnummer: null, naam: null, functie: null, telefoon: null, email: null, vestiging: null, skills: [] },
            fields: employeeFields(skills, branches, true), isCurrent: () => sequence === detailNumber && detail.open,
            onSaved: () => { detailDraft = null; detail.close(); if (current === list) load(list); } });
        } else if (list === 'klanten') {
          detailDraft = window.VsvkPlanningEditor.create({ content, saveButton: detailSave, method: 'POST',
            endpoint: '/api/planning/klanten', request, item: { debiteurnummer: '', bedrijfsnaam: '' },
            fields: [{ key: 'debiteurnummer', label: 'Debiteurnummer', required: true }, { key: 'bedrijfsnaam', label: 'Bedrijfsnaam', required: true }],
            isCurrent: () => sequence === detailNumber && detail.open,
            onSaved: () => { detailDraft = null; detail.close(); if (current === list) load(list); } });
        } else if (list === 'tarieven') {
          detailDraft = window.VsvkPlanningEditor.create({ content, saveButton: detailSave, method: 'POST',
            endpoint: '/api/planning/tarieven', request, item: { actief: true, functie: '', prijs: null, eenheid: '', geldigVanaf: null },
            fields: [{ key: 'actief', label: 'Actief', type: 'boolean' }, { key: 'functie', label: 'Functie', required: true },
              { key: 'prijs', label: 'Prijs', type: 'number', required: true }, { key: 'eenheid', label: 'Eenheid', required: true },
              { key: 'geldigVanaf', label: 'Geldig vanaf', type: 'date', required: true }],
            isCurrent: () => sequence === detailNumber && detail.open,
            onSaved: () => { detailDraft = null; detail.close(); if (current === list) load(list); } });
        } else if (list === 'materieel') {
          const references = await request('/api/planning/materieel/referenties');
          if (sequence !== detailNumber || !detail.open) return;
          const options = entries => entries.map(entry => ({ value: entry.id, label: entry.naam }));
          const fields = [{ key: 'omschrijving', label: 'Omschrijving', required: true },
            { key: 'materieelGroepId', label: 'Groep', type: 'select', options: options(references.groepen) },
            { key: 'standplaatsId', label: 'Vestiging', type: 'select', options: options(references.vestigingen) },
            { key: 'kenteken', label: 'Kenteken' }, { key: 'merk', label: 'Merk' },
            { key: 'zoeknaam', label: 'Zoeknaam' }, { key: 'serienummer', label: 'Serienummer' }];
          detailDraft = window.VsvkPlanningEditor.create({ content, saveButton: detailSave, method: 'POST',
            endpoint: '/api/planning/materieel', request, item: { omschrijving: '', materieelGroepId: null, standplaatsId: null, kenteken: null, merk: null, zoeknaam: null, serienummer: null },
            fields, isCurrent: () => sequence === detailNumber && detail.open,
            onSaved: () => { detailDraft = null; detail.close(); if (current === list) load(list); } });
        } else {
          const [categories, units] = await Promise.all([request('/api/article-categories'), request('/api/article-units')]);
          if (sequence !== detailNumber || !detail.open) return;
          renderArticleDetail(content, { naam: '', categorieId: '', eenheidId: '', tarief: null, tariefSoort: 'zie_prijs', actief: true }, categories, units, sequence, null);
        }
      } catch (error) {
        if (sequence === detailNumber && detail.open) content.textContent = 'Gegevens ophalen mislukt: ' + error.message;
      } finally { finishLoading(); }
    }
    function addDetailSection(container, title, text) {
      const section = document.createElement('section'); section.className = 'fsec'; const heading = document.createElement('h3'); heading.textContent = title; const paragraph = document.createElement('p'); paragraph.className = 'hint'; paragraph.textContent = text; section.append(heading, paragraph); container.append(section);
    }
    async function openDetail(list, item) {
      const definition = definitions[list];
      const sequence = ++detailNumber;
      stopDetailLoading();
      customerRatesDirty = false;
      detailSave.disabled = true; detailSave.onclick = null; detailSave.title = '';
      if (list === 'klanten') detail.classList.add('customer-detail'); else detail.classList.remove('customer-detail');
      document.querySelector('#detail-title').textContent = item.bedrijfsnaam || item.naam || item.omschrijving || definition.singular;
      document.querySelector('#detail-subtitle').textContent = definition.title + ' · Alleen bekijken';
      const content = document.querySelector('#detail-body'); content.replaceChildren();
      if (list === 'klanten') {
        content.textContent = 'Klantgegevens laden…';
        detail.showModal();
        const finishLoading = window.VsvkLoading.begin();
        stopDetailLoading = finishLoading;
        try {
          const [customer, canEdit] = await Promise.all([request('/api/planning/klanten/' + encodeURIComponent(item.id)), planningPermissions]);
          if (sequence !== detailNumber || !detail.open) return;
          document.querySelector('#detail-subtitle').textContent = (customer.debiteurnummer ? 'Debiteur ' + customer.debiteurnummer + ' · ' : '') + (canEdit ? 'Klantgegevens wijzigen' : 'Klantgegevens alleen bekijken');
          const rates = renderCustomerDetail(content, customer, canEdit, sequence, item);
          await loadCustomerRates(rates, customer.id, sequence);
        } catch (error) {
          if (sequence !== detailNumber || !detail.open) return;
          content.textContent = 'Klantgegevens ophalen mislukt: ' + error.message;
        } finally {
          finishLoading();
        }
        return;
      }
      if (list === 'artikelen' && await planningPermissions) {
        if (sequence !== detailNumber) return;
        detail.showModal();
        content.textContent = 'Artikelgegevens laden…';
        const finishLoading = window.VsvkLoading.begin();
        stopDetailLoading = finishLoading;
        try {
          const [article, categories, units] = await Promise.all([
            request('/api/articles/' + encodeURIComponent(item.id)), request('/api/article-categories'), request('/api/article-units')
          ]);
          if (sequence !== detailNumber || !detail.open) return;
          document.querySelector('#detail-subtitle').textContent = 'Artikelgegevens wijzigen';
          renderArticleDetail(content, article, categories, units, sequence, item);
        } catch (error) {
          if (sequence === detailNumber && detail.open) content.textContent = 'Artikelgegevens ophalen mislukt: ' + error.message;
        } finally { finishLoading(); }
        return;
      }
      if (['medewerkers', 'materieel', 'tarieven'].includes(list) && await planningPermissions) {
        if (sequence !== detailNumber) return;
        detail.showModal(); content.textContent = 'Gegevens laden…';
        const finishLoading = window.VsvkLoading.begin(); stopDetailLoading = finishLoading;
        try {
          let endpoint; let readEndpoint; let fields; let record; let references;
          const options = entries => entries.map(entry => ({ value: entry.id ?? entry.naam, label: entry.naam }));
          if (list === 'medewerkers') {
            readEndpoint = '/api/planning/medewerkers/' + encodeURIComponent(item.id);
            endpoint = readEndpoint + '/gegevens';
            const [employee, skills, branches] = await Promise.all([request(readEndpoint), request('/api/planning/medewerkers/vaardigheden'), request('/api/planning/medewerkers/vestigingen')]);
            record = employee;
            fields = employeeFields(skills, branches);
          } else if (list === 'materieel') {
            endpoint = '/api/planning/materieel/' + encodeURIComponent(item.id); readEndpoint = endpoint;
            [record, references] = await Promise.all([request(endpoint), request('/api/planning/materieel/referenties')]);
            fields = [{ key: 'omschrijving', label: 'Omschrijving' }, { key: 'materieelGroepId', label: 'Groep', type: 'select', options: options(references.groepen) },
              { key: 'standplaatsId', label: 'Vestiging', type: 'select', options: options(references.vestigingen) }, { key: 'kenteken', label: 'Kenteken' },
              { key: 'merk', label: 'Merk' }, { key: 'zoeknaam', label: 'Zoeknaam' }, { key: 'serienummer', label: 'Serienummer' }];
          } else {
            endpoint = '/api/planning/tarieven/' + encodeURIComponent(item.standaardTariefId) + '/detail'; readEndpoint = endpoint;
            record = await request(endpoint);
            fields = [{ key: 'actief', label: 'Actief', type: 'boolean' }, { key: 'functie', label: 'Functie', required: true },
              { key: 'prijs', label: 'Prijs', type: 'number', required: true }, { key: 'eenheid', label: 'Eenheid', required: true },
              { key: 'geldigVanaf', label: 'Geldig vanaf', type: 'date', required: true }];
          }
          if (sequence !== detailNumber || !detail.open) return;
          document.querySelector('#detail-subtitle').textContent = definition.title + ' · Wijzigen';
          detailDraft = window.VsvkPlanningEditor.create({ content, saveButton: detailSave, endpoint, readEndpoint, request, item: record, fields,
            isCurrent: () => sequence === detailNumber && detail.open,
            onSaved: saved => {
              if (list === 'medewerkers') updateEmployee(item, saved);
              else if (list === 'materieel') {
                Object.assign(item, saved);
                item.materieelgroep = references.groepen.find(group => group.id === saved.materieelGroepId)?.naam || null;
                item.standplaats = references.vestigingen.find(branch => branch.id === saved.standplaatsId)?.naam || null;
              } else Object.assign(item, { functie: saved.functie, actief: saved.actief, prijs: saved.prijs, eenheid: saved.eenheid, geldigVanaf: saved.geldigVanaf });
              render();
            }
          });
          if (list === 'medewerkers') {
            addDetailSection(content, 'Contract & tarief', 'Nog niet beschikbaar.');
            addDetailSection(content, 'Afwezigheid', 'Nog niet beschikbaar.');
            addDetailSection(content, 'Komende inzet', 'Nog niet beschikbaar.');
          } else if (list === 'materieel') {
            addDetailSection(content, 'Verhuurtarief en keuring', 'Nog niet beschikbaar.');
            addDetailSection(content, 'Niet beschikbaar en komende inzet', 'Nog niet beschikbaar.');
          }
        } catch (error) {
          if (sequence === detailNumber && detail.open) content.textContent = 'Gegevens ophalen mislukt: ' + error.message;
        } finally { finishLoading(); }
        return;
      }
      if (sequence !== detailNumber) return;
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
    function renderArticleDetail(content, article, categories, units, sequence, item) {
      content.replaceChildren();
      const state = { baseline: article, dirty: false, saving: false, conflict: null };
      detailDraft = state;
      const fields = document.createElement('div'); fields.className = 'fg';
      const controls = {};
      const optionIds = {};
      function input(key, label, value, options) {
        const block = document.createElement('label'); block.className = 'field';
        const title = document.createElement('strong'); title.textContent = label;
        const control = document.createElement(options ? 'select' : 'input');
        control.setAttribute('aria-label', label);
        if (options) {
          const selectable = options.filter(option => option.actief !== false || option.id === value);
          const available = selectable.some(option => option.id === value) ? selectable : [{ id: value, naam: value ? article[key === 'categorieId' ? 'categorie' : 'eenheid'] : '—' }, ...selectable];
          optionIds[key] = new Set(available.map(entry => entry.id));
          for (const entry of available) { const option = document.createElement('option'); option.value = entry.id; option.textContent = entry.naam; control.append(option); }
        } else control.type = 'text';
        control.value = value ?? '';
        control.addEventListener('input', updateState); control.addEventListener('change', updateState);
        controls[key] = control; block.append(title, control); fields.append(block);
      }
      input('naam', 'Omschrijving', article.naam);
      input('categorieId', 'Categorie', article.categorieId, categories);
      input('eenheidId', 'Eenheid', article.eenheidId, units);
      input('tarief', 'Prijs', article.tarief == null ? '' : String(article.tarief));
      const activeLabel = document.createElement('label'); activeLabel.className = 'field';
      const activeTitle = document.createElement('strong'); activeTitle.textContent = 'Actief';
      const active = switchControl(article.actief, 'Actief');
      let activeValue = article.actief;
      active.addEventListener('click', () => { activeValue = !activeValue; active.setAttribute('aria-checked', String(activeValue)); updateState(); });
      activeLabel.append(activeTitle, active); fields.append(activeLabel);
      const status = document.createElement('p'); status.className = 'hint'; status.setAttribute('role', 'status');
      const conflict = document.createElement('div'); conflict.className = 'customer-rate-conflicts';
      const save = detailSave;
      content.append(fields, status, conflict);
      function values() {
        const price = controls.tarief.value.trim().replace(',', '.');
        return { naam: controls.naam.value.trim(), categorieId: controls.categorieId.value, eenheidId: controls.eenheidId.value,
          tariefSoort: price === '' ? 'zie_prijs' : 'vast', tarief: price === '' ? null : Number(price), actief: activeValue };
      }
      function comparable(value) { return JSON.stringify([value.naam, value.categorieId, value.eenheidId, value.tariefSoort, value.tarief, value.actief]); }
      function updateState() {
        state.dirty = comparable(values()) !== comparable(state.baseline);
        save.disabled = !state.dirty || state.saving || !!state.conflict;
        for (const control of Object.values(controls)) control.disabled = state.saving;
        active.disabled = state.saving;
      }
      async function showConflict() {
        try {
          const latest = await request('/api/articles/' + encodeURIComponent(article.id));
          if (sequence !== detailNumber || !detail.open) return;
          state.conflict = latest;
          conflict.replaceChildren();
          const description = document.createElement('p'); description.className = 'hint';
          description.textContent = 'Nieuwste gegevens: ' + latest.naam + ' · ' + latest.categorie + ' · ' + latest.eenheid + ' · ' + (latest.tarief ?? 'Zie prijs') + ' · ' + (latest.actief ? 'Actief' : 'Inactief') + '. Je invoer blijft staan.';
          const reapply = document.createElement('button'); reapply.type = 'button'; reapply.className = 'btn sm'; reapply.textContent = 'Mijn wijzigingen opnieuw toepassen';
          reapply.addEventListener('click', () => {
            const previous = state.baseline;
            for (const key of ['naam', 'categorieId', 'eenheidId']) {
              if (controls[key].value !== String(previous[key] ?? '')) continue;
              if (optionIds[key] && !optionIds[key].has(latest[key])) {
                const option = document.createElement('option'); option.value = latest[key]; option.textContent = latest[key === 'categorieId' ? 'categorie' : 'eenheid']; controls[key].append(option); optionIds[key].add(latest[key]);
              }
              controls[key].value = latest[key];
            }
            if (values().tarief === previous.tarief && values().tariefSoort === previous.tariefSoort) controls.tarief.value = latest.tarief == null ? '' : String(latest.tarief);
            if (activeValue === previous.actief) { activeValue = latest.actief; active.setAttribute('aria-checked', String(activeValue)); }
            state.baseline = latest; state.conflict = null; conflict.replaceChildren(); status.textContent = 'Controleer je wijzigingen en sla opnieuw op.'; updateState();
          });
          conflict.append(description, reapply);
        } catch (error) {
          if (sequence !== detailNumber || !detail.open) return;
          state.conflict = { unavailable: true };
          conflict.replaceChildren();
          const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn sm'; retry.textContent = 'Nieuwste gegevens ophalen'; retry.addEventListener('click', showConflict); conflict.append(retry);
          status.textContent = 'Nieuwste gegevens ophalen mislukt. Je invoer blijft behouden.';
        }
        updateState();
      }
      save.onclick = async () => {
        const data = values();
        const price = controls.tarief.value.trim().replace(',', '.');
        if (!data.naam || data.naam.length > 200 || !data.categorieId || !data.eenheidId || (price && (!/^\d+(?:\.\d{1,4})?$/.test(price) || data.tarief > 9999999999.9999))) {
          status.textContent = 'Vul een omschrijving, categorie, eenheid en een geldig tarief met maximaal vier decimalen in.'; return;
        }
        state.saving = true; status.textContent = ''; updateState();
        const finishLoading = window.VsvkLoading.begin();
        try {
          const headers = { 'Content-Type': 'application/json' };
          if (item) headers['If-Match'] = state.baseline.eTag;
          const saved = await request(item ? '/api/articles/' + encodeURIComponent(article.id) : '/api/articles', { method: item ? 'PUT' : 'POST', headers, body: JSON.stringify(data) });
          if (sequence !== detailNumber || !detail.open) return;
          if (!item) { detailDraft = null; detail.close(); if (current === 'artikelen') load('artikelen'); return; }
          state.baseline = saved; Object.assign(item, saved); status.textContent = 'Artikel opgeslagen.'; render();
        } catch (error) {
          if (sequence !== detailNumber || !detail.open) return;
          if (error.status === 412) { state.conflict = { unavailable: true }; status.textContent = 'Het artikel is door iemand anders gewijzigd.'; await showConflict(); }
          else status.textContent = 'Opslaan mislukt: ' + error.message;
        } finally { state.saving = false; finishLoading(); if (sequence === detailNumber && detail.open) updateState(); }
      };
      updateState();
    }
    function renderCustomerDetail(content, customer, canEdit, sequence, item) {
      content.replaceChildren();
      const customerSave = detailSave;
      customerSave.disabled = true; customerSave.onclick = null;
      customerSave.title = canEdit ? '' : 'Alleen bekijken';
      const copy = value => JSON.parse(JSON.stringify(value));
      const state = { baseline: copy(customer), draft: copy(customer), dirty: false, saving: false, conflict: null };
      if (canEdit) detailDraft = state;
      state.draft.facturatie ||= {};
      state.draft.contactpersonen ||= [];
      const billing = state.draft.facturatie;
      const fields = {};
      const fieldNames = { 'Bedrijfsnaam *': 'bedrijfsnaam', 'Debiteurnummer': 'debiteurnummer', 'KvK-nummer': 'kvkNummer', 'Btw-nummer': 'facturatie.btwNummer', 'Website': 'website', 'Telefoon algemeen': 'telefoon', 'E-mail algemeen': 'email', 'Straat': 'straat', 'Huisnr': 'huisnummer', 'Toev.': 'toevoeging', 'Postcode': 'postcode', 'Plaats': 'plaats', 'Land': 'land', 'Factuur e-mail': 'facturatie.factuurEmail', 'Vaste referentie / kostenplaats': 'facturatie.vasteReferentie', 'IBAN': 'facturatie.iban', 'G-rekening (%)': 'facturatie.gRekeningPercentage', 'Opmerkingen': 'opmerkingen' };
      const get = (obj, path) => path.split('.').reduce((value, key) => value?.[key], obj);
      const set = (obj, path, value) => { const parts = path.split('.'); const key = parts.pop(); const target = parts.reduce((value, part) => value[part], obj); target[key] = value; };
      const comparable = data => JSON.stringify([Object.keys(fieldNames).map(label => get(data, fieldNames[label]) ?? null), data.actief, data.facturatie?.afwijkendFactuuradres, data.facturatie?.btwVerlegd, data.facturatie?.mandagenregisterMeesturen, data.facturatie?.facturerenPer ?? null, data.contactpersonen]);
      let updateState = () => {};
      const element = (tag, className, text) => { const result = document.createElement(tag); if (className) result.className = className; if (text != null) result.textContent = text; return result; };
      const input = (value, label) => { const result = element('input'); result.type = 'text'; result.value = value == null ? '' : String(value); result.readOnly = !canEdit; if (label) result.setAttribute('aria-label', label); return result; };
      const field = (label, value, multiline = false) => {
        const result = element('label', 'f', label);
        const key = fieldNames[label];
        const control = multiline ? element('textarea') : input(value, label.replace(' *', ''));
        if (multiline) { control.value = value == null ? '' : String(value); control.readOnly = !canEdit; control.rows = 2; control.placeholder = 'Bijv. melden bij de bouwkeet, sleutel bij de beheerder'; }
        fields[key] = control;
        if (canEdit) control.addEventListener('input', () => { const raw = control.value; const numeric = raw.replace(',', '.'); set(state.draft, key, key === 'facturatie.gRekeningPercentage' ? (raw.trim() === '' ? null : /^\d+(?:\.\d{1,2})?$/.test(numeric) ? Number(numeric) : numeric) : (raw === '' && !['bedrijfsnaam', 'debiteurnummer'].includes(key) ? null : raw)); updateState(); });
        result.append(control); return result;
      };
      const group = (className, ...children) => { const result = element('div', className); result.append(...children); return result; };
      const section = title => { const result = element('div', 'ksec'); result.append(element('h3', '', title)); return result; };
      const booleanKeys = { 'Actief': 'actief', 'Afwijkend factuuradres': 'facturatie.afwijkendFactuuradres', 'Btw verlegd (standaard)': 'facturatie.btwVerlegd', 'Mandagenregister meesturen (bij aanneemsom alleen op verzoek)': 'facturatie.mandagenregisterMeesturen' };
      const boolean = (label, value) => {
        const result = element('span', 'swl');
        const control = typeof value === 'boolean' ? switchControl(value, label, !canEdit) : element('span', 'hint', '—');
        if (canEdit && typeof value === 'boolean') { const key = booleanKeys[label]; fields[key] = control; control.addEventListener('click', () => { const next = !get(state.draft, key); set(state.draft, key, next); control.setAttribute('aria-checked', String(next)); updateState(); }); }
        result.append(control, element('span', '', label));
        return result;
      };
      const billingPeriod = element('label', 'f', 'Factureren per');
      const periodSelect = element('select'); periodSelect.disabled = !canEdit; fields['facturatie.facturerenPer'] = periodSelect;
      const period = billing.facturerenPer == null ? '' : String(billing.facturerenPer);
      const periods = [...new Set([period, 'week', 'dag'])];
      for (const value of periods) { const option = element('option', '', value || '—'); option.value = value; periodSelect.append(option); }
      periodSelect.value = period; billingPeriod.append(periodSelect);
      if (canEdit) periodSelect.addEventListener('change', () => { state.draft.facturatie.facturerenPer = periodSelect.value || null; updateState(); });
      const company = section('Bedrijf');
      company.append(field('Bedrijfsnaam *', customer.bedrijfsnaam), group('fg', field('Debiteurnummer', customer.debiteurnummer), field('KvK-nummer', customer.kvkNummer)),
        group('fg', field('Btw-nummer', billing.btwNummer), field('Website', customer.website)),
        group('fg', field('Telefoon algemeen', customer.telefoon), field('E-mail algemeen', customer.email)), boolean('Actief', customer.actief));
      const address = section('Vestigingsadres');
      address.append(group('adr', field('Straat', customer.straat), field('Huisnr', customer.huisnummer), field('Toev.', customer.toevoeging)),
        group('adr2', field('Postcode', customer.postcode), field('Plaats', customer.plaats)), field('Land', customer.land));
      const invoicing = section('Facturatie');
      invoicing.append(field('Factuur e-mail', billing.factuurEmail), boolean('Afwijkend factuuradres', billing.afwijkendFactuuradres));
      if (billing.afwijkendFactuuradres === true) invoicing.append(element('p', 'hint', 'Afwijkend factuuradres is nog niet beschikbaar.'));
      invoicing.append(field('Vaste referentie / kostenplaats', billing.vasteReferentie), field('IBAN', billing.iban),
        group('fg', field('G-rekening (%)', billing.gRekeningPercentage), billingPeriod),
        boolean('Btw verlegd (standaard)', billing.btwVerlegd), boolean('Mandagenregister meesturen (bij aanneemsom alleen op verzoek)', billing.mandagenregisterMeesturen));
      content.append(group('kgrid', company, address, invoicing));

      const contacts = element('section', 'fsec');
      const contactAdd = element('button', 'btn sm', '+ Contactpersoon'); contactAdd.type = 'button'; contactAdd.disabled = !canEdit;
      contacts.append(group('hd', element('h3', '', 'Contactpersonen & bestellers'), contactAdd));
      const contactRows = element('div'); contacts.append(contactRows);
      let contactControls = [];
      function renderContacts() {
        contactRows.replaceChildren();
        contactControls = [];
        const people = state.draft.contactpersonen;
        if (people.length) {
        contactRows.append(group('crow2 hd', ...['★', 'Naam', 'Functie', 'Telefoon', 'E-mail', ''].map(label => element('span', '', label))));
        for (const person of people) {
          const standard = element('input'); standard.type = 'radio'; standard.name = 'customer-standard'; standard.checked = person.isStandaardBesteller === true; standard.disabled = !canEdit; standard.setAttribute('aria-label', 'Standaard besteller ' + person.naam);
          const name = input(person.naam, 'Naam contactpersoon'); name.placeholder = 'Naam';
          const job = input(person.functie, 'Functie ' + person.naam); job.className = 'opt'; job.placeholder = 'Functie';
          const phone = input(person.telefoon, 'Telefoon ' + person.naam); phone.className = 'opt'; phone.placeholder = 'Telefoon';
          const email = input(person.email, 'E-mail ' + person.naam); email.className = 'opt'; email.placeholder = 'E-mail';
          const remove = element('button', 'btn ghost', '✕'); remove.type = 'button'; remove.disabled = !canEdit; remove.setAttribute('aria-label', 'Verwijder contactpersoon ' + person.naam);
          contactControls.push(standard, name, job, phone, email, remove);
          if (canEdit) {
            for (const [control, key] of [[name, 'naam'], [job, 'functie'], [phone, 'telefoon'], [email, 'email']]) control.addEventListener('input', () => { person[key] = control.value || (key === 'naam' ? '' : null); updateState(); });
            standard.addEventListener('change', () => { people.forEach(p => { p.isStandaardBesteller = p === person; }); updateState(); });
            remove.addEventListener('click', () => { state.draft.contactpersonen = people.filter(p => p !== person); renderContacts(); updateState(); });
          }
          contactRows.append(group('crow2', standard, name, job, phone, email, remove));
        }
        contactRows.append(element('p', 'hint', '★ = standaard besteller, wordt vooringevuld bij een nieuwe werkopdracht.'));
        } else contactRows.append(element('p', 'hint', 'Nog geen contactpersonen. Voeg de besteller toe, dan staat die klaar bij een nieuwe werkopdracht.'));
      }
      if (canEdit) contactAdd.addEventListener('click', () => { state.draft.contactpersonen.push({ id: 0, naam: '', functie: null, telefoon: null, email: null, isStandaardBesteller: false }); renderContacts(); updateState(); });
      renderContacts();
      content.append(contacts);

      const rates = element('section', 'fsec customer-rates');
      rates.append(group('hd', element('h3', '', 'Afwijkende tarieven')), element('p', 'hint', 'Tarieven laden…'));
      content.append(rates, field('Opmerkingen', customer.opmerkingen, true));
      const workOrders = element('section', 'fsec');
      workOrders.append(group('hd', element('h3', '', 'Werkopdrachten')), element('p', 'hint', 'Werkopdrachten zijn nog niet gekoppeld.'));
      content.append(workOrders);
      if (canEdit) {
        const status = element('p', 'hint'); status.setAttribute('role', 'status');
        const conflict = element('div', 'customer-rate-conflicts');
        const save = customerSave;
        content.append(status, conflict);
        updateState = () => {
          state.dirty = comparable(state.draft) !== comparable(state.baseline);
          save.disabled = !state.dirty || state.saving || !!state.conflict;
          for (const control of Object.values(fields)) control.disabled = state.saving;
          contactAdd.disabled = state.saving;
          for (const control of contactControls) control.disabled = state.saving;
        };
        function refreshControls() {
          for (const [key, control] of Object.entries(fields)) {
            const value = get(state.draft, key);
            if (booleanKeys && Object.values(booleanKeys).includes(key)) control.setAttribute('aria-checked', String(value));
            else control.value = value == null ? '' : String(value);
          }
          renderContacts();
        }
        async function showConflict() {
          try {
            const latest = await request('/api/planning/klanten/' + encodeURIComponent(customer.id));
            if (sequence !== detailNumber || !detail.open) return;
            state.conflict = latest;
            conflict.replaceChildren();
            const compare = element('pre', 'hint', 'Nieuwste gegevens:\n' + JSON.stringify(latest, null, 2) + '\n\nJouw invoer:\n' + JSON.stringify(state.draft, null, 2));
            const reapply = element('button', 'btn sm', 'Mijn klantwijzigingen opnieuw toepassen'); reapply.type = 'button';
            reapply.addEventListener('click', () => {
              const keys = [...Object.values(fieldNames), ...Object.values(booleanKeys), 'facturatie.facturerenPer', 'contactpersonen'];
              for (const key of keys) if (JSON.stringify(get(state.draft, key) ?? null) === JSON.stringify(get(state.baseline, key) ?? null)) set(state.draft, key, copy(get(latest, key) ?? null));
              state.baseline = latest; state.draft.version = latest.version; state.draft.eTag = latest.eTag; state.conflict = null;
              conflict.replaceChildren(); refreshControls(); status.textContent = 'Controleer je wijzigingen en sla opnieuw op. Gewijzigde contactpersonen worden als geheel opnieuw toegepast.'; updateState();
            });
            conflict.append(compare, reapply);
          } catch (error) {
            if (sequence !== detailNumber || !detail.open) return;
            state.conflict = { unavailable: true }; conflict.replaceChildren();
            const retry = element('button', 'btn sm', 'Nieuwste klantgegevens ophalen'); retry.type = 'button'; retry.addEventListener('click', showConflict); conflict.append(retry);
            status.textContent = 'Nieuwste gegevens ophalen mislukt. Je invoer blijft behouden.';
          }
          updateState();
        }
        save.onclick = async () => {
          const data = copy(state.draft); const percentage = data.facturatie.gRekeningPercentage;
          if (!data.bedrijfsnaam?.trim() || !data.debiteurnummer?.trim() || data.contactpersonen.some(person => !person.naam?.trim()) ||
              (percentage != null && (!/^\d+(?:\.\d{1,2})?$/.test(String(percentage)) || Number(percentage) > 100))) { status.textContent = 'Vul bedrijfsnaam, debiteurnummer, contactnamen en een geldig G-rekeningpercentage in.'; return; }
          data.facturatie.gRekeningPercentage = percentage == null ? null : Number(percentage);
          state.saving = true; updateState(); const finishLoading = window.VsvkLoading.begin();
          try {
            const saved = await request('/api/planning/klanten/' + encodeURIComponent(customer.id), { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': state.baseline.eTag }, body: JSON.stringify(data) });
            if (sequence !== detailNumber || !detail.open) return;
            state.baseline = copy(saved); state.draft = copy(saved); Object.assign(item, { bedrijfsnaam: saved.bedrijfsnaam, debiteurnummer: saved.debiteurnummer, actief: saved.actief, telefoon: saved.telefoon, plaats: saved.plaats, standaardBesteller: saved.contactpersonen.find(p => p.isStandaardBesteller)?.naam });
            refreshControls(); render(); status.textContent = 'Klant opgeslagen.';
          } catch (error) {
            if (sequence !== detailNumber || !detail.open) return;
            if (error.status === 412) { state.conflict = { unavailable: true }; status.textContent = 'Deze klant is door iemand anders gewijzigd. Je invoer blijft behouden.'; await showConflict(); }
            else status.textContent = 'Opslaan mislukt: ' + error.message;
          } finally { state.saving = false; finishLoading(); if (sequence === detailNumber && detail.open) updateState(); }
        };
        updateState();
      }
      return rates;
    }
    async function loadCustomerRates(section, customerId, sequence) {
      try {
        const [standard, customerRates] = await Promise.all([
          request('/api/planning/tarieven'), request('/api/planning/klanten/' + encodeURIComponent(customerId) + '/tarieven')
        ]);
        if (sequence !== detailNumber || !detail.open) return;
        renderCustomerRates(section, customerId, standard, customerRates, sequence);
      } catch (error) {
        if (sequence !== detailNumber || !detail.open) return;
        section.replaceChildren();
        const heading = document.createElement('h3'); heading.textContent = 'Afwijkende tarieven';
        const notice = document.createElement('p'); notice.className = 'hint'; notice.textContent = 'Tarieven ophalen mislukt: ' + error.message;
        section.append(heading, notice);
      }
    }
    function renderCustomerRates(section, customerId, standard, customerRates, sequence) {
      const create = (tag, className, value) => { const element = document.createElement(tag); if (className) element.className = className; if (value != null) element.textContent = value; return element; };
      const values = rates => new Map(rates.afwijkingen.map(rate => [rate.functieId, String(rate.tarief)]));
      let baseline = values(customerRates);
      const draft = new Map(baseline);
      let version = customerRates.eTag;
      let latest = null;
      const controls = new Map();
      section.replaceChildren();
      const heading = create('div', 'hd'); heading.append(create('h3', '', 'Afwijkende tarieven'));
      const save = create('button', 'btn sm primary', 'Tarieven opslaan'); save.type = 'button'; save.disabled = true; heading.append(save);
      const explanation = create('p', 'hint', 'Laat een afwijkend tarief leeg om het standaardtarief te gebruiken. Alleen tarieven kunnen hier worden aangepast.');
      const status = create('p', 'hint'); status.setAttribute('role', 'status');
      const conflicts = create('div', 'customer-rate-conflicts');
      section.append(heading, explanation, status, conflicts);
      const normalize = value => String(value ?? '').trim().replace(',', '.');
      const comparable = value => { const normalized = normalize(value); return /^\d+(?:\.\d{1,2})?$/.test(normalized) ? String(Number(normalized)) : normalized; };
      const changed = () => standard.some(rate => comparable(draft.get(rate.functieId)) !== comparable(baseline.get(rate.functieId)));
      const updateState = () => { customerRatesDirty = changed(); save.disabled = !customerRatesDirty || customerRatesSaving || !!latest; };
      if (!standard.length) section.append(create('p', 'hint', 'Geen standaardtarieven beschikbaar.'));
      if (standard.length) {
        const labels = create('div', 'customer-rate-row customer-rate-head');
        labels.append(create('span', '', 'Functie'), create('span', '', 'Standaardtarief'), create('span', '', 'Afwijkend tarief'));
        section.append(labels);
      }
      for (const rate of standard) {
        const row = create('div', 'customer-rate-row');
        const label = create('span', '', rate.functie + (rate.actief ? '' : ' (inactief)'));
        const defaultPrice = create('span', 'hint', 'Standaard ' + formatPrice(rate.prijs) + ' / ' + rate.eenheid);
        const input = create('input'); input.type = 'text'; input.inputMode = 'decimal';
        input.placeholder = 'Standaard'; input.value = draft.get(rate.functieId) || '';
        input.disabled = !rate.actief && !baseline.has(rate.functieId);
        input.setAttribute('aria-label', 'Afwijkend tarief ' + rate.functie);
        input.addEventListener('input', () => { draft.set(rate.functieId, input.value); status.textContent = ''; updateState(); });
        controls.set(rate.functieId, input); row.append(label, defaultPrice, input); section.append(row);
      }
      const knownIds = new Set(standard.map(rate => rate.functieId));
      for (const rate of customerRates.afwijkingen.filter(rate => !knownIds.has(rate.functieId))) {
        section.append(create('p', 'hint', rate.omschrijving + ': ' + formatPrice(rate.tarief) + ' (geen geldig standaardtarief; blijft behouden)'));
      }
      for (const rate of customerRates.historischeTarieven) {
        section.append(create('p', 'hint', rate.omschrijving + ': ' + formatPrice(rate.tarief) + ' (historisch tarief; blijft behouden)'));
      }
      save.addEventListener('click', async () => {
        if (!changed() || customerRatesSaving || latest) return;
        const overrides = [];
        for (const rate of standard) {
          const raw = normalize(draft.get(rate.functieId));
          if (!raw) continue;
          const amount = Number(raw);
          if (!Number.isFinite(amount) || amount < 0 || amount >= 100000000 || !/^\d+(?:\.\d{1,2})?$/.test(raw)) {
            status.textContent = 'Vul een geldig tarief in met maximaal twee decimalen.'; return;
          }
          overrides.push({ functieId: rate.functieId, tarief: amount });
        }
        customerRatesSaving = true; updateState();
        for (const input of controls.values()) input.disabled = true;
        const finishLoading = window.VsvkLoading.begin();
        try {
          const saved = await request('/api/planning/klanten/' + encodeURIComponent(customerId) + '/tarieven', {
            method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': version }, body: JSON.stringify({ afwijkingen: overrides })
          });
          if (sequence !== detailNumber || !detail.open) return;
          baseline = values(saved); version = saved.eTag; status.textContent = 'Tarieven opgeslagen.';
        } catch (error) {
          if (sequence !== detailNumber || !detail.open) return;
          if (error.status === 412) {
            status.textContent = 'De tarieven zijn door iemand anders gewijzigd. Je wijzigingen zijn behouden.';
            try {
              latest = await request('/api/planning/klanten/' + encodeURIComponent(customerId) + '/tarieven');
              if (sequence !== detailNumber || !detail.open) return;
              const latestValues = values(latest);
              conflicts.replaceChildren(create('p', 'hint', 'Nieuwste opgeslagen tarieven:'));
              for (const rate of standard) {
                const current = latestValues.get(rate.functieId);
                const entered = normalize(draft.get(rate.functieId));
                conflicts.append(create('p', 'hint', rate.functie + ': ' + (current == null ? 'standaard ' + formatPrice(rate.prijs) : formatPrice(Number(current))) + ' · jouw invoer: ' + (!entered ? 'standaard' : /^\d+(?:\.\d{1,2})?$/.test(entered) ? formatPrice(Number(entered)) : draft.get(rate.functieId))));
              }
              const reapply = create('button', 'btn sm', 'Mijn wijzigingen opnieuw toepassen'); reapply.type = 'button';
              reapply.addEventListener('click', () => {
                for (const rate of standard) {
                  const id = rate.functieId;
                  if (comparable(draft.get(id)) === comparable(baseline.get(id))) draft.set(id, latestValues.get(id) || '');
                  controls.get(id).value = draft.get(id) || '';
                }
                baseline = latestValues; version = latest.eTag; latest = null; conflicts.replaceChildren();
                for (const rate of standard) controls.get(rate.functieId).disabled = !rate.actief && !baseline.has(rate.functieId);
                status.textContent = 'Controleer je wijzigingen en sla ze opnieuw op.'; updateState();
              });
              conflicts.append(reapply);
            } catch (refreshError) { status.textContent += ' De nieuwste tarieven ophalen is mislukt; probeer opnieuw.'; }
          } else status.textContent = 'Tarieven opslaan mislukt: ' + error.message;
        } finally {
          finishLoading(); customerRatesSaving = false;
          if (sequence === detailNumber && detail.open) {
            for (const rate of standard) controls.get(rate.functieId).disabled = !rate.actief && !baseline.has(rate.functieId);
            updateState();
          }
        }
      });
    }
    document.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => showSection(button.dataset.section)));
    document.querySelectorAll('[data-list]').forEach(button => button.addEventListener('click', () => load(button.dataset.list)));
    document.querySelector('#add').addEventListener('click', openCreate);
    const mayCloseDetail = () => !customerRatesSaving && !detailDraft?.saving && (!(customerRatesDirty || detailDraft?.dirty) || window.confirm('Niet-opgeslagen wijzigingen verwerpen?'));
    document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => { if (mayCloseDetail()) detail.close(); }));
    detail.addEventListener('cancel', event => { if (!mayCloseDetail()) event.preventDefault(); });
    detail.addEventListener('close', () => { detailNumber++; customerRatesDirty = false; detailDraft = null; detailSave.disabled = true; detailSave.onclick = null; stopDetailLoading(); });
    search.addEventListener('input', render);
    document.querySelectorAll('[data-list]').forEach(button => {
      if (!definitions[button.dataset.list].path) return;
      const counter = document.createElement('span'); counter.className = 'list-count'; counter.hidden = true; button.append(' ', counter);
    });
    refreshCounts(current);
    load(current);
