/* ═══════════════════════════════════════════════════════════════════════════
   RELBRAIN — EN-TÊTE ET PIED DE PAGE DES PAGES PUBLIQUES
   ───────────────────────────────────────────────────────────────────────────
   Une seule source pour la navigation du site vitrine : chaque page déclare
     <header data-rb-site-header></header> … <footer data-rb-site-footer></footer>
   et ce script les remplit (liens actifs, menu mobile, état connecté).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var page = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '') || 'index';

  /* 🔗 Liens officiels des communautés — à remplacer par les vrais liens
     (utilisés aussi par relbrain-communautes.html via RB.SOCIAL). */
  var SOCIAL = (window.RB = window.RB || {}).SOCIAL = {
    discord: 'https://discord.gg/NFGe3Pann',
    whatsappChannel: 'https://whatsapp.com/channel/0029VbDJjJLB4hdap5a3mK2g',
    whatsappGroup: 'https://chat.whatsapp.com/relbrain',
    tiktok: 'https://www.tiktok.com/@relbrain',
    instagram: 'https://www.instagram.com/relbrain',
    youtube: 'https://www.youtube.com/@relbrain',
  };

  var LINKS = [
    { href: 'index.html#features', label: 'Fonctionnalités', match: [] },
    { href: 'index.html#pricing', label: 'Tarifs', match: [] },
    { href: 'relbrain-blog.html', label: 'Blog', match: ['relbrain-blog', 'relbrain-article'] },
    { href: 'relbrain-documentation.html', label: 'Guide', match: ['relbrain-documentation', 'relbrain-support'] },
    { href: 'relbrain-communautes.html', label: 'Communauté', match: ['relbrain-communautes'] },
  ];

  var LOGO =
    '<a href="index.html" class="rb-logo" aria-label="RelBrain, accueil">' +
      '<img class="rb-logo__img" src="/icon.svg" alt="" width="36" height="36"/>' +
      '<span class="rb-logo__word">RelBrain<b>.AI</b></span>' +
    '</a>';

  function header(el) {
    el.className = 'rb-site-nav';
    el.innerHTML =
      '<div class="rb-site-nav__inner">' + LOGO +
        '<button class="rb-site-burger" aria-label="Ouvrir le menu" aria-expanded="false" aria-controls="rb-site-links"><i class="fa-solid fa-bars"></i></button>' +
        '<nav class="rb-site-links" id="rb-site-links" aria-label="Navigation principale">' +
          LINKS.map(function (l) {
            var current = l.match.indexOf(page) > -1;
            return '<a class="rb-site-link" href="' + l.href + '"' + (current ? ' aria-current="page"' : '') + '>' + l.label + '</a>';
          }).join('') +
          '<button type="button" class="rb-theme-toggle rb-site-link" onclick="RB.toggleTheme()" aria-label="Changer de thème"><i class="rb-theme-icon fa-solid fa-moon"></i></button>' +
          '<a class="rb-site-link" href="relbrain-login.html" data-rb-guest>Connexion</a>' +
          '<a class="rb-btn rb-btn--ink rb-btn--sm" href="relbrain-signup.html" data-rb-guest-cta>Essai gratuit <i class="fa-solid fa-arrow-right"></i></a>' +
        '</nav>' +
        '<span class="rb-site-lang" data-rb-lang-slot></span>' +
      '</div>';
    var burger = el.querySelector('.rb-site-burger'), links = el.querySelector('.rb-site-links');
    burger.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      burger.setAttribute('aria-expanded', open);
      burger.innerHTML = open ? '<i class="fa-solid fa-xmark"></i>' : '<i class="fa-solid fa-bars"></i>';
    });
    links.addEventListener('click', function (e) { if (e.target.closest('a')) { links.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); burger.innerHTML = '<i class="fa-solid fa-bars"></i>'; } });
    var onScroll = function () { el.classList.toggle('is-scrolled', window.scrollY > 12); };
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

    // Élève déjà connecté : « Mon espace » au lieu de « Essai gratuit »
    if (window.RB && RB.ready) RB.ready.then(function (sb) {
      if (!sb) return;
      sb.auth.getSession().then(function (r) {
        if (!r.data.session) return;
        var g = el.querySelector('[data-rb-guest]'); if (g) g.remove();
        var u = r.data.session.user, m = u.user_metadata || {};
        var first = (m.first_name || m.full_name || m.name || (u.email || '').split('@')[0] || '').split(' ')[0];
        var safe = String(first).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
        var cta = el.querySelector('[data-rb-guest-cta]');
        if (cta) { cta.href = 'relbrain-accueil.html'; cta.innerHTML = (safe ? 'Mon espace · ' + safe : 'Mon espace') + ' <i class="fa-solid fa-arrow-right"></i>'; }
        // Le profil (table profiles) est la source de vérité si le prénom a été modifié
        sb.from('profiles').select('first_name').eq('id', u.id).maybeSingle().then(function (p) {
          var f = p && p.data && p.data.first_name;
          if (f && cta) cta.innerHTML = 'Mon espace · ' + String(f).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }) + ' <i class="fa-solid fa-arrow-right"></i>';
        });
      });
    });
  }

  function footer(el) {
    el.className = 'rb-site-footer';
    var col = function (title, items) {
      return '<div><h4>' + title + '</h4><ul>' + items.map(function (i) { return '<li><a href="' + i[0] + '">' + i[1] + '</a></li>'; }).join('') + '</ul></div>';
    };
    el.innerHTML =
      '<div class="rb-site-footer__grid">' +
        '<div>' + LOGO.replace('class="rb-logo"', 'class="rb-logo" style="color:#fff"') +
          '<p style="margin:1rem 0 1.25rem;font-size:.9rem;line-height:1.6;max-width:22rem">Le coach d\'étude qui transforme tes cours en quiz, flashcards et révisions espacées. Pensé pour les élèves et étudiants d\'Afrique francophone.</p>' +
          '<div class="rb-row" style="--rb-gap:.5rem">' +
            [[SOCIAL.discord, 'fa-discord', 'Discord'], [SOCIAL.whatsappChannel, 'fa-whatsapp', 'WhatsApp'], [SOCIAL.tiktok, 'fa-tiktok', 'TikTok'], [SOCIAL.instagram, 'fa-instagram', 'Instagram'], [SOCIAL.youtube, 'fa-youtube', 'YouTube']]
              .map(function (s) { return '<a href="' + s[0] + '" target="_blank" rel="noopener" aria-label="RelBrain sur ' + s[2] + '" style="width:2.25rem;height:2.25rem;border-radius:.6rem;background:rgba(255,255,255,.07);display:inline-flex;align-items:center;justify-content:center"><i class="fa-brands ' + s[1] + '"></i></a>'; }).join('') +
          '</div>' +
        '</div>' +
        col('Produit', [['index.html#features', 'Fonctionnalités'], ['index.html#pricing', 'Tarifs'], ['relbrain-integrations.html', 'API & intégrations'], ['relbrain-design-system.html', 'Design system']]) +
        col('Apprendre', [['relbrain-blog.html', 'Blog'], ['relbrain-documentation.html', 'Guide d\'utilisation'], ['relbrain-support.html', 'Centre d\'aide'], ['relbrain-communautes.html', 'Communautés']]) +
        col('Contact', [['relbrain-contact.html', 'Nous écrire'], ['relbrain-contact.html?sujet=bug', 'Signaler un bug'], ['relbrain-contact.html?sujet=feature', 'Proposer une idée'], ['relbrain-contact.html?sujet=partnership', 'Écoles & partenariats']]) +
        col('Légal', [['relbrain-mentions-legales.html', 'Mentions légales'], ['relbrain-cgu.html', 'CGU'], ['relbrain-confidentialite.html', 'Confidentialité'], ['relbrain-confidentialite.html#cookies', 'Cookies']]) +
      '</div>' +
      '<p class="rb-site-footer__big" aria-hidden="true">apprendre, vraiment.</p>' +
      '<div class="rb-site-footer__bottom">' +
        '<span>© ' + new Date().getFullYear() + ' RelBrain AI · Fait à Douala avec 💜</span>' +
        '<span><i class="fa-solid fa-shield-halved" style="color:#34d399"></i> Données chiffrées · <i class="fa-solid fa-mobile-screen" style="color:#fbbf24"></i> Orange Money & MTN MoMo acceptés</span>' +
      '</div>';
  }

  /* Sommaire automatique + surbrillance de la section lue (pages légales, guide).
     <nav class="rb-docs-nav" data-rb-toc></nav> → liens vers les h2[id] de .rb-prose */
  function toc(nav) {
    var heads = Array.prototype.slice.call(document.querySelectorAll('.rb-prose h2[id]'));
    if (!heads.length) return;
    if (!nav.children.length) {
      nav.innerHTML = '<h5>Sur cette page</h5>' + heads.map(function (h) {
        return '<a href="#' + h.id + '">' + h.textContent.replace(/^\d+\.\s*/, '') + '</a>';
      }).join('');
    }
    var links = nav.querySelectorAll('a[href^="#"]');
    function spy() {
      var current = heads[0].id;
      heads.forEach(function (h) { if (h.getBoundingClientRect().top < 140) current = h.id; });
      links.forEach(function (a) { a.classList.toggle('is-active', a.getAttribute('href') === '#' + current); });
    }
    window.addEventListener('scroll', spy, { passive: true }); spy();
  }

  function boot() {
    document.querySelectorAll('[data-rb-site-header]').forEach(header);
    document.querySelectorAll('[data-rb-site-footer]').forEach(footer);
    document.querySelectorAll('[data-rb-toc]').forEach(toc);
    if (window.RB && RB.setTheme) RB.setTheme(RB.getTheme()); // met à jour l'icône du thème
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
