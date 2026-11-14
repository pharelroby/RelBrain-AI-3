/* ═══════════════════════════════════════════════════════════════════════════
   RELBRAIN — ÉCRAN DE CHARGEMENT + AIGUILLAGE MAINTENANCE
   Chargé en tout premier dans <head> : recouvre la page pendant que les
   styles et les données arrivent (utile sur connexion lente), puis vérifie
   si le site est en maintenance (interrupteur de la page administrateur).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var html = document.documentElement;
  var page = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '') || 'index';
  var TIPS = [
    'Réviser un peu chaque jour vaut mieux que tout la veille.',
    'Se tester mémorise mieux que relire.',
    'Une notion oubliée puis retrouvée reste plus longtemps.',
    'Dix minutes de flashcards suffisent à garder ta série.',
  ];
  var dark = false;
  try { var p = localStorage.getItem('rb-theme') || 'system'; dark = p === 'dark' || (p === 'system' && matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) {}

  var el = document.createElement('div');
  el.id = 'rb-splash';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', 'Chargement de RelBrain');
  el.innerHTML =
    '<style>' +
    '#rb-splash{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.1rem;padding:1.5rem;text-align:center;background:' + (dark ? '#14101f' : '#fdf4e8') + ';color:' + (dark ? '#ede9fe' : '#3b2a5a') + ';font-family:system-ui,-apple-system,"Segoe UI",sans-serif;transition:opacity .28s ease}' +
    '#rb-splash.out{opacity:0;pointer-events:none}' +
    '#rb-splash .in{display:flex;flex-direction:column;align-items:center;gap:1.1rem;opacity:0;animation:rbsIn .3s ease .18s forwards}' +
    '#rb-splash svg{width:76px;height:76px;overflow:visible}' +
    '#rb-splash .n{fill:#7c3aed;animation:rbsP 1.2s ease-in-out infinite}' +
    '#rb-splash .n.b{fill:#a855f7;animation-delay:.2s}#rb-splash .n.c{fill:#ec4899;animation-delay:.4s}#rb-splash .n.d{fill:#f59e0b;animation-delay:.6s}' +
    '#rb-splash .l{stroke:#c4b5fd;stroke-width:3;stroke-linecap:round;stroke-dasharray:60;animation:rbsL 1.2s ease-in-out infinite}' +
    '#rb-splash b{font-size:1.15rem;letter-spacing:-.01em}#rb-splash b i{font-style:normal;color:#7c3aed}' +
    '#rb-splash p{margin:0;font-size:.8rem;font-weight:600;max-width:20rem;opacity:.72;line-height:1.5}' +
    '@keyframes rbsIn{to{opacity:1}}@keyframes rbsP{0%,100%{transform:scale(.75);transform-origin:center;transform-box:fill-box}50%{transform:scale(1.15);transform-origin:center;transform-box:fill-box}}' +
    '@keyframes rbsL{0%{stroke-dashoffset:60}60%,100%{stroke-dashoffset:0}}' +
    '@media(prefers-reduced-motion:reduce){#rb-splash .n,#rb-splash .l{animation:none}}' +
    '</style>' +
    '<div class="in"><svg viewBox="0 0 80 80" aria-hidden="true"><path class="l" d="M16 24 40 14 64 28 54 58 24 60 16 24 M40 14 40 38 M64 28 40 38 M24 60 40 38"/>' +
    '<circle class="n" cx="16" cy="24" r="7"/><circle class="n b" cx="40" cy="14" r="7"/><circle class="n c" cx="64" cy="28" r="7"/><circle class="n d" cx="54" cy="58" r="7"/><circle class="n b" cx="24" cy="60" r="7"/><circle class="n" cx="40" cy="38" r="9"/></svg>' +
    '<b>RelBrain<i>.ai</i></b><p id="rb-splash-tip">' + TIPS[Math.floor(Math.random() * TIPS.length)] + '</p></div>';
  html.appendChild(el);

  var done = false;
  function hide() {
    if (done) return; done = true;
    el.classList.add('out');
    setTimeout(function () { el.remove(); }, 320);
  }
  var isPrivate = function () { return document.body && document.body.hasAttribute('data-rb-private'); };
  function ready() { return window.RB_CONFIG && window.RB_CONFIG.SUPABASE_URL && isPrivate(); }

  window.addEventListener('load', function () { if (!ready()) hide(); });
  document.addEventListener('rb:ready', hide);
  window.addEventListener('pageshow', function (e) { if (e.persisted) hide(); });
  // Connexion lente : on rassure, puis on rend la main quoi qu'il arrive
  setTimeout(function () { var t = document.getElementById('rb-splash-tip'); if (t && !done) t.textContent = 'Ta connexion est un peu lente, on y est presque…'; }, 5000);
  setTimeout(hide, 12000);

  /* ─── Maintenance ─── */
  var EXEMPT = ['relbrain-maintenance', 'relbrain-login', 'relbrain-admin', 'relbrain-forgot-password', 'relbrain-reset-password', '404'];
  function go(reason) {
    location.replace('relbrain-maintenance.html?' + (reason ? 'reason=' + reason + '&' : '') + 'from=' + encodeURIComponent(page + '.html' + location.search));
  }
  function apply(state) {
    if (state === 'on') {
      var admin = false;
      try { admin = localStorage.getItem('rb-admin') === '1'; } catch (e) {}
      if (!admin) go('');
    } else if (state === 'down' && isPrivate()) go('down');
    else if (state === 'offline' && isPrivate()) go('offline');
  }
  function check() {
    var c = window.RB_CONFIG;
    if (!c || !c.SUPABASE_URL || EXEMPT.indexOf(page) > -1) return;
    try {
      var hit = JSON.parse(sessionStorage.getItem('rb-gate') || 'null');
      if (hit && Date.now() - hit.at < 30000) return apply(hit.state);
    } catch (e) {}
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 8000);
    fetch(c.SUPABASE_URL + '/rest/v1/app_settings?id=eq.1&select=maintenance', { headers: { apikey: c.SUPABASE_ANON_KEY }, signal: ctl.signal })
      .then(function (r) {
        clearTimeout(timer);
        if (r.status >= 500) return 'down';
        if (!r.ok) return 'ok';
        return r.json().then(function (rows) { return rows[0] && rows[0].maintenance ? 'on' : 'ok'; });
      })
      .catch(function () { clearTimeout(timer); return navigator.onLine === false ? 'offline' : 'down'; })
      .then(function (state) {
        try { sessionStorage.setItem('rb-gate', JSON.stringify({ at: Date.now(), state: state })); } catch (e) {}
        apply(state);
      });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check); else check();
})();
