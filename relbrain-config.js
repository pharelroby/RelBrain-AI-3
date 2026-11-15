/* ═══════════════════════════════════════════════════════════════════════════
   RELBRAIN — CONFIGURATION PUBLIQUE DU NAVIGATEUR
   ───────────────────────────────────────────────────────────────────────────
   Ce fichier est servi à tous les visiteurs : n'y mets QUE des clés
   publiques. Les clés secrètes (service_role, OpenAI, Stripe, Mobile
   Money…) vont dans .env.local / Vercel, jamais ici.

   Tant que SUPABASE_URL est vide, le site fonctionne en MODE DÉMO :
   les pages affichent leurs données d'exemple, sans compte ni base.
   ═══════════════════════════════════════════════════════════════════════════ */
window.RB_CONFIG = {
  // ═══════════════════════════════════════════════════════════════
  // 🚀 RÉGLAGES DU LANCEMENT — tu peux les changer sans risque
  // ────────────────────────────────────────────────────────────────
  // Modifie la valeur, enregistre, recharge la page. C'est tout.
  // ═══════════════════════════════════════════════════════════════

  // Paiements (Mobile Money, carte). false = les offres Pro et Premium
  // s'affichent avec « Bientôt disponible » et rien n'est encaissé.
  // Pour les ouvrir un jour : mets true ici ET PAYMENTS_ENABLED=true
  // dans les variables du serveur (.env.local et Vercel).
  PAIEMENTS_ACTIFS: false,

  // Petit badge en bas à gauche de chaque page. Mets '' pour le cacher.
  BADGE_TEST: 'Version de test · gratuit pendant le lancement',

  // Où mène le lien « Donner mon avis » du badge.
  LIEN_AVIS: 'relbrain-contact.html',

  // ═══════════════════════════════════════════════════════════════
  // 🔑 CLÉS SUPABASE PUBLIQUES À INSÉRER ICI
  // ────────────────────────────────────────────────────────────────
  // 1. Va sur https://supabase.com/dashboard → ton projet
  // 2. Project Settings → API
  // 3. Copie « Project URL » et la clé « anon public » (ou
  //    « publishable ») ci-dessous — les mêmes valeurs que
  //    SUPABASE_URL et SUPABASE_ANON_KEY dans .env.local
  // 4. Recharge la page
  // ✅ La clé anon est faite pour être publique : la sécurité repose
  //    sur les règles RLS des migrations SQL.
  // ═══════════════════════════════════════════════════════════════
  SUPABASE_URL: 'https://tuyhhcfghvhqyoqebuds.supabase.co',        // ⬅️ LA CLÉ EST ICI (URL du projet)
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1eWhoY2ZnaHZocXlvcWVidWRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MTIyMTMsImV4cCI6MjEwMDE4ODIxM30.d1e5SOkMkQnzzzpoDjjWk21jgnI0Tvl9qQ25wPjGKXA',   // ⬅️ LA CLÉ EST ICI (clé « anon » publique)

  // ═══════════════════════════════════════════════════════════════
  // 🔑 CLÉ PUBLIQUE VAPID (NOTIFICATIONS PUSH) — optionnelle
  // ────────────────────────────────────────────────────────────────
  // Même valeur que VAPID_PUBLIC_KEY dans .env.local (npm run vapid).
  // Laisse vide : elle sera lue automatiquement sur /api/notifications/subscribe.
  // ═══════════════════════════════════════════════════════════════
  VAPID_PUBLIC_KEY: '',

  // Racine des fonctions /api. Vide = même domaine (recommandé sur Vercel).
  API_BASE: '',

  // Connexion par Google : désactivée (connexion uniquement par email + mot de passe).
  GOOGLE_AUTH: false,
};

// Badge « Version de test » (texte réglé plus haut, BADGE_TEST)
(function () {
  var c = window.RB_CONFIG, text = c.BADGE_TEST;
  if (!text || /maintenance/.test(location.pathname)) return;
  try { if (sessionStorage.getItem('rb-badge-off')) return; } catch (e) {}
  function mount() {
    var b = document.createElement('div');
    b.setAttribute('role', 'note');
    b.style.cssText = 'position:fixed;left:.75rem;bottom:.75rem;z-index:150;display:flex;align-items:center;gap:.5rem;max-width:calc(100vw - 1.5rem);padding:.4rem .5rem .4rem .75rem;border-radius:999px;background:var(--rb-surface,#fff);border:1px solid var(--rb-line,#e7d9c5);box-shadow:0 8px 24px -10px rgba(26,16,51,.3);font:700 .7rem/1.3 var(--rb-font-ui,system-ui,sans-serif);color:var(--rb-ink-2,#3f3651)';
    b.innerHTML = '<span aria-hidden="true">🧪</span><span></span>' +
      (c.LIEN_AVIS ? '<a style="color:var(--rb-violet,#7c3aed);white-space:nowrap;text-decoration:underline">Donner mon avis</a>' : '') +
      '<button type="button" aria-label="Masquer" style="border:0;background:none;cursor:pointer;color:inherit;opacity:.6;font-size:.9rem;line-height:1;padding:0 .25rem">×</button>';
    b.children[1].textContent = text;
    if (c.LIEN_AVIS) {
      b.querySelector('a').href = c.LIEN_AVIS;
      // Élève connecté (pages de l'application) : le lien ouvre directement la fenêtre d'avis
      if (document.body.hasAttribute('data-rb-private') || document.querySelector('.sidebar, #sidebar')) b.querySelector('a').setAttribute('data-rb-avis', '');
    }
    b.querySelector('button').onclick = function () { b.remove(); try { sessionStorage.setItem('rb-badge-off', '1'); } catch (e) {} };
    document.body.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();

// Mode réel : on masque les noms/XP d'exemple des maquettes jusqu'à ce que
// relbrain-app.js ait chargé le profil de l'utilisateur connecté (pas de
// « Pharel FOFE » qui clignote avant le vrai nom).
(function () {
  var c = window.RB_CONFIG;
  if (!c.SUPABASE_URL || !c.SUPABASE_ANON_KEY) return;
  var html = document.documentElement;
  html.classList.add('rb-loading');
  var st = document.createElement('style');
  st.textContent = 'html.rb-loading [data-rb]{visibility:hidden}';
  document.head.appendChild(st);
  setTimeout(function () { html.classList.remove('rb-loading'); }, 6000); // filet de sécurité
})();
