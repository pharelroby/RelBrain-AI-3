/* ═══════════════════════════════════════════════════════════════════════════
   RELBRAIN — THÈME (clair / sombre / système) + toasts unifiés
   ───────────────────────────────────────────────────────────────────────────
   API : RB.getTheme() · RB.setTheme('light'|'dark'|'system') · RB.toggleTheme()
         RB.toast(message, 'info'|'success'|'error')
   Par défaut : thème CLAIR (le sombre ne s'active que si l'élève le choisit).
   La préférence est stockée dans localStorage['rb-theme'] ; un script inline
   dans <head> l'applique avant le premier rendu (pas de flash).
   Ce fichier charge aussi relbrain-motion.js s'il n'est pas déjà présent.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var RB = (window.RB = window.RB || {});
  var KEY = 'rb-theme';
  var SELF = (document.currentScript && document.currentScript.src) || '';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function stored() { try { return localStorage.getItem(KEY) || 'light'; } catch (e) { return 'light'; } }
  function isDark(pref) { return pref === 'dark' || (pref === 'system' && mq && mq.matches); }

  function apply(pref) {
    var dark = isDark(pref);
    document.documentElement.classList.toggle('dark', dark);
    document.querySelectorAll('.rb-theme-icon').forEach(function (i) {
      i.classList.toggle('fa-moon', !dark);
      i.classList.toggle('fa-sun', dark);
    });
    document.querySelectorAll('.rb-theme-toggle').forEach(function (b) {
      b.setAttribute('aria-label', dark ? 'Passer en mode clair' : 'Passer en mode sombre');
      b.setAttribute('title', dark ? 'Mode clair' : 'Mode sombre');
    });
    try { document.dispatchEvent(new CustomEvent('rb:theme', { detail: { theme: pref, dark: dark } })); } catch (e) {}
  }

  RB.getTheme = stored;
  RB.setTheme = function (pref) {
    if (['light', 'dark', 'system'].indexOf(pref) < 0) pref = 'system';
    try { localStorage.setItem(KEY, pref); } catch (e) {}
    apply(pref);
  };
  RB.toggleTheme = function () {
    RB.setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
  };
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (stored() === 'system') apply('system'); });

  /* Toast unifié (les pages historiques gardent leur toast(), qui reçoit le
     même style via le design system) */
  RB.toast = function (msg, type) {
    type = type || 'info';
    var host = document.getElementById('rb-toast-host');
    if (!host) { host = document.createElement('div'); host.id = 'rb-toast-host'; document.body.appendChild(host); }
    host.setAttribute('aria-live', 'polite');
    var bg = { info: 'background:var(--rb-ink);color:#fff', success: 'background:var(--rb-emerald);color:#fff', error: 'background:var(--rb-rose);color:#fff' }[type];
    var icon = { info: 'fa-circle-info', success: 'fa-circle-check', error: 'fa-circle-exclamation' }[type];
    var el = document.createElement('div');
    el.className = 'rb-toast rb-toast--' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.style.cssText = bg;
    el.innerHTML = '<i class="fa-solid ' + icon + '"></i><span></span>';
    el.querySelector('span').textContent = msg;
    host.appendChild(el);
    setTimeout(function () { el.classList.add('rb-toast--leaving'); setTimeout(function () { el.remove(); }, 300); }, type === 'error' ? 4500 : 3200);
    return el;
  };

  function boot() {
    apply(stored());
    if (!window.RB.motion && !document.querySelector('script[src*="relbrain-motion.js"]')) {
      var s = document.createElement('script');
      s.src = SELF ? SELF.replace(/relbrain-theme\.js.*$/, 'relbrain-motion.js') : 'relbrain-motion.js';
      s.defer = true;
      document.head.appendChild(s);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
