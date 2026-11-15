const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const headerScript = fs.readFileSync(path.join(root, 'apps/shared/header.js'), 'utf8');

function renderHeader({ application, external = false, response } = {}) {
  const name = {};
  const roles = {};
  const account = { hidden: true };
  const title = {};
  const active = { setAttribute(key, value) { this[key] = value; } };
  const navigation = {};
  const totals = application === 'calculatie' ? {} : null;
  const bar = { insertBefore(element) { this.totals = element; } };
  const wrap = { append(element) { this.navigation = element; } };
  const holder = {
    dataset: { application, title: 'Testapplicatie', account: external ? 'external' : '' },
    querySelector(selector) { return selector === 'nav.tabs' ? navigation : totals; },
    replaceWith(element) { this.header = element; }
  };
  const header = {
    querySelector(selector) {
      if (selector === '.brand span') return title;
      if (selector.startsWith('[data-application-link=')) return active;
      return { '.account-name': name, '.account-roles': roles, '.account': account, '.bar': bar, '.wrap': wrap }[selector];
    }
  };
  let fetchCount = 0;
  const window = {};
  const document = { currentScript: { previousElementSibling: holder }, createElement: () => header };
  const fetch = async () => { fetchCount++; return response || { ok: false }; };
  vm.runInNewContext(headerScript, { window, document, fetch, Set });
  return { window, holder, title, active, account, name, roles, navigation, totals, bar, wrap, fetchCount: () => fetchCount };
}

test('planning toont de ingelogde gebruiker en de actieve applicatie', async () => {
  const view = renderHeader({ application: 'planning', response: { ok: true, json: async () => ({ username: 'jan', roles: ['planning', 'default-roles-vsvk', 'onbekend'] }) } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.name.textContent, 'jan');
  assert.equal(view.roles.textContent, 'Rollen: planning, default-roles-vsvk');
  assert.equal(view.account.hidden, false);
  assert.equal(view.active['aria-current'], 'page');
  assert.equal(view.wrap.navigation, view.navigation);
  assert.equal(view.holder.header.className, 'top no-totals');
});

test('calculatie behoudt de totalen en vult het account zelf', () => {
  const view = renderHeader({ application: 'calculatie', external: true });
  assert.equal(view.fetchCount(), 0);
  assert.equal(view.bar.totals, view.totals);
  assert.equal(view.account.hidden, true);
  view.window.VsvkHeader.setAccount('piet', ['directie']);
  assert.equal(view.name.textContent, 'piet');
  assert.equal(view.roles.textContent, 'Rollen: directie');
  assert.equal(view.account.hidden, false);
});

test('een mislukte accountaanvraag toont geen fictieve gebruiker', async () => {
  const view = renderHeader({ application: 'planning' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.account.hidden, true);
});

test('applicaties gebruiken gedeelde header en externe stylesheets', () => {
  for (const app of ['calculatie', 'planning']) {
    const html = fs.readFileSync(path.join(root, 'apps', app, 'index.html'), 'utf8');
    assert.match(html, /\/shared\/layout\.css/);
    assert.match(html, /\/shared\/header\.js/);
    assert.doesNotMatch(html, /<style\b|\sstyle=/i);
  }
});

test('header en inhoud gebruiken dezelfde gedeelde container', () => {
  const layout = fs.readFileSync(path.join(root, 'apps/shared/layout.css'), 'utf8');
  assert.match(layout, /(?:^|\n)\.wrap\{[^}]*max-width:1500px[^}]*\}/);
  for (const app of ['calculatie', 'planning']) {
    const html = fs.readFileSync(path.join(root, 'apps', app, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'apps', app, `${app}.css`), 'utf8');
    assert.match(html, /<main\s+class="wrap"/);
    assert.doesNotMatch(css, /\.wrap\s*\{/);
  }
});

test('inhoud sluit direct aan op de header', () => {
  for (const app of ['calculatie', 'planning']) {
    const css = fs.readFileSync(path.join(root, 'apps', app, `${app}.css`), 'utf8');
    assert.match(css, /main\{[^}]*padding-block:\s*0\s+60px/);
  }
});
