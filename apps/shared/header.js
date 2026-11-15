(function () {
  'use strict';
  const holder = document.currentScript.previousElementSibling;
  const application = holder.dataset.application;
  const navigation = holder.querySelector('nav.tabs');
  const totals = holder.querySelector('.totals');
  const header = document.createElement('header');
  header.className = 'top' + (totals ? '' : ' no-totals');
  header.innerHTML = `<div class="wrap"><div class="bar"><div class="brand"><svg class="logo-svg" viewBox="0 0 700 130" role="img" aria-label="VSVK"><path fill="var(--brand-orange)" d="M 0 127.2 L 68.1 64.4 L 0 1.5 L 58.4 1.5 L 125.6 64.1 L 58.4 127.2 Z M 0 127.2M 0 93.1 L 32.6 64.4 L 0 35.6 Z M 0 93.1M 125.7 32 L 93.4 1.5 L 125.7 1.5 Z M 125.7 32M 95.2 127.2 L 125.7 94.9 L 125.7 127.2 Z M 95.2 127.2"/><path fill="var(--logo-ink)" d="M 242.8 128.1 L 289.6 2.1 L 250.1 2.1 L 222.1 92.8 L 193.8 2.1 L 153 2.1 L 200.6 128.1 Z M 354.1 130.2 C 366.3 130.2 376.4 128.5 384.4 125 C 392.4 121.4 398.7 116.3 403.2 109.5 C 407.6 102.6 409.9 95.2 409.9 87.1 C 409.9 80.2 408.2 74 404.8 68.5 C 401.5 62.9 396.1 58.3 388.8 54.5 C 381.4 50.8 369.2 47.1 352.2 43.4 C 345.3 42 341 40.4 339.1 38.8 C 337.3 37.1 336.3 35.3 336.3 33.3 C 336.3 30.6 337.5 28.3 339.7 26.3 C 342 24.4 345.4 23.5 350 23.5 C 355.5 23.5 359.8 24.7 362.9 27.3 C 366 29.9 368.1 34 369 39.7 L 405.7 37.5 C 404.1 24.5 399.1 15 390.7 9 C 382.2 3 369.9 0 353.8 0 C 340.7 0 330.4 1.6 322.9 4.9 C 315.3 8.2 309.7 12.8 305.9 18.5 C 302.2 24.3 300.3 30.4 300.3 36.9 C 300.3 46.7 304 54.8 311.3 61.2 C 318.6 67.5 330.8 72.6 347.8 76.5 C 358.2 78.8 364.9 81.2 367.8 83.8 C 370.6 86.3 372.1 89.3 372.1 92.5 C 372.1 96 370.5 99 367.5 101.6 C 364.5 104.2 360.3 105.5 354.7 105.5 C 347.2 105.5 341.5 103 337.5 97.9 C 335.1 94.7 333.4 90.1 332.6 84.1 L 295.6 86.4 C 296.7 99.1 301.3 109.6 309.6 117.9 C 317.8 126.1 332.7 130.2 354.1 130.2 Z M 506.8 128.1 L 553.5 2.1 L 514 2.1 L 486.1 92.8 L 457.7 2.1 L 417 2.1 L 464.6 128.1 Z M 605.4 128.1 L 605.4 97.3 L 625.5 76.3 L 652.1 128.1 L 700 128.1 L 652.1 49.7 L 697.9 2.1 L 646.2 2.1 L 605.4 49.7 L 605.4 2.1 L 566.5 2.1 L 566.5 128.1 Z M 605.4 128.1"/></svg><span></span></div><nav class="app-switcher" aria-label="Applicatie wisselen"><a href="/" data-application-link="calculatie">Calculatie &amp; offerte</a><a href="/planning/" data-application-link="planning">Planning</a></nav><div class="account" id="account" hidden aria-label="Ingelogde gebruiker"><div class="account-meta"><span class="account-name" id="account-name"></span><span class="account-roles" id="account-roles"></span></div><form class="account-logout-form" action="/bff/logout" method="post"><button class="account-logout" type="submit">Uitloggen</button></form></div></div></div>`;
  header.querySelector('.brand span').textContent = holder.dataset.title;
  const active = header.querySelector('[data-application-link="' + application + '"]');
  if (active) active.setAttribute('aria-current', 'page');
  if (totals) header.querySelector('.bar').insertBefore(totals, header.querySelector('.account'));
  if (navigation) header.querySelector('.wrap').append(navigation);
  holder.replaceWith(header);

  function setAccount(name, roles) {
    header.querySelector('.account-name').textContent = name || 'Ingelogde gebruiker';
    header.querySelector('.account-roles').textContent = roles.length ? 'Rollen: ' + roles.join(', ') : 'Rollen: geen applicatierol gevonden';
    header.querySelector('.account').hidden = false;
  }
  window.VsvkHeader = { setAccount };

  if (holder.dataset.account !== 'external') {
    fetch('/bff/user', { credentials: 'same-origin' }).then(response => {
      if (!response.ok) return null;
      return response.json();
    }).then(user => {
      if (!user) return;
      const allowedRoles = new Set(['default-roles-vsvk', 'development', 'directie', 'finance', 'operationeel', 'planning']);
      const roles = [...new Set((Array.isArray(user.roles) ? user.roles : []).map(role => String(role).toLowerCase().trim()).filter(role => allowedRoles.has(role)))];
      setAccount(user.username || user.name, roles);
    }).catch(() => {});
  }
}());

