(() => {
  'use strict';
  let visible = 0;
  function show() {
    document.documentElement.setAttribute('data-vsvk-loading', 'true');
    document.querySelector('[data-vsvk-loading-status]').textContent = 'Gegevens laden…';
  }
  function hide() {
    document.documentElement.removeAttribute('data-vsvk-loading');
    document.querySelector('[data-vsvk-loading-status]').textContent = '';
  }
  window.VsvkLoading = {
    begin() {
      let finished = false;
      let shown = false;
      const timer = setTimeout(() => { shown = true; visible++; show(); }, 350);
      return () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (shown && --visible === 0) hide();
      };
    }
  };
})();
