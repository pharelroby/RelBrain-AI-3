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
  SUPABASE_URL: '',        // ⬅️ ex. 'https://abcdefgh.supabase.co'
  SUPABASE_ANON_KEY: '',   // ⬅️ ex. 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…'

  // ═══════════════════════════════════════════════════════════════
  // 🔑 CLÉ PUBLIQUE VAPID (NOTIFICATIONS PUSH) — optionnelle
  // ────────────────────────────────────────────────────────────────
  // Même valeur que VAPID_PUBLIC_KEY dans .env.local (npm run vapid).
  // Laisse vide : elle sera lue automatiquement sur /api/notifications/subscribe.
  // ═══════════════════════════════════════════════════════════════
  VAPID_PUBLIC_KEY: '',

  // Racine des fonctions /api. Vide = même domaine (recommandé sur Vercel).
  API_BASE: '',

  // Afficher le bouton « Continuer avec Google » (activer le fournisseur
  // dans Supabase → Authentication → Providers → Google).
  GOOGLE_AUTH: true,
};
