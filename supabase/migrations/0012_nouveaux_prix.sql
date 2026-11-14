-- ═══════════════════════════════════════════════════════════════════════════
-- 0012 — Nouveaux prix (étude de marché de novembre 2026, voir ETUDE-PRIX.md)
--   Pro     : 3 000 FCFA / mois  (30 000 FCFA l'année, 12 mois au prix de 10) · 4,90 € par carte
--   Premium : 6 500 FCFA / mois  (65 000 FCFA l'année)                         · 9,90 € par carte
-- Pour changer un prix plus tard : modifie les nombres ci-dessous et exécute
-- ce fichier dans Supabase → SQL Editor. Le site lit les prix dans cette table.
-- ═══════════════════════════════════════════════════════════════════════════
update public.plans set price_xaf = 3000, price_eur_cents = 490 where id = 'pro';
update public.plans set price_xaf = 6500, price_eur_cents = 990 where id = 'premium';
