/* ═══════════════════════════════════════════════════════════════════════════
   RELBRAIN — ÉCRAN DE CHARGEMENT + TRADUCTION + AIGUILLAGE MAINTENANCE
   Chargé en tout premier dans <head> :
   1. recouvre la page d'un écran animé (cahier, formules qui flottent, logo
      en orbite, astuces qui défilent, barre de progression) pendant que les
      styles et les données arrivent ;
   2. charge relbrain-i18n.js (traduction anglaise si la langue choisie est « en ») ;
   3. vérifie si le site est en maintenance (interrupteur de la salle des profs).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var html = document.documentElement;
  var page = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '') || 'index';

  /* ─── Langue + traduction ─── */
  var lang = 'fr';
  try { lang = localStorage.getItem('rb-lang') === 'en' ? 'en' : 'fr'; } catch (e) {}
  html.setAttribute('lang', lang);
  var gate = new Promise(function (r) { window.__rbI18nDone = r; });
  var i18n = document.createElement('script');
  i18n.src = '/relbrain-i18n.js?v=19da8e19e7';
  (document.head || html).appendChild(i18n);

  var TIPS = lang === 'en' ? [
    'A little revision every day beats everything the night before.',
    'Testing yourself sticks better than re-reading.',
    'A notion you forget and find again stays longer.',
    'Ten minutes of flashcards keeps your streak alive.',
    'Explain a lesson out loud: if you can teach it, you know it.',
    'Short breaks help your brain store what you just learned.',
  ] : [
    'Réviser un peu chaque jour vaut mieux que tout la veille.',
    'Se tester mémorise mieux que relire.',
    'Une notion oubliée puis retrouvée reste plus longtemps.',
    'Dix minutes de flashcards suffisent à garder ta série.',
    'Explique ton cours à voix haute : si tu sais l\'enseigner, tu le sais.',
    'Une courte pause aide ton cerveau à ranger ce que tu viens d\'apprendre.',
  ];
  var T = lang === 'en'
    ? { label: 'Loading RelBrain', did: 'Did you know?', slow: 'Your connection is a bit slow, almost there…', sub: 'Preparing your notebook' }
    : { label: 'Chargement de RelBrain', did: 'Le savais-tu ?', slow: 'Ta connexion est un peu lente, on y est presque…', sub: 'On prépare ton cahier' };

  var dark = false;
  try { var p = localStorage.getItem('rb-theme') || 'light'; dark = p === 'dark' || (p === 'system' && matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) {}
  var C = dark
    ? { bg: '#14101f', ink: '#ede9fe', soft: '#a99cc9', line: 'rgba(196,181,253,.08)', margin: 'rgba(236,72,153,.14)', card: 'rgba(255,255,255,.05)', glyph: 'rgba(196,181,253,.2)' }
    : { bg: '#fdf4e8', ink: '#2e1065', soft: '#7c6f99', line: 'rgba(124,58,237,.07)', margin: 'rgba(236,72,153,.18)', card: 'rgba(255,255,255,.7)', glyph: 'rgba(124,58,237,.16)' };

  var GLYPHS = ['π', '√x', '∑', 'x²', '∫', 'f′(x)', 'Δ', '∞', 'α', 'H₂O', 'E=mc²', '✦', 'sin θ', '½', 'λ', '★'];
  var glyphs = '';
  for (var g = 0; g < 16; g++) {
    var left = (g * 6.3 + (g % 3) * 7) % 96, dur = 9 + (g % 5) * 2.2, delay = -((g * 1.7) % dur), size = .9 + (g % 4) * .35;
    glyphs += '<span class="g" style="left:' + left + '%;font-size:' + size + 'rem;animation-duration:' + dur + 's;animation-delay:' + delay + 's">' + GLYPHS[g % GLYPHS.length] + '</span>';
  }

  var el = document.createElement('div');
  el.id = 'rb-splash';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', T.label);
  el.setAttribute('translate', 'no');
  el.innerHTML =
    '<style>' +
    '#rb-splash{position:fixed;inset:0;z-index:2147483000;overflow:hidden;display:flex;align-items:center;justify-content:center;background:' + C.bg + ';color:' + C.ink + ';font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;transition:opacity .45s ease,visibility .45s}' +
    '#rb-splash.out{opacity:0;visibility:hidden;pointer-events:none}' +
    '#rb-splash .paper{position:absolute;inset:0;background-image:repeating-linear-gradient(to bottom,transparent 0 33px,' + C.line + ' 33px 34px)}' +
    '#rb-splash .paper:after{content:"";position:absolute;top:0;bottom:0;left:clamp(1.5rem,8vw,6rem);width:2px;background:' + C.margin + '}' +
    '#rb-splash .blob{position:absolute;border-radius:50%;filter:blur(60px);opacity:' + (dark ? '.18' : '.22') + ';animation:rbsBlob 14s ease-in-out infinite}' +
    '#rb-splash .b1{width:26rem;height:26rem;background:#a855f7;left:-8rem;top:-8rem}' +
    '#rb-splash .b2{width:22rem;height:22rem;background:#ec4899;right:-7rem;bottom:-6rem;animation-delay:-5s}' +
    '#rb-splash .b3{width:16rem;height:16rem;background:#fbbf24;right:18%;top:-6rem;animation-delay:-9s;opacity:' + (dark ? '.18' : '.3') + '}' +
    '#rb-splash .g{position:absolute;bottom:-3rem;font-family:Georgia,"Times New Roman",serif;font-style:italic;font-weight:600;color:' + C.glyph + ';animation:rbsUp linear infinite;white-space:nowrap}' +
    '#rb-splash .in{position:relative;display:flex;flex-direction:column;align-items:center;gap:1rem;padding:1.5rem;text-align:center;opacity:0;animation:rbsIn .5s cubic-bezier(.2,.8,.2,1) .12s forwards}' +
    '#rb-splash .logo{position:relative;width:8.5rem;height:8.5rem;display:grid;place-items:center}' +
    '#rb-splash .glow{position:absolute;inset:1.2rem;border-radius:2rem;background:radial-gradient(circle,rgba(168,85,247,.55) 0%,transparent 70%);filter:blur(18px);animation:rbsGlow 2.4s ease-in-out infinite}' +
    '#rb-splash .ring{position:absolute;inset:0;border-radius:50%;border:2px dashed ' + (dark ? 'rgba(196,181,253,.28)' : 'rgba(124,58,237,.22)') + ';animation:rbsSpin 14s linear infinite}' +
    '#rb-splash .ring.r2{inset:-.9rem;border-style:solid;border-color:transparent;border-top-color:#a78bfa;border-right-color:rgba(167,139,250,.25);animation-duration:2.6s}' +
    '#rb-splash .orbit{position:absolute;inset:-.9rem;animation:rbsSpin 4.2s linear infinite}' +
    '#rb-splash .orbit i{position:absolute;width:.7rem;height:.7rem;border-radius:50%;box-shadow:0 0 12px currentColor}' +
    '#rb-splash .orbit i:nth-child(1){top:-.35rem;left:50%;margin-left:-.35rem;background:#a78bfa;color:#a78bfa}' +
    '#rb-splash .orbit i:nth-child(2){bottom:12%;left:4%;background:#a855f7;color:#a855f7;width:.55rem;height:.55rem}' +
    '#rb-splash .orbit i:nth-child(3){bottom:12%;right:4%;background:#c4b5fd;color:#c4b5fd;width:.5rem;height:.5rem}' +
    '#rb-splash .orbit.o2{inset:.4rem;animation-duration:6.5s;animation-direction:reverse}' +
    '#rb-splash .mark{position:relative;width:5.4rem;height:5.4rem;border-radius:1.5rem;box-shadow:0 18px 36px -12px rgba(91,33,182,.6);animation:rbsBob 2.4s ease-in-out infinite}' +
    '#rb-splash .spark{position:absolute;right:.4rem;top:.6rem;font-size:1.1rem;color:#c4b5fd;animation:rbsTwinkle 1.6s ease-in-out infinite}' +
    '#rb-splash .word{font-size:1.5rem;font-weight:900;letter-spacing:-.02em;display:flex}' +
    '#rb-splash .word span{display:inline-block;opacity:0;transform:translateY(8px);animation:rbsLetter .5s cubic-bezier(.2,.8,.2,1) forwards}' +
    '#rb-splash .word .ai{color:#7c3aed}' +
    '#rb-splash .sub{font-size:.72rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:' + C.soft + ';display:flex;align-items:center;gap:.45rem}' +
    '#rb-splash .dots i{display:inline-block;width:.32rem;height:.32rem;margin:0 .08rem;border-radius:50%;background:#7c3aed;animation:rbsDot 1.2s ease-in-out infinite}' +
    '#rb-splash .dots i:nth-child(2){animation-delay:.15s;background:#a855f7}#rb-splash .dots i:nth-child(3){animation-delay:.3s;background:#c4b5fd}' +
    '#rb-splash .bar{width:min(16rem,70vw);height:.42rem;border-radius:9px;background:' + (dark ? 'rgba(255,255,255,.08)' : 'rgba(124,58,237,.1)') + ';overflow:hidden;position:relative}' +
    '#rb-splash .bar b{position:absolute;inset:0 auto 0 0;width:8%;border-radius:9px;background:linear-gradient(90deg,#7c3aed,#a855f7);transition:width .4s ease}' +
    '#rb-splash .bar b:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.6),transparent);animation:rbsShine 1.2s linear infinite}' +
    '#rb-splash .tip{max-width:21rem;min-height:3.6rem;padding:.75rem 1rem;border-radius:1rem;background:' + C.card + ';border:1px solid ' + (dark ? 'rgba(255,255,255,.08)' : 'rgba(124,58,237,.12)') + ';backdrop-filter:blur(6px);box-shadow:0 10px 30px -18px rgba(46,16,101,.35)}' +
    '#rb-splash .tip small{display:block;font-size:.62rem;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:#7c3aed;margin-bottom:.2rem}' +
    '#rb-splash .tip p{margin:0;font-size:.84rem;font-weight:650;line-height:1.45;color:' + C.ink + ';transition:opacity .35s,transform .35s}' +
    '#rb-splash .tip p.swap{opacity:0;transform:translateY(6px)}' +
    '#rb-splash.out .mark{transform:scale(1.25);transition:transform .45s cubic-bezier(.2,.8,.2,1)}' +
    '@keyframes rbsIn{to{opacity:1}}' +
    '@keyframes rbsBlob{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(3rem,2rem) scale(1.1)}66%{transform:translate(-2rem,1rem) scale(.92)}}' +
    '@keyframes rbsUp{0%{transform:translateY(0) rotate(-6deg);opacity:0}10%{opacity:1}90%{opacity:1}100%{transform:translateY(-115vh) rotate(8deg);opacity:0}}' +
    '@keyframes rbsSpin{to{transform:rotate(360deg)}}' +
    '@keyframes rbsGlow{0%,100%{opacity:.55;transform:scale(.9)}50%{opacity:.95;transform:scale(1.08)}}' +
    '@keyframes rbsBob{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-6px) rotate(-3deg)}}' +
    '@keyframes rbsTwinkle{0%,100%{opacity:.3;transform:scale(.7) rotate(0)}50%{opacity:1;transform:scale(1.15) rotate(25deg)}}' +
    '@keyframes rbsLetter{to{opacity:1;transform:none}}' +
    '@keyframes rbsDot{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-4px);opacity:1}}' +
    '@keyframes rbsShine{from{transform:translateX(-100%)}to{transform:translateX(100%)}}' +
    '@media(prefers-reduced-motion:reduce){#rb-splash *{animation:none!important}#rb-splash .in,#rb-splash .word span{opacity:1;transform:none}}' +
    '</style>' +
    '<div class="paper"></div><span class="blob b1"></span><span class="blob b2"></span>' + glyphs +
    '<div class="in">' +
      '<div class="logo"><span class="glow"></span><span class="ring"></span><span class="ring r2"></span>' +
        '<span class="orbit"><i></i><i></i><i></i></span><span class="orbit o2"><i></i></span>' +
        '<img class="mark" src="/icon.svg" alt="" width="86" height="86"/><span class="spark">✦</span></div>' +
      '<div class="word">' + 'RelBrain'.split('').map(function (ch, i) { return '<span style="animation-delay:' + (.25 + i * .05) + 's">' + ch + '</span>'; }).join('') +
        '<span class="ai" style="animation-delay:.7s">.AI</span></div>' +
      '<div class="sub">' + T.sub + ' <span class="dots"><i></i><i></i><i></i></span></div>' +
      '<div class="bar"><b id="rb-splash-bar"></b></div>' +
      '<div class="tip"><small>💡 ' + T.did + '</small><p id="rb-splash-tip"></p></div>' +
    '</div>';
  html.appendChild(el);

  /* Astuces qui défilent + barre qui avance */
  var tipEl = el.querySelector('#rb-splash-tip'), bar = el.querySelector('#rb-splash-bar');
  var ti = Math.floor(Math.random() * TIPS.length), pct = 8;
  tipEl.textContent = TIPS[ti];
  var tipTimer = setInterval(function () {
    tipEl.classList.add('swap');
    setTimeout(function () { ti = (ti + 1) % TIPS.length; tipEl.textContent = TIPS[ti]; tipEl.classList.remove('swap'); }, 350);
  }, 3200);
  var barTimer = setInterval(function () { pct += (92 - pct) * .12; bar.style.width = pct.toFixed(1) + '%'; }, 260);

  var done = false, t0 = Date.now();
  function reallyHide() {
    if (done) return;
    // On laisse l'animation se voir un instant, même sur une connexion rapide
    var wait = 700 - (Date.now() - t0);
    if (wait > 0) return setTimeout(reallyHide, wait);
    done = true;
    clearInterval(tipTimer); clearInterval(barTimer);
    bar.style.width = '100%';
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 500); }, 180);
  }
  function hide() {
    // En anglais, on attend que la page soit traduite (au plus 3 s)
    if (lang !== 'en') return reallyHide();
    Promise.race([gate, new Promise(function (r) { setTimeout(r, 3000); })]).then(reallyHide);
  }
  var isPrivate = function () { return document.body && document.body.hasAttribute('data-rb-private'); };
  function ready() { return window.RB_CONFIG && window.RB_CONFIG.SUPABASE_URL && isPrivate(); }

  window.addEventListener('load', function () { if (!ready()) hide(); });
  document.addEventListener('rb:ready', hide);
  window.addEventListener('pageshow', function (e) { if (e.persisted) reallyHide(); });
  // Connexion lente : on rassure, puis on rend la main quoi qu'il arrive
  setTimeout(function () { if (!done) { clearInterval(tipTimer); tipEl.textContent = T.slow; } }, 7000);
  setTimeout(reallyHide, 14000);

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
