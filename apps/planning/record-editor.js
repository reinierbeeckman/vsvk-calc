(function () {
  'use strict';

  function create(config) {
    const { content, endpoint, request, fields, isCurrent, onSaved, saveButton: save } = config;
    const state = { baseline: config.item, dirty: false, saving: false, conflict: null };
    const controls = {};
    const booleanValues = {};
    const skillsValues = {};
    const nodes = [];
    const grid = document.createElement('div'); grid.className = 'fg';
    const status = document.createElement('p'); status.className = 'hint'; status.setAttribute('role', 'status');
    const conflict = document.createElement('div'); conflict.className = 'customer-rate-conflicts';
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const same = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
    const display = value => value == null || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);

    function selectOptions(control, options, value) {
      const entries = [...(options || [])];
      if (value && !entries.some(entry => String(entry.value) === String(value))) entries.push({ value, label: value });
      const empty = document.createElement('option'); empty.value = ''; empty.textContent = '—'; control.append(empty);
      for (const entry of entries) { const option = document.createElement('option'); option.value = entry.value; option.textContent = entry.label; control.append(option); }
    }
    function addInput(field) {
      const label = document.createElement('label'); label.className = 'field';
      const title = document.createElement('strong'); title.textContent = field.label; label.append(title);
      let control;
      if (field.type === 'boolean') {
        control = document.createElement('button'); control.type = 'button'; control.className = 'vsvk-switch';
        control.setAttribute('role', 'switch'); control.setAttribute('aria-label', field.label);
        booleanValues[field.key] = !!state.baseline[field.key];
        control.setAttribute('aria-checked', String(booleanValues[field.key]));
        control.addEventListener('click', () => { booleanValues[field.key] = !booleanValues[field.key]; control.setAttribute('aria-checked', String(booleanValues[field.key])); updateState(); });
      } else {
        control = document.createElement(field.type === 'select' ? 'select' : 'input');
        control.setAttribute('aria-label', field.label);
        if (field.type === 'select') selectOptions(control, field.options, state.baseline[field.key]);
        else { control.type = field.type === 'date' ? 'date' : 'text'; if (field.type === 'number') control.inputMode = 'decimal'; }
        control.value = String(state.baseline[field.key] ?? '');
        control.addEventListener('input', updateState); control.addEventListener('change', updateState);
      }
      controls[field.key] = control; nodes.push(control); label.append(control); grid.append(label);
    }
    function renderSkills(field, container) {
      container.replaceChildren();
      const heading = document.createElement('h3'); heading.textContent = field.label; container.append(heading);
      for (const [index, skill] of skillsValues[field.key].entries()) {
        const row = document.createElement('div'); row.className = 'fg';
        const name = document.createElement('select'); name.setAttribute('aria-label', 'Vaardigheid');
        selectOptions(name, field.options, skill.naam); name.value = skill.naam ?? '';
        name.addEventListener('change', () => { skill.naam = name.value; updateState(); });
        const diploma = document.createElement('input'); diploma.type = 'date'; diploma.setAttribute('aria-label', 'Diplomadatum'); diploma.value = skill.diplomaOp ?? '';
        diploma.addEventListener('input', () => { skill.diplomaOp = diploma.value || null; updateState(); });
        const expiry = document.createElement('input'); expiry.type = 'date'; expiry.setAttribute('aria-label', 'Geldig tot'); expiry.value = skill.geldigTot ?? '';
        expiry.addEventListener('input', () => { skill.geldigTot = expiry.value || null; updateState(); });
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn sm'; remove.textContent = 'Verwijderen';
        remove.addEventListener('click', () => { skillsValues[field.key].splice(index, 1); renderSkills(field, container); updateState(); });
        const labeled = (caption, control) => { const label = document.createElement('label'); label.className = 'field'; const title = document.createElement('strong'); title.textContent = caption; label.append(title, control); return label; };
        nodes.push(name, diploma, expiry, remove); row.append(labeled('Vaardigheid', name), labeled('Diplomadatum', diploma), labeled('Geldig tot', expiry), remove); container.append(row);
      }
      const add = document.createElement('button'); add.type = 'button'; add.className = 'btn sm'; add.textContent = '+ Vaardigheid';
      add.addEventListener('click', () => { skillsValues[field.key].push({ naam: '', diplomaOp: null, geldigTot: null }); renderSkills(field, container); updateState(); });
      nodes.push(add); container.append(add);
    }
    function read(field) {
      if (field.type === 'boolean') return booleanValues[field.key];
      if (field.type === 'skills') return clone(skillsValues[field.key]);
      const value = controls[field.key].value.trim();
      if (!value) return null;
      return field.type === 'number' ? Number(value.replace(',', '.')) : value;
    }
    function set(field, value) {
      if (field.type === 'boolean') { booleanValues[field.key] = !!value; controls[field.key].setAttribute('aria-checked', String(!!value)); }
      else if (field.type === 'skills') { skillsValues[field.key] = clone(value || []); renderSkills(field, controls[field.key]); }
      else {
        if (field.type === 'select' && value && !(field.options || []).some(entry => String(entry.value) === String(value))) {
          const option = document.createElement('option'); option.value = value; option.textContent = value; controls[field.key].append(option);
        }
        controls[field.key].value = String(value ?? '');
      }
    }
    function updateState() {
      state.dirty = fields.some(field => !same(read(field), state.baseline[field.key]));
      save.disabled = !state.dirty || state.saving || !!state.conflict;
      for (const node of nodes) node.disabled = state.saving;
    }
    async function getLatest() {
      try {
        const latest = await request(config.readEndpoint || endpoint);
        if (!isCurrent()) return;
        state.conflict = latest; conflict.replaceChildren();
        for (const field of fields) {
          const text = document.createElement('p'); text.className = 'hint';
          text.textContent = field.label + ': nieuwste waarde ' + display(latest[field.key]) + ' · jouw invoer ' + display(read(field));
          conflict.append(text);
        }
        const reapply = document.createElement('button'); reapply.type = 'button'; reapply.className = 'btn sm'; reapply.textContent = 'Mijn wijzigingen opnieuw toepassen';
        reapply.addEventListener('click', () => {
          for (const field of fields) if (same(read(field), state.baseline[field.key])) set(field, latest[field.key]);
          state.baseline = latest; state.conflict = null; conflict.replaceChildren(); status.textContent = 'Controleer je wijzigingen en sla opnieuw op.'; updateState();
        });
        conflict.append(reapply);
      } catch (error) {
        if (!isCurrent()) return;
        state.conflict = { unavailable: true }; conflict.replaceChildren();
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn sm'; retry.textContent = 'Nieuwste gegevens ophalen'; retry.addEventListener('click', getLatest); conflict.append(retry);
        status.textContent = 'Nieuwste gegevens ophalen mislukt. Je invoer blijft behouden.';
      }
      updateState();
    }
    for (const field of fields) {
      if (field.type !== 'skills') { addInput(field); continue; }
      const section = document.createElement('section'); section.className = 'fsec'; controls[field.key] = section;
      skillsValues[field.key] = clone(state.baseline[field.key] || []); renderSkills(field, section);
    }
    content.replaceChildren(grid);
    for (const field of fields) if (field.type === 'skills') content.append(controls[field.key]);
    content.append(status, conflict);
    save.onclick = async () => {
      const values = Object.fromEntries(fields.map(field => [field.key, read(field)]));
      if (fields.some(field => (field.required && (values[field.key] == null || values[field.key] === '')) || (field.type === 'number' && values[field.key] != null && !Number.isFinite(values[field.key])) || (field.type === 'skills' && values[field.key].some(skill => !skill.naam)))) {
        status.textContent = 'Controleer de verplichte velden en de ingevulde bedragen.'; return;
      }
      state.saving = true; status.textContent = ''; updateState();
      const finish = window.VsvkLoading?.begin() || (() => {});
      try {
        const method = config.method || 'PUT';
        const headers = { 'Content-Type': 'application/json' };
        if (method === 'PUT') headers['If-Match'] = state.baseline.eTag;
        const saved = await request(endpoint, { method, headers, body: JSON.stringify(values) });
        if (!isCurrent()) return;
        state.baseline = saved; for (const field of fields) set(field, saved[field.key]);
        status.textContent = 'Opgeslagen.'; onSaved(saved);
      } catch (error) {
        if (!isCurrent()) return;
        if (error.status === 412) { state.conflict = { unavailable: true }; status.textContent = 'Dit record is door iemand anders gewijzigd.'; await getLatest(); }
        else status.textContent = 'Opslaan mislukt: ' + error.message;
      } finally { state.saving = false; finish(); if (isCurrent()) updateState(); }
    };
    updateState();
    return state;
  }

  window.VsvkPlanningEditor = { create };
}());
