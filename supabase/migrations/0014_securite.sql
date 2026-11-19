-- ═══════════════════════════════════════════════════════════════════════════
-- Sécurité (défense en profondeur), en plus des règles RLS déjà en place :
-- 1. Messages de contact : uniquement via le serveur (/api/contact, limité à
--    5 messages / heure / IP). Plus d'écriture directe depuis le navigateur,
--    qui permettait d'inonder la boîte de réception en contournant la limite.
-- 2. Visiteurs non connectés (anon) : aucun droit d'écriture sur aucune table.
-- 3. Personne ne peut vider une table entière (TRUNCATE ignore les règles RLS).
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "contact insert" on public.contact_messages;

revoke insert, update, delete, truncate on all tables in schema public from anon;
revoke truncate on all tables in schema public from authenticated;
alter default privileges in schema public revoke insert, update, delete, truncate on tables from anon;
alter default privileges in schema public revoke truncate on tables from authenticated;
