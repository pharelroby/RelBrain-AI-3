-- ═══════════════════════════════════════════════════════════════════════════
-- RELBRAIN — 0005 · TÂCHES PLANIFIÉES (pg_cron)
-- Prérequis : Dashboard Supabase → Database → Extensions → activer « pg_cron ».
-- Les heures sont en UTC. Douala = UTC+1 (pas d'heure d'été).
--
-- Tâches gérées côté base (aucun service externe requis) :
--   · séries interrompues : toutes les heures (fuseaux horaires variés)
--   · clôture des ligues   : dimanche 23:00 UTC = lundi 00:00 à Douala
--   · habitudes d'étude    : chaque nuit
--   · purge rate_limits    : chaque nuit
-- Les envois push / email sont faits par Vercel Cron (/api/cron/*, vercel.json).
-- ═══════════════════════════════════════════════════════════════════════════
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule(jobname) from cron.job
   where jobname in ('rb-streaks', 'rb-leagues', 'rb-habits', 'rb-rate-limits');
exception when others then null;
end $$;

select cron.schedule('rb-streaks',     '5 * * * *',  $$select public.streak_maintenance()$$);
select cron.schedule('rb-leagues',     '0 23 * * 0', $$select public.finalize_league_weeks()$$);
select cron.schedule('rb-habits',      '30 2 * * *', $$select public.refresh_study_habits()$$);
select cron.schedule('rb-rate-limits', '45 2 * * *', $$select public.purge_rate_limits()$$);
