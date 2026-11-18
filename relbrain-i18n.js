/* ═══════════════════════════════════════════════════════════════════════════
   RELBRAIN — TRADUCTION FRANÇAIS → ANGLAIS DE TOUT LE SITE
   ───────────────────────────────────────────────────────────────────────────
   · Le site est écrit en français. Quand la langue choisie est « en », ce
     script remplace chaque texte par sa traduction, y compris les textes
     ajoutés plus tard (messages, fenêtres, listes chargées depuis Supabase).
   · Le dictionnaire est dans i18n/en.json. Il se génère tout seul :
         npm run i18n
     (relit toutes les pages, trouve les nouveaux textes et les traduit).
   · Corriger une traduction à la main : i18n/en.manual.json
         { "Texte français exact": "My English text" }
     puis relancer npm run i18n.
   · Ne pas traduire un élément : ajoute-lui translate="no".
   · Choix de la langue : bouton FR / EN dans l'en-tête, ou Paramètres → Langue.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var VERSION = '74569acd83'; // remplacé par npm run i18n
  var INLINE = { A: 1, ABBR: 1, B: 1, BR: 1, CODE: 1, EM: 1, I: 1, KBD: 1, MARK: 1, S: 1, SMALL: 1, SPAN: 1, STRONG: 1, SUB: 1, SUP: 1, U: 1, TIME: 1, SVG: 1, IMG: 1, LABEL: 1 };
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, PRE: 1, svg: 1, SVG: 1, TEMPLATE: 1, IFRAME: 1, CANVAS: 1 };
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-tip'];
  var LETTERS = /[A-Za-zÀ-ÿ]{2}/;

  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

  /* Éléments à ne jamais traduire : contenu des élèves, réponses de l'IA, saisies */
  function skipped(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentNode) {
      if (SKIP[e.tagName]) return true;
      if (e.getAttribute('translate') === 'no' || e.hasAttribute('data-no-i18n') || e.getAttribute('contenteditable') === 'true') return true;
      var c = e.className && e.className.baseVal === undefined ? ' ' + e.className + ' ' : '';
      if (c.indexOf(' notranslate ') > -1) return true;
      if (c.indexOf(' chat-msg ') > -1 && c.indexOf(' chat-locked ') < 0) return true;
      var rb = e.getAttribute('data-rb');
      if (rb === 'name' || rb === 'email' || rb === 'avatar') return true;
    }
    return false;
  }

  function textOf(n) { return norm(n.textContent || ''); }
  function inlineOnly(el) {
    var all = el.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      if (INLINE[all[i].tagName.toUpperCase()]) continue;
      if (all[i].closest && all[i].closest('svg')) continue; // dessins des icônes
      return false;
    }
    return true;
  }
  /* Un « bloc » : du texte + des balises en ligne avec du texte (ex. « Le <mark>tri</mark> choisit… »).
     On le traduit d'un seul tenant pour garder l'ordre des mots de la phrase. */
  function isUnit(el) {
    if (!el || el.nodeType !== 1 || SKIP[el.tagName]) return false;
    var text = false, rich = false;
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { if (LETTERS.test(n.nodeValue)) text = true; }
      else if (n.nodeType === 1) {
        if (!INLINE[n.tagName.toUpperCase()]) return false;
        if (LETTERS.test(n.textContent || '')) rich = true;
      }
    }
    return text && rich && inlineOnly(el);
  }
  function safe(s) { return s.replace(/</g, '＜').replace(/>/g, '＞'); }
  function plain(s) { return s.replace(/＜/g, '<').replace(/＞/g, '>'); }
  function unitParts(el) {
    var parts = [], key = '';
    for (var n = el.firstChild; n; n = n.nextSibling) {
      // « < » et « > » écrits dans le texte deviennent ＜ ＞ pour ne pas être confondus avec les repères <0>
      if (n.nodeType === 3) key += safe(n.nodeValue);
      else if (n.nodeType === 1) {
        var i = parts.push(n) - 1, t = textOf(n);
        key += t && LETTERS.test(t) ? '<' + i + '>' + safe(t) + '</' + i + '>' : '<' + i + '/>';
      }
    }
    return { key: norm(key), parts: parts };
  }

  /* ─── Recherche d'une traduction ─── */
  var D = null, PATTERNS = null, PREFIXES = null;
  function compile() {
    PATTERNS = []; PREFIXES = {};
    Object.keys(D.d).forEach(function (k) {
      if (/\{\d+\}/.test(k) && LETTERS.test(k.replace(/\{\d+\}/g, ''))) {
        var src = '^' + k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{(\d+)\\?\}/g, '(.+?)') + '$';
        try { PATTERNS.push({ re: new RegExp(src), order: (k.match(/\{(\d+)\}/g) || []).map(function (x) { return +x.slice(1, -1); }), en: D.d[k] }); } catch (e) {}
      }
    });
    (D.p || []).forEach(function (k) { PREFIXES[k] = 1; });
  }
  function tr(t, depth) {
    if (!t || !LETTERS.test(t)) return null;
    var d = D.d;
    if (Object.prototype.hasOwnProperty.call(d, t)) return d[t];
    depth = depth || 0;
    if (depth > 2) return null;
    // Emoji, ponctuation ou chiffres autour : « 🔥 Série du jour ! »
    var m = t.match(/^([^A-Za-zÀ-ÿ]*)([\s\S]*?)([^A-Za-zÀ-ÿ]*)$/);
    if (m && (m[1] || m[3]) && m[2] && Object.prototype.hasOwnProperty.call(d, m[2])) return m[1] + d[m[2]] + m[3];
    // Nombres variables : « 12 épreuves disponibles » ↔ « {0} épreuves disponibles »
    var nums = [];
    var p = t.replace(/\d+(?:[   .,]\d+)*/g, function (x) { nums.push(x); return '{' + (nums.length - 1) + '}'; });
    if (nums.length && Object.prototype.hasOwnProperty.call(d, p)) return d[p].replace(/\{(\d+)\}/g, function (_, i) { return nums[i] != null ? nums[i] : ''; });
    // Modèles avec des mots variables : « Concours {0} »
    for (var i = 0; i < PATTERNS.length; i++) {
      var r = PATTERNS[i].re.exec(t);
      if (r) {
        var vals = PATTERNS[i].order.map(function (_, j) { var v = r[j + 1]; return tr(v, depth + 1) || v; });
        var map = {}; PATTERNS[i].order.forEach(function (n, j) { map[n] = vals[j]; });
        return PATTERNS[i].en.replace(/\{(\d+)\}/g, function (_, n) { return map[n] != null ? map[n] : ''; });
      }
    }
    // Début de phrase connu : « Bonjour Pharel » → « Hello Pharel »
    var words = t.split(' ');
    for (var k = Math.min(words.length - 1, 4); k >= 1; k--) {
      var head = words.slice(0, k).join(' ');
      if (PREFIXES[head]) { var rest = words.slice(k).join(' '); return d[head] + ' ' + (tr(rest, depth + 1) || rest); }
    }
    if (m && (m[1] || m[3]) && m[2] && m[2] !== t) { var inner = tr(m[2], depth + 1); if (inner) return m[1] + inner + m[3]; }
    return null;
  }

  /* ─── Application au DOM ─── */
  var mine = typeof WeakMap === 'function' ? new WeakMap() : null; // nœud → valeur posée par nous
  var misses = {};
  function miss(t) { if (t && LETTERS.test(t) && !misses[t]) { misses[t] = 1; } }

  function doText(node) {
    var v = node.nodeValue;
    if (!v || (mine && mine.get(node) === v)) return;
    var t = norm(v);
    if (!LETTERS.test(t)) return;
    var en = tr(t);
    if (en == null) return miss(t);
    var lead = /^\s/.test(v) ? ' ' : '', trail = /\s$/.test(v) ? ' ' : '';
    node.nodeValue = lead + en + trail;
    if (mine) mine.set(node, node.nodeValue);
  }
  function doAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = el.getAttribute(a);
      if (!v || !LETTERS.test(v)) continue;
      if (mine && mine.get(el) && mine.get(el)[a] === v) continue;
      var en = tr(norm(v));
      if (en == null) { miss(norm(v)); continue; }
      el.setAttribute(a, en);
      if (mine) { var o = mine.get(el) || {}; o[a] = en; mine.set(el, o); }
    }
  }
  function setOne(node, text) {
    // Remplace le texte d'un élément en ligne sans toucher à ses icônes
    if (!node.firstElementChild) { node.textContent = text; return; }
    var w = node.ownerDocument.createTreeWalker(node, 4), list = [], n;
    while ((n = w.nextNode())) if (LETTERS.test(n.nodeValue)) list.push(n);
    if (list.length === 1) list[0].nodeValue = text;
  }
  function doUnit(el) {
    var u = unitParts(el);
    if (mine && mine.get(el) === u.key) return true;
    var en = Object.prototype.hasOwnProperty.call(D.d, u.key) ? D.d[u.key] : null;
    if (en == null) { miss(u.key); return false; }
    var doc = el.ownerDocument, out = [], last = 0, re = /<(\d+)\/>|<(\d+)>([\s\S]*?)<\/\2>/g, m;
    while ((m = re.exec(en))) {
      if (m.index > last) out.push(doc.createTextNode(plain(en.slice(last, m.index))));
      var part = u.parts[+(m[1] || m[2])];
      if (part) { if (m[2]) setOne(part, plain(m[3])); out.push(part); }
      last = re.lastIndex;
    }
    if (last < en.length) out.push(doc.createTextNode(plain(en.slice(last))));
    while (el.firstChild) el.removeChild(el.firstChild);
    out.forEach(function (n) { el.appendChild(n); });
    if (mine) {
      mine.set(el, unitParts(el).key);
      out.forEach(function (n) { if (n.nodeType === 3) mine.set(n, n.nodeValue); });
    }
    u.parts.forEach(function (p) { if (p.nodeType === 1) doAttrs(p); });
    return true;
  }
  function walk(node) {
    if (!node) return;
    if (node.nodeType === 3) {
      var parent = node.parentNode;
      if (!parent || parent.nodeType !== 1 || skipped(parent)) return;
      if (isUnit(parent)) { if (doUnit(parent)) return; }
      return doText(node);
    }
    if (node.nodeType !== 1 || skipped(node)) return;
    doAttrs(node);
    if (isUnit(node) && doUnit(node)) return;
    for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
  }

  /* ─── Langue choisie ─── */
  function getLang() {
    try { var l = localStorage.getItem('rb-lang'); if (l === 'en' || l === 'fr') return l; } catch (e) {}
    return 'fr';
  }
  var lang = getLang();

  var api = {
    lang: lang,
    norm: norm, isUnit: isUnit, unitParts: unitParts, skipped: skipped, LETTERS: LETTERS, ATTRS: ATTRS,
    /* Choisir la langue : enregistre, met à jour le profil si connecté, recharge la page */
    set: function (l, opts) {
      if (l !== 'en' && l !== 'fr') return;
      try { localStorage.setItem('rb-lang', l); } catch (e) {}
      var done = function () { if (!opts || opts.reload !== false) location.reload(); };
      try {
        if (root.RB && root.RB.sb && root.RB.data && root.RB.data.updateProfile && !root.RB.demo) {
          return root.RB.auth.session().then(function (s) { return s ? root.RB.data.updateProfile({ language: l }) : null; }).catch(function () {}).then(done);
        }
      } catch (e) {}
      done();
    },
    /* Au chargement du profil : la langue du compte s'applique si aucun choix local n'existe */
    syncProfile: function (profileLang) {
      var local = null;
      try { local = localStorage.getItem('rb-lang'); if (sessionStorage.getItem('rb-i18n-test')) return; } catch (e) {}
      if (!profileLang) return;
      if (!local) { if (profileLang !== lang) { try { localStorage.setItem('rb-lang', profileLang); } catch (e) {} location.reload(); } }
      else if (local !== profileLang && root.RB && root.RB.data) root.RB.data.updateProfile({ language: local }).catch(function () {});
    },
    t: function (s) { return lang === 'en' && D ? (tr(norm(s)) || s) : s; },
    misses: function () { return Object.keys(misses); },
    translate: function (node) { if (D) walk(node || document.body); },
  };
  root.RB_I18N = api;

  /* Utilisé aussi par scripts/i18n.js (Node) pour relever les textes : pas de DOM réel ici */
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  var html = document.documentElement;
  html.setAttribute('lang', lang);

  /* Bouton FR / EN ajouté à côté du bouton de thème (en-têtes du site et de l'application) */
  function mountToggle() {
    var slots = document.querySelectorAll('.rb-theme-toggle, [data-rb-lang-slot]');
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      var nav = !s.hasAttribute('data-rb-lang-slot') && s.closest && s.closest('.rb-site-nav');
      if (nav && nav.querySelector('[data-rb-lang-slot]')) continue; // en-tête du site : le bouton a sa propre place
      if (s.previousElementSibling && s.previousElementSibling.classList.contains('rb-lang-toggle')) continue;
      if (s.hasAttribute('data-rb-lang-slot') && s.querySelector('.rb-lang-toggle')) continue;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rb-lang-toggle ' + (s.hasAttribute('data-rb-lang-slot') ? '' : s.className.replace('rb-theme-toggle', ''));
      b.setAttribute('translate', 'no');
      b.setAttribute('aria-label', lang === 'en' ? 'Passer en français' : 'Switch to English');
      b.title = b.getAttribute('aria-label');
      b.innerHTML = '<span class="rb-lang-toggle__in"><span class="' + (lang === 'fr' ? 'on' : '') + '">FR</span><span class="' + (lang === 'en' ? 'on' : '') + '">EN</span></span>';
      b.onclick = function () { api.set(lang === 'en' ? 'fr' : 'en'); };
      if (s.hasAttribute('data-rb-lang-slot')) s.appendChild(b); else s.parentNode.insertBefore(b, s);
    }
  }
  var css = document.createElement('style');
  css.textContent = '.rb-lang-toggle{display:inline-flex;align-items:center;justify-content:center;cursor:pointer;background:none;border:0;padding:0 .2rem;min-width:2.6rem}' +
    '.rb-lang-toggle__in{display:inline-flex;border:1.5px solid var(--rb-line,#e7d9c5);border-radius:999px;padding:2px;background:var(--rb-surface,#fff);font:800 .62rem/1 system-ui,sans-serif;letter-spacing:.04em}' +
    '.rb-lang-toggle__in span{padding:.28rem .42rem;border-radius:999px;color:var(--rb-muted,#78716c);transition:background .2s,color .2s}' +
    '.rb-lang-toggle__in span.on{background:var(--rb-violet,#7c3aed);color:#fff}' +
    '.rb-lang-toggle:hover .rb-lang-toggle__in{border-color:var(--rb-violet-300,#c4b5fd)}';
  (document.head || html).appendChild(css);

  function onDom(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  onDom(function () {
    mountToggle();
    new MutationObserver(function () { mountToggle(); }).observe(document.body, { childList: true, subtree: true });
  });

  function release() { if (root.__rbI18nDone) root.__rbI18nDone(); }
  if (lang !== 'en') { root.__rbI18nReady = Promise.resolve(); release(); return; }

  /* ─── Mode anglais : chargement du dictionnaire (gardé en cache dans le navigateur) ─── */
  var CACHE = 'rb-i18n-en';
  function load() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE) || 'null');
      if (c && c.v === VERSION && c.d) return Promise.resolve(c);
    } catch (e) {}
    return fetch('/i18n/en.json?v=' + VERSION).then(function (r) { if (!r.ok) throw new Error('i18n ' + r.status); return r.json(); })
      .then(function (j) { try { localStorage.setItem(CACHE, JSON.stringify(j)); } catch (e) {} return j; });
  }

  // Dates en anglais (les pages demandent toLocaleDateString('fr-FR'))
  ['toLocaleDateString', 'toLocaleString', 'toLocaleTimeString'].forEach(function (fn) {
    var orig = Date.prototype[fn];
    Date.prototype[fn] = function (loc, o) { return orig.call(this, !loc || /^fr/i.test(String(loc)) ? 'en-GB' : loc, o); };
  });
  if (root.Intl && Intl.DateTimeFormat) {
    var DTF = Intl.DateTimeFormat;
    var Wrapped = function (loc, o) { return new DTF(!loc || /^fr/i.test(String(loc)) ? 'en-GB' : loc, o); };
    Wrapped.prototype = DTF.prototype; Wrapped.supportedLocalesOf = DTF.supportedLocalesOf;
    try { Intl.DateTimeFormat = Wrapped; } catch (e) {}
  }
  // Boîtes de dialogue natives
  ['alert', 'confirm', 'prompt'].forEach(function (fn) {
    var orig = root[fn];
    if (orig) root[fn] = function (msg) { var a = [].slice.call(arguments); if (D && typeof msg === 'string') a[0] = tr(norm(msg)) || msg; return orig.apply(root, a); };
  });

  root.__rbI18nReady = load().then(function (j) {
    D = j; compile();
    return new Promise(function (res) {
      onDom(function () {
        walk(document.body);
        var t = tr(norm(document.title)); if (t) document.title = t;
        new MutationObserver(function (list) {
          for (var i = 0; i < list.length; i++) {
            var r = list[i];
            if (r.type === 'childList') for (var k = 0; k < r.addedNodes.length; k++) walk(r.addedNodes[k]);
            else if (r.type === 'characterData') walk(r.target);
            else if (r.type === 'attributes') { if (!skipped(r.target)) doAttrs(r.target); }
          }
        }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
        var titleEl = document.querySelector('title');
        if (titleEl) new MutationObserver(function () { var x = tr(norm(document.title)); if (x && x !== document.title) document.title = x; }).observe(titleEl, { childList: true, characterData: true, subtree: true });
        res();
      });
    });
  }).catch(function (e) { console.warn('[RelBrain] traduction indisponible', e); }).then(release);
})(typeof window !== 'undefined' ? window : globalThis);
