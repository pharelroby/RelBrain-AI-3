/* ═══════════════════════════════════════════════════════════════════════════
   RELBRAIN — MOTION · animations signature
   ───────────────────────────────────────────────────────────────────────────
   API publique (window.RB.motion) :
     reveal()                         active les révélations au scroll (auto)
     burst(target, opts)              Éclat de savoir (bonne réponse, succès)
     xp(amount, fromEl, opts)         +XP qui s'envole vers la jauge
     countUp(el, to, opts)            compteur qui défile
     levelUp(level, opts)             écran plein « Niveau supérieur »
     shake(el)                        erreur douce
     success(el)                      check qui se dessine + tampon
     thinking(el, messages)           l'IA réfléchit (synapse + messages)
     forgettingCurve(svg)             courbe de l'oubli animée
     skeleton(el, lines)              squelette de chargement
   Tout respecte prefers-reduced-motion.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var RB = (window.RB = window.RB || {});
  if (RB.motion) return;

  var reduce = function () {
    return (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ||
      document.documentElement.classList.contains('rb-reduce-motion');
  };
  var rand = function (a, b) { return a + Math.random() * (b - a); };
  var pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };

  function centerOf(target) {
    if (target && typeof target.x === 'number') return target;
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el || !el.getBoundingClientRect) return { x: innerWidth / 2, y: innerHeight / 2 };
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function layer() {
    var l = document.querySelector('.rb-burst-layer');
    if (!l) { l = document.createElement('div'); l.className = 'rb-burst-layer'; l.setAttribute('aria-hidden', 'true'); document.body.appendChild(l); }
    return l;
  }

  /* ── 1. Révélation à l'encre + surligneur + courbe (IntersectionObserver) ── */
  var io;
  function reveal(root) {
    root = root || document;
    if (!('IntersectionObserver' in window) || reduce()) {
      root.querySelectorAll('.rb-reveal,.rb-reveal--clip,.rb-reveal--scale').forEach(function (el) { el.classList.add('is-in'); });
      root.querySelectorAll('.rb-mark,.rb-scribble,.rb-curve').forEach(function (el) { el.classList.add('is-on'); });
      root.querySelectorAll('.reveal,.reveal-scale').forEach(function (el) { el.classList.add('in'); });
      return;
    }
    io = io || new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        // Visible, ou déjà dépassé vers le haut (saut d'ancre, défilement rapide)
        if (e.isIntersecting || e.boundingClientRect.bottom < 0) show(e.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });

    // Cascade : chaque enfant direct d'un [data-rb-stagger] reçoit un délai croissant
    root.querySelectorAll('[data-rb-stagger]').forEach(function (group) {
      var step = parseInt(group.getAttribute('data-rb-stagger'), 10) || 70;
      Array.prototype.forEach.call(group.children, function (child, i) {
        if (!/rb-reveal/.test(child.className)) child.classList.add('rb-reveal');
        child.style.setProperty('--rb-delay', (i * step) + 'ms');
      });
    });
    root.querySelectorAll('.rb-reveal,.rb-reveal--clip,.rb-reveal--scale,.rb-mark,.rb-scribble,.rb-curve,[data-rb-count]')
      .forEach(function (el) { io.observe(el); pending.add(el); });
    // Les pages historiques ont leur propre observer ; on ne double pas.
    if (!scrollBound) {
      scrollBound = true;
      window.addEventListener('scroll', sweep, { passive: true });
      window.addEventListener('resize', sweep, { passive: true });
      window.addEventListener('hashchange', function () { setTimeout(sweep, 50); });
    }
  }

  /* Filet de sécurité : un défilement rapide (ou un saut d'ancre) peut faire
     passer un bloc au-dessus de l'écran sans qu'il ait jamais « intersecté ».
     On révèle donc tout élément en attente déjà dépassé ou visible. */
  var pending = new Set(), scrollBound = false, ticking = false;
  function show(el) {
    if (el.matches('.rb-mark,.rb-scribble')) el.classList.add('is-on');
    else if (el.matches('.rb-curve')) { forgettingCurve(el); el.classList.add('is-on'); }
    else el.classList.add('is-in');
    if (el.hasAttribute('data-rb-count') && !el.__rbCounted) { el.__rbCounted = true; countUp(el, parseFloat(el.getAttribute('data-rb-count'))); }
    pending.delete(el);
    if (io) io.unobserve(el);
  }
  function sweep() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var limit = window.innerHeight * 0.92;
      pending.forEach(function (el) {
        if (!el.isConnected) { pending.delete(el); return; }
        if (el.getBoundingClientRect().top < limit) show(el);
      });
    });
  }

  /* ── 2. Ripple au clic sur les boutons ── */
  function attachRipple() {
    document.addEventListener('pointerdown', function (e) {
      var btn = e.target.closest && e.target.closest('.rb-btn, .gradient-bg, .btn-primary, .upgrade-btn');
      if (!btn || reduce() || btn.disabled) return;
      var r = btn.getBoundingClientRect();
      var size = Math.max(r.width, r.height) * 2.2;
      var s = document.createElement('span');
      s.className = 'rb-ripple';
      s.style.cssText = 'width:' + size + 'px;height:' + size + 'px;left:' + (e.clientX - r.left - size / 2) + 'px;top:' + (e.clientY - r.top - size / 2) + 'px';
      if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
      if (getComputedStyle(btn).overflow !== 'hidden') btn.style.overflow = 'hidden';
      btn.appendChild(s);
      setTimeout(function () { s.remove(); }, 600);
    }, { passive: true });
  }

  /* ── 3. Éclat de savoir ── */
  var GLYPHS = {
    knowledge: ['✦', 'π', '√', '∑', '★', 'A+', '∞', '✶', 'Δ', '✓'],
    stars: ['✦', '★', '✶', '✧'],
    streak: ['🔥', '✦', '★'],
  };
  var COLORS = ['#7c3aed', '#a855f7', '#ec4899', '#f59e0b', '#10b981'];
  function burst(target, opts) {
    opts = opts || {};
    if (reduce()) return;
    var c = centerOf(target);
    var n = opts.count || 14;
    var set = GLYPHS[opts.set || 'knowledge'];
    var spread = opts.spread || 140;
    var l = layer();
    for (var i = 0; i < n; i++) {
      var g = document.createElement('span');
      g.className = 'rb-glyph';
      g.textContent = pick(set);
      var angle = (Math.PI * 2 * i) / n + rand(-0.3, 0.3);
      var dist = rand(spread * 0.45, spread);
      var x1 = Math.cos(angle) * dist;
      var y1 = Math.sin(angle) * dist * 0.85 + rand(10, 40); // légère gravité
      g.style.cssText = [
        'left:' + c.x + 'px', 'top:' + c.y + 'px', 'color:' + pick(opts.colors || COLORS),
        'font-size:' + rand(14, 26).toFixed(0) + 'px',
        '--x0:-50%', '--y0:-50%',
        '--x1:calc(-50% + ' + x1.toFixed(0) + 'px)', '--y1:calc(-50% + ' + y1.toFixed(0) + 'px)',
        '--r:' + rand(-160, 160).toFixed(0) + 'deg', '--sc:' + rand(0.7, 1.2).toFixed(2),
        '--_d:' + rand(700, 1050).toFixed(0) + 'ms'
      ].join(';');
      l.appendChild(g);
      setTimeout(function (el) { el.remove(); }.bind(null, g), 1200);
    }
  }

  /* ── 4. Compteur ── */
  function countUp(el, to, opts) {
    opts = opts || {};
    if (!el) return;
    var from = opts.from != null ? opts.from : (parseFloat((el.textContent || '0').replace(/[^\d.-]/g, '')) || 0);
    var dur = opts.duration || 1100;
    var decimals = opts.decimals || 0;
    var suffix = opts.suffix != null ? opts.suffix : (el.getAttribute('data-rb-suffix') || '');
    var fmt = function (v) {
      return (decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString('fr-FR')) + suffix;
    };
    el.classList.add('rb-counter');
    if (reduce()) { el.textContent = fmt(to); return; }
    var t0 = performance.now();
    (function tick(now) {
      var p = Math.min((now - t0) / dur, 1);
      var e = 1 - Math.pow(1 - p, 4);
      el.textContent = fmt(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }

  /* ── 5. Gain d'XP : le nombre s'envole, la jauge se remplit ── */
  function xp(amount, fromEl, opts) {
    opts = opts || {};
    var c = centerOf(fromEl);
    if (!reduce()) {
      var f = document.createElement('div');
      f.className = 'rb-xp-float';
      f.textContent = '+' + amount + ' XP';
      f.style.left = c.x + 'px'; f.style.top = c.y + 'px';
      document.body.appendChild(f);
      setTimeout(function () { f.remove(); }, 1300);
      burst(c, { count: 8, set: 'stars', spread: 70 });
    }
    // Jauges et compteurs abonnés
    document.querySelectorAll('[data-rb-xp-total]').forEach(function (el) {
      var cur = parseFloat(el.getAttribute('data-rb-xp-total')) || 0;
      el.setAttribute('data-rb-xp-total', cur + amount);
      countUp(el, cur + amount, { from: cur });
    });
    document.querySelectorAll('.rb-xp-bar').forEach(function (bar) {
      bar.classList.remove('is-gaining'); void bar.offsetWidth; bar.classList.add('is-gaining');
      if (opts.progress != null) { var fill = bar.querySelector('.rb-xp-bar__fill'); if (fill) fill.style.setProperty('--p', opts.progress + '%'); }
    });
  }

  /* ── 6. Passage de niveau ── */
  var LEVEL_TITLES = ['Curieux·se', 'Apprenti·e', 'Explorateur·rice', 'Studieux·se', 'Stratège', 'Érudit·e', 'Maître des fiches', 'Virtuose', 'Sage', 'Légende'];
  function levelUp(level, opts) {
    opts = opts || {};
    var perks = opts.perks || ['+1 gel de série', 'Nouveau thème débloqué'];
    var title = opts.title || LEVEL_TITLES[Math.min(LEVEL_TITLES.length - 1, Math.floor((level - 1) / 3))];
    var wrap = document.createElement('div');
    wrap.className = 'rb-levelup';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Niveau ' + level + ' atteint');
    wrap.innerHTML =
      '<div class="rb-levelup__rays"></div>' +
      '<div class="rb-levelup__card">' +
        '<p class="rb-levelup__eyebrow">Niveau supérieur</p>' +
        '<p class="rb-levelup__num">' + level + '</p>' +
        '<p class="rb-levelup__title">' + title + '</p>' +
        '<div class="rb-levelup__perks">' + perks.map(function (p) { return '<span>' + p + '</span>'; }).join('') + '</div>' +
        '<button type="button" class="rb-btn rb-btn--paper rb-btn--block">Continuer</button>' +
      '</div>';
    document.body.appendChild(wrap);
    var btn = wrap.querySelector('button');
    var close = function () {
      wrap.classList.add('is-leaving');
      setTimeout(function () { wrap.remove(); }, 320);
      document.removeEventListener('keydown', onKey);
      if (opts.onClose) opts.onClose();
    };
    var onKey = function (e) { if (e.key === 'Escape') close(); };
    btn.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    setTimeout(function () { btn.focus(); }, 400);
    setTimeout(function () {
      var card = wrap.querySelector('.rb-levelup__num');
      burst(card, { count: 22, spread: 220 });
    }, 650);
    return close;
  }

  /* ── 7. Erreur douce & succès ── */
  function shake(el) {
    if (!el) return;
    el.classList.remove('rb-shake'); void el.offsetWidth; el.classList.add('rb-shake');
    setTimeout(function () { el.classList.remove('rb-shake'); }, 450);
  }
  function success(el, opts) {
    opts = opts || {};
    if (!el) return;
    el.innerHTML = '<svg class="rb-check-draw" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>' +
      (opts.stamp ? '<span class="rb-stamp" style="margin-top:.75rem">' + opts.stamp + '</span>' : '');
    if (opts.burst !== false) setTimeout(function () { burst(el, { count: 10 }); }, 650);
  }

  /* ── 8. L'IA réfléchit ── */
  function thinking(el, messages) {
    if (!el) return function () {};
    messages = messages || ['Lecture du document', 'Repérage des notions clés', 'Connexion des idées', 'Rédaction des questions'];
    el.innerHTML = '<div class="rb-thinking" role="status" aria-live="polite"><span class="rb-synapse"><i></i><i></i><i></i></span><span class="rb-thinking__text"></span></div>';
    var txt = el.querySelector('.rb-thinking__text');
    var i = 0;
    txt.textContent = messages[0];
    var timer = setInterval(function () { i = (i + 1) % messages.length; txt.textContent = messages[i]; }, 1800);
    return function stop() { clearInterval(timer); el.innerHTML = ''; };
  }

  /* ── 9. Courbe de l'oubli ──────────────────────────────────────────────
     <svg class="rb-curve" data-reviews="1,3,7,16" viewBox="0 0 600 260"></svg>
     data-reviews : jours de révision (sur 30 jours).                     */
  function forgettingCurve(svg) {
    if (!svg || svg.__rbCurve) return;
    svg.__rbCurve = true;
    var W = 600, H = 260, pad = { l: 44, r: 16, t: 18, b: 34 };
    var days = 30;
    var reviews = (svg.getAttribute('data-reviews') || '1,3,7,16').split(',').map(Number);
    var X = function (d) { return pad.l + (d / days) * (W - pad.l - pad.r); };
    var Y = function (r) { return pad.t + (1 - r) * (H - pad.t - pad.b); };
    // Sans révision : R(t) = e^(-t/S), S = 2.2 jours
    var forget = [];
    for (var d = 0; d <= days; d += 0.5) forget.push([X(d), Y(Math.exp(-d / 2.2))]);
    // Avec révisions : chaque révision remonte à 1 et multiplie la stabilité
    var learn = [], S = 2.2, last = 0, dots = [];
    for (var t = 0; t <= days; t += 0.25) {
      if (reviews.length && t >= reviews[0]) {
        var r0 = Math.exp(-(t - last) / S);
        learn.push([X(t), Y(r0)]);
        dots.push([X(t), Y(1), reviews[0]]);
        last = reviews.shift(); S *= 2.4; t = last;
      }
      learn.push([X(t), Y(Math.exp(-(t - last) / S))]);
    }
    var path = function (pts) { return 'M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L'); };
    var ns = 'http://www.w3.org/2000/svg';
    var grid = '';
    [0, .25, .5, .75, 1].forEach(function (v) {
      grid += '<line x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/>';
    });
    var labels = '';
    [0, 50, 100].forEach(function (v) { labels += '<text class="rb-curve__axis" x="' + (pad.l - 10) + '" y="' + (Y(v / 100) + 4) + '" text-anchor="end">' + v + '%</text>'; });
    [0, 7, 14, 21, 30].forEach(function (v) { labels += '<text class="rb-curve__axis" x="' + X(v) + '" y="' + (H - 10) + '" text-anchor="middle">J' + v + '</text>'; });
    var learnD = path(learn);
    var areaD = learnD + ' L' + X(days) + ' ' + Y(0) + ' L' + X(0) + ' ' + Y(0) + ' Z';
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('role', 'img');
    if (!svg.getAttribute('aria-label')) svg.setAttribute('aria-label', 'Courbe de l\'oubli : sans révision la mémoire chute en quelques jours ; chaque révision espacée la remonte durablement.');
    svg.innerHTML =
      '<defs><linearGradient id="rb-curve-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a855f7" stop-opacity=".22"/><stop offset="1" stop-color="#a855f7" stop-opacity="0"/></linearGradient></defs>' +
      '<g class="rb-curve__grid">' + grid + '</g>' + labels +
      '<path class="rb-curve__area" d="' + areaD + '"/>' +
      '<path class="rb-curve__forget" d="' + path(forget) + '" data-draw style="--d:.1s;--_dur:1.6s"/>' +
      '<path class="rb-curve__learn" d="' + learnD + '" data-draw style="--d:.6s;--_dur:2.6s"/>' +
      dots.map(function (p, i) {
        var delay = (0.6 + 2.6 * ((p[0] - pad.l) / (W - pad.l - pad.r))).toFixed(2);
        // Étiquettes courtes (jour de la révision), alternées pour ne pas se chevaucher
        return '<circle class="rb-curve__dot" cx="' + p[0] + '" cy="' + p[1] + '" r="6" style="--d:' + delay + 's"/>' +
          '<text class="rb-curve__label" x="' + p[0] + '" y="' + (p[1] - (i % 2 ? 26 : 12)) + '" text-anchor="middle" style="--d:' + delay + 's">J+' + p[2] + '</text>';
      }).join('') +
      '<text class="rb-curve__label" x="' + X(5.5) + '" y="' + Y(.12) + '" style="--d:1.2s;fill:var(--rb-muted)">sans révision</text>';
    svg.querySelectorAll('[data-draw]').forEach(function (p) {
      try { p.style.setProperty('--len', Math.ceil(p.getTotalLength())); } catch (e) { /* SVG pas encore rendu */ }
    });
    void ns;
  }

  /* ── 10. Squelettes ── */
  function skeleton(el, lines) {
    if (!el) return;
    lines = lines || 3;
    var html = '';
    for (var i = 0; i < lines; i++) html += '<div class="rb-skeleton rb-skeleton-line"></div>';
    el.innerHTML = html;
    el.setAttribute('aria-busy', 'true');
  }

  RB.motion = {
    reveal: reveal, burst: burst, xp: xp, countUp: countUp, levelUp: levelUp,
    shake: shake, success: success, thinking: thinking, forgettingCurve: forgettingCurve,
    skeleton: skeleton, reduce: reduce,
  };

  function boot() { reveal(); attachRipple(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
