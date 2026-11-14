-- ═══════════════════════════════════════════════════════════════════════════
-- RELBRAIN — 0007 · DURCISSEMENT (suite à l'audit « Security Advisor »)
-- · Les RPC du site sont réservées aux élèves connectés : on retire
--   l'exécution au rôle anon (visiteur non connecté).
-- · search_path figé sur les fonctions utilitaires.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare f text;
begin
  foreach f in array array[
    'check_answer(uuid,uuid,jsonb,integer)', 'finish_quiz_attempt(uuid,integer)', 'start_quiz_attempt(uuid)',
    'review_flashcard(uuid,text,integer)', 'log_study_session(text,integer,uuid,text,integer)',
    'get_global_leaderboard(integer)', 'get_league_leaderboard()', 'get_my_gamification()',
    'get_my_league_history()', 'get_my_quota()', 'get_recommendations()', 'mark_notifications_read(uuid[])',
    'get_leaderboard(text,text,integer)', 'register_document(text,text,text,text,bigint,text,text)',
    'get_due_flashcards(uuid,integer)', 'get_weak_points(integer)', 'get_activity(integer,text,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

alter function public.tg_set_updated_at()        set search_path = public;
alter function public.xp_for_level(integer)      set search_path = public;
alter function public.level_for_xp(integer)      set search_path = public;
alter function public.league_today()             set search_path = public;
alter function public.week_start(date)           set search_path = public;
alter function public.normalize_answer(text)     set search_path = public;
