-- ═══════════════════════════════════════════════════════════════════════════
-- 0010 — Lancement sur les plans gratuits
-- Le plan gratuit de Vercel n'exécute les tâches planifiées qu'une fois par
-- jour. p_any_hour = true : on relance tous les élèves qui n'ont pas étudié
-- aujourd'hui, sans attendre « leur » heure (sinon presque personne ne
-- recevrait de rappel). Avec un cron horaire (plan payant), laisser false.
-- ═══════════════════════════════════════════════════════════════════════════
drop function if exists public.users_due_for_reminder();

create or replace function public.users_due_for_reminder(p_any_hour boolean default false) returns table (
  user_id uuid, email text, first_name text, streak integer, due_cards integer, local_hour integer, push boolean, mail boolean
)
language sql stable security definer set search_path = public, auth as $$
  select p.id, u.email::text, p.first_name, p.streak_current,
         (select count(*)::integer from public.flashcards f where f.user_id = p.id and f.due_at <= now()),
         extract(hour from now() at time zone p.timezone)::integer,
         coalesce(np.channel_push, true), coalesce(np.channel_email, true)
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.notification_preferences np on np.user_id = p.id
   where coalesce(np.reminders, true)
     and u.email_confirmed_at is not null
     and (p.last_study_date is null or p.last_study_date < public.user_today(p.id))
     and (p_any_hour or extract(hour from now() at time zone p.timezone)::integer
         = coalesce(np.reminder_hour, p.preferred_study_hour, 18))
     and not exists (
       select 1 from public.notifications n
        where n.user_id = p.id and n.category = 'reminder' and n.created_at > now() - interval '20 hours')
$$;

revoke execute on function public.users_due_for_reminder(boolean) from public, anon, authenticated;
grant execute on function public.users_due_for_reminder(boolean) to service_role;
